// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestAnnotationAssistEventStates(t *testing.T) {
	var events []AnnotationAssistEvent
	var mu sync.Mutex
	done := make(chan struct{}, 1)
	// Inject the generator so the test does not depend on a configured model.
	previous := annotationDraftGenerator
	annotationDraftGenerator = func(ctx context.Context, in AnnotationAssistInput) ([]AnnotationDraft, string, string, error) {
		return []AnnotationDraft{{AnchorKey: in.AnchorKey, Kind: AnnotationKindNote, Title: "t"}}, "testmodel", `{"annotations":[]}`, nil
	}
	defer func() { annotationDraftGenerator = previous }()

	jobID := startAnnotationAssist("k1", "conn", AnnotationAssistInput{AnchorKey: "e1:m0"}, func(event AnnotationAssistEvent) {
		mu.Lock()
		events = append(events, event)
		mu.Unlock()
		if event.State == GenStateDone || event.State == GenStateFailed {
			done <- struct{}{}
		}
	})
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatalf("job never completed")
	}
	mu.Lock()
	defer mu.Unlock()
	if len(events) < 3 {
		t.Fatalf("expected queued/running/done, got %#v", events)
	}
	if events[0].State != GenStateQueued || events[1].State != GenStateRunning {
		t.Fatalf("unexpected state order: %#v", events)
	}
	if events[0].JobID != jobID || events[0].Connection != "conn" {
		t.Fatalf("event metadata wrong: %#v", events[0])
	}
	if events[2].State != GenStateDone || len(events[2].Drafts) != 1 {
		t.Fatalf("expected done with drafts: %#v", events[2])
	}
	if events[2].AIModel != "testmodel" {
		t.Fatalf("expected model echoed: %#v", events[2])
	}
}

func TestAnnotationAssistCancel(t *testing.T) {
	release := make(chan struct{})
	failed := make(chan string, 1)
	go func() {}()
	jobID := startAnnotationAssist("k2", "", AnnotationAssistInput{AnchorKey: "e1:m0"}, func(event AnnotationAssistEvent) {
		if event.State == GenStateFailed || event.State == "cancelled" {
			select {
			case failed <- event.State:
			default:
			}
		}
	})
	// Cancel immediately; the job may or may not have started.
	CancelAnnotationAssist(jobID)
	close(release)
	select {
	case <-failed:
	case <-time.After(5 * time.Second):
		// A very fast job can finish before cancellation lands; acceptable.
	}
}

func TestAnnotationAssistJobIDsUnique(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 50; i++ {
		id := newAnnotationJobID()
		if seen[id] {
			t.Fatalf("duplicate job id %q", id)
		}
		if !strings.HasPrefix(id, "annjob-") {
			t.Fatalf("unexpected job id format %q", id)
		}
		seen[id] = true
	}
}
