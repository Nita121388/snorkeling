// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"path/filepath"
	"testing"
)

func newBatchTestManager(t *testing.T) *Manager {
	t.Helper()
	dir := t.TempDir()
	return NewManagerWithOptions(ManagerOptions{
		IndexPath:  filepath.Join(dir, "index.json"),
		MetaPath:   filepath.Join(dir, "meta.json"),
		SQLitePath: filepath.Join(dir, "index-v2.sqlite"),
	})
}

// seedIndexedSession writes one session row straight into the SQLite index so
// ResolveSummaries can find it without any provider file existing on disk.
func seedIndexedSession(t *testing.T, manager *Manager, key string, summary SessionSummary) {
	t.Helper()
	ctx := context.Background()
	idx, err := manager.openSQLiteIndex()
	if err != nil {
		t.Fatalf("open index: %v", err)
	}
	defer idx.Close()
	if _, errs := idx.SaveScannedSummaries(ctx, []SessionSummary{summary}, true); len(errs) > 0 {
		t.Fatalf("seed summary: %v", errs[0])
	}
	_ = key
}

func TestResolveSummariesHitsIndexWithoutFullScan(t *testing.T) {
	manager := newBatchTestManager(t)
	key := "codex:batch-1:/tmp/batch-1.jsonl"
	seedIndexedSession(t, manager, key, SessionSummary{
		Key:         key,
		ID:          "batch-1",
		Source:      "codex",
		Title:       "indexed title",
		ProjectPath: "/tmp/project",
		FilePath:    "/tmp/batch-1.jsonl",
	})

	ctx := context.Background()
	// Note / tags live in the meta layer, which ResolveSummaries applies.
	if _, err := manager.Note(ctx, key, "hand written note"); err != nil {
		t.Fatalf("set note: %v", err)
	}

	resolved, missing := manager.ResolveSummaries(ctx, []string{"batch-1"})
	if len(missing) != 0 {
		t.Fatalf("expected no missing identifiers, got %v", missing)
	}
	summary, ok := resolved["batch-1"]
	if !ok {
		t.Fatalf("expected identifier batch-1 to resolve, got %#v", resolved)
	}
	if summary.Title != "indexed title" {
		t.Fatalf("title not from index: %#v", summary)
	}
	if summary.Note != "hand written note" {
		t.Fatalf("meta layer not applied: %#v", summary)
	}
}

func TestResolveSummariesReportsMissingIdentifiers(t *testing.T) {
	manager := newBatchTestManager(t)
	ctx := context.Background()

	resolved, missing := manager.ResolveSummaries(ctx, []string{"does-not-exist"})
	if len(resolved) != 0 {
		t.Fatalf("expected no resolutions, got %#v", resolved)
	}
	if len(missing) != 1 || missing[0] != "does-not-exist" {
		t.Fatalf("expected the unknown identifier in missing, got %v", missing)
	}
}

func TestResolveSummariesDedupesAndSkipsBlanks(t *testing.T) {
	manager := newBatchTestManager(t)
	key := "codex:batch-2:/tmp/batch-2.jsonl"
	seedIndexedSession(t, manager, key, SessionSummary{
		Key:      key,
		ID:       "batch-2",
		Source:   "codex",
		Title:    "dedupe",
		FilePath: "/tmp/batch-2.jsonl",
	})

	ctx := context.Background()
	resolved, missing := manager.ResolveSummaries(ctx, []string{"batch-2", "batch-2", "  ", ""})
	if len(missing) != 0 {
		t.Fatalf("expected no missing identifiers, got %v", missing)
	}
	if len(resolved) != 1 {
		t.Fatalf("expected exactly one resolution, got %#v", resolved)
	}
	if resolved["batch-2"].Key != key {
		t.Fatalf("wrong resolution: %#v", resolved["batch-2"])
	}
}

func TestResolveSummariesEmptyInput(t *testing.T) {
	manager := newBatchTestManager(t)
	resolved, missing := manager.ResolveSummaries(context.Background(), nil)
	if len(resolved) != 0 || len(missing) != 0 {
		t.Fatalf("expected empty results, got resolved=%#v missing=%#v", resolved, missing)
	}
}
