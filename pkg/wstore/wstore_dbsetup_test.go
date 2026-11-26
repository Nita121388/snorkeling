// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

func TestMakeDBSetsWALPerfPragmas(t *testing.T) {
	tmpDir := t.TempDir()
	dbDir := filepath.Join(tmpDir, wavebase.WaveDBDir)
	if err := os.MkdirAll(dbDir, 0o700); err != nil {
		t.Fatal(err)
	}
	origDataHome := wavebase.DataHome_VarCache
	wavebase.DataHome_VarCache = tmpDir
	t.Cleanup(func() { wavebase.DataHome_VarCache = origDataHome })
	t.Setenv(wavebase.WaveDataHomeEnvVar, tmpDir)

	db, err := MakeDB(context.Background())
	if err != nil {
		t.Fatalf("MakeDB failed: %v", err)
	}
	defer db.Close()

	var syncMode int
	if err := db.Get(&syncMode, `PRAGMA synchronous`); err != nil {
		t.Fatalf("PRAGMA synchronous: %v", err)
	}
	if syncMode != 1 {
		t.Fatalf("expected PRAGMA synchronous=1 (NORMAL), got %d", syncMode)
	}

	var tempStore int
	if err := db.Get(&tempStore, `PRAGMA temp_store`); err != nil {
		t.Fatalf("PRAGMA temp_store: %v", err)
	}
	if tempStore != 2 {
		t.Fatalf("expected PRAGMA temp_store=2 (MEMORY), got %d", tempStore)
	}

	var cacheSize int
	if err := db.Get(&cacheSize, `PRAGMA cache_size`); err != nil {
		t.Fatalf("PRAGMA cache_size: %v", err)
	}
	if cacheSize > -16000 {
		t.Fatalf("expected PRAGMA cache_size <= -16000 (16MB), got %d", cacheSize)
	}
}
