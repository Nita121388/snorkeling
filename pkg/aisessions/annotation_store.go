// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Node-level annotation storage (schema v4).
//
// All writes go through this file; the only overwrite rule lives in
// annotation_rules.go (CanReplace). Annotations are stored only in Snorkeling's
// SQLite index; provider session JSONL files are never modified.

package aisessions

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// AnnotationBodyMaxChars is a defensive storage ceiling. The AI prompt config
// may impose a smaller limit; this one prevents a runaway client from writing
// megabytes into one row.
const AnnotationBodyMaxChars = 20000

// ensureAnnotationColumns is a forward-compatibility guard for the annotation
// table. Fresh and old databases both get the table from CREATE TABLE IF NOT
// EXISTS in init; this only adds columns that may be introduced later.
func (idx *SQLiteIndex) ensureAnnotationColumns(ctx context.Context) error {
	wanted := map[string]string{
		"anchor_preview": "TEXT NOT NULL DEFAULT ''",
		// node_text：用户手改的「节点原文」副本。空串 = 没覆盖，卡片回落到活节点文本。
		"node_text": "TEXT NOT NULL DEFAULT ''",
	}
	var columns []struct {
		Name string `db:"name"`
	}
	if err := idx.db.SelectContext(ctx, &columns, `SELECT name FROM pragma_table_info('ai_session_annotations')`); err != nil {
		return err
	}
	existing := make(map[string]bool, len(columns))
	for _, column := range columns {
		existing[column.Name] = true
	}
	for name, definition := range wanted {
		if existing[name] {
			continue
		}
		if _, err := idx.db.ExecContext(ctx, fmt.Sprintf("ALTER TABLE ai_session_annotations ADD COLUMN %s %s", name, definition)); err != nil {
			return err
		}
	}
	return nil
}

func normalizeAnnotationKind(kind string) string {
	switch strings.TrimSpace(strings.ToLower(kind)) {
	case AnnotationKindMilestone:
		return AnnotationKindMilestone
	case AnnotationKindDecision:
		return AnnotationKindDecision
	case AnnotationKindQuestion:
		return AnnotationKindQuestion
	default:
		return AnnotationKindNote
	}
}

func normalizeAnnotationStatus(status string) string {
	if strings.TrimSpace(strings.ToLower(status)) == AnnotationStatusDraft {
		return AnnotationStatusDraft
	}
	return AnnotationStatusAccepted
}

func normalizeAnnotationSource(source string) string {
	if strings.TrimSpace(strings.ToLower(source)) == AnnotationSourceAI {
		return AnnotationSourceAI
	}
	return AnnotationSourceUser
}

func clampAnnotationBody(body string) string {
	runes := []rune(body)
	if len(runes) <= AnnotationBodyMaxChars {
		return body
	}
	return string(runes[:AnnotationBodyMaxChars])
}

// AnnotationNodeTextMaxChars 限制用户手改的节点原文副本长度。
const AnnotationNodeTextMaxChars = 8000

func clampAnnotationNodeText(text string) string {
	runes := []rune(text)
	if len(runes) <= AnnotationNodeTextMaxChars {
		return text
	}
	return string(runes[:AnnotationNodeTextMaxChars])
}

func annotationTagsJSON(tags []string) string {
	normalized := NormalizeSessionTags(tags)
	if normalized == nil {
		normalized = []string{}
	}
	raw, err := json.Marshal(normalized)
	if err != nil {
		return "[]"
	}
	return string(raw)
}

func decodeAnnotationTags(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return []string{}
	}
	var tags []string
	if err := json.Unmarshal([]byte(raw), &tags); err != nil {
		return []string{}
	}
	return NormalizeSessionTags(tags)
}

