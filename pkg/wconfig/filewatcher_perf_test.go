// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

func TestFileWatcherDebouncesBurstEvents(t *testing.T) {
	tmpDir := t.TempDir()
	origCfg := wavebase.ConfigHome_VarCache
	origData := wavebase.DataHome_VarCache
	wavebase.ConfigHome_VarCache = tmpDir
	wavebase.DataHome_VarCache = tmpDir
	t.Cleanup(func() {
		wavebase.ConfigHome_VarCache = origCfg
		wavebase.DataHome_VarCache = origData
	})
	t.Setenv(wavebase.WaveConfigHomeEnvVar, tmpDir)
	t.Setenv(wavebase.WaveDataHomeEnvVar, tmpDir)

	w := &Watcher{initialized: true}
	var calls atomic.Int32
	w.RegisterUpdateHandler(func(_ FullConfigType) {
		calls.Add(1)
	})

	event := fsnotify.Event{
		Name: filepath.Join(tmpDir, "settings.json"),
		Op:   fsnotify.Write,
	}
	for i := 0; i < 5; i++ {
		w.handleEvent(event)
	}

	time.Sleep(300 * time.Millisecond)
	if got := calls.Load(); got != 1 {
		t.Fatalf("expected 5 burst fsnotify events to coalesce into 1 reload, got %d", got)
	}
}
