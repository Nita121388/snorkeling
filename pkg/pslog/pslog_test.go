// Copyright 2026, Command Phase Inc.
// SPDX-License-Identifier: Apache-2.0

package pslog

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// withTempPslog sets up a fresh pslog pointed at a temp dir, enabled, and
// returns the dir + a function that closes the file for reading. t.Cleanup
// resets global state after each test.
func withTempPslog(t *testing.T) (logDir string) {
	t.Helper()
	dir := t.TempDir()
	SetDataDirForTesting(dir)
	SetEnabled(true)
	t.Cleanup(func() {
		SetEnabled(false)
		resetForTesting()
		SetDataDirForTesting("")
	})
	return dir
}

// readPslogPath globs the unique pslog-<ts>-<pid>.log in dir and returns it.
// Fails the test if not exactly one.
func readPslogPath(t *testing.T, dir string) string {
	t.Helper()
	matches, err := filepath.Glob(filepath.Join(dir, "pslog-*.log"))
	if err != nil {
		t.Fatalf("glob pslog: %v", err)
	}
	if len(matches) != 1 {
		t.Fatalf("expected exactly 1 pslog file in %s, got %d: %v", dir, len(matches), matches)
	}
	return matches[0]
}

// readPslog reads the whole pslog file.
func readPslog(t *testing.T, dir string) string {
	t.Helper()
	path := readPslogPath(t, dir)
	// Force lazy open to flush any deferred state (open already ran inside Append);
	// we just read the file directly here.
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read pslog %s: %v", path, err)
	}
	return string(data)
}

func TestNewTraceIdUnique(t *testing.T) {
	withTempPslog(t)
	const n = 100
	ids := make(map[string]struct{}, n)
	for i := 0; i < n; i++ {
		id := NewTraceId()
		if !strings.Contains(id, "-") {
			t.Fatalf("trace id missing dash separator: %q", id)
		}
		if _, dup := ids[id]; dup {
			t.Fatalf("duplicate trace id: %q", id)
		}
		ids[id] = struct{}{}
	}
	if len(ids) != n {
		t.Fatalf("expected %d unique ids, got %d", n, len(ids))
	}
	// All ids must share the same pid prefix (this process).
	pid := os.Getpid()
	wantPrefix := ""
	for id := range ids {
		wantPrefix = strings.SplitN(id, "-", 2)[0]
		break
	}
	if wantPrefix != pidToString(pid) {
		t.Fatalf("trace id prefix %q != pid %d", wantPrefix, pid)
	}
}

func pidToString(pid int) string {
	// match NewTraceId's fmt.Sprintf("%d-...", os.Getpid()) exactly
	return pidField(pid)
}

