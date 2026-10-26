// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AI 调用审计：记录每一次 AI 生成（标题 / note+tags / 批注时间线 / 批注字段）
// 的入队、执行、结果与原文，并提供「重试」能力。
//
// 设计约束：
//   - 记录与执行解耦：recorder 只在状态跃迁时被调用，AI 路径不变；
//   - 原文可选：rawRequest/rawResponse 由调用方决定是否附带（默认带，
//     超限截断并标记）；
//   - 单表 + 两个索引，查询只走 created_at / session_key。

package aisessions

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// Audit feature values.
const (
	AuditFeatureTitle              = "title"
	AuditFeatureMetadata           = "metadata"
	AuditFeatureAnnotationTimeline = "annotation-timeline"
	AuditFeatureAnnotationField    = "annotation-field"
)

// Audit state values.
const (
	AuditStateQueued    = "queued"
	AuditStateRunning   = "running"
	AuditStateDone      = "done"
	AuditStateFailed    = "failed"
	AuditStateCancelled = "cancelled"
)

// AuditTrigger values.
const (
	AuditTriggerManual = "manual"
	AuditTriggerAuto   = "auto"
)

// AuditRawMaxChars caps one stored raw payload so a runaway transcript cannot
// bloat the table.
const AuditRawMaxChars = 200_000

// AuditLogRow is the storage shape.
type AuditLogRow struct {
	ID           int64  `db:"id"`
	Feature      string `db:"feature"`
	Scope        string `db:"scope"`
	SessionKey   string `db:"session_key"`
	SessionTitle string `db:"session_title"`
	Connection   string `db:"connection"`
	Trigger      string `db:"trigger"`
	State        string `db:"state"`
	AIModel      string `db:"ai_model"`
	JobID        string `db:"job_id"`
	AnchorTotal  int    `db:"anchor_total"`
	AnchorKept   int    `db:"anchor_kept"`
	ResultCount  int    `db:"result_count"`
	DurationMs   int64  `db:"duration_ms"`
	Error        string `db:"error"`
	RawRequest   string `db:"raw_request"`
	RawResponse  string `db:"raw_response"`
	RawTruncated bool   `db:"raw_truncated"`
	CreatedAt    int64  `db:"created_at"`
	UpdatedAt    int64  `db:"updated_at"`
}

// AuditView is the RPC shape (same fields, JSON tags).
type AuditView struct {
	ID           int64  `json:"id"`
	Feature      string `json:"feature"`
	Scope        string `json:"scope"`
	SessionKey   string `json:"sessionKey"`
	SessionTitle string `json:"sessionTitle"`
	Connection   string `json:"connection"`
	Trigger      string `json:"trigger"`
	State        string `json:"state"`
	AIModel      string `json:"aiModel"`
	JobID        string `json:"jobId"`
	AnchorTotal  int    `json:"anchorTotal"`
	AnchorKept   int    `json:"anchorKept"`
	ResultCount  int    `json:"resultCount"`
	DurationMs   int64  `json:"durationMs"`
	Error        string `json:"error"`
	RawRequest   string `json:"rawRequest,omitempty"`
	RawResponse  string `json:"rawResponse,omitempty"`
	RawTruncated bool   `json:"rawTruncated"`
	CreatedAt    int64  `json:"createdAt"`
	UpdatedAt    int64  `json:"updatedAt"`
}

// AuditInput describes one attempt when it starts.
type AuditInput struct {
	Feature     string
	Scope       string
	SessionKey  string
	Connection  string
	Trigger     string
	AIModel     string
	JobID       string
	AnchorTotal int
	RawRequest  string
}

// AuditResult describes the outcome of an attempt.
type AuditResult struct {
	State       string
	AIModel     string
	ResultCount int
	AnchorKept  int
	Error       string
	DurationMs  int64
	RawResponse string
}

type AuditFilter struct {
	Feature    string
	State      string
	SessionKey string
	Query      string
	Limit      int
	Offset     int
}

const auditColumns = `id, feature, scope, session_key, session_title, connection, trigger, state,
	ai_model, job_id, anchor_total, anchor_kept, result_count, duration_ms, error,
	raw_request, raw_response, raw_truncated, created_at, updated_at`

