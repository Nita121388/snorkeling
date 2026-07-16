// Copyright 2025, Command Phase Inc.
// SPDX-License-Identifier: Apache-2.0

// Package pslog writes a single append-only log file under <wave data dir>/pslog/
// for tracing cross-process causal chains (today: the pubsub chain
// persist -> publish -> route -> recv; future domains appended on demand).
// Both backend Go code and frontend (via /wave/pslog POST) write into the
// same file so an entire chain can be grep'd in one place.
//
// Tag naming: lowercase, dash-separated, "<domain>-<event>". Known domain
// today is "ps" (pubsub chain: ps-init/ps-recv/ps-use/ps-set/ps-route/ps-publish).
// New domains add their own prefix (e.g. "as" for agent-status) only when
// introduced by a concrete tracing need — do not pre-register domains.
//
// traceId: a process-wide monotonically-increasing id (NewTraceId) lets a
// single causal chain be grep'd across multiple AppendWithTrace lines. The id
// is *not* auto-propagated across processes; callers thread it explicitly
// (env var, RPC envelope, hook arg) when they wire a new chain. Infrastructure
// only provides the id generator and the append API; it does not call them.
package pslog

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// enabledFlag is the live value of the `debug:pslog` setting, pushed in by the
// process bootstrap (cmd/server) via SetEnabled. pslog must not import wconfig
// directly because wconfig already depends (transitively) on pslog — reading
// the setting inside this package would close an import cycle. Default false,
// matching the setting default: nothing is written and no file is opened.
var enabledFlag atomic.Bool

// SetEnabled is called by the process bootstrap when the debug:pslog setting
// changes (also at startup). Safe to call from any goroutine.
func SetEnabled(b bool) {
	enabledFlag.Store(b)
}

func enabled() bool {
	return enabledFlag.Load()
}

// traceCounter is a process-wide monotonic counter used by NewTraceId so that
// every id is globally unique within the process. Cross-process unlinkability
// is broken by pid prefix; per-process uniqueness is broken by the counter.
var traceCounter atomic.Uint64

// NewTraceId returns a process-unique id of the form "<pid>-<counter>". Callers
// thread it across processes/env/RPC themselves; pslog never does that.
func NewTraceId() string {
	return fmt.Sprintf("%d-%d", os.Getpid(), traceCounter.Add(1))
}

var (
	once   sync.Once
	fileMu sync.Mutex
	file   *os.File
	initErr error
)

// dirOverride, when set, replaces wavebase.GetWaveDataDir() in open(). It is
// a test-only seam (see resetForTesting) — production never sets it; it must
// remain nil in non-test builds so open() resolves to the shared data dir.
var dirOverride string

// resetForTesting resets the lazy-open state so a test can open a fresh file
// in a temp dir. Tests pass t.TempDir() via SetDataDirForTesting.
//
// ForTesting only. Production code must not call this.
func resetForTesting() {
	fileMu.Lock()
	defer fileMu.Unlock()
	once = sync.Once{}
	if file != nil {
		_ = file.Close()
	}
	file = nil
	initErr = nil
	traceCounter.Store(0)
}

// SetDataDirForTesting points pslog at dir for the next open().
// ForTesting only. Pair with resetForTesting() in t.Cleanup.
func SetDataDirForTesting(dir string) {
	dirOverride = dir
}

// open lazily creates the log file. Once-per-process; a fresh launch makes a fresh file.
func open() {
	once.Do(func() {
		dir := dirOverride
		if dir == "" {
			dir = filepath.Join(wavebase.GetWaveDataDir(), "pslog")
		}
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
	AppendWithTrace("", tag, kv...)
}

// AppendWithTrace is like Append but appends " trace=<traceId>" at line end
// when traceId is non-empty, letting a causal chain be grep'd across calls.
// Empty traceId preserves the original Append byte-for-byte output.
func AppendWithTrace(traceId string, tag string, kv ...any) {
	if !enabled() {
		return
	}
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
	if traceId != "" {
		sb.WriteString(" trace=")
		sb.WriteString(traceId)
	}
	sb.WriteString("\n")
	line := sb.String()
	fileMu.Lock()
	defer fileMu.Unlock()
	file.WriteString(line)
}

// AppendRaw is for callers that have already formatted their own line content (excluding timestamp/tag).
func AppendRaw(tag string, content string) {
	AppendRawWithTrace("", tag, content)
}

// AppendRawWithTrace is like AppendRaw but appends " trace=<traceId>" at line
// end when traceId is non-empty (see AppendWithTrace).
func AppendRawWithTrace(traceId string, tag string, content string) {
	if !enabled() {
		return
	}
	open()
	if initErr != nil {
		return
	}
	line := time.Now().Format("2006-01-02T15:04:05.000") + " [" + tag + "] " + content
	if traceId != "" {
		line += " trace=" + traceId
	}
	line += "\n"
	fileMu.Lock()
	defer fileMu.Unlock()
	file.WriteString(line)
}
