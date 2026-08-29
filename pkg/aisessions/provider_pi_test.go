// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// writePiJSONL writes content to <dir>/<name>.jsonl inside the test temp dir and
// returns the file path. Pi sessions are JSONL v3 trees: the first line is a
// `session` header, subsequent lines are messages linked by `id`/`parentId`.
func writePiJSONL(t *testing.T, dir string, content string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", dir, err)
	}
	path := filepath.Join(dir, "pi-sess-1.jsonl")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	return path
}

const piSampleV3 = `{"type":"session","version":3,"id":"pi-sess-1","timestamp":1700000000,"cwd":"/home/user/project"}` + "\n" +
	`{"type":"message","id":"msg-1","parentId":"","role":"user","content":"hello"}` + "\n" +
	`{"type":"message","id":"msg-2","parentId":"msg-1","role":"assistant","content":[{"type":"text","text":"hi"}]}` + "\n"

func TestPiProvider_List(t *testing.T) {
	dir := t.TempDir()
	writePiJSONL(t, dir, piSampleV3)
	p := NewPiProvider(dir)
	summaries, err := p.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(summaries) != 1 {
		t.Fatalf("expected 1 summary, got %d: %#v", len(summaries), summaries)
	}
	if summaries[0].ID != "pi-sess-1" {
		t.Fatalf("expected id pi-sess-1, got %q", summaries[0].ID)
	}
	if summaries[0].Source != SourcePi {
		t.Fatalf("expected source %q, got %q", SourcePi, summaries[0].Source)
	}
	if summaries[0].ProjectPath != "/home/user/project" {
		t.Fatalf("expected cwd /home/user/project, got %q", summaries[0].ProjectPath)
	}
	if summaries[0].CreatedAt == 0 {
		t.Fatalf("expected non-zero CreatedAt, got %d", summaries[0].CreatedAt)
	}
	if summaries[0].FilePath == "" {
		t.Fatalf("expected non-empty FilePath")
	}
	if summaries[0].Key == "" {
		t.Fatalf("expected non-empty Key")
	}
}

