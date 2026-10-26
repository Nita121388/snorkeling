// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Background AI metadata generation (title / note+tags).
//
// The queue is fed from two places:
//
//   - the automatic scan funnel (enqueueAutoTitles): only titles, gated by the
//     ai:sessionautotitle setting, at most one attempt per session ever;
//   - explicit user actions (EnqueueManualGeneration): title / metadata / both,
//     always allowed, retried with exponential backoff on transient failures.
//
// The worker is deliberately conservative:
//
//   - It never performs I/O or AI work on the request path: enqueue only writes
//     to an in-memory map and pokes a capacity-1 channel.
//   - It is serial: one goroutine per index path, so a burst of clicks cannot
//     fan out into parallel model calls.
//   - It is idempotent per (session, kind): pending jobs dedupe on key|kind and
//     every automatic attempt is persisted so a restart does not repeat it.
//   - It never overwrites a user title unless the caller passes Force.
//   - It publishes status transitions so the GUI can show queued/running/failed
//     without polling.

package aisessions

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

const (
	defaultAutoTitleIntervalMs = 1500
	defaultAutoTitleBatchSize  = 20
	autoTitleRequestTimeout    = 90 * time.Second

	// ManualGenerationMaxAttempts is the total number of attempts for a
	// user-triggered job (1 initial + retries).
	ManualGenerationMaxAttempts = 3
)

// manualRetryBackoff is indexed by the completed attempt count: after attempt 0
// fails wait 2s, after attempt 1 fails wait 5s, after attempt 2 fails wait 15s
// (then give up).
var manualRetryBackoff = []time.Duration{2 * time.Second, 5 * time.Second, 15 * time.Second}

// Generation kind values shared by the queue, RPC and event payloads.
const (
	GenKindTitle    = "title"
	GenKindMetadata = "metadata"
	GenKindBoth     = "both"
)

// Status values published by GenerationStatusEvent.
const (
	GenStateQueued  = "queued"
	GenStateRunning = "running"
	GenStateDone    = "done"
	GenStateFailed  = "failed"
)

var (
	errSkipUserTitle           = errors.New("session has a user-defined title")
	errTitleFeatureDisabled    = errors.New("session title generation is disabled in AI Prompts settings")
	errMetadataFeatureDisabled = errors.New("session note & tags generation is disabled in AI Prompts settings")
	errSkipMissing             = errors.New("session is missing")
)

func autoTitleEnabled() bool {
	cfg := wconfig.GetWatcher().GetFullConfig()
	value := cfg.Settings.AiSessionAutoTitle
	return value != nil && *value
}

func autoTitleInterval() time.Duration {
	cfg := wconfig.GetWatcher().GetFullConfig()
	ms := defaultAutoTitleIntervalMs
	if v := cfg.Settings.AiSessionAutoTitleIntervalMs; v != nil && *v >= 0 {
		ms = int(*v)
	}
	return time.Duration(ms) * time.Millisecond
}

// autoTitleConcurrency controls how many jobs run at once per index path. The
// AI calls are independent; SQLite writes serialize on the busy-timeout.
func autoTitleConcurrency() int {
	cfg := wconfig.GetWatcher().GetFullConfig()
	value := 3
	if v := cfg.Settings.AiSessionAutoTitleConcurrency; v != nil && *v > 0 {
		value = int(*v)
	}
	if value > 8 {
		value = 8
	}
	return value
}

func autoTitleBatchSize() int {
	cfg := wconfig.GetWatcher().GetFullConfig()
	size := defaultAutoTitleBatchSize
	if v := cfg.Settings.AiSessionAutoTitleBatchSize; v != nil && *v > 0 {
		size = int(*v)
	}
	return size
}

// autoTitlePromptConfig reads the per-feature prompt override from aiprompts.json,
// mirroring the service layer's promptConfigForFeature so the background worker
// honors the same custom prompt / limits.
func autoTitlePromptConfig() wconfig.AIPromptConfigType {
	return PromptConfigForFeature(PromptFeatureSessionTitle)
}

// autoTitleEligible reports whether a summary should get an automatic background
// AI title. Pure function so the eligibility matrix is unit-testable without a
// DB/worker.
func autoTitleEligible(s SessionSummary) bool {
	if strings.TrimSpace(s.Key) == "" || s.Missing {
		return false
	}
	switch s.TitleSource {
	case "user", "ai", "source_title":
		return false
	}
	return s.AITitleAttemptedAt == 0
}

