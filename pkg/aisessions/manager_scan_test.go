// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
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
