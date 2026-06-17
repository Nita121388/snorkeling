// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestCodexSummarySkipsAgentsInjection(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "rollout-2026-03-06T21-50-12-019cc369-bd7c-7891-b371-7b20b4fe0b18.jsonl")
	err := os.WriteFile(path, []byte(
		`{"timestamp":"2026-03-06T21:50:12Z","type":"session_meta","payload":{"id":"019cc369-bd7c-7891-b371-7b20b4fe0b18","cwd":"/tmp/project"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:13Z","type":"response_item","payload":{"type":"message","role":"user","content":"# AGENTS.md instructions for /tmp/project\n<INSTRUCTIONS>Do stuff</INSTRUCTIONS>"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:14Z","type":"response_item","payload":{"type":"message","role":"user","content":"Fix the login bug"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:15Z","type":"response_item","payload":{"type":"message","role":"assistant","content":"Done."}}`+"\n",
	), 0600)
	if err != nil {
		t.Fatal(err)
	}

	summary, ok := NewCodexProvider(dir).parseSummary(path)
	if !ok {
		t.Fatal("expected summary")
	}
	if summary.Title != "Fix the login bug" {
		t.Fatalf("unexpected title: %q", summary.Title)
	}
}

func TestCodexSummarySkipsEnvironmentContext(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "rollout-2026-03-06T21-50-12-019cc369-bd7c-7891-b371-7b20b4fe0b18.jsonl")
	err := os.WriteFile(path, []byte(
		`{"timestamp":"2026-03-06T21:50:12Z","type":"session_meta","payload":{"id":"019cc369-bd7c-7891-b371-7b20b4fe0b18","cwd":"/tmp/project"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:13Z","type":"response_item","payload":{"type":"message","role":"user","content":"<environment_context>\n  <cwd>/tmp/project</cwd>\n</environment_context>"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:14Z","type":"response_item","payload":{"type":"message","role":"user","content":"Summarize this project"}}`+"\n",
	), 0600)
	if err != nil {
		t.Fatal(err)
	}

	summary, ok := NewCodexProvider(dir).parseSummary(path)
	if !ok {
		t.Fatal("expected summary")
	}
	if summary.Title != "Summarize this project" {
		t.Fatalf("unexpected title: %q", summary.Title)
	}
}

func TestCodexSummaryStripsDiscordEnvelope(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "rollout-2026-03-06T21-50-12-019cc369-bd7c-7891-b371-7b20b4fe0b18.jsonl")
	err := os.WriteFile(path, []byte(
		`{"timestamp":"2026-03-06T21:50:12Z","type":"session_meta","payload":{"id":"019cc369-bd7c-7891-b371-7b20b4fe0b18","cwd":"/tmp/project"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:13Z","type":"response_item","payload":{"type":"message","role":"user","content":"[Discord nita07996 user id:1082985147760128021]\n[message_id: 1498693312230461562]\nFix the TUI layout"}}`+"\n",
	), 0600)
	if err != nil {
		t.Fatal(err)
	}

	summary, ok := NewCodexProvider(dir).parseSummary(path)
	if !ok {
		t.Fatal("expected summary")
	}
	if summary.Title != "Fix the TUI layout" {
		t.Fatalf("unexpected title: %q", summary.Title)
	}
}

func TestCodexSummaryTrimsLeadingTitlePath(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "rollout-2026-03-06T21-50-12-019cc369-bd7c-7891-b371-7b20b4fe0b18.jsonl")
	err := os.WriteFile(path, []byte(
		`{"timestamp":"2026-03-06T21:50:12Z","type":"session_meta","payload":{"id":"019cc369-bd7c-7891-b371-7b20b4fe0b18","cwd":"/tmp/project"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:13Z","type":"response_item","payload":{"type":"message","role":"user","content":"/Users/nita/project/08-AI会话管理需求.md 又一个问题 做成CLI的话怎么显示"}}`+"\n",
	), 0600)
	if err != nil {
		t.Fatal(err)
	}

	summary, ok := NewCodexProvider(dir).parseSummary(path)
	if !ok {
		t.Fatal("expected summary")
	}
	if summary.Title != "又一个问题 做成CLI的话怎么显示" {
		t.Fatalf("unexpected title: %q", summary.Title)
	}
}