type genJob struct {
	key          string
	projectPath  string
	messageCount int
	connection   string
	kind         string
	manual       bool
	force        bool
	attempt      int
	aiMode       string
	// source 是 UI 入口（agent-card / session-row / detail / batch / auto-scan），
	// 写进审计用于回答"我点了哪里"。
	source string
}

func genJobPendingKey(job genJob) string {
	return job.key + "|" + job.kind
}

type autoTitleQueue struct {
	mu            sync.Mutex
	pending       map[string]genJob
	order         []string
	wake          chan struct{}
	started       bool
	providers     []Provider
	indexPath     string
	metaPath      string
	sqlitePath    string
	publish       func(SessionSummary)
	publishStatus func(GenerationStatusEvent)
}

// autoTitleWorkers is a package-level registry keyed by index path so that the
// per-request Manager instances (created fresh on every RPC) all funnel into the
// same long-lived worker. This mirrors scanFlights / backgroundScans.
var autoTitleWorkers = struct {
	mu sync.Mutex
	m  map[string]*autoTitleQueue
}{m: make(map[string]*autoTitleQueue)}

func autoTitleQueueFor(key string, newQueue func() *autoTitleQueue) *autoTitleQueue {
	autoTitleWorkers.mu.Lock()
	defer autoTitleWorkers.mu.Unlock()
	if q, ok := autoTitleWorkers.m[key]; ok {
		return q
	}
	q := newQueue()
	autoTitleWorkers.m[key] = q
	return q
}

// enqueueAutoTitles is the hot-path entry point for the automatic funnel. It
// must stay O(len(summaries)) and non-blocking; it never performs I/O or AI work.
func (m *Manager) enqueueAutoTitles(summaries []SessionSummary) {
	if !autoTitleEnabled() || len(summaries) == 0 {
		return
	}
	var jobs []genJob
	for _, summary := range summaries {
		if !autoTitleEligible(summary) {
			continue
		}
		jobs = append(jobs, genJob{
			key:          summary.Key,
			projectPath:  summary.ProjectPath,
			messageCount: summary.MessageCount,
			kind:         GenKindTitle,
			manual:       false,
		})
	}
	if len(jobs) == 0 {
		return
	}
	q := m.autoTitleWorker()
	for _, job := range jobs {
		q.push(job)
	}
}

// ManualGenerationRequest is the exported shape the service layer uses to
// enqueue a user-triggered generation job.
type ManualGenerationRequest struct {
	Key        string
	Kind       string
	Connection string
	Force      bool
	AIMode     string
	Source     string
}

// EnqueueManualGeneration admits user-triggered jobs into the same serial worker
// used by the automatic funnel. It is O(len(reqs)) and never performs AI work.
func (m *Manager) EnqueueManualGeneration(reqs []ManualGenerationRequest) []string {
	if len(reqs) == 0 {
		return nil
	}
	q := m.autoTitleWorker()
	queued := make([]string, 0, len(reqs))
	for _, req := range reqs {
		key := strings.TrimSpace(req.Key)
		if key == "" {
			continue
		}
		kind := normalizeGenKind(req.Kind)
		if kind == "" {
			continue
		}
		job := genJob{
			key:        key,
			kind:       kind,
			manual:     true,
			force:      req.Force,
			connection: strings.TrimSpace(req.Connection),
			aiMode:     strings.TrimSpace(req.AIMode),
			source:     strings.TrimSpace(req.Source),
		}
		q.push(job)
		q.status(job, GenStateQueued, nil)
		queued = append(queued, key)
	}
	return queued
}

func normalizeGenKind(kind string) string {
	switch strings.TrimSpace(strings.ToLower(kind)) {
	case GenKindTitle:
		return GenKindTitle
	case GenKindMetadata:
		return GenKindMetadata
	case GenKindBoth:
		return GenKindBoth
	}
	return ""
}

func (m *Manager) autoTitleWorker() *autoTitleQueue {
	key := m.scanKey()
	return autoTitleQueueFor(key, func() *autoTitleQueue {
		q := &autoTitleQueue{
			pending:       make(map[string]genJob),
			wake:          make(chan struct{}, autoTitleConcurrency()),
			providers:     append([]Provider(nil), m.Providers...),
			indexPath:     m.IndexPath,
			metaPath:      m.MetaPath,
			sqlitePath:    m.SQLitePath,
			publish:       m.OnTitleUpdated,
			publishStatus: m.OnGenerationStatus,
		}
		q.startWorkers(autoTitleConcurrency())
		return q
	})
}

