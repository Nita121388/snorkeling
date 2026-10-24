// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Background AI title auto-generation.
//
// One serial worker per index path refreshes otherwise-untitled sessions with an
// AI-generated title. The worker is deliberately conservative:
//
//   - It only runs when the ai:sessionautotitle setting is enabled (default off).
//   - It is fed by the list funnel via enqueueAutoTitles, which is O(1) and never
//     blocks the caller: it only inserts into an in-memory map and pokes a
//     capacity-1 channel. No AI call ever happens on the request path.
//   - It is idempotent: every attempt (success or failure) persists an
//     ai_title_attempted_at marker so the same session is never auto-generated
//     twice, across restarts included.
//   - It never overwrites a user title (titleSource "user") or an existing AI
//     title ("ai"), and never touches a provider-provided "source_title".

package aisessions

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

const (
	defaultAutoTitleIntervalMs = 1500
	defaultAutoTitleBatchSize  = 20
	autoTitleRequestTimeout    = 90 * time.Second
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
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	if fullConfig.AIPrompts == nil {
		return wconfig.AIPromptConfigType{}
	}
	return fullConfig.AIPrompts[PromptFeatureSessionTitle]
}

// autoTitleEligible reports whether a summary should get a background AI title.
// Pure function so the eligibility matrix is unit-testable without a DB/worker.
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

type autoTitleJob struct {
	key              string
	source           string
	projectPath      string
	messageCount     int
}

type autoTitleQueue struct {
	mu        sync.Mutex
	pending   map[string]autoTitleJob
	order     []string
	wake      chan struct{}
	started   bool
	providers []Provider
	indexPath string
	metaPath  string
	sqlitePath string
	publish   func(SessionSummary)
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

// enqueueAutoTitles is the hot-path entry point. It must stay O(len(summaries))
// and non-blocking; it never performs I/O or AI work.
func (m *Manager) enqueueAutoTitles(summaries []SessionSummary) {
	if !autoTitleEnabled() || len(summaries) == 0 {
		return
	}
	var jobs []autoTitleJob
	for _, summary := range summaries {
		if !autoTitleEligible(summary) {
			continue
		}
		jobs = append(jobs, autoTitleJob{
			key:          summary.Key,
			source:       summary.Source,
			projectPath:  summary.ProjectPath,
			messageCount: summary.MessageCount,
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

func (m *Manager) autoTitleWorker() *autoTitleQueue {
	key := m.scanKey()
	return autoTitleQueueFor(key, func() *autoTitleQueue {
		q := &autoTitleQueue{
			pending:    make(map[string]autoTitleJob),
			wake:       make(chan struct{}, 1),
			providers:  append([]Provider(nil), m.Providers...),
			indexPath:  m.IndexPath,
			metaPath:   m.MetaPath,
			sqlitePath: m.SQLitePath,
			publish:    m.OnTitleUpdated,
		}
		go q.run()
		return q
	})
}

func (q *autoTitleQueue) push(job autoTitleJob) {
	if strings.TrimSpace(job.key) == "" {
		return
	}
	q.mu.Lock()
	if _, exists := q.pending[job.key]; !exists {
		q.pending[job.key] = job
		q.order = append(q.order, job.key)
	}
	q.mu.Unlock()
	// Non-blocking poke: a full channel already means "there is work pending".
	select {
	case q.wake <- struct{}{}:
	default:
	}
}

func (q *autoTitleQueue) pop() (autoTitleJob, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	for len(q.order) > 0 {
		key := q.order[0]
		q.order = q.order[1:]
		if job, ok := q.pending[key]; ok {
			delete(q.pending, key)
			return job, true
		}
	}
	return autoTitleJob{}, false
}

func (q *autoTitleQueue) run() {
	for range q.wake {
		batch := autoTitleBatchSize()
		for i := 0; i < batch; i++ {
			job, ok := q.pop()
			if !ok {
				break
			}
			if !autoTitleEnabled() {
				break
			}
			q.runOne(job)
			if more := q.hasPending(); !more {
				break
			}
			time.Sleep(autoTitleInterval())
		}
	}
}

func (q *autoTitleQueue) hasPending() bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.order) > 0
}

func (q *autoTitleQueue) newManager() *Manager {
	return NewManagerWithOptions(ManagerOptions{
		Providers:      q.providers,
		IndexPath:      q.indexPath,
		MetaPath:       q.metaPath,
		SQLitePath:     q.sqlitePath,
		OnTitleUpdated: q.publish,
	})
}

// runOne generates a single title. It always records an attempt marker, whether
// the generation succeeded or not, so the session is never retried.
func (q *autoTitleQueue) runOne(job autoTitleJob) {
	m := q.newManager()
	ctx, cancel := context.WithTimeout(context.Background(), autoTitleRequestTimeout)
	defer cancel()

	// Re-check eligibility against the freshest state: the user may have renamed
	// the session (or another pass may have generated a title) since enqueue.
	summary, err := m.resolveSessionForMetaWrite(ctx, job.key)
	if err != nil {
		debugf("autoTitle resolve skipped key=%q err=%v", job.key, err)
		return
	}
	if !autoTitleEligible(summary) {
		return
	}

	promptCfg := autoTitlePromptConfig()
	if !PromptEnabled(promptCfg) {
		debugf("autoTitle feature disabled in AI prompts; skipping key=%q", job.key)
		return
	}

	detail, err := m.Load(ctx, summary.Key, LoadOptions{})
	if err != nil {
		debugf("autoTitle load failed key=%q err=%v", job.key, err)
		_ = m.markAITitleAttempt(context.Background(), summary.Key, summary.MessageCount)
		return
	}

	suggestion, err := GenerateSessionTitle(ctx, TitleGenerateRequest{
		SessionKey:    detail.Summary.Key,
		Source:        detail.Summary.Source,
		ProjectPath:   detail.Summary.ProjectPath,
		Messages:      detail.Messages,
		ExistingTitle: detail.Summary.Title,
		PromptConfig:  promptCfg,
	})
	if err != nil {
		debugf("autoTitle generate failed key=%q err=%v", job.key, err)
		_ = m.markAITitleAttempt(context.Background(), summary.Key, detail.Summary.MessageCount)
		return
	}

	title := strings.TrimSpace(suggestion.Title)
	if title == "" {
		_ = m.markAITitleAttempt(context.Background(), summary.Key, detail.Summary.MessageCount)
		return
	}

	updated, err := m.setAutoTitle(ctx, summary.Key, title)
	if err != nil {
		debugf("autoTitle persist failed key=%q err=%v", job.key, err)
	} else if q.publish != nil {
		q.publish(updated)
	}
	_ = m.markAITitleAttempt(context.Background(), summary.Key, detail.Summary.MessageCount)
}