func (row AnnotationRow) view(orphaned bool) AnnotationView {
	return AnnotationView{
		ID:            row.ID,
		SessionKey:    row.SessionKey,
		AnchorKey:     row.AnchorKey,
		Seq:           row.Seq,
		Kind:          row.Kind,
		Title:         row.Title,
		Body:          row.Body,
		Tags:          decodeAnnotationTags(row.TagsJSON),
		Status:        row.Status,
		Source:        row.Source,
		UserEdited:    row.UserEdited,
		AIModel:       row.AIModel,
		AnchorPreview: row.AnchorPreview,
		NodeText:      row.NodeText,
		Orphaned:      orphaned,
		CreatedAt:     row.CreatedAt,
		UpdatedAt:     row.UpdatedAt,
	}
}

const annotationColumns = `id, session_key, anchor_key, seq, kind, title, body, tags_json,
	status, source, user_edited, ai_model, anchor_hash, anchor_preview, node_text, created_at, updated_at`

func scanAnnotationRow(scanner interface {
	Scan(dest ...any) error
}) (AnnotationRow, error) {
	var row AnnotationRow
	err := scanner.Scan(
		&row.ID, &row.SessionKey, &row.AnchorKey, &row.Seq, &row.Kind, &row.Title, &row.Body, &row.TagsJSON,
		&row.Status, &row.Source, &row.UserEdited, &row.AIModel, &row.AnchorHash, &row.AnchorPreview,
		&row.NodeText, &row.CreatedAt, &row.UpdatedAt,
	)
	return row, err
}

