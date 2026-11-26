// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package filestore

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestMakeDBSetsWALPerfPragmas(t *testing.T) {
	origTesting := useTestingDb
	useTestingDb = false
	defer func() { useTestingDb = origTesting }()

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
}

func TestFlushCacheContinuesPastMissingEntry(t *testing.T) {
	origTesting := useTestingDb
	origDB := globalDB
	origStop := stopFlush.Load()
	useTestingDb = true
	stopFlush.Store(true)
	defer func() {
		if globalDB != nil {
			_ = globalDB.Close()
		}
		globalDB = origDB
		useTestingDb = origTesting
		stopFlush.Store(origStop)
		flushErrorCount.Store(0)
	}()

	if err := InitFilestore(); err != nil {
		t.Fatalf("InitFilestore failed: %v", err)
	}
	ctx := context.Background()
	store := &FileStore{
		Lock:  &sync.Mutex{},
		Cache: make(map[cacheKey]*CacheEntry),
	}

	// Seed 6 files that will disappear from db_wave_file before FlushCache, plus 2 valid files.
	for i := 0; i < 6; i++ {
		name := fmt.Sprintf("missing-%d", i)
		if err := store.MakeFile(ctx, "zone-1", name, nil, wshrpc.FileOpts{}); err != nil {
			t.Fatalf("MakeFile %s: %v", name, err)
		}
		if err := store.AppendData(ctx, "zone-1", name, []byte("orphan")); err != nil {
			t.Fatalf("AppendData %s: %v", name, err)
		}
		if err := WithTx(ctx, func(tx *TxWrap) error {
			tx.Exec(`DELETE FROM db_wave_file WHERE zoneid = ? AND name = ?`, "zone-1", name)
			return nil
		}); err != nil {
			t.Fatalf("delete %s: %v", name, err)
		}
	}
	for i := 0; i < 2; i++ {
		name := fmt.Sprintf("valid-%d", i)
		if err := store.MakeFile(ctx, "zone-1", name, nil, wshrpc.FileOpts{}); err != nil {
			t.Fatalf("MakeFile %s: %v", name, err)
		}
		if err := store.AppendData(ctx, "zone-1", name, []byte("keep-me")); err != nil {
			t.Fatalf("AppendData %s: %v", name, err)
		}
	}

	stats, _ := store.FlushCache(ctx)
	if stats.NumCommitted != 2 {
		t.Fatalf("expected FlushCache to commit both valid files despite missing entries, got committed=%d/%d", stats.NumCommitted, stats.NumDirtyEntries)
	}
}
