// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Async runner for annotation AI drafts.
//
// The RPC only enqueues; the model call happens on a bounded worker pool so the
// request path never blocks. Each job can be cancelled via its job id. Results
// (or errors) are published as wps events; nothing is written to the database.

package aisessions

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

// AnnotationAssistConcurrency caps parallel model calls for annotation drafts.
const AnnotationAssistConcurrency = 3

var annotationAssistSem = make(chan struct{}, AnnotationAssistConcurrency)

var annotationAssistJobs = struct {
	mu      sync.Mutex
	cancels map[string]context.CancelFunc
}{cancels: make(map[string]context.CancelFunc)}

// AnnotationAssistEvent is published on every annotation job transition.
type AnnotationAssistEvent struct {
	JobID      string            `json:"jobId"`
	SessionKey string            `json:"key"`
	Connection string            `json:"connection,omitempty"`
	Scope      string            `json:"scope"`
	State      string            `json:"state"` // queued | running | done | failed | cancelled
	Drafts     []AnnotationDraft `json:"drafts,omitempty"`
	AIModel    string            `json:"aiModel,omitempty"`
	Error      string            `json:"error,omitempty"`
	UpdatedAt  int64             `json:"updatedAt"`
}

func newAnnotationJobID() string {
	raw := make([]byte, 12)
	if _, err := rand.Read(raw); err != nil {
		return "annjob-" + time.Now().Format("150405.000000")
	}
	return "annjob-" + hex.EncodeToString(raw)
}

// StartAnnotationAssist enqueues one job and returns immediately. The worker
// acquires a concurrency slot, runs the model call, and publishes the result.
func StartAnnotationAssist(ctx context.Context, key, connection string, input AnnotationAssistInput, publish func(AnnotationAssistEvent)) string {
	return startAnnotationAssist(key, connection, input, publish)
}

func startAnnotationAssist(key, connection string, input AnnotationAssistInput, publish func(AnnotationAssistEvent)) string {
	jobID := newAnnotationJobID()
	jobCtx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	annotationAssistJobs.mu.Lock()
	annotationAssistJobs.cancels[jobID] = cancel
	annotationAssistJobs.mu.Unlock()

	emit := func(state string, drafts []AnnotationDraft, model string, err error) {
		if publish == nil {
			return
		}
		event := AnnotationAssistEvent{
			JobID:      jobID,
			SessionKey: key,
			Connection: connection,
			Scope:      normalizeAnnotationScope(input.Scope),
			State:      state,
			Drafts:     drafts,
			AIModel:    model,
			UpdatedAt:  time.Now().UnixMilli(),
		}
		if err != nil {
			event.Error = err.Error()
		}
		publish(event)
	}

	emit(GenStateQueued, nil, "", nil)
	auditID, auditErr := beginAssistAudit(key, connection, input)
	go func() {
		_ = auditErr
		startedAt := time.Now()
		defer func() {
			cancel()
			annotationAssistJobs.mu.Lock()
			delete(annotationAssistJobs.cancels, jobID)
			annotationAssistJobs.mu.Unlock()
		}()
		select {
		case annotationAssistSem <- struct{}{}:
			defer func() { <-annotationAssistSem }()
		case <-jobCtx.Done():
			emit(GenStateFailed, nil, "", jobCtx.Err())
			return
		}
		if jobCtx.Err() != nil {
			emit(GenStateFailed, nil, "", jobCtx.Err())
			return
		}
		emit(GenStateRunning, nil, "", nil)
		drafts, model, rawReply, err := GenerateAnnotationDraftsWithContext(jobCtx, input)
		if err != nil {
			state := GenStateFailed
			if jobCtx.Err() != nil {
				state = "cancelled"
			}
			finishAssistAudit(auditID, AuditResult{
				State:       state,
				AIModel:     model,
				Error:       err.Error(),
				DurationMs:  time.Since(startedAt).Milliseconds(),
				RawResponse: rawReply,
			})
			emit(state, nil, model, err)
			return
		}
		kept := 0
		for _, draft := range drafts {
			if draft.AnchorKey != "" {
				kept++
			}
		}
		finishAssistAudit(auditID, AuditResult{
			State:       AuditStateDone,
			AIModel:     model,
			ResultCount: len(drafts),
			AnchorKept:  kept,
			DurationMs:  time.Since(startedAt).Milliseconds(),
			RawResponse: rawReply,
		})
		emit(GenStateDone, drafts, model, nil)
	}()
	return jobID
}

func beginAssistAudit(key, connection string, input AnnotationAssistInput) (int64, error) {
	manager := NewManager("", nil)
	feature := AuditFeatureAnnotationTimeline
	if normalizeAnnotationScope(input.Scope) != AnnotationScopeTimeline {
		feature = AuditFeatureAnnotationField
	}
	return manager.AuditBegin(context.Background(), AuditInput{
		Feature:    feature,
		Scope:      normalizeAnnotationScope(input.Scope),
		SessionKey: key,
		Connection: connection,
		Trigger:    AuditTriggerManual,
		// 审计页要能看出「这次给了多少个候选节点」，否则永远是 0。
		AnchorTotal: len(buildAnnotationDigest(input.Messages, input.ToolCalls)),
	})
}

func finishAssistAudit(id int64, result AuditResult) {
	if id <= 0 {
		return
	}
	_ = NewManager("", nil).AuditFinish(context.Background(), id, result)
}

// CancelAnnotationAssist cancels a running/queued job by id. Unknown ids are a no-op.
func CancelAnnotationAssist(jobID string) {
	annotationAssistJobs.mu.Lock()
	cancel := annotationAssistJobs.cancels[jobID]
	annotationAssistJobs.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}
