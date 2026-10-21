// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/jmoiron/sqlx"
	_ "github.com/mattn/go-sqlite3"
)

// A database written by a pre-v4 binary has ai_sessions WITHOUT parent_key/kind.
// Opening it with this build must add both columns in place (no rebuild, no data
// loss) and existing rows must read back as top-level sessions.
func TestSQLiteSchemaMigrationAddsParentColumns(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "index-v3.sqlite")

	// Build a v3-shaped database by hand: same table minus the two new columns.
	v3, err := sqlx.Open("sqlite3", "file:"+dbPath+"?mode=rwc")
	if err != nil {
		t.Fatal(err)
	}
	stmts := []string{
		`CREATE TABLE ai_schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
		`INSERT INTO ai_schema_meta(key, value) VALUES('schema_version', '3')`,
		`CREATE TABLE ai_sessions (
			key TEXT PRIMARY KEY,
			id TEXT NOT NULL,
			source TEXT NOT NULL,
			title TEXT,
			title_source TEXT,
			project_path TEXT,
			created_at INTEGER,
			updated_at INTEGER,
			message_count INTEGER,
			file_path TEXT NOT NULL,
			vendor_id TEXT,
			config_dir TEXT,
			snippet TEXT,
			mtime INTEGER,
			size INTEGER,
			missing INTEGER NOT NULL DEFAULT 0,
			indexed_at INTEGER NOT NULL
		)`,
		`INSERT INTO ai_sessions(key, id, source, title, file_path, mtime, size, missing, indexed_at)
			VALUES('pi:legacy:/tmp/legacy.jsonl', 'legacy', 'pi', 'Legacy row', '/tmp/legacy.jsonl', 1, 2, 0, 3)`,
	}
	for _, stmt := range stmts {
		if _, err := v3.ExecContext(context.Background(), stmt); err != nil {
			t.Fatalf("seed v3 db: %v", err)
		}
	}
	if err := v3.Close(); err != nil {
		t.Fatal(err)
	}

	// Opening with the current build runs init() → ensureAISessionParentColumns.
	idx, err := openSQLiteIndex(dbPath, "")
	if err != nil {
		t.Fatalf("openSQLiteIndex: %v", err)
	}
	defer idx.Close()

	columns := map[string]bool{}
	var rows []struct {
		Name string `db:"name"`
	}
	if err := idx.db.SelectContext(context.Background(), &rows, `SELECT name FROM pragma_table_info('ai_sessions')`); err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		columns[row.Name] = true
	}
	for _, want := range []string{"parent_key", "kind"} {
		if !columns[want] {
			t.Fatalf("column %q missing after migration; columns=%v", want, columns)
		}
	}

	// The legacy row must still be readable and default to "top-level session".
	var parentKey, kind string
	if err := idx.db.QueryRowxContext(
		context.Background(),
		`SELECT coalesce(parent_key, ''), coalesce(kind, '') FROM ai_sessions WHERE key = ?`,
		"pi:legacy:/tmp/legacy.jsonl",
	).Scan(&parentKey, &kind); err != nil {
		t.Fatalf("read migrated row: %v", err)
	}
	if parentKey != "" || kind != "" {
		t.Fatalf("migrated row = (parentKey %q, kind %q), want both empty", parentKey, kind)
	}

	// And the index must report the new schema version.
	version, ok, err := idx.schemaMeta(context.Background(), "schema_version")
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("schema_version row disappeared")
	}
	if version != sqliteIndexSchemaVersion {
		t.Fatalf("schema_version = %q, want %q", version, sqliteIndexSchemaVersion)
	}
}

// New rows must round-trip parent_key/kind through saveSummaryTx and the row→
// summary projection used by ListWithDistribution/GetSession.
func TestSQLiteSaveSummaryPersistsParentKey(t *testing.T) {
	dir := t.TempDir()
	idx, err := openSQLiteIndex(filepath.Join(dir, "index.sqlite"), "")
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()

	ctx := context.Background()
	child := SessionSummary{
		Key:       "pi:child:/tmp/parent/forks/x.jsonl",
		ID:        "child",
		Source:    SourcePi,
		FilePath:  "/tmp/parent/forks/x.jsonl",
		MTime:     10,
		Size:      20,
		ParentKey: "pi:parent:/tmp/parent.jsonl",
		Kind:      SessionKindFork,
	}
	if err := idx.SaveSummary(ctx, child); err != nil {
		t.Fatalf("SaveSummary: %v", err)
	}

	got, err := idx.GetSession(ctx, child.Key)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if got.ParentKey != child.ParentKey {
		t.Fatalf("ParentKey = %q, want %q", got.ParentKey, child.ParentKey)
	}
	if got.Kind != SessionKindFork {
		t.Fatalf("Kind = %q, want %q", got.Kind, SessionKindFork)
	}

	summaries, err := idx.List(ctx, ListOptions{})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(summaries) != 1 {
		t.Fatalf("expected 1 summary, got %d", len(summaries))
	}
	if summaries[0].ParentKey != child.ParentKey || summaries[0].Kind != SessionKindFork {
		t.Fatalf("List row lost parent fields: %#v", summaries[0])
	}
}