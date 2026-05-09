// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestManagerScanFlowWithoutIndexStore(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(dir, "meta.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_DELETED_DIR", filepath.Join(t.TempDir(), "deleted"))

	sessionPath := filepath.Join(dir, "session.jsonl")
	err := os.WriteFile(sessionPath, []byte(
		`{"timestamp":"2026-03-06T21:50:12Z","type":"session_meta","payload":{"id":"test-id","cwd":"/tmp/project"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:13Z","type":"response_item","payload":{"type":"message","role":"user","content":"How do I deploy Snorkling?"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:13Z","type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"{\"cmd\":[\"ls\"]}","call_id":"call_1"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:13Z","type":"response_item","payload":{"type":"function_call_output","call_id":"call_1","output":"release.yml"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:14Z","type":"response_item","payload":{"type":"message","role":"assistant","content":"Use the release pipeline."}}`+"\n",
	), 0600)
	if err != nil {
		t.Fatal(err)
	}

	manager := NewManager(filepath.Join(dir, "index.json"), []Provider{NewCodexProvider(dir)})

	results, err := manager.List(context.Background(), ListOptions{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0].ID != "test-id" {
		t.Fatalf("unexpected list results: %#v", results)
	}
	if results[0].MessageCount != 2 {
		t.Fatalf("expected 2 readable messages in list, got %d (%#v)", results[0].MessageCount, results[0])
	}

	marked, err := manager.Mark(context.Background(), "test-id", true)
	if err != nil {
		t.Fatal(err)
	}
	if !marked.Marked {
		t.Fatalf("expected marked session: %#v", marked)
	}

	note, err := manager.Note(context.Background(), "test-id", "important")
	if err != nil {
		t.Fatal(err)
	}
	if note.Note != "important" {
		t.Fatalf("unexpected note session: %#v", note)
	}

	detail, err := manager.Load(context.Background(), "test-id", false)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Summary.Note != "important" || !detail.Summary.Marked {
		t.Fatalf("unexpected detail summary: %#v", detail.Summary)
	}
	if detail.Summary.MessageCount != 2 {
		t.Fatalf("expected 2 readable messages in detail summary, got %d", detail.Summary.MessageCount)
	}
	if len(detail.Messages) != 4 {
		t.Fatalf("expected full detail to retain 4 parsed messages, got %d", len(detail.Messages))
	}

	path, err := manager.Path(context.Background(), "test-id", false)
	if err != nil {
		t.Fatal(err)
	}
	if path != sessionPath {
		t.Fatalf("unexpected path: %q", path)
	}

	markedOnly, err := manager.List(context.Background(), ListOptions{MarkedOnly: true, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(markedOnly) != 1 || !markedOnly[0].Marked || markedOnly[0].Note != "important" {
		t.Fatalf("unexpected marked-only results: %#v", markedOnly)
	}

	deleted, err := manager.Delete(context.Background(), "test-id")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(sessionPath); !os.IsNotExist(err) {
		t.Fatalf("expected original session to be moved, stat err=%v", err)
	}
	if _, err := os.Stat(deleted.FilePath); err != nil {
		t.Fatalf("expected deleted session file at %q: %v", deleted.FilePath, err)
	}
	afterDelete, err := manager.List(context.Background(), ListOptions{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(afterDelete) != 0 {
		t.Fatalf("expected no sessions after delete, got %#v", afterDelete)
	}
}

func TestManagerReadableMessageCountForClaude(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(dir, "meta.json"))

	sessionPath := filepath.Join(dir, "session-claude.jsonl")
	err := os.WriteFile(sessionPath, []byte(
		`{"type":"user","sessionId":"claude-id","timestamp":"2026-03-06T10:00:00Z","cwd":"/tmp/project","message":{"role":"user","content":"Write the file"}}`+"\n"+
			`{"timestamp":"2026-03-06T10:00:01Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Write","input":{"file_path":"a.txt"}}]}}`+"\n"+
			`{"timestamp":"2026-03-06T10:00:02Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"File written"}]}}`+"\n"+
			`{"timestamp":"2026-03-06T10:00:03Z","message":{"role":"assistant","content":"Done."}}`+"\n",
	), 0600)
	if err != nil {
		t.Fatal(err)
	}

	manager := NewManager(filepath.Join(dir, "index.json"), []Provider{NewClaudeProvider([]string{dir})})

	results, err := manager.List(context.Background(), ListOptions{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0].ID != "claude-id" {
		t.Fatalf("unexpected list results: %#v", results)
	}
	if results[0].MessageCount != 2 {
		t.Fatalf("expected 2 readable messages in list, got %d (%#v)", results[0].MessageCount, results[0])
	}

	detail, err := manager.Load(context.Background(), "claude-id", false)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Summary.MessageCount != 2 {
		t.Fatalf("expected 2 readable messages in detail summary, got %d", detail.Summary.MessageCount)
	}
	if len(detail.Messages) != 4 {
		t.Fatalf("expected full detail to retain 4 parsed messages, got %d", len(detail.Messages))
	}
}

type countingProvider struct {
	source          string
	summaries       []SessionSummary
	loadMessagesHit int
}

func (p *countingProvider) Source() string {
	return p.source
}

func (p *countingProvider) List(ctx context.Context) ([]SessionSummary, error) {
	return p.summaries, ctx.Err()
}

func (p *countingProvider) LoadMessages(ctx context.Context, filePath string) ([]Message, error) {
	p.loadMessagesHit++
	return nil, fmt.Errorf("LoadMessages should not be called")
}

func TestManagerSummaryDoesNotLoadMessages(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(dir, "meta.json"))
	provider := &countingProvider{
		source: SourceCodex,
		summaries: []SessionSummary{
			{
				Key:      "codex:test-id:/tmp/session.jsonl",
				ID:       "test-id",
				Source:   SourceCodex,
				Title:    "Test session",
				FilePath: "/tmp/session.jsonl",
			},
		},
	}
	manager := NewManager(filepath.Join(dir, "index.json"), []Provider{provider})
	if _, err := manager.Note(context.Background(), "test-id", "important"); err != nil {
		t.Fatal(err)
	}

	summary, err := manager.Summary(context.Background(), "test-id", false)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Note != "important" {
		t.Fatalf("expected note from meta, got %#v", summary)
	}
	if provider.loadMessagesHit != 0 {
		t.Fatalf("Summary loaded messages %d times", provider.loadMessagesHit)
	}
}
