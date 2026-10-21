// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// piSessionLine builds a minimal pi JSONL v3 header for the given id.
func piSessionLine(id string, cwd string) string {
	return `{"type":"session","version":3,"id":"` + id + `","timestamp":"2026-10-21T10:00:00.000Z","cwd":"` + cwd + `"}` + "\n" +
		`{"type":"message","id":"m1","parentId":"","timestamp":"2026-10-21T10:00:01.000Z","message":{"role":"user","content":"hello"}}` + "\n"
}

// writeFileAt writes content to an absolute path, creating parent dirs.
func writeFileAt(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// The parent/child relationship exists only on disk, so the provider must attach
// ParentPath/Kind while listing and echo them back onto the summary. This walks
// the real directory shapes pi produces (fork dir + uuid/run-0/session.jsonl).
func TestPiProviderListFilesClassifiesSubagentAndFork(t *testing.T) {
	sessionsDir := t.TempDir()
	project := "--Users-nita-project--"
	projDir := filepath.Join(sessionsDir, project)
	parentID := "019fd778-48eb-7774-a4fd-25424af0a21e"
	parentName := "2026-10-21T10-00-00-000Z_" + parentID

	parentPath := filepath.Join(projDir, parentName+".jsonl")
	forkPath := filepath.Join(projDir, parentName, "forks", "2026-10-21T11-00-00-000Z_bbbb.jsonl")
	subPath := filepath.Join(projDir, parentName, "3506248a-3918-4874-b4ba-cfda11fdce9c", "run-0", "session.jsonl")

	writeFileAt(t, parentPath, piSessionLine(parentID, "/Users/nita/project"))
	writeFileAt(t, forkPath, piSessionLine("bbbb", "/Users/nita/project"))
	writeFileAt(t, subPath, piSessionLine("cccc", "/Users/nita/project"))

	provider := NewPiProvider(sessionsDir)
	files, err := provider.ListFiles(context.Background())
	if err != nil {
		t.Fatalf("ListFiles: %v", err)
	}
	if len(files) != 3 {
		t.Fatalf("expected 3 files, got %d", len(files))
	}
	byPath := make(map[string]SessionFile, len(files))
	for _, file := range files {
		byPath[file.Path] = file
	}

	parentFile := byPath[parentPath]
	if parentFile.Kind != SessionKindSession {
		t.Fatalf("parent kind = %q, want %q", parentFile.Kind, SessionKindSession)
	}
	if parentFile.ParentPath != "" {
		t.Fatalf("parent ParentPath = %q, want empty", parentFile.ParentPath)
	}

	forkFile := byPath[forkPath]
	if forkFile.Kind != SessionKindFork {
		t.Fatalf("fork kind = %q, want %q", forkFile.Kind, SessionKindFork)
	}
	if forkFile.ParentPath != parentPath {
		t.Fatalf("fork ParentPath = %q, want %q", forkFile.ParentPath, parentPath)
	}

	subFile := byPath[subPath]
	if subFile.Kind != SessionKindSubagent {
		t.Fatalf("subagent kind = %q, want %q", subFile.Kind, SessionKindSubagent)
	}
	if subFile.ParentPath != parentPath {
		t.Fatalf("subagent ParentPath = %q, want %q", subFile.ParentPath, parentPath)
	}

	// The summary must carry both fields through to the index, and the child's
	// ParentKey must equal the parent summary's own Key.
	wantParentKey := StableKey(SourcePi, parentID, parentPath)
	summaries := map[string]SessionSummary{}
	for _, file := range files {
		summary, ok := provider.ParseSummary(context.Background(), file)
		if !ok {
			t.Fatalf("ParseSummary failed for %s", file.Path)
		}
		summaries[file.Path] = summary
	}

	parentSummary := summaries[parentPath]
	if parentSummary.ParentKey != "" {
		t.Fatalf("parent ParentKey = %q, want empty", parentSummary.ParentKey)
	}
	if parentSummary.Kind != SessionKindSession {
		t.Fatalf("parent summary Kind = %q, want %q", parentSummary.Kind, SessionKindSession)
	}

	forkSummary := summaries[forkPath]
	if forkSummary.ParentKey != wantParentKey {
		t.Fatalf("fork ParentKey = %q, want %q", forkSummary.ParentKey, wantParentKey)
	}
	if forkSummary.ParentKey != parentSummary.Key {
		t.Fatalf("fork ParentKey (%q) does not point at the parent summary key (%q)", forkSummary.ParentKey, parentSummary.Key)
	}
	if forkSummary.Kind != SessionKindFork {
		t.Fatalf("fork summary Kind = %q, want %q", forkSummary.Kind, SessionKindFork)
	}

	subSummary := summaries[subPath]
	if subSummary.ParentKey != parentSummary.Key {
		t.Fatalf("subagent ParentKey = %q, want parent key %q", subSummary.ParentKey, parentSummary.Key)
	}
	if subSummary.Kind != SessionKindSubagent {
		t.Fatalf("subagent summary Kind = %q, want %q", subSummary.Kind, SessionKindSubagent)
	}
}

// ParseSummary is also called with hand-built SessionFiles (no prior ListFiles
// classification). It must derive the same parent/kind rather than silently
// producing an unparented row.
func TestPiProviderParseSummaryClassifiesWithoutListFiles(t *testing.T) {
	sessionsDir := t.TempDir()
	project := "--proj--"
	parentID := "019fd778-48eb-7774-a4fd-25424af0a21e"
	parentName := "2026-10-21T10-00-00-000Z_" + parentID
	subPath := filepath.Join(sessionsDir, project, parentName, "aaaa", "run-0", "session.jsonl")
	writeFileAt(t, subPath, piSessionLine("cccc", "/tmp/p"))

	provider := NewPiProvider(sessionsDir)
	summary, ok := provider.ParseSummary(context.Background(), SessionFile{Source: SourcePi, Path: subPath})
	if !ok {
		t.Fatal("ParseSummary returned false")
	}
	if summary.Kind != SessionKindSubagent {
		t.Fatalf("Kind = %q, want %q", summary.Kind, SessionKindSubagent)
	}
	parentPath := filepath.Join(sessionsDir, project, parentName+".jsonl")
	if want := StableKey(SourcePi, parentID, parentPath); summary.ParentKey != want {
		t.Fatalf("ParentKey = %q, want %q", summary.ParentKey, want)
	}
}

// An orphan directory (parent file deleted, directory left behind) still yields a
// parent key; the list layer promotes such rows to the top level. It must never
// panic or drop the session.
func TestPiProviderOrphanChildDirectory(t *testing.T) {
	sessionsDir := t.TempDir()
	project := "--proj--"
	parentID := "019fd778-48eb-7774-a4fd-25424af0a21e"
	parentName := "2026-10-21T10-00-00-000Z_" + parentID
	subPath := filepath.Join(sessionsDir, project, parentName, "aaaa", "session.jsonl")
	writeFileAt(t, subPath, piSessionLine("cccc", "/tmp/p"))

	provider := NewPiProvider(sessionsDir)
	summary, ok := provider.ParseSummary(context.Background(), SessionFile{Source: SourcePi, Path: subPath})
	if !ok {
		t.Fatal("ParseSummary returned false for orphan child")
	}
	if summary.ParentKey == "" {
		t.Fatal("expected a parent key for an orphan child directory")
	}
	if summary.Kind != SessionKindSubagent {
		t.Fatalf("Kind = %q, want %q", summary.Kind, SessionKindSubagent)
	}
}