func (q *autoTitleQueue) push(job genJob) {
	if strings.TrimSpace(job.key) == "" {
		return
	}
	pk := genJobPendingKey(job)
	q.mu.Lock()
	if _, exists := q.pending[pk]; !exists {
		q.pending[pk] = job
		q.order = append(q.order, pk)
	}
	q.mu.Unlock()
	q.poke()
}

func (q *autoTitleQueue) pop() (genJob, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	for len(q.order) > 0 {
		pk := q.order[0]
		q.order = q.order[1:]
		if job, ok := q.pending[pk]; ok {
			delete(q.pending, pk)
			return job, true
		}
	}
	return genJob{}, false
}

// startWorkers boots a bounded pool. Concurrency is intentionally limited:
// model providers rate-limit aggressively, so 2-4 is the sweet spot.
func (q *autoTitleQueue) startWorkers(count int) {
	if count < 1 {
		count = 1
	}
	for i := 0; i < count; i++ {
		go q.worker()
	}
}

func (q *autoTitleQueue) worker() {
	for {
		job, ok := q.pop()
		if !ok {
			<-q.wake
			continue
		}
		q.runOne(job)
		// Automatic jobs are paced to avoid burning quota during scans; manual
		// (user-triggered) jobs only get a tiny gap so a batch of 50 actually
		// benefits from the pool.
		if job.manual {
			time.Sleep(100 * time.Millisecond)
		} else {
			time.Sleep(autoTitleInterval())
		}
		if q.hasPending() {
			q.poke()
		}
	}
}

func (q *autoTitleQueue) poke() {
	select {
	case q.wake <- struct{}{}:
	default:
	}
}

func (q *autoTitleQueue) hasPending() bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.order) > 0
}

func (q *autoTitleQueue) newManager() *Manager {
	return NewManagerWithOptions(ManagerOptions{
		Providers:          q.providers,
		IndexPath:          q.indexPath,
		MetaPath:           q.metaPath,
		SQLitePath:         q.sqlitePath,
		OnTitleUpdated:     q.publish,
		OnGenerationStatus: q.publishStatus,
	})
}

func (q *autoTitleQueue) status(job genJob, state string, err error) {
	if q.publishStatus == nil {
		return
	}
	event := GenerationStatusEvent{
		Key:         job.key,
		Kind:        job.kind,
		Connection:  job.connection,
		State:       state,
		Attempt:     job.attempt + 1,
		MaxAttempts: 1,
		UpdatedAt:   time.Now().UnixMilli(),
	}
	if job.manual {
		event.MaxAttempts = ManualGenerationMaxAttempts
	}
	if err != nil {
		event.Error = err.Error()
	}
	q.publishStatus(event)
}

// runOne resolves the session, re-checks eligibility against the freshest state,
// then dispatches to the requested kind(s). Every failure is either retried (for
// manual jobs) or recorded as an automatic attempt marker.
func (q *autoTitleQueue) runOne(job genJob) {
	m := q.newManager()
	ctx, cancel := context.WithTimeout(context.Background(), autoTitleRequestTimeout)
	defer cancel()

	summary, err := m.resolveSessionForMetaWrite(ctx, job.key)
	if err != nil {
		q.fail(m, summary, job, fmt.Errorf("resolve session: %w", err))
		return
	}
	if job.manual {
		if summary.Missing {
			q.fail(m, summary, job, errSkipMissing)
			return
		}
	} else if !autoTitleEligible(summary) {
		return
	}

	q.status(job, GenStateRunning, nil)

	startedAt := time.Now()
	auditID, _ := m.AuditBegin(ctx, AuditInput{
		Feature:    job.kind,
		Scope:      job.source,
		SessionKey: summary.Key,
		Connection: job.connection,
		Trigger:    map[bool]string{true: AuditTriggerManual, false: AuditTriggerAuto}[job.manual],
		AIModel:    job.aiMode,
	})

	var runErr error
	switch job.kind {
	case GenKindMetadata:
		_, runErr = q.runMetadata(ctx, m, summary, job)
	case GenKindBoth:
		if _, err := q.runTitle(ctx, m, summary, job); err != nil {
			runErr = err
			break
		}
		_, runErr = q.runMetadata(ctx, m, summary, job)
	default:
		_, runErr = q.runTitle(ctx, m, summary, job)
	}

	if runErr != nil {
		_ = m.AuditFinish(context.Background(), auditID, AuditResult{
			State:      AuditStateFailed,
			Error:      runErr.Error(),
			DurationMs: time.Since(startedAt).Milliseconds(),
		})
		q.fail(m, summary, job, runErr)
		return
	}
	if !job.manual {
		_ = m.markAITitleAttempt(context.Background(), summary.Key, summary.MessageCount)
	}
	_ = m.AuditFinish(context.Background(), auditID, AuditResult{
		State:       AuditStateDone,
		AIModel:     job.aiMode,
		ResultCount: 1,
		DurationMs:  time.Since(startedAt).Milliseconds(),
	})
	q.status(job, GenStateDone, nil)
}

