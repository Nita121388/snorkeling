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

func TestProjectPathMatches(t *testing.T) {
	tests := []struct {
		name    string
		path    string
		project string
		want    bool
	}{
		{"empty project matches everything", "E:\\code", "", true},
		{"exact equal", "/Users/nita/Primary", "/Users/nita/Primary", true},
		{"child under prefix", "/Users/nita/Primary/projects/snorkeling", "/Users/nita/Primary", true},
		{"same-name-prefix sibling excluded", "/Users/nita/Primary/projects/snorkeling-light-theme", "/Users/nita/Primary/projects/snorkeling", false},
		{"same-name-prefix deep child included", "/Users/nita/Primary/projects/snorkeling/frontend", "/Users/nita/Primary/projects/snorkeling", true},
		{"case-insensitive", "/USERS/nIta/Primary/PROJECTS/snorkeling", "/users/nita/primary/projects/snorkeling", true},
		{"windows drive root matches all under it", "E:\\code\\snorkeling", "E:\\", true},
		{"windows drive root exact", "E:\\", "E:\\", true},
		{"windows sibling excluded", "E:\\snorkeling-light-theme", "E:\\snorkeling", false},
		{"unix root / matches all absolute", "/tmp/project", "/", true},
		{"not under prefix", "/home/other/x", "/Users/nita", false},
		{"prefix in middle not matched", "/Volumes/backup/Users/nita/x", "/Users/nita", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := projectPathMatches(tt.path, tt.project); got != tt.want {
				t.Errorf("projectPathMatches(%q, %q) = %v, want %v", tt.path, tt.project, got, tt.want)
			}
		})
	}
}

func TestSummarizeProjectPathsFromMap(t *testing.T) {
	got := summarizeProjectPathsFromMap(map[string]int{
		"/b": 2,
		"/a": 5,
		"/c": 1,
	})
	if len(got) != 3 {
		t.Fatalf("unexpected length %d", len(got))
	}
	// sorted count desc, then path asc
	want := []ProjectPathSummary{{Path: "/a", Count: 5}, {Path: "/b", Count: 2}, {Path: "/c", Count: 1}}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("entry %d = %#v, want %#v", i, got[i], want[i])
		}
	}
}