func TestCodexSummarySkipsTurnAborted(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "rollout-2026-03-06T21-50-12-019cc369-bd7c-7891-b371-7b20b4fe0b18.jsonl")
	err := os.WriteFile(path, []byte(
		`{"timestamp":"2026-03-06T21:50:12Z","type":"session_meta","payload":{"id":"019cc369-bd7c-7891-b371-7b20b4fe0b18","cwd":"/tmp/project"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:13Z","type":"response_item","payload":{"type":"message","role":"user","content":"<turn_aborted>\nThe user interrupted the previous turn on purpose."}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:14Z","type":"response_item","payload":{"type":"message","role":"user","content":"继续 TUI 开发"}}`+"\n",
	), 0600)
	if err != nil {
		t.Fatal(err)
	}

	summary, ok := NewCodexProvider(dir).parseSummary(path)
	if !ok {
		t.Fatal("expected summary")
	}
	if summary.Title != "继续 TUI 开发" {
		t.Fatalf("unexpected title: %q", summary.Title)
	}
}

func TestCodexLoadMessagesIncludesFunctionCalls(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "session.jsonl")
	err := os.WriteFile(path, []byte(
		`{"timestamp":"2026-03-06T21:50:12Z","type":"session_meta","payload":{"id":"test-id","cwd":"/tmp"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:13Z","type":"response_item","payload":{"type":"message","role":"user","content":"list files"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:14Z","type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"{\"cmd\":[\"ls\"]}","call_id":"call_1"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:15Z","type":"response_item","payload":{"type":"function_call_output","call_id":"call_1","output":"file1.txt\nfile2.txt"}}`+"\n",
	), 0600)
	if err != nil {
		t.Fatal(err)
	}

	messages, err := NewCodexProvider(dir).LoadMessages(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 3 {
		t.Fatalf("expected 3 messages, got %d", len(messages))
	}
	if messages[1].Role != RoleAssistant || messages[1].ToolName != "shell" {
		t.Fatalf("unexpected tool call message: %#v", messages[1])
	}
	if messages[2].Role != RoleTool {
		t.Fatalf("expected tool output role, got %q", messages[2].Role)
	}
}

func TestCodexLoadToolCalls(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "session.jsonl")
	err := os.WriteFile(path, []byte(
		`{"timestamp":"2026-03-06T21:50:12Z","type":"session_meta","payload":{"id":"test-id","cwd":"/tmp"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:14Z","type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"{\"cmd\":[\"ls\"]}","call_id":"call_1"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:15Z","type":"response_item","payload":{"type":"function_call_output","call_id":"call_1","output":"file1.txt\nfile2.txt"}}`+"\n",
	), 0600)
	if err != nil {
		t.Fatal(err)
	}

	toolCalls, err := NewCodexProvider(dir).LoadToolCalls(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	if len(toolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(toolCalls))
	}
	if toolCalls[0].Name != "shell" || toolCalls[0].Output != "file1.txt\nfile2.txt" {
		t.Fatalf("unexpected tool call: %#v", toolCalls[0])
	}
	if toolCalls[0].Summary == "" {
		t.Fatalf("expected summary: %#v", toolCalls[0])
	}
}

func TestCodexListKeepsFirstUserTitleOverSessionIndexTitle(t *testing.T) {
	codexDir := t.TempDir()
	sessionsDir := filepath.Join(codexDir, "sessions")
	if err := os.MkdirAll(sessionsDir, 0700); err != nil {
		t.Fatal(err)
	}
	sessionPath := filepath.Join(sessionsDir, "rollout-2026-03-06T21-50-12-019cc369-bd7c-7891-b371-7b20b4fe0b18.jsonl")
	if err := os.WriteFile(sessionPath, []byte(
		`{"timestamp":"2026-03-06T21:50:12Z","type":"session_meta","payload":{"id":"019cc369-bd7c-7891-b371-7b20b4fe0b18","cwd":"/tmp/project"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:13Z","type":"response_item","payload":{"type":"message","role":"user","content":"Fallback user title"}}`+"\n",
	), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(codexDir, "session_index.jsonl"), []byte(
		`{"id":"019cc369-bd7c-7891-b371-7b20b4fe0b18","thread_name":"Indexed title","updated_at":"2026-03-07T10:00:00Z"}`+"\n",
	), 0600); err != nil {
		t.Fatal(err)
	}

	summaries, err := NewCodexProvider(sessionsDir).List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(summaries) != 1 {
		t.Fatalf("expected one summary, got %d", len(summaries))
	}
	if summaries[0].Title != "Fallback user title" || summaries[0].TitleSource != "first_user_message" {
		t.Fatalf("unexpected user title: %#v", summaries[0])
	}
	if summaries[0].UpdatedAt == 0 {
		t.Fatalf("expected indexed updated time: %#v", summaries[0])
	}
}

