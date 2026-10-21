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

// Regression: the migrated columns must not be NULL, otherwise the SELECT
// projection (`parent_key`/`kind` scanned into non-nullable strings) fails for
// every pre-v4 row and takes down List/ListWithDistribution/GetSession for the
// whole index. The old DDL added them as plain nullable TEXT.
func TestSQLiteMigratedRowsRemainListable(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "index-v3.sqlite")

	v3, err := sqlx.Open("sqlite3", "file:"+dbPath+"?mode=rwc")
	if err != nil {
		t.Fatal(err)
	}
	// Same shape a v3 binary left behind: no parent_key/kind columns at all.
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
		`CREATE TABLE ai_session_meta (
			session_key TEXT PRIMARY KEY,
			marked INTEGER NOT NULL DEFAULT 0,
			note TEXT NOT NULL DEFAULT '',
			title TEXT NOT NULL DEFAULT '',
			updated_at INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL DEFAULT 0,
			source TEXT NOT NULL DEFAULT 'migration',
			dirty INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE ai_session_tags (session_key TEXT NOT NULL, tag TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(session_key, tag))`,
		`INSERT INTO ai_sessions(key, id, source, title, title_source, project_path, created_at, updated_at,
			message_count, file_path, vendor_id, config_dir, snippet, mtime, size, missing, indexed_at)
		 VALUES('pi:legacy:/tmp/legacy.jsonl', 'legacy', 'pi', 'Legacy row', 'source_title', '/tmp', 100, 100,
			1, '/tmp/legacy.jsonl', '', '', '', 100, 200, 0, 1)`,
	}
	for _, stmt := range stmts {
		if _, err := v3.ExecContext(context.Background(), stmt); err != nil {
			t.Fatalf("seed v3 db: %v", err)
		}
	}
	if err := v3.Close(); err != nil {
		t.Fatal(err)
	}

	idx, err := openSQLiteIndex(dbPath, "")
	if err != nil {
		t.Fatalf("openSQLiteIndex: %v", err)
	}
	defer idx.Close()

	summaries, err := idx.List(context.Background(), ListOptions{})
	if err != nil {
		t.Fatalf("List on a migrated index must not fail: %v", err)
	}
	if len(summaries) != 1 {
		t.Fatalf("expected the legacy row back, got %d rows", len(summaries))
	}
	if summaries[0].ParentKey != "" || summaries[0].Kind != "" {
		t.Fatalf("legacy row = (parentKey %q, kind %q), want both empty", summaries[0].ParentKey, summaries[0].Kind)
	}

	// GetSession goes through the same projection and must survive too.
	if _, err := idx.GetSession(context.Background(), "pi:legacy:/tmp/legacy.jsonl"); err != nil {
		t.Fatalf("GetSession on a migrated index must not fail: %v", err)
	}

	// The stored values must be the empty string, never NULL.
	var nullCount int
	if err := idx.db.GetContext(context.Background(), &nullCount,
		`SELECT count(*) FROM ai_sessions WHERE parent_key IS NULL OR kind IS NULL`); err != nil {
		t.Fatal(err)
	}
	if nullCount != 0 {
		t.Fatalf("migrated rows still hold NULL parent_key/kind: %d", nullCount)
	}
}

// Regression: an index that already went through the nullable build holds NULL
// in both columns. Opening it must repair the values, otherwise the list
// projection fails for those rows forever.
func TestSQLiteNullableParentColumnsAreRepaired(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "index-nullable.sqlite")

	legacy, err := sqlx.Open("sqlite3", "file:"+dbPath+"?mode=rwc")
	if err != nil {
		t.Fatal(err)
	}
	stmts := []string{
		`CREATE TABLE ai_schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
		`INSERT INTO ai_schema_meta(key, value) VALUES('schema_version', '4')`,
		// Columns present but nullable: the state a build with `ADD COLUMN x TEXT` left.
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
			parent_key TEXT,
			kind TEXT,
			indexed_at INTEGER NOT NULL
		)`,
		`CREATE TABLE ai_session_meta (
			session_key TEXT PRIMARY KEY,
			marked INTEGER NOT NULL DEFAULT 0,
			note TEXT NOT NULL DEFAULT '',
			title TEXT NOT NULL DEFAULT '',
			updated_at INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL DEFAULT 0,
			source TEXT NOT NULL DEFAULT 'migration',
			dirty INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE ai_session_tags (session_key TEXT NOT NULL, tag TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(session_key, tag))`,
		`INSERT INTO ai_sessions(key, id, source, title, title_source, project_path, created_at, updated_at,
			message_count, file_path, vendor_id, config_dir, snippet, mtime, size, missing, parent_key, kind, indexed_at)
		 VALUES('pi:null:/tmp/null.jsonl', 'null', 'pi', 'NULL row', 'source_title', '/tmp', 100, 100,
			1, '/tmp/null.jsonl', '', '', '', 100, 200, 0, NULL, NULL, 1)`,
	}
	for _, stmt := range stmts {
		if _, err := legacy.ExecContext(context.Background(), stmt); err != nil {
			t.Fatalf("seed nullable db: %v", err)
		}
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}

	idx, err := openSQLiteIndex(dbPath, "")
	if err != nil {
		t.Fatalf("openSQLiteIndex: %v", err)
	}
	defer idx.Close()

	var nullCount int
	if err := idx.db.GetContext(context.Background(), &nullCount,
		`SELECT count(*) FROM ai_sessions WHERE parent_key IS NULL OR kind IS NULL`); err != nil {
		t.Fatal(err)
	}
	if nullCount != 0 {
		t.Fatalf("NULL parent_key/kind survived the repair: %d rows", nullCount)
	}

	summaries, err := idx.List(context.Background(), ListOptions{})
	if err != nil {
		t.Fatalf("List after repair: %v", err)
	}
	if len(summaries) != 1 || summaries[0].ParentKey != "" || summaries[0].Kind != "" {
		t.Fatalf("repaired row = %#v, want one top-level session", summaries)
	}
}