func (row AuditLogRow) view() AuditView {
	return AuditView{
		ID:           row.ID,
		Feature:      row.Feature,
		Scope:        row.Scope,
		SessionKey:   row.SessionKey,
		SessionTitle: row.SessionTitle,
		Connection:   row.Connection,
		Trigger:      row.Trigger,
		State:        row.State,
		AIModel:      row.AIModel,
		JobID:        row.JobID,
		AnchorTotal:  row.AnchorTotal,
		AnchorKept:   row.AnchorKept,
		ResultCount:  row.ResultCount,
		DurationMs:   row.DurationMs,
		Error:        row.Error,
		RawRequest:   row.RawRequest,
		RawResponse:  row.RawResponse,
		RawTruncated: row.RawTruncated,
		CreatedAt:    row.CreatedAt,
		UpdatedAt:    row.UpdatedAt,
	}
}

func clampAuditRaw(text string) (string, bool) {
	if text == "" {
		return "", false
	}
	runes := []rune(text)
	if len(runes) <= AuditRawMaxChars {
		return text, false
	}
	return string(runes[:AuditRawMaxChars]) + "\n…[truncated]", true
}

// ensureAuditTable creates the audit table for old databases (CREATE TABLE IF
// NOT EXISTS in init already covers new ones).
func (idx *SQLiteIndex) ensureAuditTable(ctx context.Context) error {
	_, err := idx.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS ai_audit_log (
		id            INTEGER PRIMARY KEY AUTOINCREMENT,
		feature       TEXT NOT NULL DEFAULT '',
		scope         TEXT NOT NULL DEFAULT '',
		session_key   TEXT NOT NULL DEFAULT '',
		session_title TEXT NOT NULL DEFAULT '',
		connection    TEXT NOT NULL DEFAULT '',
		trigger       TEXT NOT NULL DEFAULT 'manual',
		state         TEXT NOT NULL DEFAULT 'queued',
		ai_model      TEXT NOT NULL DEFAULT '',
		job_id        TEXT NOT NULL DEFAULT '',
		anchor_total  INTEGER NOT NULL DEFAULT 0,
		anchor_kept   INTEGER NOT NULL DEFAULT 0,
		result_count  INTEGER NOT NULL DEFAULT 0,
		duration_ms   INTEGER NOT NULL DEFAULT 0,
		error         TEXT NOT NULL DEFAULT '',
		raw_request   TEXT NOT NULL DEFAULT '',
		raw_response  TEXT NOT NULL DEFAULT '',
		raw_truncated INTEGER NOT NULL DEFAULT 0,
		created_at    INTEGER NOT NULL,
		updated_at    INTEGER NOT NULL
	)`)
	return err
}

// ── Manager wrappers ──

// AuditBegin records the start of one AI attempt.
func (m *Manager) AuditBegin(ctx context.Context, in AuditInput) (int64, error) {
	var id int64
	err := m.withSQLiteIndex(func(idx *SQLiteIndex) error {
		var inner error
		id, inner = idx.AuditBegin(ctx, in)
		return inner
	})
	return id, err
}

// AuditFinish records the outcome of one AI attempt.
func (m *Manager) AuditFinish(ctx context.Context, id int64, result AuditResult) error {
	if id <= 0 {
		return nil
	}
	return m.withSQLiteIndex(func(idx *SQLiteIndex) error {
		return idx.AuditFinish(ctx, id, result)
	})
}

// AuditList returns recent audit entries.
func (m *Manager) AuditList(ctx context.Context, filter AuditFilter) ([]AuditView, int, error) {
	var views []AuditView
	var total int
	err := m.withSQLiteIndex(func(idx *SQLiteIndex) error {
		rows, count, inner := idx.listAuditLogs(ctx, filter)
		if inner != nil {
			return inner
		}
		total = count
		views = make([]AuditView, 0, len(rows))
		for _, row := range rows {
			views = append(views, row.view())
		}
		return nil
	})
	return views, total, err
}

// AuditGet returns one audit entry including raw payloads.
func (m *Manager) AuditGet(ctx context.Context, id int64) (AuditView, error) {
	var view AuditView
	err := m.withSQLiteIndex(func(idx *SQLiteIndex) error {
		row, inner := idx.getAuditLog(ctx, id)
		if inner != nil {
			return inner
		}
		view = row.view()
		return nil
	})
	return view, err
}

// AuditStats returns 24h aggregates.
func (m *Manager) AuditStats(ctx context.Context) (AuditStatsResult, error) {
	var stats AuditStatsResult
	err := m.withSQLiteIndex(func(idx *SQLiteIndex) error {
		var inner error
		stats, inner = idx.AuditStats(ctx)
		return inner
	})
	return stats, err
}

// AuditClear removes entries older than the cutoff.
func (m *Manager) AuditClear(ctx context.Context, before int64) (int, error) {
	var removed int
	err := m.withSQLiteIndex(func(idx *SQLiteIndex) error {
		var inner error
		removed, inner = idx.deleteAuditLogs(ctx, before)
		return inner
	})
	return removed, err
}

// AuditBegin inserts a queued row and returns its id.
func (idx *SQLiteIndex) AuditBegin(ctx context.Context, in AuditInput) (int64, error) {
	if err := idx.ensureAuditTable(ctx); err != nil {
		return 0, err
	}
	feature := strings.TrimSpace(in.Feature)
	if feature == "" {
		return 0, fmt.Errorf("audit feature is required")
	}
	trigger := strings.TrimSpace(in.Trigger)
	if trigger == "" {
		trigger = AuditTriggerManual
	}
	rawRequest, truncated := clampAuditRaw(in.RawRequest)
	now := time.Now().UnixMilli()
	result, err := idx.db.ExecContext(ctx,
		`INSERT INTO ai_audit_log
			(feature, scope, session_key, session_title, connection, trigger, state, ai_model, job_id,
			 anchor_total, anchor_kept, result_count, duration_ms, error, raw_request, raw_response,
			 raw_truncated, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?,0,0,0,'',?,'',?,?,?)`,
		feature, in.Scope, in.SessionKey, "", in.Connection, trigger, AuditStateQueued,
		in.AIModel, in.JobID, in.AnchorTotal, rawRequest, boolToAuditInt(truncated), now, now)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func boolToAuditInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

// AuditFinish updates an existing row with the outcome.
func (idx *SQLiteIndex) AuditFinish(ctx context.Context, id int64, result AuditResult) error {
	if id <= 0 {
		return nil
	}
	state := strings.TrimSpace(result.State)
	if state == "" {
		state = AuditStateDone
	}
	rawResponse, truncated := clampAuditRaw(result.RawResponse)
	_, err := idx.db.ExecContext(ctx,
		`UPDATE ai_audit_log SET state=?, ai_model=?, result_count=?, anchor_kept=?, duration_ms=?,
			error=?, raw_response=?, raw_truncated=?, updated_at=? WHERE id=?`,
		state, result.AIModel, result.ResultCount, result.AnchorKept, result.DurationMs,
		result.Error, rawResponse, boolToAuditInt(truncated), time.Now().UnixMilli(), id)
	return err
}

func (idx *SQLiteIndex) getAuditLog(ctx context.Context, id int64) (AuditLogRow, error) {
	var row AuditLogRow
	err := idx.db.GetContext(ctx, &row,
		`SELECT `+auditColumns+` FROM ai_audit_log WHERE id = ?`, id)
	return row, err
}

func (idx *SQLiteIndex) listAuditLogs(ctx context.Context, filter AuditFilter) ([]AuditLogRow, int, error) {
	where := []string{"1=1"}
	args := []any{}
	if feature := strings.TrimSpace(filter.Feature); feature != "" {
		where = append(where, "feature = ?")
		args = append(args, feature)
	}
	if state := strings.TrimSpace(filter.State); state != "" {
		where = append(where, "state = ?")
		args = append(args, state)
	}
	if key := strings.TrimSpace(filter.SessionKey); key != "" {
		where = append(where, "session_key = ?")
		args = append(args, key)
	}
	if query := strings.TrimSpace(filter.Query); query != "" {
		where = append(where, "(session_title LIKE ? OR error LIKE ? OR ai_model LIKE ?)")
		pattern := "%" + strings.ToLower(query) + "%"
		args = append(args, pattern, pattern, pattern)
	}
	whereSQL := " WHERE " + strings.Join(where, " AND ")

	var total int
	if err := idx.db.GetContext(ctx, &total, `SELECT COUNT(*) FROM ai_audit_log`+whereSQL, args...); err != nil {
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
	args = append(args, limit, offset)
	rows, err := idx.db.QueryContext(ctx,
		`SELECT `+auditColumns+` FROM ai_audit_log`+whereSQL+` ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
		args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var result []AuditLogRow
	for rows.Next() {
		var row AuditLogRow
		if err := rows.Scan(&row.ID, &row.Feature, &row.Scope, &row.SessionKey, &row.SessionTitle,
			&row.Connection, &row.Trigger, &row.State, &row.AIModel, &row.JobID, &row.AnchorTotal,
			&row.AnchorKept, &row.ResultCount, &row.DurationMs, &row.Error, &row.RawRequest,
			&row.RawResponse, &row.RawTruncated, &row.CreatedAt, &row.UpdatedAt); err != nil {
			return nil, 0, err
		}
		result = append(result, row)
	}
	return result, total, rows.Err()
}

