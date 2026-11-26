// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"path/filepath"
	"testing"
)

func TestSQLiteIndexInitFastPathAndPragmas(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "index.sqlite")
	metaPath := filepath.Join(tmpDir, "meta.json")

	beforeFull := sqliteFullInitCount.Load()
	idx, err := OpenSQLiteIndex(dbPath, metaPath)
	if err != nil {
		t.Fatalf("OpenSQLiteIndex first open: %v", err)
	}
	var syncMode int
	if err := idx.db.Get(&syncMode, `PRAGMA synchronous`); err != nil {
		_ = idx.Close()
		t.Fatalf("PRAGMA synchronous: %v", err)
	}
	var tempStore int
	if err := idx.db.Get(&tempStore, `PRAGMA temp_store`); err != nil {
		_ = idx.Close()
		t.Fatalf("PRAGMA temp_store: %v", err)
	}
	var cacheSize int
	if err := idx.db.Get(&cacheSize, `PRAGMA cache_size`); err != nil {
		_ = idx.Close()
		t.Fatalf("PRAGMA cache_size: %v", err)
	}
	if err := idx.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	if syncMode != 1 {
		t.Fatalf("expected PRAGMA synchronous=1 (NORMAL), got %d", syncMode)
	}
	if tempStore != 2 {
		t.Fatalf("expected PRAGMA temp_store=2 (MEMORY), got %d", tempStore)
	}
	if cacheSize > -64000 {
		t.Fatalf("expected PRAGMA cache_size <= -64000 (64MB), got %d", cacheSize)
	}

	// Reopening the same initialized DB 4 more times must hit the fast path without re-running full DDL/migrations.
	for i := 0; i < 4; i++ {
		reopen, err := OpenSQLiteIndex(dbPath, metaPath)
		if err != nil {
			t.Fatalf("reopen %d: %v", i, err)
		}
		if err := reopen.Close(); err != nil {
			t.Fatalf("reopen close %d: %v", i, err)
		}
	}
	if got := sqliteFullInitCount.Load() - beforeFull; got != 1 {
		t.Fatalf("expected 5 opens of same DB to run full init exactly once, got %d", got)
	}
}
