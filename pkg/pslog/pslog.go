// Copyright 2025, Command Phase Inc.
// SPDX-License-Identifier: Apache-2.0

// Package pslog writes a single append-only log file under <wave data dir>/pslog/
// for tracing the pubsub chain: persist -> publish -> route -> recv.
// Both backend Go code and frontend (via /wave/pslog POST) write into the same file
// so the entire chain can be grep'd in one place.
package pslog

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

var (
	once      sync.Once
	fileMu    sync.Mutex
	file      *os.File
	initErr   error
	enabledKV = true // false disables formatting; kept for future toggling
)

// open lazily creates the log file. Once-per-process; a fresh launch makes a fresh file.
func open() {
	once.Do(func() {
		dir := filepath.Join(wavebase.GetWaveDataDir(), "pslog")
		if err := os.MkdirAll(dir, 0700); err != nil {
			initErr = fmt.Errorf("pslog mkdir: %w", err)
			return
		}
		ts := time.Now().Format("20060102-150405")
		pid := os.Getpid()
		path := filepath.Join(dir, fmt.Sprintf("pslog-%s-%d.log", ts, pid))
		f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
		if err != nil {
			initErr = fmt.Errorf("pslog open: %w", err)
			return
		}
		file = f
		// first header so the grep knows which file this is
		fmt.Fprintf(file, "=== pslog open ts=%s pid=%d path=%s\n", time.Now().Format(time.RFC3339Nano), pid, path)
	})
}

// Append writes one line tagged with `tag` and key-value fields joined by spaces.
// Safe to call from any goroutine. Fails silently after first open error.
// Example: pslog.Append("ps-persist", "block", blockId, "sid", sessionId)
func Append(tag string, kv ...any) {
	open()
	if initErr != nil {
		return
	}
	var sb strings.Builder
	sb.WriteString(time.Now().Format("2006-01-02T15:04:05.000"))
	sb.WriteString(" [")
	sb.WriteString(tag)
	sb.WriteString("]")
	for i := 0; i+1 < len(kv); i += 2 {
		sb.WriteString(" ")
		sb.WriteString(fmt.Sprintf("%v", kv[i]))
		sb.WriteString("=")
		sb.WriteString(fmt.Sprintf("%v", kv[i+1]))
	}
	sb.WriteString("\n")
	line := sb.String()
	fileMu.Lock()
	defer fileMu.Unlock()
	file.WriteString(line)
	if !enabledKV {
		return
	}
}

// AppendRaw is for callers that have already formatted their own line content (excluding timestamp/tag).
func AppendRaw(tag string, content string) {
	open()
	if initErr != nil {
		return
	}
	line := time.Now().Format("2006-01-02T15:04:05.000") + " [" + tag + "] " + content + "\n"
	fileMu.Lock()
	defer fileMu.Unlock()
	file.WriteString(line)
}