// AuditStats aggregates recent activity for the block header.
func (idx *SQLiteIndex) AuditStats(ctx context.Context) (AuditStatsResult, error) {
	var stats AuditStatsResult
	since := time.Now().Add(-24 * time.Hour).UnixMilli()
	row := struct {
		Total  int   `db:"total"`
		Failed int   `db:"failed"`
		Done   int   `db:"done"`
		AvgMs  int64 `db:"avg_ms"`
		Oldest int64 `db:"oldest"`
	}{}
	err := idx.db.GetContext(ctx, &row, `SELECT COUNT(*) AS total,
		SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END) AS failed,
		SUM(CASE WHEN state='done' THEN 1 ELSE 0 END) AS done,
		CAST(COALESCE(AVG(duration_ms),0) AS INTEGER) AS avg_ms,
		COALESCE(MIN(created_at),0) AS oldest
		FROM ai_audit_log WHERE created_at >= ?`, since)
	if err != nil {
		return stats, err
	}
	stats.Total24h = row.Total
	stats.Failed24h = row.Failed
	stats.Done24h = row.Done
	stats.AvgDurationMs = row.AvgMs
	featureRows, err := idx.db.QueryContext(ctx,
		`SELECT feature, COUNT(*) AS c FROM ai_audit_log WHERE created_at >= ? GROUP BY feature ORDER BY c DESC`, since)
	if err != nil {
		return stats, err
	}
	defer featureRows.Close()
	for featureRows.Next() {
		var feature string
		var count int
		if err := featureRows.Scan(&feature, &count); err != nil {
			return stats, err
		}
		stats.ByFeature = append(stats.ByFeature, AuditFeatureCount{Feature: feature, Count: count})
	}
	return stats, featureRows.Err()
}

type AuditFeatureCount struct {
	Feature string `json:"feature"`
	Count   int    `json:"count"`
}

type AuditStatsResult struct {
	Total24h      int                 `json:"total24h"`
	Failed24h     int                 `json:"failed24h"`
	Done24h       int                 `json:"done24h"`
	AvgDurationMs int64               `json:"avgDurationMs"`
	ByFeature     []AuditFeatureCount `json:"byFeature"`
}

func (idx *SQLiteIndex) deleteAuditLogs(ctx context.Context, before int64) (int, error) {
	if before <= 0 {
		before = time.Now().Add(-30 * 24 * time.Hour).UnixMilli()
	}
	result, err := idx.db.ExecContext(ctx, `DELETE FROM ai_audit_log WHERE created_at < ?`, before)
	if err != nil {
		return 0, err
	}
	affected, _ := result.RowsAffected()
	return int(affected), nil
}
