// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"path/filepath"
	"testing"
)

// DetectChangedSessionFiles is the stat-only probe the local session watcher
// uses to publish aisessions:sessionschanged. These tests pin its contract:
// new files count, indexed files do not, and mtime/size changes do again.
func TestDetectChangedSessionFiles(t *testing.T) {
	dir := t.TempDir()
	file := SessionFile{Path: "a.jsonl", MTime: 1, Size: 10}
	provider := &scanFileProvider{source: "test", files: []SessionFile{file}}
	m := NewManagerWithOptions(ManagerOptions{
		Providers:  []Provider{provider},
		IndexPath:  filepath.Join(dir, "index.json"),
		SQLitePath: filepath.Join(dir, "index-v2.sqlite"),
		MetaPath:   filepath.Join(dir, "meta.json"),
	})
	ctx := context.Background()

	// Empty index: the only file is new.
	changed, err := m.DetectChangedSessionFiles(ctx)
	if err != nil {
		t.Fatalf("first detect: %v", err)
	}
	if changed != 1 {
		t.Fatalf("expected 1 changed file on empty index, got %d", changed)
	}

	// Persist the file into the index (what refreshChangedSummaries does).
	sqliteIdx, err := m.openSQLiteIndex()
	if err != nil {
		t.Fatalf("open sqlite index: %v", err)
	}
	summary := SessionSummary{
		Key:      StableKey(provider.source, "a", file.Path),
		ID:       "a",
		Source:   provider.source,
		FilePath: file.Path,
		MTime:    file.MTime,
		Size:     file.Size,
	}
	if _, errs := sqliteIdx.SaveScannedSummaries(ctx, []SessionSummary{summary}, true); len(errs) > 0 {
		t.Fatalf("SaveScannedSummaries errors: %v", errs)
	}
	if err := sqliteIdx.Close(); err != nil {
		t.Fatalf("close sqlite index: %v", err)
	}

	// Index is up to date: nothing changed.
	changed, err = m.DetectChangedSessionFiles(ctx)
	if err != nil {
		t.Fatalf("second detect: %v", err)
	}
	if changed != 0 {
		t.Fatalf("expected 0 changed files on fresh index, got %d", changed)
	}

	// mtime/size drift: the file counts as changed again.
	file.MTime = 2
	provider.files = []SessionFile{file}
	changed, err = m.DetectChangedSessionFiles(ctx)
	if err != nil {
		t.Fatalf("third detect: %v", err)
	}
	if changed != 1 {
		t.Fatalf("expected 1 changed file after mtime drift, got %d", changed)
	}
}

// A manager without SummaryFileProviders (e.g. a legacy provider) cannot
// detect anything: the watcher must treat that as "no changes", not an error.
func TestDetectChangedSessionFilesNonFileProvider(t *testing.T) {
	dir := t.TempDir()
	m := NewManagerWithOptions(ManagerOptions{
		Providers:  []Provider{&cacheProvider{source: "legacy"}},
		IndexPath:  filepath.Join(dir, "index.json"),
		SQLitePath: filepath.Join(dir, "index-v2.sqlite"),
		MetaPath:   filepath.Join(dir, "meta.json"),
	})
	changed, err := m.DetectChangedSessionFiles(context.Background())
	if err != nil {
		t.Fatalf("detect: %v", err)
	}
	if changed != 0 {
		t.Fatalf("expected 0 changed files for non-file provider, got %d", changed)
	}
}