// fail emits the failed status and decides whether a manual job is retried.
// Automatic jobs keep their original at-most-once contract; manual jobs retry
// transient errors with exponential backoff and stop on configuration errors.
func (q *autoTitleQueue) fail(m *Manager, summary SessionSummary, job genJob, err error) {
	q.status(job, GenStateFailed, err)
	if !job.manual {
		_ = m.markAITitleAttempt(context.Background(), summary.Key, summary.MessageCount)
		return
	}
	if !isRetryableGenerationError(err) {
		return
	}
	if job.attempt+1 >= ManualGenerationMaxAttempts {
		return
	}
	delay := manualRetryBackoff[job.attempt]
	job.attempt++
	time.AfterFunc(delay, func() {
		q.push(job)
	})
}

func isRetryableGenerationError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, errSkipUserTitle) ||
		errors.Is(err, errSkipMissing) ||
		errors.Is(err, errTitleFeatureDisabled) ||
		errors.Is(err, errMetadataFeatureDisabled) {
		return false
	}
	return true
}

func (q *autoTitleQueue) runTitle(ctx context.Context, m *Manager, summary SessionSummary, job genJob) (SessionSummary, error) {
	if summary.TitleSource == "user" && !job.force {
		return SessionSummary{}, errSkipUserTitle
	}
	promptCfg := PromptConfigForFeature(PromptFeatureSessionTitle)
	if !PromptEnabled(promptCfg) {
		return SessionSummary{}, errTitleFeatureDisabled
	}
	detail, err := m.Load(ctx, summary.Key, LoadOptions{})
	if err != nil {
		return SessionSummary{}, err
	}
	suggestion, err := GenerateSessionTitle(ctx, TitleGenerateRequest{
		SessionKey:    detail.Summary.Key,
		Source:        detail.Summary.Source,
		ProjectPath:   detail.Summary.ProjectPath,
		Messages:      detail.Messages,
		ExistingTitle: detail.Summary.Title,
		AIMode:        job.aiMode,
		PromptConfig:  promptCfg,
	})
	if err != nil {
		return SessionSummary{}, err
	}
	title := strings.TrimSpace(suggestion.Title)
	if title == "" {
		return SessionSummary{}, fmt.Errorf("AI title generation returned an empty title")
	}
	updated, err := m.setAutoTitle(ctx, summary.Key, title)
	if err != nil {
		return SessionSummary{}, err
	}
	if q.publish != nil {
		q.publish(updated)
	}
	return updated, nil
}

func (q *autoTitleQueue) runMetadata(ctx context.Context, m *Manager, summary SessionSummary, job genJob) (SessionSummary, error) {
	promptCfg := PromptConfigForFeature(PromptFeatureSessionNoteTags)
	if !PromptEnabled(promptCfg) {
		return SessionSummary{}, errMetadataFeatureDisabled
	}
	detail, err := m.Load(ctx, summary.Key, LoadOptions{})
	if err != nil {
		return SessionSummary{}, err
	}
	suggestion, err := GenerateSessionMetadata(ctx, MetadataGenerateRequest{
		SessionKey:   detail.Summary.Key,
		Source:       detail.Summary.Source,
		ProjectPath:  detail.Summary.ProjectPath,
		Messages:     detail.Messages,
		ExistingNote: detail.Summary.Note,
		ExistingTags: detail.Summary.Tags,
		AIMode:       job.aiMode,
		PromptConfig: promptCfg,
	})
	if err != nil {
		return SessionSummary{}, err
	}
	updated, err := m.NoteAndTags(ctx, summary.Key, strings.TrimSpace(suggestion.Note), suggestion.Tags)
	if err != nil {
		return SessionSummary{}, err
	}
	if q.publish != nil {
		q.publish(updated)
	}
	return updated, nil
}
