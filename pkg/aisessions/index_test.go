// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestManagerIndexesSearchesAndMarks(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(dir, "meta.json"))
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
	stats, errs := manager.Index(context.Background())
	if len(errs) > 0 {
		t.Fatalf("unexpected index errors: %v", errs)
	}
	if stats.Summaries != 1 || stats.FullTextIndexed != 1 {
		t.Fatalf("unexpected stats: %#v", stats)
	}

	results, err := manager.Search(context.Background(), SearchOptions{Query: "deploy", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0].ID != "test-id" {
		t.Fatalf("unexpected search results: %#v", results)
	}

	marked, err := manager.Mark(context.Background(), "test-id", true)
	if err != nil {
		t.Fatal(err)
	}
	if !marked.Marked {
		t.Fatal("expected marked summary")
	}
	if _, err := manager.Note(context.Background(), "test-id", "important"); err != nil {
		t.Fatal(err)
	}

	list, err := manager.List(context.Background(), ListOptions{Marked: "starred", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || !list[0].Marked || list[0].Note != "important" {
		t.Fatalf("unexpected marked list: %#v", list)
	}
}