func TestClaudeSummarySkipsCommandCaveat(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "session-clear.jsonl")
	err := os.WriteFile(path, []byte(
		`{"type":"file-history-snapshot","messageId":"msg-1","snapshot":{},"isSnapshotUpdate":false}`+"\n"+
			`{"type":"user","message":{"role":"user","content":"<local-command-caveat>Caveat</local-command-caveat>"},"sessionId":"session-clear","timestamp":"2026-03-06T10:00:00Z","cwd":"/tmp/project"}`+"\n"+
			`{"type":"user","message":{"role":"user","content":"<command-name>/clear</command-name>\n<command-message>clear</command-message>"},"sessionId":"session-clear","timestamp":"2026-03-06T10:00:01Z","cwd":"/tmp/project"}`+"\n"+
			`{"type":"user","message":{"role":"user","content":"帮我看看工作区的改动"},"sessionId":"session-clear","timestamp":"2026-03-06T10:01:00Z","cwd":"/tmp/project"}`+"\n",
	), 0600)
	if err != nil {
		t.Fatal(err)
	}

	summary, ok := NewClaudeProvider([]string{dir}).parseSummary(path)
	if !ok {
		t.Fatal("expected summary")
	}
	if summary.Title != "帮我看看工作区的改动" {
		t.Fatalf("unexpected title: %q", summary.Title)
	}
}

func TestClaudeToolResultUserMessageBecomesTool(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "session.jsonl")
	err := os.WriteFile(path, []byte(
		`{"message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Write","input":{"file_path":"a.txt"}}]},"timestamp":"2026-03-06T10:00:00Z"}`+"\n"+
			`{"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"File written"}]},"timestamp":"2026-03-06T10:00:01Z"}`+"\n",
	), 0600)
	if err != nil {
		t.Fatal(err)
	}

	messages, err := NewClaudeProvider([]string{dir}).LoadMessages(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(messages))
	}
	if messages[1].Role != RoleTool || messages[1].Text != "File written" {
		t.Fatalf("unexpected tool result message: %#v", messages[1])
	}
}

func TestClaudeLoadToolCalls(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "session.jsonl")
	err := os.WriteFile(path, []byte(
		`{"message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Write","input":{"file_path":"a.txt"}}]},"timestamp":"2026-03-06T10:00:00Z"}`+"\n"+
			`{"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"File written"}]},"timestamp":"2026-03-06T10:00:01Z"}`+"\n",
	), 0600)
	if err != nil {
		t.Fatal(err)
	}

	toolCalls, err := NewClaudeProvider([]string{dir}).LoadToolCalls(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	if len(toolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(toolCalls))
	}
	if toolCalls[0].Name != "Write" || toolCalls[0].Output != "File written" {
		t.Fatalf("unexpected tool call: %#v", toolCalls[0])
	}
	if toolCalls[0].Summary == "" {
		t.Fatalf("expected summary: %#v", toolCalls[0])
	}
}

func TestParseCompleteJSONLFromReaderIncludesFinalLineWithoutNewline(t *testing.T) {
	ctx := context.Background()
	items, seq, bytesRead, err := parseCompleteJSONLFromReader(ctx, bytes.NewBufferString("one\ntwo"), 1, func(line []byte, seq int) (string, bool) {
		return string(line), true
	})
	if err != nil {
		t.Fatal(err)
	}
	if seq != 3 {
		t.Fatalf("unexpected seq: %d", seq)
	}
	if bytesRead != 7 {
		t.Fatalf("unexpected bytes read: %d", bytesRead)
	}
	if len(items) != 2 || items[1] != "two" {
		t.Fatalf("unexpected items: %#v", items)
	}
}

