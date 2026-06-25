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
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	_ "github.com/mattn/go-sqlite3"
)

const sqliteIndexSchemaVersion = "2"

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
			snippet TEXT,
			mtime INTEGER,
			size INTEGER,
			missing INTEGER NOT NULL DEFAULT 0,
			indexed_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS ai_session_messages (
			session_key TEXT NOT NULL,
			seq INTEGER NOT NULL,
			role TEXT NOT NULL,
			text TEXT NOT NULL,
			timestamp INTEGER,
			tool_name TEXT,
			char_count INTEGER,
			PRIMARY KEY(session_key, seq)
		)`,
		`CREATE TABLE IF NOT EXISTS ai_session_meta (
			session_key TEXT PRIMARY KEY,
			marked INTEGER NOT NULL DEFAULT 0,
			note TEXT NOT NULL DEFAULT '',
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
		`CREATE TABLE IF NOT EXISTS ai_files (
			file_path TEXT PRIMARY KEY,
			source TEXT NOT NULL,
			mtime INTEGER NOT NULL,
			size INTEGER NOT NULL,
			indexed_at INTEGER NOT NULL,
			message_indexed INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_sessions_source_id ON ai_sessions(source, id)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_sessions_updated ON ai_sessions(updated_at)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_session_messages_session ON ai_session_messages(session_key, seq)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_session_tags_tag ON ai_session_tags(tag)`,
	}
	for _, stmt := range stmts {
		if _, err := idx.db.ExecContext(ctx, stmt); err != nil {
			return err
		}
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
	err := tx.QueryRowxContext(ctx, `SELECT marked, note, updated_at, created_at FROM ai_session_meta WHERE session_key = ?`, key).
		Scan(&existing.Marked, &existing.Note, &existing.UpdatedAt, &existingCreatedAt)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err == nil && existing.UpdatedAt > incomingUpdatedAt {
		return nil
	}
	if err == nil && existing.UpdatedAt == incomingUpdatedAt {
		if item.Note == "" && existing.Note != "" {
			item.Note = existing.Note
		}
		item.Marked = item.Marked || existing.Marked
	}
	createdAt := existingCreatedAt
	if createdAt == 0 {
		createdAt = now
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO ai_session_meta(session_key, marked, note, updated_at, created_at, source, dirty)
		VALUES(?, ?, ?, ?, ?, ?, 0)
		ON CONFLICT(session_key) DO UPDATE SET
			marked = excluded.marked,
			note = excluded.note,
			updated_at = excluded.updated_at,
			source = excluded.source,
			dirty = excluded.dirty`,
		key, boolToInt(item.Marked), item.Note, incomingUpdatedAt, createdAt, source)
	return err
}

func (idx *SQLiteIndex) ApplyMeta(ctx context.Context, summary *SessionSummary) error {
	if summary == nil || strings.TrimSpace(summary.Key) == "" {
		return nil
	}
	var marked bool
	var note string
	err := idx.db.QueryRowxContext(ctx, `SELECT marked, note FROM ai_session_meta WHERE session_key = ?`, summary.Key).
		Scan(&marked, &note)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	summary.Marked = marked
	summary.Note = note
	tags, err := idx.tagsForSession(ctx, summary.Key)
	if err != nil {
		return err
	}
	summary.Tags = tags
	return nil
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
	err := tx.QueryRowxContext(ctx, `SELECT marked, note, updated_at, created_at FROM ai_session_meta WHERE session_key = ?`, key).
		Scan(&existing.Marked, &existing.Note, &existing.UpdatedAt, &existingCreatedAt)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if source == "sqlite-mark" {
		incoming.Note = existing.Note
	} else if source == "sqlite-note" || source == "sqlite-note-tags" {
		incoming.Marked = existing.Marked
	}
	if incoming.UpdatedAt == 0 {
		incoming.UpdatedAt = now
	}
	createdAt := existingCreatedAt
	if createdAt == 0 {
		createdAt = now
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO ai_session_meta(session_key, marked, note, updated_at, created_at, source, dirty)
		VALUES(?, ?, ?, ?, ?, ?, 1)
		ON CONFLICT(session_key) DO UPDATE SET
			marked = excluded.marked,
			note = excluded.note,
			updated_at = excluded.updated_at,
			source = excluded.source,
			dirty = excluded.dirty`,
		key, boolToInt(incoming.Marked), incoming.Note, incoming.UpdatedAt, createdAt, source)
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
		CharCount int    `db:"char_count"`
	}
	err = idx.db.SelectContext(ctx, &rows, `SELECT seq, role, text, timestamp, tool_name, char_count
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
	stmt, err := tx.PreparexContext(ctx, `INSERT INTO ai_session_messages(session_key, seq, role, text, timestamp, tool_name, char_count)
		VALUES(?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, message := range messages {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if _, err := stmt.ExecContext(ctx, summary.Key, message.Seq, message.Role, message.Text, message.Timestamp, message.ToolName, message.CharCount); err != nil {
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
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO ai_schema_meta(key, value) VALUES(?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value`, "summaries_scanned_at", fmt.Sprintf("%d", now)); err != nil {
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
	return ok && strings.TrimSpace(value) != "", nil
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
		Source:     opts.Source,
		Project:    opts.Project,
		Since:      opts.Since,
		Before:     opts.Before,
		Marked:     opts.Marked,
		Limit:      0,
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
	var rows []sqliteSessionRow
	err := idx.db.SelectContext(ctx, &rows, `SELECT key, id, source, title, title_source, project_path, created_at, updated_at, message_count, file_path, snippet, mtime, size, missing FROM ai_sessions`)
	if err != nil {
		return nil, err
	}
	var summaries []SessionSummary
	for _, row := range rows {
		if ctx.Err() != nil {
			return summaries, ctx.Err()
		}
		summary := row.summary()
		if err := idx.ApplyMeta(ctx, &summary); err != nil {
			return summaries, err
		}
		if !summaryMatchesList(summary, opts) {
			continue
		}
		if !sessionTagsContainAll(summary.Tags, opts.TagFilters) {
			continue
		}
		summaries = append(summaries, summary)
	}
	sortSummaries(summaries)
	return limitSummaries(summaries, opts.Limit), nil
}

func (idx *SQLiteIndex) Search(ctx context.Context, opts SearchOptions) ([]SessionSummary, error) {
	query := strings.ToLower(strings.TrimSpace(opts.Query))
	summaries, err := idx.List(ctx, ListOptions{Source: opts.Source, Project: opts.Project, Limit: 0, TagFilters: opts.TagFilters})
	if err != nil {
		return nil, err
	}
	if query == "" {
		return limitSummaries(summaries, opts.Limit), nil
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
	sortSummaries(filtered)
	return limitSummaries(filtered, opts.Limit), nil
}

func (idx *SQLiteIndex) GetSession(ctx context.Context, identifier string) (SessionSummary, error) {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		return SessionSummary{}, fmt.Errorf("session id is required")
	}
	var rows []sqliteSessionRow
	err := idx.db.SelectContext(ctx, &rows, `SELECT key, id, source, title, title_source, project_path, created_at, updated_at, message_count, file_path, snippet, mtime, size, missing FROM ai_sessions WHERE missing = 0`)
	if err != nil {
		return SessionSummary{}, err
	}
	var matches []SessionSummary
	for _, row := range rows {
		if ctx.Err() != nil {
			return SessionSummary{}, ctx.Err()
		}
		summary := row.summary()
		if summary.Key == identifier || summary.ID == identifier || strings.HasPrefix(summary.ID, identifier) {
			if err := idx.ApplyMeta(ctx, &summary); err != nil {
				return SessionSummary{}, err
			}
			matches = append(matches, summary)
		}
	}
	if len(matches) == 0 {
		return SessionSummary{}, fmt.Errorf("session not found: %s", identifier)
	}
	sort.SliceStable(matches, func(i, j int) bool {
		if matches[i].Key == identifier {
			return true
		}
		if matches[j].Key == identifier {
			return false
		}
		if matches[i].ID == identifier {
			return true
		}
		if matches[j].ID == identifier {
			return false
		}
		return summarySortTime(matches[i]) > summarySortTime(matches[j])
	})
	if len(matches) > 1 && matches[0].ID != identifier && matches[0].Key != identifier {
		return SessionSummary{}, fmt.Errorf("ambiguous session id prefix %q (%d matches)", identifier, len(matches))
	}
	return matches[0], nil
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
	Snippet      string `db:"snippet"`
	MTime        int64  `db:"mtime"`
	Size         int64  `db:"size"`
	Missing      bool   `db:"missing"`
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
		Snippet:      row.Snippet,
		MTime:        row.MTime,
		Size:         row.Size,
		Missing:      row.Missing,
	}
}

func (idx *SQLiteIndex) saveSummaryTx(ctx context.Context, tx *sqlx.Tx, summary SessionSummary, messageIndexed bool) error {
	now := time.Now().UnixMilli()
	_, err := tx.ExecContext(ctx, `INSERT INTO ai_sessions(key, id, source, title, title_source, project_path, created_at, updated_at, message_count, file_path, snippet, mtime, size, missing, indexed_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET
			id = excluded.id,
			source = excluded.source,
			title = excluded.title,
			title_source = excluded.title_source,
			project_path = excluded.project_path,
			created_at = excluded.created_at,
			updated_at = excluded.updated_at,
			message_count = excluded.message_count,
			file_path = excluded.file_path,
			snippet = excluded.snippet,
			mtime = excluded.mtime,
			size = excluded.size,
			missing = excluded.missing,
			indexed_at = excluded.indexed_at`,
		summary.Key, summary.ID, summary.Source, summary.Title, summary.TitleSource, summary.ProjectPath, summary.CreatedAt, summary.UpdatedAt,
		summary.MessageCount, summary.FilePath, summary.Snippet, summary.MTime, summary.Size, boolToInt(summary.Missing), now)
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
	err := tx.QueryRowxContext(ctx, `SELECT marked, note FROM ai_session_meta WHERE session_key = ?`, summary.Key).
		Scan(&marked, &note)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	summary.Marked = marked
	summary.Note = note
	return nil
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
