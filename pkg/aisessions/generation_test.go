// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"errors"
	"testing"
	"time"
)

func TestNormalizeGenKind(t *testing.T) {
	cases := map[string]string{
		"title":    GenKindTitle,
		" TITLE ":  GenKindTitle,
		"metadata": GenKindMetadata,
		"both":     GenKindBoth,
		"":         "",
		"nope":     "",
	}
	for input, want := range cases {
		if got := normalizeGenKind(input); got != want {
			t.Fatalf("normalizeGenKind(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestIsRetryableGenerationError(t *testing.T) {
	retryable := []error{
		errors.New("model returned 500"),
		errors.New("network timeout"),
	}
	for _, err := range retryable {
		if !isRetryableGenerationError(err) {
			t.Fatalf("expected retryable: %v", err)
		}
	}
	notRetryable := []error{
		nil,
		errSkipUserTitle,
		errSkipMissing,
		errTitleFeatureDisabled,
		errMetadataFeatureDisabled,
	}
	for _, err := range notRetryable {
		if isRetryableGenerationError(err) {
			t.Fatalf("expected NOT retryable: %v", err)
		}
	}
}

func TestGenQueuePushDedupesByKeyAndKind(t *testing.T) {
	q := &autoTitleQueue{
		pending: make(map[string]genJob),
		wake:    make(chan struct{}, 1),
	}
	title := genJob{key: "s1", kind: GenKindTitle}
	metadata := genJob{key: "s1", kind: GenKindMetadata}
	q.push(title)
	q.push(title)    // duplicate, ignored
	q.push(metadata) // different kind, kept
	if len(q.pending) != 2 {
		t.Fatalf("expected 2 pending entries, got %d (%#v)", len(q.pending), q.pending)
	}
	first, ok := q.pop()
	if !ok || first.key != "s1" {
		t.Fatalf("pop returned %#v ok=%v", first, ok)
	}
	second, ok := q.pop()
	if !ok || second.key != "s1" {
		t.Fatalf("second pop returned %#v ok=%v", second, ok)
	}
	if first.kind == second.kind {
		t.Fatalf("expected different kinds, got %q and %q", first.kind, second.kind)
	}
	if _, ok := q.pop(); ok {
		t.Fatalf("queue should be empty")
	}
}

func TestGenerationStatusReportsAttempts(t *testing.T) {
	var events []GenerationStatusEvent
	q := &autoTitleQueue{publishStatus: func(e GenerationStatusEvent) { events = append(events, e) }}

	q.status(genJob{key: "s1", kind: GenKindTitle, manual: false}, GenStateQueued, nil)
	q.status(genJob{key: "s2", kind: GenKindBoth, manual: true, attempt: 1}, GenStateFailed, errors.New("boom"))

	if len(events) != 2 {
		t.Fatalf("expected 2 events, got %d", len(events))
	}
	auto := events[0]
	if auto.Attempt != 1 || auto.MaxAttempts != 1 || auto.State != GenStateQueued {
		t.Fatalf("unexpected automatic event: %#v", auto)
	}
	manual := events[1]
	if manual.Kind != GenKindBoth || manual.State != GenStateFailed {
		t.Fatalf("unexpected manual event: %#v", manual)
	}
	if manual.Attempt != 2 || manual.MaxAttempts != ManualGenerationMaxAttempts {
		t.Fatalf("manual attempt bookkeeping wrong: %#v", manual)
	}
	if manual.Error != "boom" || manual.UpdatedAt == 0 {
		t.Fatalf("manual error/updatedAt missing: %#v", manual)
	}
}

func TestManualRetrySchedulesRequeue(t *testing.T) {
	previous := manualRetryBackoff
	manualRetryBackoff = []time.Duration{time.Millisecond, time.Millisecond, time.Millisecond}
	defer func() { manualRetryBackoff = previous }()

	q := &autoTitleQueue{pending: make(map[string]genJob), wake: make(chan struct{}, 1)}
	q.fail(nil, SessionSummary{}, genJob{key: "s1", kind: GenKindTitle, manual: true, attempt: 0}, errors.New("transient"))
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		q.mu.Lock()
		n := len(q.pending)
		q.mu.Unlock()
		if n == 1 {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("expected failed manual job to be requeued")
}

func TestManualRetryStopsAtMaxAttempts(t *testing.T) {
	q := &autoTitleQueue{pending: make(map[string]genJob), wake: make(chan struct{}, 1)}
	q.fail(nil, SessionSummary{}, genJob{key: "s1", kind: GenKindTitle, manual: true, attempt: ManualGenerationMaxAttempts - 1}, errors.New("still failing"))
	time.Sleep(30 * time.Millisecond)
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.pending) != 0 {
		t.Fatalf("terminal failure must not requeue, got %#v", q.pending)
	}
}

func TestManualRetrySkipsNonRetryableError(t *testing.T) {
	q := &autoTitleQueue{pending: make(map[string]genJob), wake: make(chan struct{}, 1)}
	q.fail(nil, SessionSummary{}, genJob{key: "s1", kind: GenKindTitle, manual: true, attempt: 0}, errSkipUserTitle)
	time.Sleep(10 * time.Millisecond)
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.pending) != 0 {
		t.Fatalf("skip error must not requeue, got %#v", q.pending)
	}
}