func TestPiProvider_ListFiles(t *testing.T) {
	dir := t.TempDir()
	writePiJSONL(t, dir, piSampleV3)
	p := NewPiProvider(dir)
	files, err := p.ListFiles(context.Background())
	if err != nil {
		t.Fatalf("ListFiles: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("expected 1 file, got %d: %#v", len(files), files)
	}
	if files[0].Source != SourcePi {
		t.Fatalf("expected source %q, got %q", SourcePi, files[0].Source)
	}
}

func TestPiProvider_ParseSummary(t *testing.T) {
	dir := t.TempDir()
	path := writePiJSONL(t, dir, piSampleV3)
	p := NewPiProvider(dir)
	mtime, size := fileStatFields(path)
	summary, ok := p.ParseSummary(context.Background(), SessionFile{Source: SourcePi, Path: path, MTime: mtime, Size: size})
	if !ok {
		t.Fatalf("expected ParseSummary ok")
	}
	if summary.ID != "pi-sess-1" {
		t.Fatalf("expected id pi-sess-1, got %q", summary.ID)
	}
	if summary.Source != SourcePi {
		t.Fatalf("expected source %q, got %q", SourcePi, summary.Source)
	}
	if summary.ProjectPath != "/home/user/project" {
		t.Fatalf("expected cwd /home/user/project, got %q", summary.ProjectPath)
	}
	if summary.FilePath != path {
		t.Fatalf("expected FilePath %q, got %q", path, summary.FilePath)
	}
}

// piSampleToolTail ends with a tool-call-only assistant message, so the snippet
// must skip the "[Tool: ...]" placeholder and fall back to the user message.
const piSampleToolTail = `{"type":"session","version":3,"id":"pi-sess-2","timestamp":1700000000,"cwd":"/home/user/project"}` + "\n" +
	`{"type":"message","id":"msg-1","parentId":"","role":"user","content":"hello"}` + "\n" +
	`{"type":"message","id":"msg-2","parentId":"msg-1","role":"assistant","content":[{"type":"toolCall","name":"bash","arguments":{"cmd":"ls"}}]}` + "\n"

func TestPiProvider_ParseSummarySnippet(t *testing.T) {
	dir := t.TempDir()
	path := writePiJSONL(t, dir, piSampleV3)
	p := NewPiProvider(dir)
	mtime, size := fileStatFields(path)
	summary, ok := p.ParseSummary(context.Background(), SessionFile{Source: SourcePi, Path: path, MTime: mtime, Size: size})
	if !ok {
		t.Fatalf("expected ParseSummary ok")
	}
	if summary.Snippet != "hi" {
		t.Fatalf("expected snippet %q, got %q", "hi", summary.Snippet)
	}
}

func TestPiProvider_ParseSummarySnippetSkipsToolTail(t *testing.T) {
	dir := t.TempDir()
	path := writePiJSONL(t, dir, piSampleToolTail)
	p := NewPiProvider(dir)
	mtime, size := fileStatFields(path)
	summary, ok := p.ParseSummary(context.Background(), SessionFile{Source: SourcePi, Path: path, MTime: mtime, Size: size})
	if !ok {
		t.Fatalf("expected ParseSummary ok")
	}
	if summary.Snippet != "hello" {
		t.Fatalf("expected snippet %q, got %q", "hello", summary.Snippet)
	}
}

func TestPiProvider_ParseSummaryRoundTripsList(t *testing.T) {
	dir := t.TempDir()
	writePiJSONL(t, dir, piSampleV3)
	p := NewPiProvider(dir)
	files, err := p.ListFiles(context.Background())
	if err != nil {
		t.Fatalf("ListFiles: %v", err)
	}
	for _, f := range files {
		summary, ok := p.ParseSummary(context.Background(), f)
		if !ok {
			t.Fatalf("ParseSummary failed for %#v", f)
		}
		if summary.ID == "" || summary.Source != SourcePi {
			t.Fatalf("unexpected summary: %#v", summary)
		}
	}
}

func TestPiProvider_LoadMessages(t *testing.T) {
	dir := t.TempDir()
	path := writePiJSONL(t, dir, piSampleV3)
	p := NewPiProvider(dir)
	messages, err := p.LoadMessages(context.Background(), path)
	if err != nil {
		t.Fatalf("LoadMessages: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("expected 2 messages, got %d: %#v", len(messages), messages)
	}
	if messages[0].Role != RoleUser {
		t.Fatalf("expected first message role user, got %q", messages[0].Role)
	}
	if messages[0].Text != "hello" {
		t.Fatalf("expected first message text hello, got %q", messages[0].Text)
	}
	if messages[1].Role != RoleAssistant {
		t.Fatalf("expected second message role assistant, got %q", messages[1].Role)
	}
	if messages[1].Text != "hi" {
		t.Fatalf("expected second message text hi, got %q", messages[1].Text)
	}
	if messages[1].Seq != messages[0].Seq+1 {
		t.Fatalf("expected sequential seq numbers, got %d and %d", messages[0].Seq, messages[1].Seq)
	}
}

func TestPiProvider_LoadMessagesTree(t *testing.T) {
	// Branched tree: m1 (user) has two replies, m2 and m3. Ordering follows pi's
	// own buildSessionPath: the visible conversation is the ACTIVE branch only,
	// i.e. the parentId chain from the file's last entry back to the root.
	// Here the last entry is m3, so the path is m1 → m3; the abandoned branch
	// m2 is not part of the current conversation.
	dir := t.TempDir()
	content := `{"type":"session","version":3,"id":"pi-sess-2","timestamp":1700000001,"cwd":"/home/user/work"}` + "\n" +
		`{"type":"message","id":"m1","parentId":"","role":"user","content":"hello"}` + "\n" +
		`{"type":"message","id":"m2","parentId":"m1","role":"assistant","content":[{"type":"text","text":"first reply"}]}` + "\n" +
		`{"type":"message","id":"m3","parentId":"m1","role":"assistant","content":[{"type":"text","text":"second reply"}]}` + "\n"
	path := writePiJSONL(t, dir, content)
	p := NewPiProvider(dir)
	messages, err := p.LoadMessages(context.Background(), path)
	if err != nil {
		t.Fatalf("LoadMessages: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("expected 2 messages (active branch only), got %d: %#v", len(messages), messages)
	}
	if messages[0].Text != "hello" {
		t.Fatalf("expected first text hello, got %q", messages[0].Text)
	}
	if messages[1].Text != "second reply" {
		t.Fatalf("expected second text 'second reply' (active branch head), got %q", messages[1].Text)
	}
}

func TestPiProvider_LoadMessagesNonMessageNodes(t *testing.T) {
	// Regression: a model_change entry between messages makes the second user
	// message parent at a NON-message node. The parentId walk must traverse
	// those nodes so the displayed order stays the real Q/A chronology.
	dir := t.TempDir()
	content := `{"type":"session","version":3,"id":"pi-sess-2b","timestamp":1700000002,"cwd":"/home/user/work"}` + "\n" +
		`{"type":"model_change","id":"n0","parentId":"h0","timestamp":"2026-08-28T15:19:48.263Z","provider":"anthropic","modelId":"claude"}` + "\n" +
		`{"type":"message","id":"m1","parentId":"n0","timestamp":"2026-08-28T15:19:53.422Z","message":{"role":"user","content":[{"type":"text","text":"first question"}]}}` + "\n" +
		`{"type":"message","id":"m2","parentId":"m1","timestamp":"2026-08-28T15:20:00.558Z","message":{"role":"assistant","content":[{"type":"text","text":"first answer"}]}}` + "\n" +
		`{"type":"model_change","id":"n1","parentId":"m2","timestamp":"2026-08-28T15:20:18.404Z","provider":"openai","modelId":"gpt-5"}` + "\n" +
		`{"type":"message","id":"m3","parentId":"n1","timestamp":"2026-08-28T15:20:32.970Z","message":{"role":"user","content":[{"type":"text","text":"second question"}]}}` + "\n" +
		`{"type":"message","id":"m4","parentId":"m3","timestamp":"2026-08-28T15:20:41.299Z","message":{"role":"assistant","content":[{"type":"text","text":"second answer"}]}}` + "\n"
	path := writePiJSONL(t, dir, content)
	p := NewPiProvider(dir)
	messages, err := p.LoadMessages(context.Background(), path)
	if err != nil {
		t.Fatalf("LoadMessages: %v", err)
	}
	want := []string{"first question", "first answer", "second question", "second answer"}
	if len(messages) != len(want) {
		t.Fatalf("expected %d messages in order %v, got %d: %#v", len(want), want, len(messages), messages)
	}
	for i, text := range want {
		if messages[i].Text != text {
			t.Fatalf("message %d: expected %q, got %q", i, text, messages[i].Text)
		}
		if messages[i].Seq != i+1 {
			t.Fatalf("message %d: expected seq %d, got %d", i, i+1, messages[i].Seq)
		}
	}
}

func TestPiProvider_LoadMessagesBashExecution(t *testing.T) {
	// bashExecution item → anchor message "[Tool: bash]"; the bash output shows
	// through the paired ToolCall row (LoadToolCalls), not as message text.
	dir := t.TempDir()
	content := `{"type":"session","version":3,"id":"pi-sess-3","timestamp":1700000002,"cwd":"/home/user/proj"}` + "\n" +
		`{"type":"message","id":"b1","parentId":"","role":"user","content":"run ls"}` + "\n" +
		`{"type":"message","id":"b2","parentId":"b1","role":"assistant","content":[{"type":"bashExecution","bashOutput":"file1\nfile2"}]}` + "\n"
	path := writePiJSONL(t, dir, content)
	p := NewPiProvider(dir)
	messages, err := p.LoadMessages(context.Background(), path)
	if err != nil {
		t.Fatalf("LoadMessages: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("expected 2 messages, got %d: %#v", len(messages), messages)
	}
	if messages[1].ToolName != "bash" {
		t.Fatalf("expected ToolName bash on bashExecution anchor, got %q", messages[1].ToolName)
	}
	if messages[1].Text != "[Tool: bash]" {
		t.Fatalf("expected bash anchor text, got %q", messages[1].Text)
	}
	toolCalls, err := p.LoadToolCalls(context.Background(), path)
	if err != nil {
		t.Fatalf("LoadToolCalls: %v", err)
	}
	if len(toolCalls) != 1 || toolCalls[0].Output != "file1\nfile2" {
		t.Fatalf("expected bashExecution ToolCall with output, got %#v", toolCalls)
	}
}

func TestPiProvider_LoadMessagesMixedTextAndBash(t *testing.T) {
	// Mixed array: text item comes first, a tool item second. The text becomes
	// its own message and the tool becomes an anchor — the timeline pairs the
	// anchor with the matching ToolCall row (bashOutput rides the ToolCall).
	dir := t.TempDir()
	content := `{"type":"session","version":3,"id":"pi-sess-5","timestamp":1700000004,"cwd":"/home/user/mixed"}` + "\n" +
		`{"type":"message","id":"x1","parentId":"","role":"user","content":"run build"}` + "\n" +
		`{"type":"message","id":"x2","parentId":"x1","role":"assistant","content":[{"type":"text","text":"internal step"},{"type":"bashExecution","bashOutput":"build success"}]}` + "\n"
	path := writePiJSONL(t, dir, content)
	p := NewPiProvider(dir)
	messages, err := p.LoadMessages(context.Background(), path)
	if err != nil {
		t.Fatalf("LoadMessages: %v", err)
	}
	if len(messages) != 3 {
		t.Fatalf("expected 3 messages (user, text, anchor), got %d: %#v", len(messages), messages)
	}
	if messages[1].Role != RoleAssistant || messages[1].Text != "internal step" {
		t.Fatalf("expected second message assistant 'internal step', got %#v", messages[1])
	}
	if messages[2].Role != RoleAssistant || messages[2].Text != "[Tool: bash]" || messages[2].ToolName != "bash" {
		t.Fatalf("expected third message bash anchor, got %#v", messages[2])
	}
}

func TestPiProvider_LoadMessagesTextPlusTwoToolCalls(t *testing.T) {
	// Assistant entry with thinking + text + TWO tool calls: previously only a
	// single tool (or none) surfaced. Now: text message + one anchor per tool.
	dir := t.TempDir()
	content := `{"type":"session","version":3,"id":"pi-sess-6","timestamp":1700000005,"cwd":"/home/user/multi"}` + "\n" +
		`{"type":"message","id":"y1","parentId":"","timestamp":"2026-08-29T05:50:00.000Z","message":{"role":"user","content":[{"type":"text","text":"run tools"}]}}` + "\n" +
		`{"type":"message","id":"y2","parentId":"y1","timestamp":"2026-08-29T05:50:01.000Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"plan"},{"type":"text","text":"done"}]}}` + "\n" +
		`{"type":"message","id":"y3","parentId":"y2","timestamp":"2026-08-29T05:50:02.000Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"running tools"},{"type":"toolCall","id":"c1","name":"bash","arguments":{"command":"ls"}},{"type":"toolCall","id":"c2","name":"read","arguments":{"path":"/tmp/x"}}]}}` + "\n"
	path := writePiJSONL(t, dir, content)
	p := NewPiProvider(dir)
	messages, err := p.LoadMessages(context.Background(), path)
	if err != nil {
		t.Fatalf("LoadMessages: %v", err)
	}
	want := []struct{ text, tool, thinking string }{
		{"run tools", "", ""},
		{"done", "", "plan"},
		{"[Tool: bash]", "bash", "running tools"},
		{"[Tool: read]", "read", ""},
	}
	if len(messages) != len(want) {
		t.Fatalf("expected %d messages, got %d: %#v", len(want), len(messages), messages)
	}
	for i, w := range want {
		if messages[i].Text != w.text || messages[i].ToolName != w.tool || messages[i].Thinking != w.thinking {
			t.Fatalf("message %d: want %#v, got %#v", i, w, messages[i])
		}
		if messages[i].Seq != i+1 {
			t.Fatalf("message %d: expected seq %d, got %d", i, i+1, messages[i].Seq)
		}
	}
}

func TestPiProvider_LoadToolCalls(t *testing.T) {
	dir := t.TempDir()
	content := `{"type":"session","version":3,"id":"pi-sess-4","timestamp":1700000003,"cwd":"/home/user/repo"}` + "\n" +
		`{"type":"message","id":"t1","parentId":"","role":"user","content":"list files"}` + "\n" +
		`{"type":"message","id":"t2","parentId":"t1","role":"assistant","content":[{"type":"text","text":"running..."},{"type":"toolcall","name":"bash","input":"ls -la","output":"total 0"}]}` + "\n"
	path := writePiJSONL(t, dir, content)
	p := NewPiProvider(dir)
	toolCalls, err := p.LoadToolCalls(context.Background(), path)
	if err != nil {
		t.Fatalf("LoadToolCalls: %v", err)
	}
	if len(toolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d: %#v", len(toolCalls), toolCalls)
	}
	if toolCalls[0].Name != "bash" {
		t.Fatalf("expected tool name bash, got %q", toolCalls[0].Name)
	}
	if toolCalls[0].Summary == "" {
		t.Fatalf("expected non-empty tool summary")
	}
	if toolCalls[0].Output != "total 0" {
		t.Fatalf("expected output 'total 0', got %q", toolCalls[0].Output)
	}
}

func TestPiProvider_LoadMessageDelta(t *testing.T) {
	dir := t.TempDir()
	path := writePiJSONL(t, dir, piSampleV3)
	p := NewPiProvider(dir)

	// First load: get the cursor pointing at end of file.
	messages, err := p.LoadMessages(context.Background(), path)
	if err != nil {
		t.Fatalf("LoadMessages: %v", err)
	}
	lastSeq := messages[len(messages)-1].Seq

	// Append a new message line.
	appendContent := `{"type":"message","id":"msg-3","parentId":"msg-2","role":"user","content":"follow up"}` + "\n"
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatalf("open for append: %v", err)
	}
	if _, err := f.WriteString(appendContent); err != nil {
		f.Close()
		t.Fatalf("append: %v", err)
	}
	f.Close()

	info, _ := os.Stat(path)
	cursor := SessionMessageCursor{
		ByteOffset: info.Size() - int64(len(appendContent)),
		LastSeq:    lastSeq,
	}
	delta, err := p.LoadMessageDelta(context.Background(), path, cursor, 0)
	if err != nil {
		t.Fatalf("LoadMessageDelta: %v", err)
	}
	if len(delta.Messages) != 1 {
		t.Fatalf("expected 1 delta message, got %d: %#v", len(delta.Messages), delta.Messages)
	}
	if delta.Messages[0].Text != "follow up" {
		t.Fatalf("expected delta text 'follow up', got %q", delta.Messages[0].Text)
	}
	if delta.Messages[0].Role != RoleUser {
		t.Fatalf("expected delta role user, got %q", delta.Messages[0].Role)
	}
}

func TestPiProvider_MissingDir(t *testing.T) {
	p := NewPiProvider(filepath.Join(t.TempDir(), "does-not-exist"))
	summaries, err := p.List(context.Background())
	if err != nil {
		t.Fatalf("List on missing dir should not error: %v", err)
	}
	if len(summaries) != 0 {
		t.Fatalf("expected 0 summaries, got %#v", summaries)
	}
}

// --- Real pi v3 format regression tests -------------------------------------
// Real pi session files (verified against ~/.pi/agent/sessions) differ from the
// older fixtures above in three ways:
//   1. header `timestamp` is an ISO-8601 string, not numeric epoch
//   2. message role/content is nested under a `message` key
//   3. the first message's parentId points at a non-message node (model_change /
//      thinking_level_change), so message-tree roots are not parentId=="" lines
// These tests pin the real shape end to end (summary + messages + tool calls).

const realPiSampleV3 = `{"type":"session","version":3,"id":"real-pi-sess","timestamp":"2026-08-05T05:19:19.857Z","cwd":"E:\\code\\snorkeling"}` + "\n" +
	`{"type":"model_change","id":"51af115e","parentId":null,"timestamp":"2026-08-05T05:19:20.128Z","provider":"openai","modelId":"deepseek-v4-flash"}` + "\n" +
	`{"type":"thinking_level_change","id":"6e2dbf7b","parentId":"51af115e","timestamp":"2026-08-05T05:19:20.129Z","thinkingLevel":"off"}` + "\n" +
	`{"type":"message","id":"m1","parentId":"6e2dbf7b","timestamp":"2026-08-05T05:19:34.807Z","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}` + "\n" +
	`{"type":"message","id":"m2","parentId":"m1","timestamp":"2026-08-05T05:20:17.024Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"let me think"},{"type":"text","text":"hi"}]}}` + "\n" +
	`{"type":"message","id":"m3","parentId":"m2","timestamp":"2026-08-05T05:20:18.000Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"need to run ls"},{"type":"toolCall","id":"call_1","name":"bash","arguments":{"command":"ls"}}]}}` + "\n" +
	`{"type":"message","id":"m4","parentId":"m3","timestamp":"2026-08-05T05:20:19.000Z","message":{"role":"toolResult","toolCallId":"call_1","toolName":"bash","content":[{"type":"text","text":"file1\nfile2"}]}}` + "\n"

func TestPiProvider_RealFormatParseSummary(t *testing.T) {
	dir := t.TempDir()
	writePiJSONL(t, dir, realPiSampleV3)
	p := NewPiProvider(dir)
	files, err := p.ListFiles(context.Background())
	if err != nil {
		t.Fatalf("ListFiles: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("expected 1 file, got %d", len(files))
	}
	summary, ok := p.ParseSummary(context.Background(), files[0])
	if !ok {
		t.Fatalf("expected ParseSummary ok for real-format header")
	}
	if summary.ID != "real-pi-sess" {
		t.Fatalf("expected id real-pi-sess, got %q", summary.ID)
	}
	if summary.ProjectPath != `E:\code\snorkeling` {
		t.Fatalf("expected cwd E:\\code\\snorkeling, got %q", summary.ProjectPath)
	}
	expCreated, _ := time.Parse(time.RFC3339Nano, "2026-08-05T05:19:19.857Z")
	if summary.CreatedAt != expCreated.UnixMilli() {
		t.Fatalf("expected CreatedAt %d, got %d", expCreated.UnixMilli(), summary.CreatedAt)
	}
	expUpdated, _ := time.Parse(time.RFC3339Nano, "2026-08-05T05:20:19.000Z")
	if summary.UpdatedAt != expUpdated.UnixMilli() {
		t.Fatalf("expected UpdatedAt %d, got %d", expUpdated.UnixMilli(), summary.UpdatedAt)
	}
}

func TestPiProvider_RealFormatLoadMessages(t *testing.T) {
	dir := t.TempDir()
	path := writePiJSONL(t, dir, realPiSampleV3)
	p := NewPiProvider(dir)
	messages, err := p.LoadMessages(context.Background(), path)
	if err != nil {
		t.Fatalf("LoadMessages: %v", err)
	}
	if len(messages) != 4 {
		t.Fatalf("expected 4 messages, got %d: %#v", len(messages), messages)
	}
	// m1: user text (nested message key, root via non-message parentId)
	if messages[0].Role != RoleUser || messages[0].Text != "hello" {
		t.Fatalf("expected m1 user 'hello', got %#v", messages[0])
	}
	// m2: thinking item skipped, text item kept
	if messages[1].Role != RoleAssistant || messages[1].Text != "hi" {
		t.Fatalf("expected m2 assistant 'hi' (thinking skipped), got %#v", messages[1])
	}
	// m3: thinking + toolCall → tool marker text
	if messages[2].Role != RoleAssistant || messages[2].Text != "[Tool: bash]" {
		t.Fatalf("expected m3 '[Tool: bash]', got %#v", messages[2])
	}
	// m4: toolResult → tool role with output text
	if messages[3].Role != RoleTool || messages[3].Text != "file1\nfile2" || messages[3].ToolName != "bash" {
		t.Fatalf("expected m4 tool 'file1\nfile2' with toolName bash, got %#v", messages[3])
	}
	for i, msg := range messages {
		if msg.Seq != i+1 {
			t.Fatalf("expected sequential seq, got %d at index %d", msg.Seq, i)
		}
	}
}

func TestPiProvider_RealFormatLoadToolCalls(t *testing.T) {
	dir := t.TempDir()
	path := writePiJSONL(t, dir, realPiSampleV3)
	p := NewPiProvider(dir)
	toolCalls, err := p.LoadToolCalls(context.Background(), path)
	if err != nil {
		t.Fatalf("LoadToolCalls: %v", err)
	}
	if len(toolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d: %#v", len(toolCalls), toolCalls)
	}
	if toolCalls[0].Name != "bash" {
		t.Fatalf("expected tool name bash, got %q", toolCalls[0].Name)
	}
	if !strings.Contains(toolCalls[0].Summary, "ls") {
		t.Fatalf("expected summary to contain 'ls', got %q", toolCalls[0].Summary)
	}
	// output is paired back from the toolResult message by toolCallId
	if toolCalls[0].Output != "file1\nfile2" {
		t.Fatalf("expected output 'file1\nfile2', got %q", toolCalls[0].Output)
	}
}

func TestPiProvider_LoadMessagesExtractsThinking(t *testing.T) {
	// assistant message with thinking blocks: history keeps the reasoning so
	// the detail pane can show it (collapsed) after the live stream ends.
	dir := t.TempDir()
	content := `{"type":"session","version":3,"id":"pi-sess-think","timestamp":1700000003,"cwd":"/home/user/proj"}` + "\n" +
		`{"type":"message","id":"t1","parentId":"","timestamp":"2026-08-28T15:19:53.000Z","message":{"role":"user","content":[{"type":"text","text":"plan it"}]}}` + "\n" +
		`{"type":"message","id":"t2","parentId":"t1","timestamp":"2026-08-28T15:19:54.000Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"step one"},{"type":"text","text":"done"},{"type":"thinking","thinking":"step two"}]}}` + "\n"
	path := writePiJSONL(t, dir, content)
	p := NewPiProvider(dir)
	messages, err := p.LoadMessages(context.Background(), path)
	if err != nil {
		t.Fatalf("LoadMessages: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("expected 2 messages, got %d: %#v", len(messages), messages)
	}
	assistant := messages[1]
	if assistant.Text != "done" {
		t.Fatalf("expected text 'done', got %q", assistant.Text)
	}
	if assistant.Thinking != "step one\n\nstep two" {
		t.Fatalf("expected joined thinking, got %q", assistant.Thinking)
	}
}

// piTitleSummary writes a file and returns the derived title + source.
func piParseTitle(t *testing.T, content string) (string, string) {
	t.Helper()
	dir := t.TempDir()
	path := writePiJSONL(t, dir, content)
	p := NewPiProvider(dir)
	mtime, size := fileStatFields(path)
	summary, ok := p.ParseSummary(context.Background(), SessionFile{Source: SourcePi, Path: path, MTime: mtime, Size: size})
	if !ok {
		t.Fatalf("expected ParseSummary ok")
	}
	return summary.Title, summary.TitleSource
}

func TestPiProvider_TitleFromFirstUserMessage(t *testing.T) {
	content := `{"type":"session","version":3,"id":"pi-title-1","timestamp":1700000000,"cwd":"/home/user/proj"}` + "\n" +
		`{"type":"message","id":"u1","parentId":"","timestamp":"2026-08-05T05:19:34.807Z","message":{"role":"user","content":[{"type":"text","text":"Refactor the auth module"}]}}` + "\n"
	title, source := piParseTitle(t, content)
	if title != "Refactor the auth module" {
		t.Fatalf("expected title from first user message, got %q", title)
	}
	if source != "first_user_message" {
		t.Fatalf("expected source first_user_message, got %q", source)
	}
}

func TestPiProvider_TitlePrefersSessionInfoName(t *testing.T) {
	content := `{"type":"session","version":3,"id":"pi-title-2","timestamp":1700000000,"cwd":"/home/user/proj"}` + "\n" +
		`{"type":"session_info","id":"n1","parentId":null,"timestamp":"2026-08-05T05:20:00.000Z","name":"CI audit"}` + "\n" +
		`{"type":"message","id":"u1","parentId":"n1","timestamp":"2026-08-05T05:20:10.000Z","message":{"role":"user","content":[{"type":"text","text":"check the build"}]}}` + "\n"
	title, source := piParseTitle(t, content)
	if title != "CI audit" {
		t.Fatalf("expected session name to win, got %q", title)
	}
	if source != "source_title" {
		t.Fatalf("expected source source_title, got %q", source)
	}
}

func TestPiProvider_TitleSkipsBoilerplateUserMessage(t *testing.T) {
	// The first user message is AGENTS.md boilerplate injected by the harness;
	// it must be skipped in favor of the real first user prompt.
	content := `{"type":"session","version":3,"id":"pi-title-3","timestamp":1700000000,"cwd":"/home/user/proj"}` + "\n" +
		`{"type":"message","id":"u1","parentId":"","timestamp":"2026-08-05T05:19:34.807Z","message":{"role":"user","content":[{"type":"text","text":"Read AGENTS.md if it exists"}]}}` + "\n" +
		`{"type":"message","id":"u2","parentId":"u1","timestamp":"2026-08-05T05:19:35.000Z","message":{"role":"user","content":[{"type":"text","text":"why is the auth failing"}]}}` + "\n"
	title, source := piParseTitle(t, content)
	if title != "why is the auth failing" {
		t.Fatalf("expected boilerplate user message skipped, got %q", title)
	}
	if source != "first_user_message" {
		t.Fatalf("expected source first_user_message, got %q", source)
	}
}

func TestPiProvider_TitleEmptyFallsBackToID(t *testing.T) {
	// No name and no effective user message -> empty title so DisplayTitle
	// falls back to the project basename or session id.
	content := `{"type":"session","version":3,"id":"pi-title-4","timestamp":1700000000,"cwd":"/home/user/proj"}` + "\n" +
		`{"type":"message","id":"u1","parentId":"","timestamp":"2026-08-05T05:19:34.807Z","message":{"role":"user","content":[{"type":"text","text":"Read AGENTS.md if it exists"}]}}` + "\n"
	title, source := piParseTitle(t, content)
	if title != "" || source != "" {
		t.Fatalf("expected empty title/source, got %q / %q", title, source)
	}
	dir := t.TempDir()
	path := writePiJSONL(t, dir, content)
	p := NewPiProvider(dir)
	mtime, size := fileStatFields(path)
	summary, ok := p.ParseSummary(context.Background(), SessionFile{Source: SourcePi, Path: path, MTime: mtime, Size: size})
	if !ok {
		t.Fatalf("expected ParseSummary ok")
	}
	if got := summary.DisplayTitle(); got != "proj" {
		t.Fatalf("expected DisplayTitle fallback to project basename, got %q", got)
	}
}
