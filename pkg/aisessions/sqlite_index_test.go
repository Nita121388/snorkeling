// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestSQLiteIndexMigratesMetaJSONAndManagerAppliesIt(t *testing.T) {
	dir := t.TempDir()
	metaPath := filepath.Join(dir, "meta.json")
	indexPath := filepath.Join(dir, "index.json")
	sqlitePath := filepath.Join(dir, "index-v2.sqlite")
	sessionKey := "codex:sqlite-meta:/tmp/sqlite-meta.jsonl"
	if err := os.WriteFile(metaPath, []byte(`{
  "version": 1,
  "sessions": {
    "`+sessionKey+`": {
      "marked": true,
      "note": "important note",
      "updatedAt": 1770000000000
    }
  }
}`), 0600); err != nil {
		t.Fatal(err)
	}
	provider := &cacheProvider{
		source: SourceCodex,
		summaries: []SessionSummary{
			{Key: sessionKey, ID: "sqlite-meta", Source: SourceCodex, FilePath: "/tmp/sqlite-meta.jsonl", MTime: 1, Size: 10},
		},
		messages: []Message{{Seq: 1, Role: RoleUser, Text: "hello"}},
	}
	manager := NewManagerWithOptions(ManagerOptions{
		Providers:  []Provider{provider},
		IndexPath:  indexPath,
		MetaPath:   metaPath,
		SQLitePath: sqlitePath,
	})

	summary, err := manager.Summary(context.Background(), "sqlite-meta", false)
	if err != nil {
		t.Fatal(err)
	}
	if !summary.Marked || summary.Note != "important note" {
		t.Fatalf("expected migrated meta on summary, got %#v", summary)
	}
	if _, err := os.Stat(sqlitePath); err != nil {
		t.Fatalf("expected sqlite index at %q: %v", sqlitePath, err)
	}
	matches, err := filepath.Glob(filepath.Join(dir, "meta.json.backup-before-sqlite-*"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 1 {
		t.Fatalf("expected one meta backup, got %d: %#v", len(matches), matches)
	}
}

func TestManagerNoteAndMarkDualWriteSQLiteAndMetaJSON(t *testing.T) {
	dir := t.TempDir()
	metaPath := filepath.Join(dir, "meta.json")
	indexPath := filepath.Join(dir, "index.json")
	sqlitePath := filepath.Join(dir, "index-v2.sqlite")
	sessionKey := "codex:dual-write:/tmp/dual-write.jsonl"
	provider := &cacheProvider{
		source: SourceCodex,
		summaries: []SessionSummary{
			{Key: sessionKey, ID: "dual-write", Source: SourceCodex, FilePath: "/tmp/dual-write.jsonl", MTime: 1, Size: 10},
		},
		messages: []Message{{Seq: 1, Role: RoleUser, Text: "hello"}},
	}
	manager := NewManagerWithOptions(ManagerOptions{
		Providers:  []Provider{provider},
		IndexPath:  indexPath,
		MetaPath:   metaPath,
		SQLitePath: sqlitePath,
	})

	if _, err := manager.Note(context.Background(), "dual-write", "sqlite note"); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Mark(context.Background(), "dual-write", true); err != nil {
		t.Fatal(err)
	}
	summary, err := manager.Summary(context.Background(), "dual-write", false)
	if err != nil {
		t.Fatal(err)
	}
	if !summary.Marked || summary.Note != "sqlite note" {
		t.Fatalf("expected sqlite meta after dual-write, got %#v", summary)
	}
	metaBytes, err := os.ReadFile(metaPath)
	if err != nil {
		t.Fatal(err)
	}
	metaText := string(metaBytes)
	if !strings.Contains(metaText, "sqlite note") || !strings.Contains(metaText, `"marked": true`) {
		t.Fatalf("expected meta.json dual-write, got %s", metaText)
	}
}

func TestManagerLoadUsesSQLiteMessageCache(t *testing.T) {
	dir := t.TempDir()
	metaPath := filepath.Join(dir, "meta.json")
	indexPath := filepath.Join(dir, "index.json")
	sqlitePath := filepath.Join(dir, "index-v2.sqlite")
	summary := SessionSummary{
		Key:      "codex:sqlite-cache:/tmp/sqlite-cache.jsonl",
		ID:       "sqlite-cache",
		Source:   SourceCodex,
		FilePath: "/tmp/sqlite-cache.jsonl",
		MTime:    1,
		Size:     10,
	}
	provider := &cacheProvider{
		source:    SourceCodex,
		summaries: []SessionSummary{summary},
		messages:  []Message{{Seq: 1, Role: RoleUser, Text: "fresh"}},
	}
	manager := NewManagerWithOptions(ManagerOptions{
		Providers:  []Provider{provider},
		IndexPath:  indexPath,
		MetaPath:   metaPath,
		SQLitePath: sqlitePath,
	})

	if _, err := manager.Load(context.Background(), "sqlite-cache", LoadOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Load(context.Background(), "sqlite-cache", LoadOptions{}); err != nil {
		t.Fatal(err)
	}
	if provider.loadMessagesHit != 1 {
		t.Fatalf("expected sqlite message cache hit, provider loads=%d", provider.loadMessagesHit)
	}

	provider.summaries[0].Size = 11
	if _, err := manager.Load(context.Background(), "sqlite-cache", LoadOptions{}); err != nil {
		t.Fatal(err)
	}
	if provider.loadMessagesHit != 2 {
		t.Fatalf("expected sqlite cache invalidation after size change, provider loads=%d", provider.loadMessagesHit)
	}
}

func TestSQLiteIndexRenamesCorruptDatabaseAndRestoresMeta(t *testing.T) {
	dir := t.TempDir()
	metaPath := filepath.Join(dir, "meta.json")
	sqlitePath := filepath.Join(dir, "index-v2.sqlite")
	sessionKey := "codex:corrupt:/tmp/corrupt.jsonl"
	if err := os.WriteFile(metaPath, []byte(`{
  "version": 1,
  "sessions": {
    "`+sessionKey+`": {
      "note": "restored note",
      "updatedAt": 1770000000000
    }
  }
}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(sqlitePath, []byte("not sqlite"), 0600); err != nil {
		t.Fatal(err)
	}
	idx, err := OpenSQLiteIndex(sqlitePath, metaPath)
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	summary := SessionSummary{Key: sessionKey}
	if err := idx.ApplyMeta(context.Background(), &summary); err != nil {
		t.Fatal(err)
	}
	if summary.Note != "restored note" {
		t.Fatalf("expected restored note, got %#v", summary)
	}
	matches, err := filepath.Glob(filepath.Join(dir, "index-v2.corrupt-*.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 1 {
		t.Fatalf("expected one renamed corrupt sqlite file, got %#v", matches)
	}
}

func TestSQLiteIndexKeepsExistingMetaWhenMetaJSONCorrupt(t *testing.T) {
	dir := t.TempDir()
	metaPath := filepath.Join(dir, "meta.json")
	sqlitePath := filepath.Join(dir, "index-v2.sqlite")
	sessionKey := "codex:corrupt-meta:/tmp/corrupt-meta.jsonl"
	if err := os.WriteFile(metaPath, []byte(`{
  "version": 1,
  "sessions": {
    "`+sessionKey+`": {
      "note": "sqlite survives",
      "updatedAt": 1770000000000
    }
  }
}`), 0600); err != nil {
		t.Fatal(err)
	}
	idx, err := OpenSQLiteIndex(sqlitePath, metaPath)
	if err != nil {
		t.Fatal(err)
	}
	_ = idx.Close()
	if err := os.WriteFile(metaPath, []byte(`{"version": 1,`), 0600); err != nil {
		t.Fatal(err)
	}
	idx, err = OpenSQLiteIndex(sqlitePath, metaPath)
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	summary := SessionSummary{Key: sessionKey}
	if err := idx.ApplyMeta(context.Background(), &summary); err != nil {
		t.Fatal(err)
	}
	if summary.Note != "sqlite survives" {
		t.Fatalf("expected existing sqlite note to survive corrupt meta json, got %#v", summary)
	}
}

func TestManagerDoesNotOverwriteCorruptMetaJSON(t *testing.T) {
	dir := t.TempDir()
	metaPath := filepath.Join(dir, "meta.json")
	indexPath := filepath.Join(dir, "index.json")
	sqlitePath := filepath.Join(dir, "index-v2.sqlite")
	corruptMeta := []byte(`{"version": 1,`)
	if err := os.WriteFile(metaPath, corruptMeta, 0600); err != nil {
		t.Fatal(err)
	}
	sessionKey := "codex:corrupt-meta-write:/tmp/corrupt-meta-write.jsonl"
	provider := &cacheProvider{
		source: SourceCodex,
		summaries: []SessionSummary{
			{Key: sessionKey, ID: "corrupt-meta-write", Source: SourceCodex, FilePath: "/tmp/corrupt-meta-write.jsonl", MTime: 1, Size: 10},
		},
		messages: []Message{{Seq: 1, Role: RoleUser, Text: "hello"}},
	}
	manager := NewManagerWithOptions(ManagerOptions{
		Providers:  []Provider{provider},
		IndexPath:  indexPath,
		MetaPath:   metaPath,
		SQLitePath: sqlitePath,
	})

	summary, err := manager.Note(context.Background(), "corrupt-meta-write", "sqlite only")
	if err != nil {
		t.Fatal(err)
	}
	if summary.Note != "sqlite only" {
		t.Fatalf("expected note written to sqlite, got %#v", summary)
	}
	after, err := os.ReadFile(metaPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(corruptMeta) {
		t.Fatalf("expected corrupt meta json to be preserved, got %q", string(after))
	}
	summary, err = manager.Summary(context.Background(), "corrupt-meta-write", false)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Note != "sqlite only" {
		t.Fatalf("expected sqlite note after corrupt meta json was preserved, got %#v", summary)
	}
}

func TestSQLiteIndexDoesNotRenameHealthyDatabaseWhenMetaBackupFails(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("chmod write-denial simulation is POSIX-only")
	}
	dir := t.TempDir()
	dbDir := filepath.Join(dir, "db")
	metaDir := filepath.Join(dir, "meta")
	if err := os.MkdirAll(dbDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(metaDir, 0700); err != nil {
		t.Fatal(err)
	}
	sqlitePath := filepath.Join(dbDir, "index-v2.sqlite")
	noMetaPath := filepath.Join(dbDir, "missing-meta.json")
	metaPath := filepath.Join(metaDir, "meta.json")
	sessionKey := "codex:healthy-sqlite:/tmp/healthy-sqlite.jsonl"
	if err := os.WriteFile(metaPath, []byte(`{
  "version": 1,
  "sessions": {
    "`+sessionKey+`": {
      "note": "healthy",
      "updatedAt": 1770000000000
    }
  }
}`), 0600); err != nil {
		t.Fatal(err)
	}
	idx, err := OpenSQLiteIndex(sqlitePath, noMetaPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := idx.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(metaDir, 0500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = os.Chmod(metaDir, 0700)
	})

	idx, err = OpenSQLiteIndex(sqlitePath, metaPath)
	if err != nil {
		t.Fatalf("expected healthy sqlite database to open even when meta backup cannot be written: %v", err)
	}
	defer idx.Close()
	if _, statErr := os.Stat(sqlitePath); statErr != nil {
		t.Fatalf("expected healthy sqlite database to remain in place: %v", statErr)
	}
	matches, globErr := filepath.Glob(filepath.Join(dbDir, "index-v2.corrupt-*.sqlite"))
	if globErr != nil {
		t.Fatal(globErr)
	}
	if len(matches) != 0 {
		t.Fatalf("expected healthy sqlite database not to be renamed, got %#v", matches)
	}
	summary := SessionSummary{Key: sessionKey}
	if err := idx.ApplyMeta(context.Background(), &summary); err != nil {
		t.Fatal(err)
	}
	if summary.Note != "" {
		t.Fatalf("expected meta migration to be skipped when backup fails, got %#v", summary)
	}
}

func TestManagerIndexAndSearchUseSQLiteWithoutJSONIndex(t *testing.T) {
	dir := t.TempDir()
	metaPath := filepath.Join(dir, "meta.json")
	indexPath := filepath.Join(dir, "index.json")
	sqlitePath := filepath.Join(dir, "index-v2.sqlite")
	sessionPath := filepath.Join(dir, "session.jsonl")
	if err := os.WriteFile(sessionPath, []byte(
		`{"timestamp":"2026-03-06T21:50:12Z","type":"session_meta","payload":{"id":"sqlite-search","cwd":"/tmp/project"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:13Z","type":"response_item","payload":{"type":"message","role":"user","content":"Find the sqlite needle"}}`+"\n",
	), 0600); err != nil {
		t.Fatal(err)
	}
	manager := NewManagerWithOptions(ManagerOptions{
		Providers:  []Provider{NewCodexProvider(dir)},
		IndexPath:  indexPath,
		MetaPath:   metaPath,
		SQLitePath: sqlitePath,
	})
	stats, errs := manager.Index(context.Background())
	if len(errs) > 0 {
		t.Fatalf("unexpected index errors: %v", errs)
	}
	if stats.Summaries != 1 || stats.FullTextIndexed != 1 {
		t.Fatalf("unexpected sqlite index stats: %#v", stats)
	}
	if _, err := os.Stat(indexPath); !os.IsNotExist(err) {
		t.Fatalf("expected legacy json index not to be created, stat err=%v", err)
	}
	results, err := manager.Search(context.Background(), SearchOptions{Query: "needle", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0].ID != "sqlite-search" {
		t.Fatalf("unexpected sqlite search results: %#v", results)
	}
}

func TestManagerSearchFallsBackWhenSQLiteHasNoSummaries(t *testing.T) {
	dir := t.TempDir()
	metaPath := filepath.Join(dir, "meta.json")
	indexPath := filepath.Join(dir, "index.json")
	sqlitePath := filepath.Join(dir, "index-v2.sqlite")
	sessionPath := filepath.Join(dir, "session.jsonl")
	if err := os.WriteFile(sessionPath, []byte(
		`{"timestamp":"2026-03-06T21:50:12Z","type":"session_meta","payload":{"id":"fallback-search","cwd":"/tmp/project"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:13Z","type":"response_item","payload":{"type":"message","role":"user","content":"Fallback search title"}}`+"\n",
	), 0600); err != nil {
		t.Fatal(err)
	}
	if idx, err := OpenSQLiteIndex(sqlitePath, metaPath); err != nil {
		t.Fatal(err)
	} else {
		_ = idx.Close()
	}
	manager := NewManagerWithOptions(ManagerOptions{
		Providers:  []Provider{NewCodexProvider(dir)},
		IndexPath:  indexPath,
		MetaPath:   metaPath,
		SQLitePath: sqlitePath,
	})

	results, err := manager.Search(context.Background(), SearchOptions{Query: "fallback", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0].ID != "fallback-search" {
		t.Fatalf("expected scan fallback result, got %#v", results)
	}
}

func TestManagerListDropsGuardianFromLegacySummaryCache(t *testing.T) {
	dir := t.TempDir()
	metaPath := filepath.Join(dir, "meta.json")
	indexPath := filepath.Join(dir, "index.json")
	sqlitePath := filepath.Join(dir, "index-v2.sqlite")
	sessionPath := filepath.Join(dir, "guardian.jsonl")
	if err := os.WriteFile(sessionPath, []byte(
		`{"timestamp":"2026-07-11T01:56:40Z","type":"session_meta","payload":{"id":"guardian-id","cwd":"/tmp/project","source":{"subagent":{"other":"guardian"}},"thread_source":"subagent"}}`+"\n"+
			`{"timestamp":"2026-07-11T01:56:41Z","type":"response_item","payload":{"type":"message","role":"user","content":"The following is the Codex agent history"}}`+"\n",
	), 0600); err != nil {
		t.Fatal(err)
	}
	legacySummary := SessionSummary{
		Key:      StableKey(SourceCodex, "guardian-id", sessionPath),
		ID:       "guardian-id",
		Source:   SourceCodex,
		Title:    "The following is the Codex agent history",
		FilePath: sessionPath,
	}
	idx, err := OpenSQLiteIndex(sqlitePath, metaPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, errs := idx.SaveScannedSummaries(context.Background(), []SessionSummary{legacySummary}, true); len(errs) != 0 {
		t.Fatalf("unexpected legacy scan errors: %v", errs)
	}
	if _, err := idx.db.Exec(`DELETE FROM ai_schema_meta WHERE key = ?`, summaryParserVersionKey); err != nil {
		t.Fatal(err)
	}
	if err := idx.Close(); err != nil {
		t.Fatal(err)
	}

	manager := NewManagerWithOptions(ManagerOptions{
		Providers:  []Provider{NewCodexProvider(dir)},
		IndexPath:  indexPath,
		MetaPath:   metaPath,
		SQLitePath: sqlitePath,
	})
	results, err := manager.List(context.Background(), ListOptions{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 0 {
		t.Fatalf("expected guardian session to be removed, got %#v", results)
	}
	idx, err = OpenSQLiteIndex(sqlitePath, metaPath)
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	hasScan, err := idx.HasSummaryScan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !hasScan {
		t.Fatal("expected refreshed summary cache")
	}
	if _, err := idx.GetSession(context.Background(), "guardian-id"); err == nil {
		t.Fatal("expected cached guardian session to be marked missing")
	}
}

func TestSQLitePartialScanDoesNotSetSummaryParserVersion(t *testing.T) {
	dir := t.TempDir()
	idx, err := OpenSQLiteIndex(filepath.Join(dir, "index-v2.sqlite"), filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	if err := idx.setSchemaMeta(context.Background(), "summaries_scanned_at", "1"); err != nil {
		t.Fatal(err)
	}
	if err := idx.setSchemaMeta(context.Background(), summaryParserVersionKey, "1"); err != nil {
		t.Fatal(err)
	}
	if _, errs := idx.SaveScannedSummaries(context.Background(), []SessionSummary{{Key: "invalid"}}, true); len(errs) == 0 {
		t.Fatal("expected invalid summary error")
	}
	hasScan, err := idx.HasSummaryScan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if hasScan {
		t.Fatal("partial scan must not advance the summary parser version")
	}
	version, ok, err := idx.schemaMeta(context.Background(), summaryParserVersionKey)
	if err != nil {
		t.Fatal(err)
	}
	if !ok || version != "1" {
		t.Fatalf("summary parser version = %q, want legacy version 1", version)
	}
}

func TestSQLiteSummaryRefreshPreservesIndexedMessageCount(t *testing.T) {
	dir := t.TempDir()
	idx, err := OpenSQLiteIndex(filepath.Join(dir, "index-v2.sqlite"), filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	summary := SessionSummary{
		Key:      "codex:count:/tmp/count.jsonl",
		ID:       "count",
		Source:   SourceCodex,
		FilePath: "/tmp/count.jsonl",
		MTime:    1,
		Size:     10,
	}
	if err := idx.SaveMessages(context.Background(), summary, []Message{
		{Seq: 1, Role: RoleUser, Text: "request"},
		{Seq: 2, Role: RoleAssistant, Text: "response"},
	}); err != nil {
		t.Fatal(err)
	}
	if _, errs := idx.SaveScannedSummaries(context.Background(), []SessionSummary{summary}, true); len(errs) != 0 {
		t.Fatalf("unexpected summary refresh errors: %v", errs)
	}
	cached, err := idx.GetSession(context.Background(), summary.ID)
	if err != nil {
		t.Fatal(err)
	}
	if cached.MessageCount != 2 {
		t.Fatalf("message count after unchanged refresh = %d, want 2", cached.MessageCount)
	}

	summary.Size++
	if _, errs := idx.SaveScannedSummaries(context.Background(), []SessionSummary{summary}, true); len(errs) != 0 {
		t.Fatalf("unexpected changed summary refresh errors: %v", errs)
	}
	cached, err = idx.GetSession(context.Background(), summary.ID)
	if err != nil {
		t.Fatal(err)
	}
	if cached.MessageCount != 0 {
		t.Fatalf("message count after changed refresh = %d, want 0", cached.MessageCount)
	}
}

func TestSQLitePartialScanDoesNotMarkExistingSessionsMissing(t *testing.T) {
	dir := t.TempDir()
	sqlitePath := filepath.Join(dir, "index-v2.sqlite")
	idx, err := OpenSQLiteIndex(sqlitePath, filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	oldSummary := SessionSummary{
		Key:      "codex:old:/tmp/old.jsonl",
		ID:       "old",
		Source:   SourceCodex,
		FilePath: "/tmp/old.jsonl",
		MTime:    1,
		Size:     10,
	}
	if _, errs := idx.SaveScannedSummaries(context.Background(), []SessionSummary{oldSummary}, true); len(errs) != 0 {
		t.Fatalf("unexpected initial scan errors: %v", errs)
	}
	if _, errs := idx.SaveScannedSummaries(context.Background(), []SessionSummary{
		{Key: "codex:new:/tmp/new.jsonl", ID: "new", Source: SourceCodex, FilePath: "/tmp/new.jsonl", MTime: 1, Size: 10},
		{Key: "invalid"},
	}, true); len(errs) == 0 {
		t.Fatal("expected invalid summary error")
	}
	oldAfter, err := idx.GetSession(context.Background(), "old")
	if err != nil {
		t.Fatal(err)
	}
	if oldAfter.Missing {
		t.Fatalf("expected old summary to remain visible after partial scan, got %#v", oldAfter)
	}
}

func TestManagerNoteSucceedsWhenMetaJSONDualWriteFailsAfterSQLiteWrite(t *testing.T) {
	dir := t.TempDir()
	metaPath := filepath.Join(dir, "missing-dir", "meta.json")
	indexPath := filepath.Join(dir, "index.json")
	sqlitePath := filepath.Join(dir, "index-v2.sqlite")
	sessionKey := "codex:dual-write-fallback:/tmp/dual-write-fallback.jsonl"
	provider := &cacheProvider{
		source: SourceCodex,
		summaries: []SessionSummary{
			{Key: sessionKey, ID: "dual-write-fallback", Source: SourceCodex, FilePath: "/tmp/dual-write-fallback.jsonl", MTime: 1, Size: 10},
		},
		messages: []Message{{Seq: 1, Role: RoleUser, Text: "hello"}},
	}
	manager := NewManagerWithOptions(ManagerOptions{
		Providers:  []Provider{provider},
		IndexPath:  indexPath,
		MetaPath:   metaPath,
		SQLitePath: sqlitePath,
	})
	if _, err := manager.Summary(context.Background(), "dual-write-fallback", false); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Dir(metaPath)); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Dir(metaPath), []byte("not a dir"), 0600); err != nil {
		t.Fatal(err)
	}

	summary, err := manager.Note(context.Background(), "dual-write-fallback", "kept in sqlite")
	if err != nil {
		t.Fatal(err)
	}
	if summary.Note != "kept in sqlite" {
		t.Fatalf("unexpected note summary: %#v", summary)
	}
	summary, err = manager.Summary(context.Background(), "dual-write-fallback", false)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Note != "kept in sqlite" {
		t.Fatalf("expected sqlite note despite meta json write failure, got %#v", summary)
	}
}

func TestSQLiteIndexMigratesNoteTagsSafely(t *testing.T) {
	dir := t.TempDir()
	sqlitePath := filepath.Join(dir, "index-v2.sqlite")
	sessionKey := "codex:tag-migration:/tmp/tag-migration.jsonl"
	idx, err := OpenSQLiteIndex(sqlitePath, filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := idx.setMeta(context.Background(), sessionKey, sessionMeta{Note: "Follow up #todo #研究", UpdatedAt: 1770000000000}, "test"); err != nil {
		t.Fatal(err)
	}
	if err := idx.setSchemaMeta(context.Background(), "schema_version", "1"); err != nil {
		t.Fatal(err)
	}
	if err := idx.Close(); err != nil {
		t.Fatal(err)
	}

	idx, err = OpenSQLiteIndex(sqlitePath, filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	summary := SessionSummary{Key: sessionKey}
	if err := idx.ApplyMeta(context.Background(), &summary); err != nil {
		t.Fatal(err)
	}
	if summary.Note != "Follow up #todo #研究" {
		t.Fatalf("expected migrated note to keep hash text, got %#v", summary)
	}
	if strings.Join(summary.Tags, ",") != "todo,研究" {
		t.Fatalf("expected migrated tags, got %#v", summary.Tags)
	}
	matches, err := filepath.Glob(filepath.Join(dir, "index-v2.sqlite.backup-before-tags-*"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 1 {
		t.Fatalf("expected sqlite tag migration backup, got %#v", matches)
	}
	if err := idx.Close(); err != nil {
		t.Fatal(err)
	}
	idx, err = OpenSQLiteIndex(sqlitePath, filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	matches, err = filepath.Glob(filepath.Join(dir, "index-v2.sqlite.backup-before-tags-*"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 1 {
		t.Fatalf("expected tag migration to run only once, got backups %#v", matches)
	}
}

func TestManagerNoteExtractsTagsAndListFiltersByTags(t *testing.T) {
	dir := t.TempDir()
	metaPath := filepath.Join(dir, "meta.json")
	indexPath := filepath.Join(dir, "index.json")
	sqlitePath := filepath.Join(dir, "index-v2.sqlite")
	provider := &cacheProvider{
		source: SourceCodex,
		summaries: []SessionSummary{
			{Key: "codex:tag-a:/tmp/tag-a.jsonl", ID: "tag-a", Source: SourceCodex, FilePath: "/tmp/tag-a.jsonl", MTime: 1, Size: 10},
			{Key: "codex:tag-b:/tmp/tag-b.jsonl", ID: "tag-b", Source: SourceCodex, FilePath: "/tmp/tag-b.jsonl", MTime: 1, Size: 10},
		},
		messages: []Message{{Seq: 1, Role: RoleUser, Text: "hello"}},
	}
	manager := NewManagerWithOptions(ManagerOptions{
		Providers:  []Provider{provider},
		IndexPath:  indexPath,
		MetaPath:   metaPath,
		SQLitePath: sqlitePath,
	})
	if _, err := manager.Note(context.Background(), "tag-a", "Needs review #review #urgent"); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.NoteAndTags(context.Background(), "tag-b", "Different", []string{"review"}); err != nil {
		t.Fatal(err)
	}
	tagA, err := manager.Summary(context.Background(), "tag-a", false)
	if err != nil {
		t.Fatal(err)
	}
	if tagA.Note != "Needs review #review #urgent" || strings.Join(tagA.Tags, ",") != "review,urgent" {
		t.Fatalf("unexpected tagged summary: %#v", tagA)
	}
	matches, err := manager.ScanList(context.Background(), ListOptions{TagFilters: []string{"review", "urgent"}}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 1 || matches[0].ID != "tag-a" {
		t.Fatalf("expected AND tag filter to return tag-a, got %#v", matches)
	}
	tags, err := manager.ListTags(context.Background(), ListOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(tags) != 2 || tags[0].Tag != "review" || tags[0].Count != 2 {
		t.Fatalf("unexpected tag summaries: %#v", tags)
	}
	searchMatches, err := manager.Search(context.Background(), SearchOptions{Query: "urgent", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(searchMatches) != 1 || searchMatches[0].ID != "tag-a" {
		t.Fatalf("expected query to search tags, got %#v", searchMatches)
	}
}

func TestExtractSessionTagsFromNoteUsesHashSyntax(t *testing.T) {
	cleanNote, tags := ExtractSessionTagsFromNote("Follow #todo and #研究")
	if cleanNote != "Follow #todo and #研究" {
		t.Fatalf("expected note text preserved, got %q", cleanNote)
	}
	if strings.Join(tags, ",") != "todo,研究" {
		t.Fatalf("expected hash tags, got %#v", tags)
	}

	cleanNote, tags = ExtractSessionTagsFromNote("Keep legacy #+todo text and url https://example.test/a#section")
	if cleanNote != "Keep legacy #+todo text and url https://example.test/a#section" {
		t.Fatalf("expected non-tag text preserved, got %q", cleanNote)
	}
	if len(tags) != 0 {
		t.Fatalf("expected legacy plus syntax and URL fragment not to become tags, got %#v", tags)
	}
}

func TestSQLiteIndexRenameTagUpdatesAllSessions(t *testing.T) {
	dir := t.TempDir()
	sqlitePath := filepath.Join(dir, "index-v2.sqlite")
	idx, err := OpenSQLiteIndex(sqlitePath, filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()

	if err := idx.SetNoteAndTags(context.Background(), "codex:rename-a:/tmp/a.jsonl", "A", []string{"todo", "urgent"}); err != nil {
		t.Fatal(err)
	}
	if err := idx.SetNoteAndTags(context.Background(), "codex:rename-b:/tmp/b.jsonl", "B", []string{"Todo", "done"}); err != nil {
		t.Fatal(err)
	}
	if err := idx.SetNoteAndTags(context.Background(), "codex:rename-c:/tmp/c.jsonl", "C", []string{"done"}); err != nil {
		t.Fatal(err)
	}

	count, err := idx.RenameTag(context.Background(), "#todo", "done")
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("expected 2 renamed sessions, got %d", count)
	}

	aTags, err := idx.tagsForSession(context.Background(), "codex:rename-a:/tmp/a.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(aTags, ",") != "done,urgent" {
		t.Fatalf("expected renamed and preserved tags for a, got %#v", aTags)
	}
	bTags, err := idx.tagsForSession(context.Background(), "codex:rename-b:/tmp/b.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(bTags, ",") != "done" {
		t.Fatalf("expected duplicate target tag to be deduped for b, got %#v", bTags)
	}
}

func TestCleanupBackupsOnlyDeletesOldKnownMigrationBackups(t *testing.T) {
	dir := t.TempDir()
	sqlitePath := filepath.Join(dir, "index-v2.sqlite")
	metaPath := filepath.Join(dir, "meta.json")
	oldTagBackup := filepath.Join(dir, "index-v2.sqlite.backup-before-tags-20260101-000000")
	recentTagBackup := filepath.Join(dir, "index-v2.sqlite.backup-before-tags-20260102-000000")
	oldMetaBackup := filepath.Join(dir, "meta.json.backup-before-sqlite-20260101-000000")
	ignoredBackup := filepath.Join(dir, "index-v2.corrupt-20260101-000000.sqlite")
	for path, text := range map[string]string{
		oldTagBackup:    "old tag",
		recentTagBackup: "recent tag",
		oldMetaBackup:   "old meta",
		ignoredBackup:   "ignored",
	} {
		if err := os.WriteFile(path, []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	oldTime := time.Now().AddDate(0, 0, -20)
	recentTime := time.Now()
	for _, path := range []string{oldTagBackup, oldMetaBackup} {
		if err := os.Chtimes(path, oldTime, oldTime); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chtimes(recentTagBackup, recentTime, recentTime); err != nil {
		t.Fatal(err)
	}

	stats, err := BackupStatsForPaths(context.Background(), sqlitePath, metaPath, BackupRetentionOptions{KeepRecent: 1, MaxAgeDays: 7})
	if err != nil {
		t.Fatal(err)
	}
	if stats.Count != 3 || stats.CleanupCount != 2 {
		t.Fatalf("unexpected backup stats: %#v", stats)
	}

	result, err := CleanupBackupsForPaths(context.Background(), sqlitePath, metaPath, BackupRetentionOptions{KeepRecent: 1, MaxAgeDays: 7})
	if err != nil {
		t.Fatal(err)
	}
	if result.Count != 2 {
		t.Fatalf("expected two deleted backups, got %#v", result)
	}
	for _, path := range []string{oldTagBackup, oldMetaBackup} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("expected old backup deleted path=%q err=%v", path, err)
		}
	}
	for _, path := range []string{recentTagBackup, ignoredBackup} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("expected path preserved %q: %v", path, err)
		}
	}
}
