package aisessions

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestManagerDeletePermanentlyRemovesFileAndData(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(dir, "meta.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_SQLITE_INDEX", filepath.Join(dir, "index-v2.sqlite"))
	t.Setenv("WAVETERM_AI_SESSIONS_DELETED_DIR", filepath.Join(t.TempDir(), "deleted"))

	sessionPath := filepath.Join(dir, "session.jsonl")
	if err := os.WriteFile(sessionPath, []byte(
		`{"timestamp":"2026-03-06T21:50:12Z","type":"session_meta","payload":{"id":"perm-id","cwd":"/tmp/project"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:13Z","type":"response_item","payload":{"type":"message","role":"user","content":"hello"}}`+"\n",
	), 0600); err != nil {
		t.Fatal(err)
	}

	manager := NewManager(filepath.Join(dir, "index.json"), []Provider{NewCodexProvider(dir)})
	if _, err := manager.List(context.Background(), ListOptions{Limit: 10}); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Note(context.Background(), "perm-id", "keep? no"); err != nil {
		t.Fatal(err)
	}

	deleted, err := manager.DeletePermanently(context.Background(), "perm-id")
	if err != nil {
		t.Fatal(err)
	}
	if deleted.ID != "perm-id" {
		t.Fatalf("unexpected deleted summary: %#v", deleted)
	}
	if _, err := os.Stat(sessionPath); !os.IsNotExist(err) {
		t.Fatalf("expected source file removed, stat err=%v", err)
	}
	if deleted.FilePath != "" {
		t.Fatalf("expected empty file path for permanent delete, got %q", deleted.FilePath)
	}
	if _, err := manager.Load(context.Background(), "perm-id", LoadOptions{}); err == nil || !strings.Contains(err.Error(), "session not found") {
		t.Fatalf("expected permanently deleted session not to load, got err=%v", err)
	}

	idx, err := manager.openSQLiteIndex()
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	var count int
	if err := idx.db.GetContext(context.Background(), &count, `SELECT COUNT(*) FROM ai_sessions WHERE key = ?`, deleted.Key); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("expected ai_sessions row removed, count=%d", count)
	}
	var fileCount int
	if err := idx.db.GetContext(context.Background(), &fileCount, `SELECT COUNT(*) FROM ai_files WHERE file_path = ?`, sessionPath); err != nil {
		t.Fatal(err)
	}
	if fileCount != 0 {
		t.Fatalf("expected ai_files row removed, count=%d", fileCount)
	}
}