func TestLoadLocalMessageDeltaStopsAtIncompleteTail(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "session.jsonl")
	err := os.WriteFile(path, []byte(
		`{"timestamp":"2026-03-06T21:50:13Z","type":"response_item","payload":{"type":"message","role":"user","content":"first"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:14Z","type":"response_item","payload":{"type":"message","role":"assistant","content":"second"`,
	), 0600)
	if err != nil {
		t.Fatal(err)
	}

	delta, err := loadLocalMessageDelta(context.Background(), SourceCodex, path, SessionMessageCursor{ByteOffset: 0, LastSeq: 0}, 1024, parseCodexMessageLine)
	if err != nil {
		t.Fatal(err)
	}
	if len(delta.Messages) != 1 {
		t.Fatalf("expected only the complete first message, got %#v", delta.Messages)
	}
	if delta.Cursor.ByteOffset != int64(len(`{"timestamp":"2026-03-06T21:50:13Z","type":"response_item","payload":{"type":"message","role":"user","content":"first"}}`+"\n")) {
		t.Fatalf("unexpected cursor offset: %#v", delta.Cursor)
	}
	if !delta.HasMore {
		t.Fatal("expected hasMore for incomplete tail")
	}
}

func TestLoadLocalMessageDeltaConsumesCompleteIgnoredTail(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "session.jsonl")
	raw := []byte(`{"timestamp":"2026-03-06T21:50:12Z","type":"session_meta","payload":{"id":"test-id","cwd":"/tmp/project"}}`)
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}

	delta, err := loadLocalMessageDelta(context.Background(), SourceCodex, path, SessionMessageCursor{}, 1024, parseCodexMessageLine)
	if err != nil {
		t.Fatal(err)
	}
	if len(delta.Messages) != 0 {
		t.Fatalf("expected no readable messages, got %#v", delta.Messages)
	}
	if delta.Cursor.ByteOffset != int64(len(raw)) {
		t.Fatalf("expected cursor to consume complete ignored line, got %#v", delta.Cursor)
	}
	if delta.HasMore {
		t.Fatal("did not expect hasMore after complete ignored line")
	}
}

func TestLoadLocalMessageDeltaReturnsEmptyMessagesArrayWhenUnchanged(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "session.jsonl")
	raw := []byte(`{"timestamp":"2026-03-06T21:50:12Z","type":"response_item","payload":{"type":"message","role":"user","content":"first"}}` + "\n")
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}

	delta, err := loadLocalMessageDelta(context.Background(), SourceCodex, path, SessionMessageCursor{ByteOffset: int64(len(raw)), FileSize: int64(len(raw)), LastSeq: 1}, 1024, parseCodexMessageLine)
	if err != nil {
		t.Fatal(err)
	}
	if delta.Messages == nil {
		t.Fatal("expected empty messages slice, got nil")
	}
	if len(delta.Messages) != 0 {
		t.Fatalf("expected no messages, got %#v", delta.Messages)
	}
}

func TestRemoteProviderLoadMessageDeltaStopsAtIncompleteTail(t *testing.T) {
	sessionPath := "/home/tester/.codex/sessions/2026/05/29/rollout-remote-session.jsonl"
	raw := []byte(
		`{"timestamp":"2026-05-29T00:00:00Z","type":"response_item","payload":{"type":"message","role":"user","content":"Remote user request"}}` + "\n" +
			`{"timestamp":"2026-05-29T00:00:01Z","type":"response_item","payload":{"type":"message","role":"assistant","content":"Remote answer"`,
	)
	reader := &fakeRemoteFileReader{
		files: map[string][]byte{
			sessionPath: raw,
		},
		info: map[string]*wshrpc.FileInfo{
			sessionPath: {Path: sessionPath, Size: int64(len(raw)), ModTime: 1234},
		},
	}
	provider, err := NewRemoteProvider(RemoteProviderOptions{
		Connection: "ssh://example",
		HomeDir:    "/home/tester",
		FileReader: reader,
	})
	if err != nil {
		t.Fatal(err)
	}

	delta, err := provider.LoadMessageDelta(context.Background(), makeRemoteSessionPath(SourceCodex, "ssh://example", sessionPath), SessionMessageCursor{}, 1024)
	if err != nil {
		t.Fatal(err)
	}
	if len(delta.Messages) != 1 {
		t.Fatalf("expected only the complete first message, got %#v", delta.Messages)
	}
	if delta.Cursor.ByteOffset != int64(len(`{"timestamp":"2026-05-29T00:00:00Z","type":"response_item","payload":{"type":"message","role":"user","content":"Remote user request"}}`+"\n")) {
		t.Fatalf("unexpected cursor offset: %#v", delta.Cursor)
	}
	if !delta.HasMore {
		t.Fatal("expected hasMore for incomplete remote tail")
	}
}