// listAnnotationsTx is ListAnnotations bound to an existing transaction. The
// connection pool is capped at 1, so callers holding a tx must not query idx.db.
func listAnnotationsTx(ctx context.Context, tx interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}, sessionKey string) ([]AnnotationRow, error) {
	rows, err := tx.QueryContext(ctx,
		`SELECT `+annotationColumns+` FROM ai_session_annotations WHERE session_key = ? ORDER BY seq, id`,
		sessionKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []AnnotationRow
	for rows.Next() {
		row, err := scanAnnotationRow(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

// ListAnnotations returns every annotation of one session ordered by seq then id.
func (idx *SQLiteIndex) ListAnnotations(ctx context.Context, sessionKey string) ([]AnnotationRow, error) {
	sessionKey = strings.TrimSpace(sessionKey)
	if sessionKey == "" {
		return nil, fmt.Errorf("session key is required")
	}
	rows, err := idx.db.QueryContext(ctx,
		`SELECT `+annotationColumns+` FROM ai_session_annotations WHERE session_key = ? ORDER BY seq, id`,
		sessionKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []AnnotationRow
	for rows.Next() {
		row, err := scanAnnotationRow(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

// UpsertAnnotation creates or updates one annotation. Updating a row that was
// AI-generated marks it user_edited=1 so no later AI pass can replace it.
func (idx *SQLiteIndex) UpsertAnnotation(ctx context.Context, row AnnotationRow) (AnnotationRow, error) {
	row.SessionKey = strings.TrimSpace(row.SessionKey)
	row.AnchorKey = strings.TrimSpace(row.AnchorKey)
	if row.SessionKey == "" || row.AnchorKey == "" {
		return AnnotationRow{}, fmt.Errorf("session key and anchor key are required")
	}
	row.Kind = normalizeAnnotationKind(row.Kind)
	row.Status = normalizeAnnotationStatus(row.Status)
	row.Body = clampAnnotationBody(row.Body)
	if row.Tags != nil {
		row.TagsJSON = annotationTagsJSON(row.Tags)
	}
	now := time.Now().UnixMilli()

	tx, err := idx.db.BeginTxx(ctx, nil)
	if err != nil {
		return AnnotationRow{}, err
	}
	defer func() { _ = tx.Rollback() }()

	if row.ID > 0 {
		var existingSource string
		err := tx.GetContext(ctx, &existingSource,
			`SELECT source FROM ai_session_annotations WHERE id = ? AND session_key = ?`, row.ID, row.SessionKey)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return AnnotationRow{}, fmt.Errorf("annotation %d not found in session", row.ID)
			}
			return AnnotationRow{}, err
		}
		if existingSource == AnnotationSourceAI {
			row.UserEdited = true
		}
		if row.Source == "" {
			row.Source = existingSource
		}
		row.Source = normalizeAnnotationSource(row.Source)
		row.UpdatedAt = now
		if _, err := tx.ExecContext(ctx,
			`UPDATE ai_session_annotations SET anchor_key=?, seq=?, kind=?, title=?, body=?, tags_json=?,
			 status=?, source=?, user_edited=?, ai_model=?, anchor_hash=?, anchor_preview=?, node_text=?, updated_at=?
			 WHERE id=? AND session_key=?`,
			row.AnchorKey, row.Seq, row.Kind, row.Title, row.Body, annotationTagsJSON(decodeAnnotationTags(row.TagsJSON)),
			row.Status, row.Source, annotationBoolToInt(row.UserEdited), row.AIModel, row.AnchorHash, row.AnchorPreview,
			clampAnnotationNodeText(row.NodeText), now, row.ID, row.SessionKey); err != nil {
			return AnnotationRow{}, err
		}
		if err := tx.Commit(); err != nil {
			return AnnotationRow{}, err
		}
		row.CreatedAt = 0
		stored, err := idx.getAnnotation(ctx, row.ID)
		return stored, err
	}

	row.Source = normalizeAnnotationSource(row.Source)
	if row.Source == AnnotationSourceAI {
		// New AI rows start unedited; only a human save flips this.
		row.UserEdited = false
	}
	row.CreatedAt = now
	row.UpdatedAt = now
	result, err := tx.ExecContext(ctx,
		`INSERT INTO ai_session_annotations
			(session_key, anchor_key, seq, kind, title, body, tags_json, status, source, user_edited,
			 ai_model, anchor_hash, anchor_preview, node_text, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		row.SessionKey, row.AnchorKey, row.Seq, row.Kind, row.Title, row.Body,
		annotationTagsJSON(decodeAnnotationTags(row.TagsJSON)), row.Status, row.Source,
		annotationBoolToInt(row.UserEdited), row.AIModel, row.AnchorHash, row.AnchorPreview,
		clampAnnotationNodeText(row.NodeText), now, now)
	if err != nil {
		return AnnotationRow{}, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return AnnotationRow{}, err
	}
	if err := tx.Commit(); err != nil {
		return AnnotationRow{}, err
	}
	row.ID = id
	return row, nil
}

func annotationBoolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func (idx *SQLiteIndex) getAnnotation(ctx context.Context, id int64) (AnnotationRow, error) {
	row, err := scanAnnotationRow(idx.db.QueryRowContext(ctx,
		`SELECT `+annotationColumns+` FROM ai_session_annotations WHERE id = ?`, id))
	if err != nil {
		return AnnotationRow{}, err
	}
	return row, nil
}

// DeleteAnnotation removes one annotation permanently.
func (idx *SQLiteIndex) DeleteAnnotation(ctx context.Context, id int64) error {
	if id <= 0 {
		return fmt.Errorf("annotation id is required")
	}
	result, err := idx.db.ExecContext(ctx, `DELETE FROM ai_session_annotations WHERE id = ?`, id)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// ReplaceReplaceableAnnotations atomically replaces every annotation of a
// session that CanReplace allows, leaving protected rows untouched. New rows are
// inserted as drafts so the user still decides whether to accept them.
func (idx *SQLiteIndex) ReplaceReplaceableAnnotations(ctx context.Context, sessionKey string, rows []AnnotationRow) ([]AnnotationRow, error) {
	sessionKey = strings.TrimSpace(sessionKey)
	if sessionKey == "" {
		return nil, fmt.Errorf("session key is required")
	}
	tx, err := idx.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	// Read through tx, not idx.db: the pool is capped at one connection and the
	// open transaction already owns it (reading through idx.db would deadlock).
	existing, err := listAnnotationsTx(ctx, tx, sessionKey)
	if err != nil {
		return nil, err
	}
	for _, current := range existing {
		if !CanReplace(current) {
			continue
		}
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM ai_session_annotations WHERE id = ? AND session_key = ?`, current.ID, sessionKey); err != nil {
			return nil, err
		}
	}

	now := time.Now().UnixMilli()
	inserted := make([]AnnotationRow, 0, len(rows))
	for _, row := range rows {
		row.ID = 0
		row.SessionKey = sessionKey
		row.AnchorKey = strings.TrimSpace(row.AnchorKey)
		if row.AnchorKey == "" {
			continue
		}
		row.Kind = normalizeAnnotationKind(row.Kind)
		if row.Tags != nil {
			row.TagsJSON = annotationTagsJSON(row.Tags)
		}
		row.Status = AnnotationStatusDraft
		row.Source = AnnotationSourceAI
		row.UserEdited = false
		row.Body = clampAnnotationBody(row.Body)
		row.CreatedAt = now
		row.UpdatedAt = now
		result, err := tx.ExecContext(ctx,
			`INSERT INTO ai_session_annotations
				(session_key, anchor_key, seq, kind, title, body, tags_json, status, source, user_edited,
				 ai_model, anchor_hash, anchor_preview, node_text, created_at, updated_at)
			 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			row.SessionKey, row.AnchorKey, row.Seq, row.Kind, row.Title, row.Body,
			annotationTagsJSON(decodeAnnotationTags(row.TagsJSON)), row.Status, row.Source,
			0, row.AIModel, row.AnchorHash, row.AnchorPreview, clampAnnotationNodeText(row.NodeText), now, now)
		if err != nil {
			return nil, err
		}
		id, err := result.LastInsertId()
		if err != nil {
			return nil, err
		}
		row.ID = id
		inserted = append(inserted, row)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return inserted, nil
}

// BulkDraftAction either accepts or discards draft annotations of one session.
const (
	AnnotationDraftActionAccept  = "accept"
	AnnotationDraftActionDiscard = "discard"
)

// BulkDraftAnnotations accepts (status=accepted) or discards (delete) draft
// annotations. Only status='draft' rows are touched: accepted rows and
// user-edited rows are never modified by this path.
func (idx *SQLiteIndex) BulkDraftAnnotations(ctx context.Context, sessionKey string, ids []int64, action string) (int, error) {
	sessionKey = strings.TrimSpace(sessionKey)
	if sessionKey == "" {
		return 0, fmt.Errorf("session key is required")
	}
	switch action {
	case AnnotationDraftActionAccept, AnnotationDraftActionDiscard:
	default:
		return 0, fmt.Errorf("invalid draft action %q", action)
	}
	query := `SELECT id FROM ai_session_annotations WHERE session_key = ? AND status = '` + AnnotationStatusDraft + `'`
	args := []any{sessionKey}
	if len(ids) > 0 {
		parts := make([]string, 0, len(ids))
		for _, id := range ids {
			if id <= 0 {
				continue
			}
			parts = append(parts, "?")
			args = append(args, id)
		}
		if len(parts) > 0 {
			query += " AND id IN (" + strings.Join(parts, ",") + ")"
		}
	}
	var targetIDs []int64
	if err := idx.db.SelectContext(ctx, &targetIDs, query, args...); err != nil {
		return 0, err
	}
	if len(targetIDs) == 0 {
		return 0, nil
	}
	if action == AnnotationDraftActionDiscard {
		result, err := idx.db.ExecContext(ctx,
			`DELETE FROM ai_session_annotations WHERE session_key = ? AND id IN (`+placeholders(len(targetIDs))+`) AND status = '`+AnnotationStatusDraft+`'`,
			append([]any{sessionKey}, toAnySlice(targetIDs)...)...)
		if err != nil {
			return 0, err
		}
		affected, _ := result.RowsAffected()
		return int(affected), nil
	}
	result, err := idx.db.ExecContext(ctx,
		`UPDATE ai_session_annotations SET status = '`+AnnotationStatusAccepted+`', updated_at = ?
		 WHERE session_key = ? AND id IN (`+placeholders(len(targetIDs))+`) AND status = '`+AnnotationStatusDraft+`'`,
		append([]any{time.Now().UnixMilli(), sessionKey}, toAnySlice(targetIDs)...)...)
	if err != nil {
		return 0, err
	}
	affected, _ := result.RowsAffected()
	return int(affected), nil
}

func placeholders(count int) string {
	if count <= 0 {
		return ""
	}
	return strings.TrimSuffix(strings.Repeat("?,", count), ",")
}

func toAnySlice(ids []int64) []any {
	out := make([]any, 0, len(ids))
	for _, id := range ids {
		out = append(out, id)
	}
	return out
}

// ReanchorAnnotation writes back a resolved anchor after drift detection.
func (idx *SQLiteIndex) ReanchorAnnotation(ctx context.Context, id int64, anchor AnnotationAnchor) error {
	if id <= 0 || strings.TrimSpace(anchor.AnchorKey) == "" {
		return fmt.Errorf("annotation id and anchor key are required")
	}
	_, err := idx.db.ExecContext(ctx,
		`UPDATE ai_session_annotations SET anchor_key=?, seq=?, anchor_hash=?, updated_at=? WHERE id=?`,
		strings.TrimSpace(anchor.AnchorKey), anchor.Seq, anchor.Hash, time.Now().UnixMilli(), id)
	return err
}

// MarkAnnotationAnchorPreview stores a snapshot of the node text for orphan
// display. Best effort; failures must not block annotation listing.
func (idx *SQLiteIndex) MarkAnnotationAnchorPreview(ctx context.Context, id int64, preview string) error {
	_, err := idx.db.ExecContext(ctx,
		`UPDATE ai_session_annotations SET anchor_preview=? WHERE id=?`, annotationTruncateRunes(preview, 500), id)
	return err
}

func annotationTruncateRunes(text string, limit int) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit])
}

// AnnotatedSessionFilter narrows the cross-session annotation list.
type AnnotatedSessionFilter struct {
	Query           string
	TagFilters      []string
	ProjectPrefixes []string
	Limit           int
	Offset          int
}

// ListAnnotatedSessions returns sessions with at least one accepted annotation,
// newest annotation first. One aggregate query; no N+1.
func (idx *SQLiteIndex) ListAnnotatedSessions(ctx context.Context, filter AnnotatedSessionFilter) ([]AnnotatedSession, int, error) {
	where := []string{"s.missing = 0", "a.status = '" + AnnotationStatusAccepted + "'"}
	args := []any{}
	if query := strings.TrimSpace(filter.Query); query != "" {
		where = append(where, "(LOWER(s.title) LIKE ? OR LOWER(s.id) LIKE ? OR LOWER(s.project_path) LIKE ?)")
		pattern := "%" + strings.ToLower(query) + "%"
		args = append(args, pattern, pattern, pattern)
	}
	for _, tag := range NormalizeSessionTags(filter.TagFilters) {
		where = append(where,
			"EXISTS (SELECT 1 FROM json_each(a.tags_json) j WHERE j.value = ?)")
		args = append(args, tag)
	}
	if prefixes := filter.ProjectPrefixes; len(prefixes) > 0 {
		parts := make([]string, 0, len(prefixes))
		for _, prefix := range prefixes {
			prefix = strings.TrimSpace(prefix)
			if prefix == "" {
				continue
			}
			parts = append(parts, "s.project_path LIKE ?")
			args = append(args, prefix+"%")
		}
		if len(parts) > 0 {
			where = append(where, "("+strings.Join(parts, " OR ")+")")
		}
	}
	whereSQL := " WHERE " + strings.Join(where, " AND ")

	var total int
	countSQL := `SELECT COUNT(*) FROM (
		SELECT s.key FROM ai_sessions s JOIN ai_session_annotations a ON a.session_key = s.key` +
		whereSQL + ` GROUP BY s.key)`
	if err := idx.db.GetContext(ctx, &total, countSQL, args...); err != nil {
		return nil, 0, err
	}

	limit := filter.Limit
	if limit <= 0 {
		limit = 100
	}
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}
	querySQL := `SELECT s.key, s.title, s.source, s.project_path, s.updated_at,
			COUNT(a.id) AS annotation_count, MAX(a.updated_at) AS last_annotation_at
		FROM ai_sessions s
		JOIN ai_session_annotations a ON a.session_key = s.key` + whereSQL + `
		GROUP BY s.key
		ORDER BY last_annotation_at DESC
		LIMIT ? OFFSET ?`
	args = append(args, limit, offset)
	rows, err := idx.db.QueryContext(ctx, querySQL, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var sessions []AnnotatedSession
	for rows.Next() {
		var session AnnotatedSession
		if err := rows.Scan(&session.Key, &session.Title, &session.Source, &session.ProjectPath,
			&session.UpdatedAt, &session.AnnotationCount, &session.LastAnnotationAt); err != nil {
			return nil, 0, err
		}
		sessions = append(sessions, session)
	}
	return sessions, total, rows.Err()
}

// SetAnnotationAIState is the write-only hook for a future automatic annotation
// pass. M1 never reads it back.
func (idx *SQLiteIndex) SetAnnotationAIState(ctx context.Context, sessionKey string, messageCount int, maxSeq int, requestHash string, model string, status string) error {
	sessionKey = strings.TrimSpace(sessionKey)
	if sessionKey == "" {
		return fmt.Errorf("session key is required")
	}
	_, err := idx.db.ExecContext(ctx,
		`INSERT INTO ai_session_annotation_ai_state
			(session_key, last_message_count, last_max_seq, request_hash, model, status, updated_at)
		 VALUES (?,?,?,?,?,?,?)
		 ON CONFLICT(session_key) DO UPDATE SET
			last_message_count=excluded.last_message_count,
			last_max_seq=excluded.last_max_seq,
			request_hash=excluded.request_hash,
			model=excluded.model,
			status=excluded.status,
			updated_at=excluded.updated_at`,
		sessionKey, messageCount, maxSeq, requestHash, model, status, time.Now().UnixMilli())
	return err
}

// ── Manager wrappers ──

func (m *Manager) withSQLiteIndex(fn func(*SQLiteIndex) error) error {
	idx, err := m.openSQLiteIndex()
	if err != nil {
		return err
	}
	defer idx.Close()
	return fn(idx)
}

// ListAnnotations returns all annotations of one session.
func (m *Manager) ListAnnotations(ctx context.Context, sessionKey string) ([]AnnotationRow, error) {
	var rows []AnnotationRow
	err := m.withSQLiteIndex(func(idx *SQLiteIndex) error {
		var inner error
		rows, inner = idx.ListAnnotations(ctx, sessionKey)
		return inner
	})
	return rows, err
}

// SaveAnnotation creates or updates one annotation.
func (m *Manager) SaveAnnotation(ctx context.Context, row AnnotationRow) (AnnotationRow, error) {
	var result AnnotationRow
	err := m.withSQLiteIndex(func(idx *SQLiteIndex) error {
		var inner error
		result, inner = idx.UpsertAnnotation(ctx, row)
		return inner
	})
	return result, err
}

// DeleteAnnotation removes one annotation.
func (m *Manager) DeleteAnnotation(ctx context.Context, id int64) error {
	return m.withSQLiteIndex(func(idx *SQLiteIndex) error {
		return idx.DeleteAnnotation(ctx, id)
	})
}

// ReplaceReplaceableAnnotations replaces AI-regenerable annotations of a session.
func (m *Manager) ReplaceReplaceableAnnotations(ctx context.Context, sessionKey string, rows []AnnotationRow) ([]AnnotationRow, error) {
	var result []AnnotationRow
	err := m.withSQLiteIndex(func(idx *SQLiteIndex) error {
		var inner error
		result, inner = idx.ReplaceReplaceableAnnotations(ctx, sessionKey, rows)
		return inner
	})
	return result, err
}

// BulkDraftAnnotations accepts or discards draft annotations of one session.
func (m *Manager) BulkDraftAnnotations(ctx context.Context, sessionKey string, ids []int64, action string) (int, error) {
	var affected int
	err := m.withSQLiteIndex(func(idx *SQLiteIndex) error {
		var inner error
		affected, inner = idx.BulkDraftAnnotations(ctx, sessionKey, ids, action)
		return inner
	})
	return affected, err
}

// ListAnnotatedSessions returns the cross-session annotation list.
func (m *Manager) ListAnnotatedSessions(ctx context.Context, filter AnnotatedSessionFilter) ([]AnnotatedSession, int, error) {
	var sessions []AnnotatedSession
	var total int
	err := m.withSQLiteIndex(func(idx *SQLiteIndex) error {
		var inner error
		sessions, total, inner = idx.ListAnnotatedSessions(ctx, filter)
		return inner
	})
	return sessions, total, err
}

// ResolveAnnotationAnchors flags or re-anchors annotations against the current
// message anchors (sent by the frontend, which owns the live message list).
// Re-anchored rows are written back; unresolvable rows are returned orphaned.
func (m *Manager) ResolveAnnotationAnchors(ctx context.Context, sessionKey string, anchors []AnnotationAnchor) ([]AnnotationView, error) {
	rows, err := m.ListAnnotations(ctx, sessionKey)
	if err != nil {
		return nil, err
	}
	points := make([]AnchorPoint, 0, len(anchors))
	for _, anchor := range anchors {
		points = append(points, AnchorPoint{
			AnchorKey: anchor.AnchorKey,
			Seq:       anchor.Seq,
			Role:      anchor.Role,
			Hash:      anchor.Hash,
		})
	}
	views := make([]AnnotationView, 0, len(rows))
	if len(points) == 0 {
		// The caller did not send a live anchor list (e.g. the session has not
		// loaded yet). Do not mark everything orphaned.
		for _, row := range rows {
			views = append(views, row.view(false))
		}
		return views, nil
	}
	_ = m.withSQLiteIndex(func(idx *SQLiteIndex) error {
		for _, row := range rows {
			want := AnchorPoint{AnchorKey: row.AnchorKey, Seq: row.Seq, Hash: row.AnchorHash}
			resolved, ok := PickReanchor(points, want)
			if ok {
				// 两个都要修：换了锚点（key 变）和「key 没变但位置/指纹过期」。
				// 后者是历史遗留：AI 生成的批注只带 anchorKey 落库，seq 恒为 0，
				// 不补写的话时间线圆点点了永远不跳转。
				stalePos := resolved.Seq != row.Seq || (resolved.Hash != "" && resolved.Hash != row.AnchorHash)
				if resolved.AnchorKey != row.AnchorKey || stalePos {
					if err := idx.ReanchorAnnotation(ctx, row.ID, AnnotationAnchor{
						AnchorKey: resolved.AnchorKey,
						Seq:       resolved.Seq,
						Role:      resolved.Role,
						Hash:      resolved.Hash,
					}); err == nil {
						row.AnchorKey = resolved.AnchorKey
						row.Seq = resolved.Seq
						if resolved.Hash != "" {
							row.AnchorHash = resolved.Hash
						}
					}
				}
			}
			orphaned := !ok
			if orphaned && row.AnchorPreview == "" {
				_ = idx.MarkAnnotationAnchorPreview(ctx, row.ID, row.Title+" "+row.Body)
			}
			views = append(views, row.view(orphaned))
		}
		return nil
	})
	return views, nil
}
