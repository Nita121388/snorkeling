// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	_ "github.com/mattn/go-sqlite3"
)

const (
	sqliteIndexSchemaVersion = "4"
	summaryParserVersionKey  = "summary_parser_version"
	summaryParserVersion     = "3"
)

type SQLiteIndex struct {
	path     string
	metaPath string
	db       *sqlx.DB
}

func OpenSQLiteIndex(path string, metaPath string) (*SQLiteIndex, error) {
	if path == "" {
		path = DefaultSQLiteIndexPath()
	}
	if metaPath == "" {
		metaPath = DefaultMetaPath()
	}
	idx, err := openSQLiteIndex(path, metaPath)
	if err == nil {
		return idx, nil
	}
	if !sqliteDBExists(path) || !isRecoverableSQLiteCorruption(err) {
		return nil, err
	}
	corruptPath := corruptSQLitePath(path)
	if renameErr := renameSQLiteDatabaseSet(path, corruptPath); renameErr != nil {
		return nil, fmt.Errorf("open sqlite AI session index %q: %w", path, err)
	}
	debugf("SQLiteIndex renamed corrupt database path=%q corruptPath=%q err=%v", path, corruptPath, err)
	return openSQLiteIndex(path, metaPath)
}

func openSQLiteIndex(path string, metaPath string) (*SQLiteIndex, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	db, err := sqlx.Open("sqlite3", fmt.Sprintf("file:%s?mode=rwc&_journal_mode=WAL&_busy_timeout=5000", path))
	if err != nil {
		return nil, err
	}
	db.DB.SetMaxOpenConns(1)
	idx := &SQLiteIndex{path: path, metaPath: metaPath, db: db}
	if err := idx.init(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	return idx, nil
}

func sqliteDBExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func corruptSQLitePath(path string) string {
	ext := filepath.Ext(path)
	stem := strings.TrimSuffix(path, ext)
	return fmt.Sprintf("%s.corrupt-%s%s", stem, time.Now().Format("20060102-150405"), ext)
}

func renameSQLiteDatabaseSet(path string, destPath string) error {
	if err := os.Rename(path, destPath); err != nil {
		return err
	}
	for _, suffix := range []string{"-wal", "-shm"} {
		src := path + suffix
		if _, err := os.Stat(src); err != nil {
			continue
		}
		_ = os.Rename(src, destPath+suffix)
	}
	return nil
}

func (idx *SQLiteIndex) Close() error {
	if idx == nil || idx.db == nil {
		return nil
	}
	return idx.db.Close()
}

func (idx *SQLiteIndex) Path() string {
	if idx == nil {
		return ""
	}
	return idx.path
}

func (idx *SQLiteIndex) init(ctx context.Context) error {
	stmts := []string{
		`PRAGMA journal_mode=WAL`,
		`PRAGMA busy_timeout=5000`,
		`CREATE TABLE IF NOT EXISTS ai_schema_meta (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)`,
	}
	for _, stmt := range stmts {
		if _, err := idx.db.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	existingSchemaVersion, _, err := idx.schemaMeta(ctx, "schema_version")
	if err != nil {
		return err
	}
	// ai_sessions' parent_key/kind must match ensureAISessionParentColumns' DDL
	// exactly: a nullable column would be NULL for rows written before the ALTER
	// ran, and the SELECT projection scans these into non-nullable strings.
	stmts = []string{
		`CREATE TABLE IF NOT EXISTS ai_sessions (
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
			parent_key TEXT NOT NULL DEFAULT '',
			kind TEXT NOT NULL DEFAULT '',
			indexed_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS ai_session_messages (
			session_key TEXT NOT NULL,
			seq INTEGER NOT NULL,
			role TEXT NOT NULL,
			text TEXT NOT NULL,
			timestamp INTEGER,
			tool_name TEXT,
			thinking TEXT NOT NULL DEFAULT '',
			char_count INTEGER,
			PRIMARY KEY(session_key, seq)
		)`,
		`CREATE TABLE IF NOT EXISTS ai_session_meta (
			session_key TEXT PRIMARY KEY,
			marked INTEGER NOT NULL DEFAULT 0,
			note TEXT NOT NULL DEFAULT '',
			title TEXT NOT NULL DEFAULT '',
			updated_at INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL DEFAULT 0,
			source TEXT NOT NULL DEFAULT 'migration',
			dirty INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS ai_session_tags (
			session_key TEXT NOT NULL,
			tag TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY(session_key, tag)
		)`,
		// Custom session properties (Notion-style). One row per property key.
		// Value is JSON so any PropertyValue shape round-trips without schema
		// churn. Built-in properties stay in ai_session_meta and are virtually
		// mapped by the UI, so this table only ever holds the additive layer.
		`CREATE TABLE IF NOT EXISTS ai_session_props (
			session_key TEXT NOT NULL,
			prop_key TEXT NOT NULL,
			value_json TEXT NOT NULL DEFAULT 'null',
			prop_type TEXT NOT NULL DEFAULT '',
			source TEXT NOT NULL DEFAULT 'user',
			updated_at INTEGER NOT NULL DEFAULT 0,
			prop_name TEXT NOT NULL DEFAULT '',
			prop_order INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY(session_key, prop_key)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_session_props_session ON ai_session_props(session_key)`,
		`CREATE TABLE IF NOT EXISTS ai_files (
			file_path TEXT PRIMARY KEY,
			source TEXT NOT NULL,
			mtime INTEGER NOT NULL,
			size INTEGER NOT NULL,
			indexed_at INTEGER NOT NULL,
			message_indexed INTEGER NOT NULL DEFAULT 0
		)`,
		// Node-level annotations (schema v4). Anchors use Message.ItemKey; seq is
		// only a drift fallback, never a key. Provider session files are untouched.
		`CREATE TABLE IF NOT EXISTS ai_session_annotations (
			id             INTEGER PRIMARY KEY AUTOINCREMENT,
			session_key    TEXT    NOT NULL,
			anchor_key     TEXT    NOT NULL,
			seq            INTEGER NOT NULL DEFAULT -1,
			kind           TEXT    NOT NULL DEFAULT 'note',
			title          TEXT    NOT NULL DEFAULT '',
			body           TEXT    NOT NULL DEFAULT '',
			tags_json      TEXT    NOT NULL DEFAULT '[]',
			status         TEXT    NOT NULL DEFAULT 'accepted',
			source         TEXT    NOT NULL DEFAULT 'user',
			user_edited    INTEGER NOT NULL DEFAULT 0,
			ai_model       TEXT    NOT NULL DEFAULT '',
			anchor_hash    TEXT    NOT NULL DEFAULT '',
			anchor_preview TEXT    NOT NULL DEFAULT '',
			node_text      TEXT    NOT NULL DEFAULT '',
			created_at     INTEGER NOT NULL,
			updated_at     INTEGER NOT NULL
		)`,
		// Idempotency bookkeeping for a future automatic annotation pass (M3).
		// M1 only writes it; nothing reads it yet.
		`CREATE TABLE IF NOT EXISTS ai_session_annotation_ai_state (
			session_key        TEXT PRIMARY KEY,
			last_message_count INTEGER NOT NULL DEFAULT 0,
			last_max_seq       INTEGER NOT NULL DEFAULT 0,
			request_hash       TEXT NOT NULL DEFAULT '',
			model              TEXT NOT NULL DEFAULT '',
			status             TEXT NOT NULL DEFAULT '',
			updated_at         INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_sessions_source_id ON ai_sessions(source, id)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_sessions_updated ON ai_sessions(updated_at)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_session_messages_session ON ai_session_messages(session_key, seq)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_session_tags_tag ON ai_session_tags(tag)`,
		// Composite indexes for ListWithDistribution / Search hot paths
		`CREATE INDEX IF NOT EXISTS idx_ai_sessions_list ON ai_sessions(missing, source, updated_at DESC, project_path)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_sessions_search ON ai_sessions(missing, title)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_session_meta_key ON ai_session_meta(session_key, marked, updated_at)`,
		`CREATE INDEX IF NOT EXISTS idx_ann_session ON ai_session_annotations(session_key, seq)`,
		`CREATE INDEX IF NOT EXISTS idx_ann_anchor ON ai_session_annotations(session_key, anchor_key, id)`,
	}
	for _, stmt := range stmts {
		if _, err := idx.db.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	if err := idx.ensureAISessionProvenanceColumns(ctx); err != nil {
		return err
	}
	if err := idx.ensureAISessionParentColumns(ctx); err != nil {
		return err
	}
	if err := idx.ensureMetaTitleColumn(ctx); err != nil {
		return err
	}
	if err := idx.ensureMetaAutoTitleColumns(ctx); err != nil {
		return err
	}
	if err := idx.ensureMessageThinkingColumn(ctx); err != nil {
		return err
	}
	if err := idx.ensureContentHashColumn(ctx); err != nil {
		return err
	}
	if err := idx.ensureAnnotationColumns(ctx); err != nil {
		return err
	}
	if err := idx.ensurePropsColumns(ctx); err != nil {
		return err
	}
	if err := idx.migrateThinkingMessageCache(ctx, existingSchemaVersion); err != nil {
		return err
	}
	if err := idx.MigrateMetaJSON(ctx); err != nil {
		return err
	}
	tagMigrationComplete, err := idx.migrateSessionTags(ctx, existingSchemaVersion)
	if err != nil {
		return err
	}
	if tagMigrationComplete {
		if err := idx.setSchemaMeta(ctx, "schema_version", sqliteIndexSchemaVersion); err != nil {
			return err
		}
	}
	return nil
}

// ensurePropsColumns adds the rename/order columns to ai_session_props for
// databases created before they existed. CREATE TABLE IF NOT EXISTS does not
// alter an existing table, so this runtime ALTER is required.
func (idx *SQLiteIndex) ensurePropsColumns(ctx context.Context) error {
	var columns []struct {
		Name string `db:"name"`
	}
	if err := idx.db.SelectContext(ctx, &columns, `SELECT name FROM pragma_table_info('ai_session_props')`); err != nil {
		return err
	}
	existing := make(map[string]bool, len(columns))
	for _, column := range columns {
		existing[column.Name] = true
	}
	wanted := map[string]string{
		"prop_name":  "TEXT NOT NULL DEFAULT ''",
		"prop_order": "INTEGER NOT NULL DEFAULT 0",
	}
	for name, definition := range wanted {
		if existing[name] {
			continue
		}
		if _, err := idx.db.ExecContext(ctx, fmt.Sprintf("ALTER TABLE ai_session_props ADD COLUMN %s %s", name, definition)); err != nil {
			return err
		}
	}
	return nil
}

func (idx *SQLiteIndex) ensureAISessionProvenanceColumns(ctx context.Context) error {
	_, err := idx.ensureAISessionColumns(ctx, map[string]string{
		"vendor_id":  "TEXT",
		"config_dir": "TEXT",
	})
	return err
}

// ensureAISessionParentColumns (schema v4) adds the parent/child relationship
// columns used to fold pi subagent runs and forks under their parent session.
// Older databases are migrated in place; existing rows read back as "top-level
// session" (empty parent_key/kind), which is the pre-v4 behaviour.
//
// NOT NULL with a default is required, not a style choice: a plain TEXT column is
// NULL for every pre-v4 row, and `SELECT ... parent_key` into sqliteSessionRow's
// `string` field then fails with "converting NULL to string is unsupported",
// which takes down List/ListWithDistribution/GetSession for the whole index. The
// non-NULL default makes NULL literally unrepresentable.
//
// A v3 -> v4 upgrade must also invalidate the summary-scan marker: without it the
// next List only refreshes *changed* files, so parent_key/kind stay empty on every
// untouched row and the tree silently never folds (exactly what happened on a
// 2GB index where nothing had changed). Clearing the marker makes the next List
// run one full pass that fills the columns, and it is a no-op on every later
// open because the columns already exist.
func (idx *SQLiteIndex) ensureAISessionParentColumns(ctx context.Context) error {
	added, err := idx.ensureAISessionColumns(ctx, map[string]string{
		"parent_key": "TEXT NOT NULL DEFAULT ''",
		"kind":       "TEXT NOT NULL DEFAULT ''",
	})
	if err != nil {
		return err
	}
	if added {
		if err := idx.invalidateSummaryScanMarker(ctx); err != nil {
			return err
		}
	}
	return idx.backfillParentColumns(ctx)
}

// invalidateSummaryScanMarker drops the "a complete summary scan has run" markers
// so the next List performs a full pass instead of only refreshing changed files.
func (idx *SQLiteIndex) invalidateSummaryScanMarker(ctx context.Context) error {
	if _, err := idx.db.ExecContext(ctx, `DELETE FROM ai_schema_meta WHERE key IN (?, ?)`, "summaries_scanned_at", summaryParserVersionKey); err != nil {
		return err
	}
	return nil
}

// backfillParentColumns normalises the NULLs an ALTER TABLE cannot avoid.
//
// A column added by ALTER TABLE always gets the default for pre-existing rows, so
// a correctly-added column never holds NULL. This is a second safety net for
// indexes that already went through a build where the columns were added as
// nullable (or were seeded by an external tool): any NULL is rewritten to the
// "top-level session" value. One UPDATE over the table, guarded by an index scan
// so it is skipped entirely on healthy databases.
func (idx *SQLiteIndex) backfillParentColumns(ctx context.Context) error {
	var nulls int
	if err := idx.db.GetContext(ctx, &nulls, `SELECT count(*) FROM ai_sessions WHERE parent_key IS NULL OR kind IS NULL`); err != nil {
		return err
	}
	if nulls == 0 {
		return nil
	}
	_, err := idx.db.ExecContext(ctx, `UPDATE ai_sessions SET parent_key = '' WHERE parent_key IS NULL`)
	if err != nil {
		return err
	}
	_, err = idx.db.ExecContext(ctx, `UPDATE ai_sessions SET kind = '' WHERE kind IS NULL`)
	return err
}

// ensureAISessionColumns adds any missing columns to ai_sessions. CREATE TABLE
// only covers freshly created databases, so every column added after v1 needs an
// explicit ALTER guarded by pragma_table_info. It reports whether any column was
// added, so callers can run one-time follow-up work (e.g. invalidating the
// summary-scan marker after a schema bump).
func (idx *SQLiteIndex) ensureAISessionColumns(ctx context.Context, wanted map[string]string) (bool, error) {
	var columns []struct {
		Name string `db:"name"`
	}
	if err := idx.db.SelectContext(ctx, &columns, `SELECT name FROM pragma_table_info('ai_sessions')`); err != nil {
		return false, err
	}
	existing := make(map[string]bool, len(columns))
	for _, column := range columns {
		existing[column.Name] = true
	}
	added := false
	for name, definition := range wanted {
		if existing[name] {
			continue
		}
		if _, err := idx.db.ExecContext(ctx, fmt.Sprintf("ALTER TABLE ai_sessions ADD COLUMN %s %s", name, definition)); err != nil {
			return added, err
		}
		added = true
	}
	return added, nil
}

func (idx *SQLiteIndex) ensureMetaTitleColumn(ctx context.Context) error {
	var columns []struct {
		Name string `db:"name"`
	}
	if err := idx.db.SelectContext(ctx, &columns, `SELECT name FROM pragma_table_info('ai_session_meta')`); err != nil {
		return err
	}
	for _, column := range columns {
		if column.Name == "title" {
			return nil
		}
	}
	_, err := idx.db.ExecContext(ctx, `ALTER TABLE ai_session_meta ADD COLUMN title TEXT NOT NULL DEFAULT ''`)
	return err
}

// ensureMetaAutoTitleColumns adds the AI auto-title bookkeeping columns to
// ai_session_meta for databases created before they existed:
//
//   - title_source             'user' (hand-written / user-applied) vs 'ai'
//   - ai_title_attempted_at    >0 once a background generation was attempted
//   - ai_title_attempt_message_count  messageCount at that attempt
func (idx *SQLiteIndex) ensureMetaAutoTitleColumns(ctx context.Context) error {
	var columns []struct {
		Name string `db:"name"`
	}
	if err := idx.db.SelectContext(ctx, &columns, `SELECT name FROM pragma_table_info('ai_session_meta')`); err != nil {
		return err
	}
	existing := make(map[string]bool, len(columns))
	for _, column := range columns {
		existing[column.Name] = true
	}
	wanted := []struct{ name, definition string }{
		{"title_source", "TEXT NOT NULL DEFAULT 'user'"},
		{"ai_title_attempted_at", "INTEGER NOT NULL DEFAULT 0"},
		{"ai_title_attempt_message_count", "INTEGER NOT NULL DEFAULT 0"},
	}
	for _, column := range wanted {
		if existing[column.name] {
			continue
		}
		if _, err := idx.db.ExecContext(ctx, fmt.Sprintf("ALTER TABLE ai_session_meta ADD COLUMN %s %s", column.name, column.definition)); err != nil {
			return err
		}
	}
	return nil
}

// ensureMessageThinkingColumn adds the thinking column to ai_session_messages
// for databases created before schema v3 (CREATE TABLE only covers fresh DBs).
func (idx *SQLiteIndex) ensureMessageThinkingColumn(ctx context.Context) error {
	var columns []struct {
		Name string `db:"name"`
	}
	if err := idx.db.SelectContext(ctx, &columns, `SELECT name FROM pragma_table_info('ai_session_messages')`); err != nil {
		return err
	}
	for _, column := range columns {
		if column.Name == "thinking" {
			return nil
		}
	}
	_, err := idx.db.ExecContext(ctx, `ALTER TABLE ai_session_messages ADD COLUMN thinking TEXT NOT NULL DEFAULT ''`)
	return err
}

// ensureContentHashColumn adds content_hash to ai_files for incremental scan optimization.
// Columns added by older binaries are not repairable if mtime+size matches but content changed,
// so the first scan after migration will re-hash all files.
func (idx *SQLiteIndex) ensureContentHashColumn(ctx context.Context) error {
	var columns []struct {
		Name string `db:"name"`
	}
	if err := idx.db.SelectContext(ctx, &columns, `SELECT name FROM pragma_table_info('ai_files')`); err != nil {
		return err
	}
	for _, column := range columns {
		if column.Name == "content_hash" {
			return nil
		}
	}
	_, err := idx.db.ExecContext(ctx, `ALTER TABLE ai_files ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''`)
	return err
}

// migrateThinkingMessageCache (schema v3): the pi parser started emitting
// Message.Thinking; rows cached by older binaries are beyond repair because
// cache freshness only checks file mtime+size, so drop them once and let the
// next access re-parse from the session file.
func (idx *SQLiteIndex) migrateThinkingMessageCache(ctx context.Context, existingSchemaVersion string) error {
	version, err := strconv.Atoi(strings.TrimSpace(existingSchemaVersion))
	if err != nil {
		version = 0
	}
	if version >= 3 {
		return nil
	}
	if _, err := idx.db.ExecContext(ctx, `DELETE FROM ai_session_messages`); err != nil {
		return err
	}
	_, err = idx.db.ExecContext(ctx, `UPDATE ai_files SET message_indexed = 0`)
	return err
}

func (idx *SQLiteIndex) migrateSessionTags(ctx context.Context, existingSchemaVersion string) (bool, error) {
	version, err := strconv.Atoi(strings.TrimSpace(existingSchemaVersion))
	if err != nil {
		version = 0
	}
	if version >= 2 {
		return true, nil
	}
	rows := []struct {
		Key       string `db:"session_key"`
		Note      string `db:"note"`
		UpdatedAt int64  `db:"updated_at"`
	}{}
	if err := idx.db.SelectContext(ctx, &rows, `SELECT session_key, note, updated_at FROM ai_session_meta WHERE instr(note, '#') > 0`); err != nil {
		return false, err
	}
	type tagMigrationRow struct {
		key       string
		tags      []string
		updatedAt int64
	}
	var migrations []tagMigrationRow
	for _, row := range rows {
		_, tags := ExtractSessionTagsFromNote(row.Note)
		if len(tags) == 0 {
			continue
		}
		migrations = append(migrations, tagMigrationRow{key: row.Key, tags: tags, updatedAt: row.UpdatedAt})
	}
	if len(migrations) > 0 {
		if err := idx.backupSQLiteBeforeTagMigration(); err != nil {
			debugf("SQLiteIndex skipping session tag migration because sqlite backup failed path=%q err=%v", idx.path, err)
			return false, nil
		}
	}
	tx, err := idx.db.BeginTxx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() {
		_ = tx.Rollback()
	}()
	now := time.Now().UnixMilli()
	for _, migration := range migrations {
		if ctx.Err() != nil {
			return false, ctx.Err()
		}
		updatedAt := migration.updatedAt
		if updatedAt == 0 {
			updatedAt = now
		}
		if _, err := tx.ExecContext(ctx, `UPDATE ai_session_meta SET updated_at = ?, source = ?, dirty = 1 WHERE session_key = ?`,
			updatedAt, "tag-migration", migration.key); err != nil {
			return false, err
		}
		for _, tag := range migration.tags {
			if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO ai_session_tags(session_key, tag, created_at) VALUES(?, ?, ?)`,
				migration.key, tag, now); err != nil {
				return false, err
			}
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO ai_schema_meta(key, value) VALUES(?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, "session_tags_migrated_at", fmt.Sprintf("%d", now)); err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO ai_schema_meta(key, value) VALUES(?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, "session_tags_migrated_count", fmt.Sprintf("%d", len(migrations))); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

func (idx *SQLiteIndex) backupSQLiteBeforeTagMigration() error {
	if idx.path == "" {
		return nil
	}
	if _, err := os.Stat(idx.path); err != nil {
		return err
	}
	backupPath := uniqueDeletedPath(filepath.Join(filepath.Dir(idx.path), fmt.Sprintf("%s.backup-before-tags-%s", filepath.Base(idx.path), time.Now().Format("20060102-150405"))))
	if _, err := idx.db.Exec(`VACUUM INTO ?`, backupPath); err != nil {
		return err
	}
	return nil
}

func (idx *SQLiteIndex) schemaMeta(ctx context.Context, key string) (string, bool, error) {
	var value string
	err := idx.db.GetContext(ctx, &value, `SELECT value FROM ai_schema_meta WHERE key = ?`, key)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return value, true, nil
}

func (idx *SQLiteIndex) setSchemaMeta(ctx context.Context, key string, value string) error {
	_, err := idx.db.ExecContext(ctx, `INSERT INTO ai_schema_meta(key, value) VALUES(?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

func (idx *SQLiteIndex) MigrateMetaJSON(ctx context.Context) error {
	if strings.TrimSpace(idx.metaPath) == "" {
		return nil
	}
	data, err := os.ReadFile(idx.metaPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		count, countErr := idx.CountMeta(ctx)
		if countErr == nil && count > 0 {
			debugf("SQLiteIndex skipping unreadable meta json migration path=%q existingMetaRows=%d err=%v", idx.metaPath, count, err)
			return nil
		}
		debugf("SQLiteIndex skipping unreadable meta json migration path=%q err=%v", idx.metaPath, err)
		return nil
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return nil
	}
	hash := sha256.Sum256(data)
	hashStr := hex.EncodeToString(hash[:])
	if migrated, ok, err := idx.schemaMeta(ctx, "meta_json_migrated_sha256"); err != nil {
		return err
	} else if ok && migrated == hashStr {
		return backupMetaJSON(idx.metaPath, data)
	}
	var meta metaData
	if err := json.Unmarshal(data, &meta); err != nil {
		count, countErr := idx.CountMeta(ctx)
		if countErr == nil && count > 0 {
			debugf("SQLiteIndex skipping corrupt meta json migration path=%q existingMetaRows=%d err=%v", idx.metaPath, count, err)
			return nil
		}
		debugf("SQLiteIndex skipping corrupt meta json migration path=%q err=%v", idx.metaPath, err)
		return nil
	}
	if meta.Sessions == nil {
		return nil
	}
	if err := backupMetaJSON(idx.metaPath, data); err != nil {
		debugf("SQLiteIndex skipping meta json migration because backup failed path=%q err=%v", idx.metaPath, err)
		return nil
	}
	tx, err := idx.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()
	now := time.Now().UnixMilli()
	for key, item := range meta.Sessions {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if err := idx.upsertMetaTx(ctx, tx, key, item, now, "meta-json"); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO ai_schema_meta(key, value) VALUES(?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, "meta_json_migrated_sha256", hashStr); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO ai_schema_meta(key, value) VALUES(?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, "meta_json_migrated_at", fmt.Sprintf("%d", now)); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO ai_schema_meta(key, value) VALUES(?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, "meta_json_session_count", fmt.Sprintf("%d", len(meta.Sessions))); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return nil
}

func backupMetaJSON(path string, data []byte) error {
	backupMarker := filepath.Join(filepath.Dir(path), "."+filepath.Base(path)+".sqlite-backup-created")
	if _, err := os.Stat(backupMarker); err == nil {
		return nil
	}
	if _, err := os.Stat(path); err != nil {
		return err
	}
	backupPath := filepath.Join(filepath.Dir(path), fmt.Sprintf("%s.backup-before-sqlite-%s", filepath.Base(path), time.Now().Format("20060102-150405")))
	if err := os.WriteFile(backupPath, data, 0600); err != nil {
		return err
	}
	return os.WriteFile(backupMarker, []byte(filepath.Base(backupPath)+"\n"), 0600)
}

func fileSHA256(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:]), nil
}

func (idx *SQLiteIndex) upsertMetaTx(ctx context.Context, tx *sqlx.Tx, key string, item sessionMeta, now int64, source string) error {
	incomingUpdatedAt := item.UpdatedAt
	if incomingUpdatedAt == 0 {
		incomingUpdatedAt = now
	}
	var existing sessionMeta
	var existingCreatedAt int64
	err := tx.QueryRowxContext(ctx, `SELECT marked, note, title, updated_at, created_at FROM ai_session_meta WHERE session_key = ?`, key).
		Scan(&existing.Marked, &existing.Note, &existing.Title, &existing.UpdatedAt, &existingCreatedAt)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err == nil && existing.UpdatedAt > incomingUpdatedAt {
		return nil
	}
	// Never blank a non-empty sqlite note/title from a JSON entry that simply
	// does not carry it (e.g. a legacy JSON entry written by a path that did not
	// include the note). This guards against data loss regardless of timestamps.
	if err == nil {
		if item.Note == "" && existing.Note != "" {
			item.Note = existing.Note
		}
		if item.Title == "" && existing.Title != "" {
			item.Title = existing.Title
		}
		if existing.UpdatedAt == incomingUpdatedAt {
			item.Marked = item.Marked || existing.Marked
		}
	}
	createdAt := existingCreatedAt
	if createdAt == 0 {
		createdAt = now
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO ai_session_meta(session_key, marked, note, title, updated_at, created_at, source, dirty)
		VALUES(?, ?, ?, ?, ?, ?, ?, 0)
		ON CONFLICT(session_key) DO UPDATE SET
			marked = excluded.marked,
			note = excluded.note,
			title = excluded.title,
			updated_at = excluded.updated_at,
			source = excluded.source,
			dirty = excluded.dirty`,
		key, boolToInt(item.Marked), item.Note, item.Title, incomingUpdatedAt, createdAt, source)
	return err
}

func (idx *SQLiteIndex) ApplyMeta(ctx context.Context, summary *SessionSummary) error {
	if summary == nil || strings.TrimSpace(summary.Key) == "" {
		return nil
	}
	var marked bool
	var note string
	var title string
	var titleSource string
	var aiAttemptedAt int64
	var aiAttemptCount int
	err := idx.db.QueryRowxContext(ctx, `SELECT marked, note, title, title_source, ai_title_attempted_at, ai_title_attempt_message_count FROM ai_session_meta WHERE session_key = ?`, summary.Key).
		Scan(&marked, &note, &title, &titleSource, &aiAttemptedAt, &aiAttemptCount)
	// No meta row: the session never had note/title/tags written through this
	// index (e.g. a freshly scanned provider summary that carries its own
	// Tags). Keep the original contract of not touching those fields, but still
	// load the additive custom-property layer when it exists.
	if errors.Is(err, sql.ErrNoRows) {
		props, perr := idx.PropsForSession(ctx, summary.Key)
		if perr != nil {
			return perr
		}
		if len(props) > 0 {
			summary.Props = props
		}
		return nil
	}
	if err != nil {
		return err
	}
	summary.Marked = marked
	summary.Note = note
	if title != "" {
		summary.Title = title
		summary.TitleSource = normalizeTitleSource(titleSource)
	}
	summary.AITitleAttemptedAt = aiAttemptedAt
	summary.AITitleAttemptMessageCount = aiAttemptCount
	tags, err := idx.tagsForSession(ctx, summary.Key)
	if err != nil {
		return err
	}
	summary.Tags = tags
	props, err := idx.PropsForSession(ctx, summary.Key)
	if err != nil {
		return err
	}
	if len(props) > 0 {
		summary.Props = props
	}
	return nil
}

// batchMetaMaps holds preloaded per-session metadata for a list of keys.
// loaded=true means the meta row existed (otherwise the fields are zero values).
type batchMetaMaps struct {
	loaded             map[string]bool
	marked             map[string]bool
	note               map[string]string
	title              map[string]string
	titleSource        map[string]string
	aiTitleAttemptedAt map[string]int64
	tags               map[string][]string
}

// batchMetaForKeys loads metadata for many session keys with 2 queries instead of
// 2-per-key (N+1). Returns empty (non-nil) maps; callers use applyBatchMeta.
func (idx *SQLiteIndex) batchMetaForKeys(ctx context.Context, keys []string) (batchMetaMaps, error) {
	result := batchMetaMaps{
		loaded:             make(map[string]bool, len(keys)),
		marked:             make(map[string]bool, len(keys)),
		note:               make(map[string]string, len(keys)),
		title:              make(map[string]string, len(keys)),
		titleSource:        make(map[string]string, len(keys)),
		aiTitleAttemptedAt: make(map[string]int64, len(keys)),
		tags:               make(map[string][]string, len(keys)),
	}
	if len(keys) == 0 {
		return result, nil
	}
	metaRows := []struct {
		Key                string `db:"session_key"`
		Marked             bool   `db:"marked"`
		Note               string `db:"note"`
		Title              string `db:"title"`
		TitleSource        string `db:"title_source"`
		AITitleAttemptedAt int64  `db:"ai_title_attempted_at"`
	}{}
	query, args, err := sqlx.In(`SELECT session_key, marked, note, title, title_source, ai_title_attempted_at FROM ai_session_meta WHERE session_key IN (?)`, keys)
	if err != nil {
		return result, err
	}
	query = idx.db.Rebind(query)
	if err := idx.db.SelectContext(ctx, &metaRows, query, args...); err != nil {
		return result, err
	}
	for _, row := range metaRows {
		result.loaded[row.Key] = true
		result.marked[row.Key] = row.Marked
		result.note[row.Key] = row.Note
		result.title[row.Key] = row.Title
		result.titleSource[row.Key] = row.TitleSource
		result.aiTitleAttemptedAt[row.Key] = row.AITitleAttemptedAt
	}
	tagRows := []struct {
		Key string `db:"session_key"`
		Tag string `db:"tag"`
	}{}
	query, args, err = sqlx.In(`SELECT session_key, tag FROM ai_session_tags WHERE session_key IN (?) ORDER BY session_key, tag`, keys)
	if err != nil {
		return result, err
	}
	query = idx.db.Rebind(query)
	if err := idx.db.SelectContext(ctx, &tagRows, query, args...); err != nil {
		return result, err
	}
	for _, row := range tagRows {
		result.tags[row.Key] = append(result.tags[row.Key], row.Tag)
	}
	return result, nil
}

// applyBatchMeta applies preloaded metadata to a summary, mirroring ApplyMeta semantics
// (title only set when non-empty; TitleSource promoted to user-edit).
func (idx *SQLiteIndex) applyBatchMeta(summary *SessionSummary, meta batchMetaMaps) {
	if summary == nil || strings.TrimSpace(summary.Key) == "" {
		return
	}
	if !meta.loaded[summary.Key] {
		// No meta row: clear defaults (mirrors ApplyMeta with ErrNoRows).
		summary.Marked = false
		summary.Note = ""
		summary.Tags = nil
		return
	}
	summary.Marked = meta.marked[summary.Key]
	summary.Note = meta.note[summary.Key]
	if title := meta.title[summary.Key]; title != "" {
		summary.Title = title
		summary.TitleSource = normalizeTitleSource(meta.titleSource[summary.Key])
	}
	summary.AITitleAttemptedAt = meta.aiTitleAttemptedAt[summary.Key]
	summary.Tags = meta.tags[summary.Key]
}

func (idx *SQLiteIndex) SetTitle(ctx context.Context, key string, title string) error {
	return idx.setMeta(ctx, key, sessionMeta{Title: strings.TrimSpace(title), TitleSource: "user", UpdatedAt: time.Now().UnixMilli()}, "sqlite-title")
}

// SetAutoTitle persists an AI-generated title with the "ai" source so it ranks
// below any user title but above the provider-derived fallbacks.
func (idx *SQLiteIndex) SetAutoTitle(ctx context.Context, key string, title string) error {
	return idx.setMeta(ctx, key, sessionMeta{Title: strings.TrimSpace(title), TitleSource: "ai", UpdatedAt: time.Now().UnixMilli()}, "sqlite-ai-title")
}

// MarkAITitleAttempt records that a background generation was attempted. It
// deliberately touches no other column: writing it must not disturb note, tags,
// or a title the user may have set in the meantime.
func (idx *SQLiteIndex) MarkAITitleAttempt(ctx context.Context, key string, messageCount int) error {
	return idx.setMeta(ctx, key, sessionMeta{
		AITitleAttemptedAt:         time.Now().UnixMilli(),
		AITitleAttemptMessageCount: messageCount,
	}, "sqlite-ai-title-attempt")
}

func (idx *SQLiteIndex) SetMarked(ctx context.Context, key string, marked bool) error {
	return idx.setMeta(ctx, key, sessionMeta{Marked: marked, UpdatedAt: time.Now().UnixMilli()}, "sqlite-mark")
}

func (idx *SQLiteIndex) SetNote(ctx context.Context, key string, note string) error {
	cleanNote, extractedTags := ExtractSessionTagsFromNote(note)
	if len(extractedTags) == 0 && cleanNote == strings.TrimSpace(note) {
		return idx.setMeta(ctx, key, sessionMeta{Note: cleanNote, UpdatedAt: time.Now().UnixMilli()}, "sqlite-note")
	}
	existingTags, err := idx.tagsForSession(ctx, key)
	if err != nil {
		return err
	}
	return idx.SetNoteAndTags(ctx, key, cleanNote, MergeSessionTags(existingTags, extractedTags))
}

func (idx *SQLiteIndex) SetNoteAndTags(ctx context.Context, key string, note string, tags []string) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return fmt.Errorf("session key is required")
	}
	cleanNote, extractedTags := ExtractSessionTagsFromNote(note)
	tags = MergeSessionTags(tags, extractedTags)
	tx, err := idx.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()
	if err := idx.setMetaTx(ctx, tx, key, sessionMeta{Note: cleanNote, UpdatedAt: time.Now().UnixMilli()}, "sqlite-note-tags"); err != nil {
		return err
	}
	if err := idx.replaceTagsTx(ctx, tx, key, tags); err != nil {
		return err
	}
	return tx.Commit()
}

// PropsForSession returns the custom property cells stored for a session.
// Missing / empty is not an error: the caller just sees no custom layer.
func (idx *SQLiteIndex) PropsForSession(ctx context.Context, key string) (map[string]PropertyCell, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return nil, nil
	}
	rows, err := idx.db.QueryxContext(ctx, `SELECT prop_key, value_json, prop_type, source, updated_at, prop_name, prop_order FROM ai_session_props WHERE session_key = ?`, key)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	props := make(map[string]PropertyCell)
	for rows.Next() {
		var propKey, valueJSON, propType, source, propName string
		var updatedAt int64
		var propOrder int
		if err := rows.Scan(&propKey, &valueJSON, &propType, &source, &updatedAt, &propName, &propOrder); err != nil {
			return nil, err
		}
		cell := PropertyCell{Type: propType, Source: source, UpdatedAt: updatedAt, Name: propName, Order: propOrder}
		if valueJSON != "" && valueJSON != "null" {
			var value any
			if err := json.Unmarshal([]byte(valueJSON), &value); err != nil {
				return nil, fmt.Errorf("decode prop %q: %w", propKey, err)
			}
			cell.Value = value
		}
		props[propKey] = cell
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(props) == 0 {
		return nil, nil
	}
	return props, nil
}

// SetProps upserts the given property cells (merge semantics: keys not present
// in the map are left untouched). A nil value deletes the property.
func (idx *SQLiteIndex) SetProps(ctx context.Context, key string, props map[string]PropertyCell) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return fmt.Errorf("session key is required")
	}
	if len(props) == 0 {
		return nil
	}
	tx, err := idx.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()
	now := time.Now().UnixMilli()
	for propKey, cell := range props {
		propKey = strings.TrimSpace(propKey)
		if propKey == "" {
			continue
		}
		if cell.Value == nil {
			if _, err := tx.ExecContext(ctx, `DELETE FROM ai_session_props WHERE session_key = ? AND prop_key = ?`, key, propKey); err != nil {
				return err
			}
			continue
		}
		valueJSON, err := json.Marshal(cell.Value)
		if err != nil {
			return fmt.Errorf("encode prop %q: %w", propKey, err)
		}
		updatedAt := cell.UpdatedAt
		if updatedAt == 0 {
			updatedAt = now
		}
		source := cell.Source
		if source == "" {
			source = PropertySourceUser
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO ai_session_props(session_key, prop_key, value_json, prop_type, source, updated_at, prop_name, prop_order)
			VALUES(?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(session_key, prop_key) DO UPDATE SET
				value_json = excluded.value_json,
				prop_type = excluded.prop_type,
				source = excluded.source,
				updated_at = excluded.updated_at,
				prop_name = excluded.prop_name,
				prop_order = excluded.prop_order`,
			key, propKey, string(valueJSON), cell.Type, source, updatedAt, cell.Name, cell.Order); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE ai_session_meta SET updated_at = ? WHERE session_key = ?`, now, key); err != nil {
		return err
	}
	return tx.Commit()
}

func (idx *SQLiteIndex) RenameTag(ctx context.Context, from string, to string) (int, error) {
	fromTags := NormalizeSessionTags([]string{from})
	toTags := NormalizeSessionTags([]string{to})
	if len(fromTags) == 0 {
		return 0, fmt.Errorf("source tag is required")
	}
	if len(toTags) == 0 {
		return 0, fmt.Errorf("target tag is required")
	}
	fromTag := fromTags[0]
	toTag := toTags[0]
	if fromTag == toTag {
		return 0, nil
	}
	tx, err := idx.db.BeginTxx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() {
		_ = tx.Rollback()
	}()
	var sessionKeys []string
	if err := tx.SelectContext(ctx, &sessionKeys, `SELECT session_key FROM ai_session_tags WHERE tag = ? ORDER BY session_key`, fromTag); err != nil {
		return 0, err
	}
	now := time.Now().UnixMilli()
	for _, key := range sessionKeys {
		if ctx.Err() != nil {
			return 0, ctx.Err()
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM ai_session_tags WHERE session_key = ? AND tag = ?`, key, fromTag); err != nil {
			return 0, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO ai_session_tags(session_key, tag, created_at) VALUES(?, ?, ?)`, key, toTag, now); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return len(sessionKeys), nil
}

func (idx *SQLiteIndex) DeleteMeta(ctx context.Context, key string) error {
	tx, err := idx.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()
	if _, err := tx.ExecContext(ctx, `DELETE FROM ai_session_tags WHERE session_key = ?`, key); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM ai_session_meta WHERE session_key = ?`, key); err != nil {
		return err
	}
	return tx.Commit()
}

func (idx *SQLiteIndex) tagsForSession(ctx context.Context, key string) ([]string, error) {
	var tags []string
	err := idx.db.SelectContext(ctx, &tags, `SELECT tag FROM ai_session_tags WHERE session_key = ? ORDER BY tag`, key)
	return tags, err
}

func (idx *SQLiteIndex) tagsForSessionTx(ctx context.Context, tx *sqlx.Tx, key string) ([]string, error) {
	var tags []string
	err := tx.SelectContext(ctx, &tags, `SELECT tag FROM ai_session_tags WHERE session_key = ? ORDER BY tag`, key)
	return tags, err
}

func (idx *SQLiteIndex) MarkSessionMissing(ctx context.Context, key string) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return fmt.Errorf("session key is required")
	}
	_, err := idx.db.ExecContext(ctx, `UPDATE ai_sessions SET missing = 1, indexed_at = ? WHERE key = ?`, time.Now().UnixMilli(), key)
	return err
}

func (idx *SQLiteIndex) setMeta(ctx context.Context, key string, incoming sessionMeta, source string) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return fmt.Errorf("session key is required")
	}
	tx, err := idx.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()
	if err := idx.setMetaTx(ctx, tx, key, incoming, source); err != nil {
		return err
	}
	return tx.Commit()
}

func (idx *SQLiteIndex) setMetaTx(ctx context.Context, tx *sqlx.Tx, key string, incoming sessionMeta, source string) error {
	now := time.Now().UnixMilli()
	var existing sessionMeta
	var existingCreatedAt int64
	err := tx.QueryRowxContext(ctx, `SELECT marked, note, title, title_source, ai_title_attempted_at, ai_title_attempt_message_count, updated_at, created_at FROM ai_session_meta WHERE session_key = ?`, key).
		Scan(&existing.Marked, &existing.Note, &existing.Title, &existing.TitleSource, &existing.AITitleAttemptedAt, &existing.AITitleAttemptMessageCount, &existing.UpdatedAt, &existingCreatedAt)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	// Merge onto the existing row and only overwrite the fields this source owns.
	// This is the single place that guarantees writing a note/tag/mark never
	// clears an unrelated title (or vice versa), and it keeps the three AI-title
	// bookkeeping columns from being wiped by any legacy write path.
	merged := existing
	switch source {
	case "sqlite-mark":
		merged.Marked = incoming.Marked
	case "sqlite-note", "sqlite-note-tags":
		merged.Note = incoming.Note
	case "sqlite-title":
		merged.Title = incoming.Title
		merged.TitleSource = "user"
	case "sqlite-ai-title":
		merged.Title = incoming.Title
		merged.TitleSource = "ai"
	case "sqlite-ai-title-attempt":
		merged.AITitleAttemptedAt = incoming.AITitleAttemptedAt
		merged.AITitleAttemptMessageCount = incoming.AITitleAttemptMessageCount
	default:
		merged = incoming
	}
	if incoming.UpdatedAt != 0 {
		merged.UpdatedAt = incoming.UpdatedAt
	}
	if merged.UpdatedAt == 0 {
		merged.UpdatedAt = now
	}
	if merged.TitleSource == "" {
		merged.TitleSource = "user"
	}
	createdAt := existingCreatedAt
	if createdAt == 0 {
		createdAt = now
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO ai_session_meta(session_key, marked, note, title, title_source, ai_title_attempted_at, ai_title_attempt_message_count, updated_at, created_at, source, dirty)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
		ON CONFLICT(session_key) DO UPDATE SET
			marked = excluded.marked,
			note = excluded.note,
			title = excluded.title,
			title_source = excluded.title_source,
			ai_title_attempted_at = excluded.ai_title_attempted_at,
			ai_title_attempt_message_count = excluded.ai_title_attempt_message_count,
			updated_at = excluded.updated_at,
			source = excluded.source,
			dirty = excluded.dirty`,
		key, boolToInt(merged.Marked), merged.Note, merged.Title, merged.TitleSource, merged.AITitleAttemptedAt, merged.AITitleAttemptMessageCount, merged.UpdatedAt, createdAt, source)
	return err
}

func (idx *SQLiteIndex) replaceTagsTx(ctx context.Context, tx *sqlx.Tx, key string, tags []string) error {
	tags = NormalizeSessionTags(tags)
	if _, err := tx.ExecContext(ctx, `DELETE FROM ai_session_tags WHERE session_key = ?`, key); err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	for _, tag := range tags {
		if _, err := tx.ExecContext(ctx, `INSERT INTO ai_session_tags(session_key, tag, created_at) VALUES(?, ?, ?)`, key, tag, now); err != nil {
			return err
		}
	}
	return nil
}

func (idx *SQLiteIndex) GetMessages(ctx context.Context, summary SessionSummary) ([]Message, bool, error) {
	if ctx.Err() != nil {
		return nil, false, ctx.Err()
	}
	var fileRecord struct {
		MTime          int64 `db:"mtime"`
		Size           int64 `db:"size"`
		MessageIndexed int   `db:"message_indexed"`
	}
	err := idx.db.GetContext(ctx, &fileRecord, `SELECT mtime, size, message_indexed FROM ai_files WHERE file_path = ?`, summary.FilePath)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	if fileRecord.MessageIndexed == 0 || fileRecord.MTime != summary.MTime || fileRecord.Size != summary.Size {
		return nil, false, nil
	}
	var rows []struct {
		Seq       int    `db:"seq"`
		Role      string `db:"role"`
		Text      string `db:"text"`
		Timestamp int64  `db:"timestamp"`
		ToolName  string `db:"tool_name"`
		Thinking  string `db:"thinking"`
		CharCount int    `db:"char_count"`
	}
	err = idx.db.SelectContext(ctx, &rows, `SELECT seq, role, text, timestamp, tool_name, thinking, char_count
		FROM ai_session_messages WHERE session_key = ? ORDER BY seq`, summary.Key)
	if err != nil {
		return nil, false, err
	}
	if len(rows) == 0 {
		return nil, false, nil
	}
	messages := make([]Message, 0, len(rows))
	for _, row := range rows {
		messages = append(messages, Message{
			Seq:       row.Seq,
			Role:      row.Role,
			Text:      row.Text,
			Timestamp: row.Timestamp,
			ToolName:  row.ToolName,
			Thinking:  row.Thinking,
			CharCount: row.CharCount,
		})
	}
	return messages, true, nil
}

func (idx *SQLiteIndex) SaveMessages(ctx context.Context, summary SessionSummary, messages []Message) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	tx, err := idx.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()
	if _, err := tx.ExecContext(ctx, `DELETE FROM ai_session_messages WHERE session_key = ?`, summary.Key); err != nil {
		return err
	}
	stmt, err := tx.PreparexContext(ctx, `INSERT INTO ai_session_messages(session_key, seq, role, text, timestamp, tool_name, thinking, char_count)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, message := range messages {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if _, err := stmt.ExecContext(ctx, summary.Key, message.Seq, message.Role, message.Text, message.Timestamp, message.ToolName, message.Thinking, message.CharCount); err != nil {
			return err
		}
	}
	summary.MessageCount = readableMessageCount(messages)
	if err := idx.saveSummaryTx(ctx, tx, summary, true); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return nil
}

func (idx *SQLiteIndex) SaveSummary(ctx context.Context, summary SessionSummary) error {
	tx, err := idx.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()
	if err := idx.saveSummaryTx(ctx, tx, summary, false); err != nil {
		return err
	}
	return tx.Commit()
}

func (idx *SQLiteIndex) RefreshSummaries(ctx context.Context, providers []Provider) (IndexStats, []error) {
	summaries, errs := ScanSummaries(ctx, providers)
	stats, saveErrs := idx.SaveScannedSummaries(ctx, summaries, len(errs) == 0)
	stats.Errors += len(errs)
	return stats, append(errs, saveErrs...)
}

func (idx *SQLiteIndex) SaveScannedSummaries(ctx context.Context, summaries []SessionSummary, complete bool) (IndexStats, []error) {
	stats := IndexStats{Summaries: len(summaries)}
	var errs []error
	scanComplete := complete
	seen := make(map[string]bool, len(summaries))
	tx, err := idx.db.BeginTxx(ctx, nil)
	if err != nil {
		stats.Errors++
		return stats, []error{err}
	}
	defer func() {
		_ = tx.Rollback()
	}()
	now := time.Now().UnixMilli()
	for _, summary := range summaries {
		if ctx.Err() != nil {
			errs = append(errs, ctx.Err())
			stats.Errors++
			scanComplete = false
			break
		}
		if summary.Key == "" {
			summary.Key = StableKey(summary.Source, summary.ID, summary.FilePath)
		}
		if err := summary.Validate(); err != nil {
			errs = append(errs, err)
			stats.Errors++
			scanComplete = false
			continue
		}
		seen[summary.Key] = true
		if err := idx.applyMetaTx(ctx, tx, &summary); err != nil {
			errs = append(errs, err)
			stats.Errors++
			scanComplete = false
			continue
		}
		if err := idx.saveSummaryTx(ctx, tx, summary, false); err != nil {
			errs = append(errs, err)
			stats.Errors++
			scanComplete = false
			continue
		}
	}
	if scanComplete {
		if err := markMissingSQLiteSummaries(ctx, tx, seen); err != nil {
			errs = append(errs, err)
			stats.Errors++
			scanComplete = false
		}
	}
	if scanComplete {
		if _, err := tx.ExecContext(ctx, `INSERT INTO ai_schema_meta(key, value) VALUES(?, ?), (?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
			"summaries_scanned_at", fmt.Sprintf("%d", now), summaryParserVersionKey, summaryParserVersion); err != nil {
			errs = append(errs, err)
			stats.Errors++
		}
	}
	if err := tx.Commit(); err != nil {
		errs = append(errs, err)
		stats.Errors++
	}
	return stats, errs
}

func (idx *SQLiteIndex) HasSummaryScan(ctx context.Context) (bool, error) {
	value, ok, err := idx.schemaMeta(ctx, "summaries_scanned_at")
	if err != nil {
		return false, err
	}
	if !ok || strings.TrimSpace(value) == "" {
		return false, nil
	}
	version, ok, err := idx.schemaMeta(ctx, summaryParserVersionKey)
	if err != nil {
		return false, err
	}
	return ok && strings.TrimSpace(version) == summaryParserVersion, nil
}

func (idx *SQLiteIndex) ChangedFiles(ctx context.Context, files []SessionFile) ([]SessionFile, error) {
	rows := []struct {
		FilePath string `db:"file_path"`
		MTime    int64  `db:"mtime"`
		Size     int64  `db:"size"`
	}{}
	if err := idx.db.SelectContext(ctx, &rows, `SELECT file_path, mtime, size FROM ai_files`); err != nil {
		return nil, err
	}
	existing := make(map[string]SessionFile, len(rows))
	for _, row := range rows {
		existing[row.FilePath] = SessionFile{Path: row.FilePath, MTime: row.MTime, Size: row.Size}
	}
	var changed []SessionFile
	for _, file := range files {
		if ctx.Err() != nil {
			return changed, ctx.Err()
		}
		if strings.TrimSpace(file.Path) == "" {
			continue
		}
		cached, ok := existing[file.Path]
		if !ok || cached.MTime != file.MTime || cached.Size != file.Size {
			changed = append(changed, file)
		}
	}
	return changed, nil
}

func (idx *SQLiteIndex) MarkMissingSourceFiles(ctx context.Context, source string, files []SessionFile) error {
	source = strings.TrimSpace(source)
	if source == "" {
		return nil
	}
	seen := make(map[string]bool, len(files))
	for _, file := range files {
		if strings.TrimSpace(file.Path) != "" {
			seen[file.Path] = true
		}
	}
	rows := []struct {
		Key      string `db:"key"`
		FilePath string `db:"file_path"`
	}{}
	if err := idx.db.SelectContext(ctx, &rows, `SELECT key, file_path FROM ai_sessions WHERE source = ? AND missing = 0`, source); err != nil {
		return err
	}
	tx, err := idx.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()
	now := time.Now().UnixMilli()
	for _, row := range rows {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if seen[row.FilePath] {
			continue
		}
		if _, err := tx.ExecContext(ctx, `UPDATE ai_sessions SET missing = 1, indexed_at = ? WHERE key = ?`, now, row.Key); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (idx *SQLiteIndex) IndexAll(ctx context.Context, providers []Provider) (IndexStats, []error) {
	stats, errs := idx.RefreshSummaries(ctx, providers)
	summaries, err := idx.List(ctx, ListOptions{Limit: 0})
	if err != nil {
		return stats, append(errs, err)
	}
	for _, summary := range summaries {
		if ctx.Err() != nil {
			return stats, append(errs, ctx.Err())
		}
		messages, ok, err := idx.GetMessages(ctx, summary)
		if err == nil && ok {
			summary.MessageCount = readableMessageCount(messages)
			stats.Skipped++
			continue
		}
		provider := providerBySource(providers, summary.Source)
		if provider == nil {
			errs = append(errs, fmt.Errorf("no provider for source %q", summary.Source))
			stats.Errors++
			continue
		}
		messages, err = provider.LoadMessages(ctx, summary.FilePath)
		if err != nil {
			errs = append(errs, err)
			stats.Errors++
			continue
		}
		if err := idx.SaveMessages(ctx, summary, messages); err != nil {
			errs = append(errs, err)
			stats.Errors++
			continue
		}
		stats.FullTextIndexed++
	}
	return stats, errs
}

func markMissingSQLiteSummaries(ctx context.Context, tx *sqlx.Tx, seen map[string]bool) error {
	var keys []string
	if err := tx.SelectContext(ctx, &keys, `SELECT key FROM ai_sessions WHERE missing = 0`); err != nil {
		return err
	}
	for _, key := range keys {
		if seen[key] {
			continue
		}
		if _, err := tx.ExecContext(ctx, `UPDATE ai_sessions SET missing = 1, indexed_at = ? WHERE key = ?`, time.Now().UnixMilli(), key); err != nil {
			return err
		}
	}
	return nil
}

func (idx *SQLiteIndex) CountSessions(ctx context.Context) (int, error) {
	var count int
	err := idx.db.GetContext(ctx, &count, `SELECT count(*) FROM ai_sessions WHERE missing = 0`)
	return count, err
}

func (idx *SQLiteIndex) CountMeta(ctx context.Context) (int, error) {
	var count int
	err := idx.db.GetContext(ctx, &count, `SELECT count(*) FROM ai_session_meta`)
	return count, err
}

func (idx *SQLiteIndex) ListTags(ctx context.Context, opts ListOptions) ([]SessionTagSummary, error) {
	summaries, err := idx.List(ctx, ListOptions{
		Source:          opts.Source,
		Project:         opts.Project,
		Projects:        opts.Projects,
		ExcludeProjects: opts.ExcludeProjects,
		Since:           opts.Since,
		Before:          opts.Before,
		Marked:          opts.Marked,
		ExcludeTags:     opts.ExcludeTags,
		Limit:           0,
	})
	if err != nil {
		return nil, err
	}
	counts := make(map[string]int)
	for _, summary := range summaries {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		for _, tag := range NormalizeSessionTags(summary.Tags) {
			counts[tag]++
		}
	}
	tags := make([]SessionTagSummary, 0, len(counts))
	for tag, count := range counts {
		tags = append(tags, SessionTagSummary{Tag: tag, Count: count})
	}
	sortSessionTagSummaries(tags)
	return tags, nil
}

func (idx *SQLiteIndex) List(ctx context.Context, opts ListOptions) ([]SessionSummary, error) {
	summaries, _, err := idx.ListWithDistribution(ctx, opts)
	return summaries, err
}

// ListWithDistribution is List plus the full projectPath distribution
// (distinct projectPath counts over sessions passing the non-project filters),
// which the path-filter UI uses to navigate the directory tree with true counts.
func (idx *SQLiteIndex) ListWithDistribution(ctx context.Context, opts ListOptions) ([]SessionSummary, []ProjectPathSummary, error) {
	summaries, dist, _, err := idx.ListWithDistributionAndQuery(ctx, opts, "")
	return summaries, dist, err
}

// ListWithDistributionAndQuery runs the whole list pipeline in one place:
// non-project filters + distribution, project filters, free-text query, sort,
// limit, then hierarchy context attach. Keeping the query here (instead of in
// Manager.cachedScanListWithDistribution) is what lets attachContext see the
// pre-filter row universe: rows that failed the query are exactly the candidates
// a matching parent's subagents come from.
func (idx *SQLiteIndex) ListWithDistributionAndQuery(ctx context.Context, opts ListOptions, query string) ([]SessionSummary, []ProjectPathSummary, bool, error) {
	var rows []sqliteSessionRow
	err := idx.db.SelectContext(ctx, &rows, `SELECT `+sessionSummaryColumns+` FROM ai_sessions WHERE missing = 0`)
	if err != nil {
		return nil, nil, false, err
	}
	// --- Pass 1: convert rows to summaries (no meta yet) ---
	summaries := make([]SessionSummary, 0, len(rows))
	for _, row := range rows {
		summaries = append(summaries, row.summary())
	}
	// --- Batch-load meta (2 queries for all keys) ---
	keys := make([]string, 0, len(summaries))
	for i := range summaries {
		keys = append(keys, summaries[i].Key)
	}
	batchMeta, metaErr := idx.batchMetaForKeys(ctx, keys)
	if metaErr != nil {
		// Fallback: degrade gracefully to per-row ApplyMeta (safe, just slower).
		for i := range summaries {
			if err := idx.ApplyMeta(ctx, &summaries[i]); err != nil {
				return nil, nil, false, err
			}
		}
	} else {
		for i := range summaries {
			idx.applyBatchMeta(&summaries[i], batchMeta)
		}
	}
	// --- Pass 2: filter (non-project) + compute distribution, then apply project filter ---
	// The include-side path selection must NOT narrow the tree the UI navigates
	// (users need every directory's true count to keep selecting), so dist is
	// aggregated with Project/Projects cleared. Exclusions DO apply here: an
	// excluded session should disappear from both the list and the counts.
	baseOpts := opts
	baseOpts.Project = ""
	baseOpts.Projects = nil
	projects := effectiveProjects(opts)
	excludes := normalizeProjectFilters(opts.ExcludeProjects)
	dist := make(map[string]int, 16)
	var filtered []SessionSummary
	for i := range summaries {
		if ctx.Err() != nil {
			return nil, nil, false, ctx.Err()
		}
		if !summaryMatchesList(summaries[i], baseOpts) {
			continue
		}
		dist[summaries[i].ProjectPath]++
		if !projectPathMatchesAny(summaries[i].ProjectPath, projects) {
			continue
		}
		if projectPathExcluded(summaries[i].ProjectPath, excludes) {
			continue
		}
		if !sessionMatchesTagPresence(summaries[i], opts.TagPresence, opts.TagFilters) {
			continue
		}
		if !sessionTagsContainAll(summaries[i].Tags, opts.TagFilters) {
			continue
		}
		filtered = append(filtered, summaries[i])
	}
	if normalizedQuery := strings.ToLower(strings.TrimSpace(query)); normalizedQuery != "" {
		matches := filtered[:0]
		for i := range filtered {
			if summaryMatchesQuery(filtered[i], normalizedQuery) {
				matches = append(matches, filtered[i])
			}
		}
		filtered = matches
	}
	sortSummariesBy(filtered, opts.SortField, opts.SortDesc)
	limited := limitSummaries(filtered, opts.Limit)
	out, truncated := attachContextExcluding(ctx, limited, summaries, opts, nil)
	return out, summarizeProjectPathsFromMap(dist), truncated, nil
}

func (idx *SQLiteIndex) Search(ctx context.Context, opts SearchOptions) ([]SessionSummary, error) {
	query := strings.ToLower(strings.TrimSpace(opts.Query))
	summaries, err := idx.List(ctx, ListOptions{
		Source:          opts.Source,
		Project:         opts.Project,
		Projects:        opts.Projects,
		ExcludeProjects: opts.ExcludeProjects,
		Limit:           0,
		TagFilters:      opts.TagFilters,
		ExcludeTags:     opts.ExcludeTags,
		TagPresence:     opts.TagPresence,
	})
	if err != nil {
		return nil, err
	}
	if query == "" {
		sortSummariesBy(summaries, opts.SortField, opts.SortDesc)
		return attachContext(ctx, limitSummaries(summaries, opts.Limit), summaries, ListOptions{
			ExcludeProjects: opts.ExcludeProjects,
			ExcludeTags:     opts.ExcludeTags,
			AttachMode:      opts.AttachMode,
			AttachMaxRows:   opts.AttachMaxRows,
		}), nil
	}
	var filtered []SessionSummary
	for _, summary := range summaries {
		if ctx.Err() != nil {
			return filtered, ctx.Err()
		}
		if summaryMatchesQuery(summary, query) {
			filtered = append(filtered, summary)
			continue
		}
		var texts []string
		err := idx.db.SelectContext(ctx, &texts, `SELECT text FROM ai_session_messages WHERE session_key = ?`, summary.Key)
		if err != nil {
			return filtered, err
		}
		for _, text := range texts {
			if strings.Contains(strings.ToLower(text), query) {
				filtered = append(filtered, summary)
				break
			}
		}
	}
	sortSummariesBy(filtered, opts.SortField, opts.SortDesc)
	return attachContext(ctx, limitSummaries(filtered, opts.Limit), summaries, ListOptions{
		ExcludeProjects: opts.ExcludeProjects,
		ExcludeTags:     opts.ExcludeTags,
		AttachMode:      opts.AttachMode,
		AttachMaxRows:   opts.AttachMaxRows,
	}), nil
}

func (idx *SQLiteIndex) GetSession(ctx context.Context, identifier string) (SessionSummary, error) {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		return SessionSummary{}, fmt.Errorf("session id is required")
	}

	// 1) 主键精确命中。GetSession 在 Note/Tag/Mark 等元数据写入路径上被高频调用，
	//    原先无条件 SELECT 全表再内存匹配，会话量大时会明显拖慢写入。key 是主键，
	//    绝大多数调用都能在这里一次索引查询返回。
	var row sqliteSessionRow
	err := idx.db.GetContext(ctx, &row, `SELECT `+sessionSummaryColumns+` FROM ai_sessions WHERE key = ? AND missing = 0`, identifier)
	if err == nil {
		summary := row.summary()
		if err := idx.ApplyMeta(ctx, &summary); err != nil {
			return SessionSummary{}, err
		}
		return summary, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return SessionSummary{}, err
	}

	// 2) id 精确命中（前端有时只传裸 id 而不是带 source 的 key）。
	err = idx.db.GetContext(ctx, &row, `SELECT `+sessionSummaryColumns+` FROM ai_sessions WHERE id = ? AND missing = 0 ORDER BY updated_at DESC LIMIT 1`, identifier)
	if err == nil {
		summary := row.summary()
		if err := idx.ApplyMeta(ctx, &summary); err != nil {
			return SessionSummary{}, err
		}
		return summary, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return SessionSummary{}, err
	}

	// 3) id 前缀命中（保留旧的宽松行为）。多候选时报歧义，不猜。
	var rows []sqliteSessionRow
	if err := idx.db.SelectContext(ctx, &rows, `SELECT `+sessionSummaryColumns+` FROM ai_sessions WHERE missing = 0 AND id LIKE ? ESCAPE '\' ORDER BY updated_at DESC`, escapeLikePrefix(identifier)); err != nil {
		return SessionSummary{}, err
	}
	if len(rows) == 0 {
		return SessionSummary{}, fmt.Errorf("session not found: %s", identifier)
	}
	if len(rows) > 1 {
		return SessionSummary{}, fmt.Errorf("ambiguous session id prefix %q (%d matches)", identifier, len(rows))
	}
	summary := rows[0].summary()
	if err := idx.ApplyMeta(ctx, &summary); err != nil {
		return SessionSummary{}, err
	}
	return summary, nil
}

const sessionSummaryColumns = `key, id, source, title, title_source, project_path, created_at, updated_at, message_count, file_path, vendor_id, config_dir, snippet, mtime, size, missing, parent_key, kind`

// escapeLikePrefix 把 LIKE 前匹配的通配符转义，避免 identifier 里的 % / _ 被当成通配符。
func escapeLikePrefix(prefix string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return replacer.Replace(prefix) + "%"
}

type sqliteSessionRow struct {
	Key          string `db:"key"`
	ID           string `db:"id"`
	Source       string `db:"source"`
	Title        string `db:"title"`
	TitleSource  string `db:"title_source"`
	ProjectPath  string `db:"project_path"`
	CreatedAt    int64  `db:"created_at"`
	UpdatedAt    int64  `db:"updated_at"`
	MessageCount int    `db:"message_count"`
	FilePath     string `db:"file_path"`
	VendorID     string `db:"vendor_id"`
	ConfigDir    string `db:"config_dir"`
	Snippet      string `db:"snippet"`
	MTime        int64  `db:"mtime"`
	Size         int64  `db:"size"`
	Missing      bool   `db:"missing"`
	ParentKey    string `db:"parent_key"`
	Kind         string `db:"kind"`
}

func (row sqliteSessionRow) summary() SessionSummary {
	return SessionSummary{
		Key:          row.Key,
		ID:           row.ID,
		Source:       row.Source,
		Title:        row.Title,
		TitleSource:  row.TitleSource,
		ProjectPath:  row.ProjectPath,
		CreatedAt:    row.CreatedAt,
		UpdatedAt:    row.UpdatedAt,
		MessageCount: row.MessageCount,
		FilePath:     row.FilePath,
		VendorID:     row.VendorID,
		ConfigDir:    row.ConfigDir,
		Snippet:      row.Snippet,
		MTime:        row.MTime,
		Size:         row.Size,
		Missing:      row.Missing,
		ParentKey:    row.ParentKey,
		Kind:         row.Kind,
	}
}

func (idx *SQLiteIndex) saveSummaryTx(ctx context.Context, tx *sqlx.Tx, summary SessionSummary, messageIndexed bool) error {
	now := time.Now().UnixMilli()
	_, err := tx.ExecContext(ctx, `INSERT INTO ai_sessions(key, id, source, title, title_source, project_path, created_at, updated_at, message_count, file_path, vendor_id, config_dir, snippet, mtime, size, missing, parent_key, kind, indexed_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET
			id = excluded.id,
			source = excluded.source,
			title = excluded.title,
			title_source = excluded.title_source,
			project_path = excluded.project_path,
			created_at = excluded.created_at,
			updated_at = excluded.updated_at,
			message_count = CASE
				WHEN ? = 1 THEN excluded.message_count
				WHEN ai_sessions.mtime != excluded.mtime OR ai_sessions.size != excluded.size THEN 0
				ELSE ai_sessions.message_count
			END,
			file_path = excluded.file_path,
			vendor_id = excluded.vendor_id,
			config_dir = excluded.config_dir,
			snippet = excluded.snippet,
			mtime = excluded.mtime,
			size = excluded.size,
			missing = excluded.missing,
			parent_key = excluded.parent_key,
			kind = excluded.kind,
			indexed_at = excluded.indexed_at`,
		summary.Key, summary.ID, summary.Source, summary.Title, summary.TitleSource, summary.ProjectPath, summary.CreatedAt, summary.UpdatedAt,
		summary.MessageCount, summary.FilePath, summary.VendorID, summary.ConfigDir, summary.Snippet, summary.MTime, summary.Size, boolToInt(summary.Missing),
		summary.ParentKey, summary.Kind, now,
		boolToInt(messageIndexed))
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO ai_files(file_path, source, mtime, size, indexed_at, message_indexed)
		VALUES(?, ?, ?, ?, ?, ?)
		ON CONFLICT(file_path) DO UPDATE SET
			source = excluded.source,
			mtime = excluded.mtime,
			size = excluded.size,
			indexed_at = excluded.indexed_at,
			message_indexed = CASE
				WHEN excluded.message_indexed = 1 THEN 1
				WHEN ai_files.mtime != excluded.mtime OR ai_files.size != excluded.size THEN 0
				ELSE ai_files.message_indexed
			END`,
		summary.FilePath, summary.Source, summary.MTime, summary.Size, now, boolToInt(messageIndexed))
	return err
}

func (idx *SQLiteIndex) applyMetaTx(ctx context.Context, tx *sqlx.Tx, summary *SessionSummary) error {
	if summary == nil || strings.TrimSpace(summary.Key) == "" {
		return nil
	}
	var marked bool
	var note string
	var title string
	err := tx.QueryRowxContext(ctx, `SELECT marked, note, title FROM ai_session_meta WHERE session_key = ?`, summary.Key).
		Scan(&marked, &note, &title)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	summary.Marked = marked
	summary.Note = note
	if title != "" {
		summary.Title = title
		summary.TitleSource = "user"
	}
	return nil
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