// pidField formats an int as base-10 without importing fmt here cheaply.
// Kept trivial — just to avoid an extra fmt.Sprintf helper in the test file.
func pidField(pid int) string {
	if pid == 0 {
		return "0"
	}
	neg := pid < 0
	if neg {
		pid = -pid
	}
	var buf [20]byte
	i := len(buf)
	for pid > 0 {
		i--
		buf[i] = byte('0' + pid%10)
		pid /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func TestAppendWithTraceEmitsTrace(t *testing.T) {
	dir := withTempPslog(t)
	tid := NewTraceId()
	AppendWithTrace(tid, "ps-test", "block", "b1", "state", "ok")
	content := readPslog(t, dir)
	if !strings.Contains(content, " trace="+tid) {
		t.Fatalf("pslog missing ' trace=%s' in:\n%s", tid, content)
	}
	if !strings.Contains(content, "[ps-test]") {
		t.Fatalf("pslog missing tag [ps-test] in:\n%s", content)
	}
	if !strings.Contains(content, "block=b1") || !strings.Contains(content, "state=ok") {
		t.Fatalf("pslog missing kv fields in:\n%s", content)
	}
}

func TestAppendNoTraceWhenEmpty(t *testing.T) {
	dir := withTempPslog(t)
	AppendWithTrace("", "ps-test", "k", "v")
	content := readPslog(t, dir)
	if strings.Contains(content, "trace=") {
		t.Fatalf("empty traceId should not emit trace= field, got:\n%s", content)
	}
	// the trailing kv line should still be there
	if !strings.Contains(content, "[ps-test] k=v") {
		t.Fatalf("pslog missing kv line in:\n%s", content)
	}
}

func TestAppendEventWritesJSONLine(t *testing.T) {
	dir := withTempPslog(t)
	AppendEvent(Event{
		Version:    99,
		Timestamp:  "stale",
		Name:       "agent.note.render",
		Stage:      "visible",
		TraceId:    "trace-1",
		BlockId:    "block-1",
		SessionRef: "fnv1a64:0123456789abcdef",
		DurationMs: 32,
		Outcome:    "ok",
		Reason:     "summary-found",
	})

	var record map[string]any
	for _, line := range strings.Split(readPslog(t, dir), "\n") {
		if strings.HasPrefix(line, "{") {
			if err := json.Unmarshal([]byte(line), &record); err != nil {
				t.Fatalf("unmarshal event line: %v", err)
			}
			break
		}
	}
	if record == nil {
		t.Fatal("structured event line not found")
	}
	if record["v"] != float64(EventVersion) || record["event"] != "agent.note.render" {
		t.Fatalf("unexpected event identity: %#v", record)
	}
	if record["stage"] != "visible" || record["traceid"] != "trace-1" || record["blockid"] != "block-1" {
		t.Fatalf("unexpected correlation fields: %#v", record)
	}
	if record["sessionref"] != "fnv1a64:0123456789abcdef" || record["durationms"] != float64(32) {
		t.Fatalf("unexpected session or duration fields: %#v", record)
	}
	if record["outcome"] != "ok" || record["reason"] != "summary-found" {
		t.Fatalf("unexpected result fields: %#v", record)
	}
	if _, err := time.Parse(time.RFC3339Nano, record["ts"].(string)); err != nil {
		t.Fatalf("invalid event timestamp %q: %v", record["ts"], err)
	}
}

func TestAppendEventDropsUntrustedSessionRef(t *testing.T) {
	dir := withTempPslog(t)
	AppendEvent(Event{Name: "agent.note", SessionRef: "raw-session-id"})
	content := readPslog(t, dir)
	if strings.Contains(content, "raw-session-id") || strings.Contains(content, "sessionref") {
		t.Fatalf("untrusted session reference leaked into pslog:\n%s", content)
	}
}

func TestMakeSessionRefIsStableAndOpaque(t *testing.T) {
	const sessionId = "550e8400-e29b-41d4-a716-446655440000"
	ref := MakeSessionRef(sessionId)
	if ref != "fnv1a64:fbb0538ee83a5048" || ref != MakeSessionRef(sessionId) {
		t.Fatalf("session ref is not stable: %q", ref)
	}
	if strings.Contains(ref, sessionId) {
		t.Fatalf("session ref contains the full session id: %q", ref)
	}
	if MakeSessionRef("") != "" {
		t.Fatal("empty session id should produce an empty ref")
	}
	traceId := MakeAgentTraceId("block-1", sessionId)
	if traceId != "agent:block-1:"+ref {
		t.Fatalf("unexpected agent trace id: %q", traceId)
	}
	if MakeAgentTraceId("", sessionId) != "" || MakeAgentTraceId("block-1", "") != "agent:block-1:" {
		t.Fatal("agent trace id should require a block and permit a pending session")
	}

	dir := withTempPslog(t)
	AppendEvent(Event{Name: "agent.session.capture", SessionRef: ref})
	content := readPslog(t, dir)
	if strings.Contains(content, sessionId) || strings.Contains(content, `"note"`) || strings.Contains(content, `"token"`) {
		t.Fatalf("structured event leaked a sensitive field:\n%s", content)
	}
}

func TestAppendRawWithTraceEmitsTrace(t *testing.T) {
	dir := withTempPslog(t)
	tid := NewTraceId()
	AppendRawWithTrace(tid, "ps-raw", "oref=block:b1 event=recv")
	content := readPslog(t, dir)
	if !strings.Contains(content, " trace="+tid) {
		t.Fatalf("AppendRawWithTrace missing ' trace=%s' in:\n%s", tid, content)
	}
	if !strings.Contains(content, "[ps-raw] oref=block:b1 event=recv") {
		t.Fatalf("AppendRawWithTrace missing content in:\n%s", content)
	}
}

func TestDisabledWritesNothing(t *testing.T) {
	dir := withTempPslog(t)
	// flip off after setup
	SetEnabled(false)
	AppendWithTrace("tid", "ps-test", "k", "v")
	AppendRawWithTrace("tid", "ps-raw", "x")
	AppendEvent(Event{Name: "ps-test"})
	matches, _ := filepath.Glob(filepath.Join(dir, "pslog-*.log"))
	// disabled must not even open() the file; no file should exist yet
	if len(matches) != 0 {
		t.Fatalf("disabled pslog should not open a file, got %v", matches)
	}
	// re-enable for t.Cleanup's reset to also not race; reset is fine either way.
	SetEnabled(true)
}
