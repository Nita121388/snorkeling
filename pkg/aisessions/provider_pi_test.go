// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"os"
	"path/filepath"
	"testing"
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
	// Tree with a branch: root → m1 (user), m1 → m2 (asst), m1 → m3 (asst second).
	// BFS from root should produce m1, m2, m3 in order.
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
	if len(messages) != 3 {
		t.Fatalf("expected 3 messages, got %d: %#v", len(messages), messages)
	}
	if messages[0].Text != "hello" {
		t.Fatalf("expected first text hello, got %q", messages[0].Text)
	}
	if messages[1].Text != "first reply" {
		t.Fatalf("expected second text 'first reply', got %q", messages[1].Text)
	}
	if messages[2].Text != "second reply" {
		t.Fatalf("expected third text 'second reply', got %q", messages[2].Text)
	}
}

func TestPiProvider_LoadMessagesBashExecution(t *testing.T) {
	// bashExecution kind → special message with tool-name "bash".
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
		t.Fatalf("expected ToolName bash on bashExecution message, got %q", messages[1].ToolName)
	}
	if messages[1].Text == "" {
		t.Fatalf("expected non-empty bashExecution text")
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
