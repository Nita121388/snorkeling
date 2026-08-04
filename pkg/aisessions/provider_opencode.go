// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	_ "modernc.org/sqlite"
)

const SourceOpenCode = "opencode"

// OpenCodeProvider reads AI sessions from a single OpenCode SQLite database
// (typically ~/.cache/opencode/opencode.db or %LOCALAPPDATA%/opencode/opencode.db).
//
// OpenCode schemas:
//   - V2: `session` + `session_message` tables.
//   - V1 fallback: a `message` table is consulted when `session_message` is empty.
//
// FilePath on summaries is the dbPath followed by `#<sessionID>`, so the same
// DB can hold many sessions while keeping a stable key.
type OpenCodeProvider struct {
	dbPath string
}

func NewOpenCodeProvider(dbPath string) *OpenCodeProvider {
	return &OpenCodeProvider{dbPath: dbPath}
}

func (p *OpenCodeProvider) Source() string {
	return SourceOpenCode
}

// openDB opens the OpenCode SQLite DB in read-only mode.
func (p *OpenCodeProvider) openDB() (*sql.DB, error) {
	if p.dbPath == "" {
		return nil, fmt.Errorf("opencode provider: dbPath is empty")
	}
	if _, err := os.Stat(p.dbPath); err != nil {
		return nil, err
	}
	// We do not request _journal_mode=WAL here: this connection is read-only,
	// and modernc.org/sqlite rejects attempts to set WAL on a ro DB. The DB's
	// own journal mode (possibly WAL set by OpenCode's writers) is honoured
	// automatically by SQLite when opening the file.
	dsn := fmt.Sprintf("file:%s?mode=ro&_busy_timeout=5000&txlock=immediate", p.dbPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	return db, nil
}

// sessionFilePath returns the synthetic FilePath used to identify one session
// within the DB. ParseSummary/LoadMessages/LoadToolCalls strip the suffix back.
func (p *OpenCodeProvider) sessionFilePath(sessionID string) string {
	return p.dbPath + "#" + sessionID
}

// parseSessionFilePath returns (dbPath, sessionID, ok). FilePath may also be
// the bare dbPath (no `#`), in which case sessionID is empty.
func parseSessionFilePath(filePath string) (string, string, bool) {
	if filePath == "" {
		return "", "", false
	}
	idx := strings.LastIndex(filePath, "#")
	if idx < 0 {
		return filePath, "", true
	}
	return filePath[:idx], filePath[idx+1:], true
}

// isOpenCodeNoSuchTableError reports whether err indicates the given
// SQLite table does not exist, so callers can fall back to a V1 schema.
func isOpenCodeNoSuchTableError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "no such table")
}

func (p *OpenCodeProvider) List(ctx context.Context) ([]SessionSummary, error) {
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	db, err := p.openDB()
	if err != nil {
		return nil, err
	}
	defer db.Close()

	rows, err := db.QueryContext(ctx, `
SELECT id, title, directory, time_created, time_updated, model_provider, model_id
FROM session
ORDER BY time_updated DESC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var summaries []SessionSummary
	for rows.Next() {
		if ctx.Err() != nil {
			return summaries, ctx.Err()
		}
		var (
			id            string
			title         string
			directory     string
			timeCreated   int64
			timeUpdated   int64
			modelProvider string
			modelID       string
		)
		if err := rows.Scan(&id, &title, &directory, &timeCreated, &timeUpdated, &modelProvider, &modelID); err != nil {
			return summaries, err
		}
		summary := p.rowToSummary(id, title, directory, timeCreated, timeUpdated, modelProvider, modelID)
		summaries = append(summaries, summary)
	}
	if err := rows.Err(); err != nil {
		return summaries, err
	}
	return summaries, nil
}

func (p *OpenCodeProvider) ListFiles(ctx context.Context) ([]SessionFile, error) {
	summaries, err := p.List(ctx)
	if err != nil {
		return nil, err
	}
	mtime, size := fileStatFields(p.dbPath)
	files := make([]SessionFile, 0, len(summaries))
	for _, s := range summaries {
		files = append(files, SessionFile{
			Source: SourceOpenCode,
			Path:   s.FilePath,
			MTime:  mtime,
			Size:   size,
		})
	}
	return files, nil
}

func (p *OpenCodeProvider) ParseSummary(ctx context.Context, file SessionFile) (SessionSummary, bool) {
	if ctx.Err() != nil {
		return SessionSummary{}, false
	}
	_, sessionID, ok := parseSessionFilePath(file.Path)
	if !ok || sessionID == "" {
		return SessionSummary{}, false
	}
	db, err := p.openDB()
	if err != nil {
		return SessionSummary{}, false
	}
	defer db.Close()
	summary, err := p.loadSummaryByID(ctx, db, sessionID)
	if err != nil || summary.ID == "" {
		return SessionSummary{}, false
	}
	return summary, true
}

func (p *OpenCodeProvider) loadSummaryByID(ctx context.Context, db *sql.DB, sessionID string) (SessionSummary, error) {
	row := db.QueryRowContext(ctx, `
SELECT id, title, directory, time_created, time_updated, model_provider, model_id
FROM session
WHERE id = ?
`, sessionID)
	var (
		id            string
		title         string
		directory     string
		timeCreated   int64
		timeUpdated   int64
		modelProvider string
		modelID       string
	)
	if err := row.Scan(&id, &title, &directory, &timeCreated, &timeUpdated, &modelProvider, &modelID); err != nil {
		return SessionSummary{}, err
	}
	return p.rowToSummary(id, title, directory, timeCreated, timeUpdated, modelProvider, modelID), nil
}

func (p *OpenCodeProvider) rowToSummary(id, title, directory string, timeCreated, timeUpdated int64, modelProvider, modelID string) SessionSummary {
	title = normalizeTitle(title)
	titleSource := "source_title"
	if title == "" {
		title = pathBase(directory)
		titleSource = "project"
	}
	if title == "" {
		title = id
		titleSource = "id"
	}

	summary := SessionSummary{
		ID:          id,
		Source:      SourceOpenCode,
		Title:       title,
		TitleSource: titleSource,
		ProjectPath: directory,
		CreatedAt:   timeCreated,
		UpdatedAt:   timeUpdated,
		FilePath:    p.sessionFilePath(id),
		VendorID:    modelProvider,
	}
	summary.Key = StableKey(summary.Source, summary.ID, summary.FilePath)
	return summary
}

func (p *OpenCodeProvider) LoadMessages(ctx context.Context, filePath string) ([]Message, error) {
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	_, sessionID, ok := parseSessionFilePath(filePath)
	if !ok || sessionID == "" {
		return nil, fmt.Errorf("opencode provider: cannot parse sessionID from filePath %q", filePath)
	}
	db, err := p.openDB()
	if err != nil {
		return nil, err
	}
	defer db.Close()

	messages, err := p.loadMessagesV2(ctx, db, sessionID)
	if err != nil {
		return nil, err
	}
	if len(messages) > 0 {
		return messages, nil
	}
	return p.loadMessagesV1(ctx, db, sessionID)
}

func (p *OpenCodeProvider) loadMessagesV2(ctx context.Context, db *sql.DB, sessionID string) ([]Message, error) {
	rows, err := db.QueryContext(ctx, `
SELECT role, content, time_created
FROM session_message
WHERE session_id = ?
ORDER BY time_created ASC, id ASC
`, sessionID)
	if err != nil {
		// V1-only DBs have no session_message table; let the caller fall back.
		if isOpenCodeNoSuchTableError(err) {
			return nil, nil
		}
		return nil, err
	}
	defer rows.Close()
	return scanOpenCodeMessages(ctx, rows)
}

// loadMessagesV1 is the terminal fallback in the V2→V1 chain: its errors propagate
// (unlike loadMessagesV2 which swallows `no such table`), because there is no
// further schema to retry against.
func (p *OpenCodeProvider) loadMessagesV1(ctx context.Context, db *sql.DB, sessionID string) ([]Message, error) {
	rows, err := db.QueryContext(ctx, `
SELECT role, content, time_created
FROM message
WHERE session_id = ?
ORDER BY time_created ASC, id ASC
`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanOpenCodeMessages(ctx, rows)
}

func scanOpenCodeMessages(ctx context.Context, rows *sql.Rows) ([]Message, error) {
	var messages []Message
	seq := 0
	for rows.Next() {
		if ctx.Err() != nil {
			return messages, ctx.Err()
		}
		var role, content string
		var timestamp int64
		if err := rows.Scan(&role, &content, &timestamp); err != nil {
			return messages, err
		}
		msg, ok := parseOpenCodeMessageRow(seq+1, role, content, timestamp)
		if !ok {
			continue
		}
		seq++
		messages = append(messages, msg)
	}
	if err := rows.Err(); err != nil {
		return messages, err
	}
	return messages, nil
}

// parseOpenCodeMessageRow turns a (role, content, timestamp) DB row into a Message.
// `content` is JSON-ish — either a JSON object with role/content, or a JSON array of
// content items, or a plain string. We re-use extractText/normalizeRole for parity
// with the codex/claude providers.
func parseOpenCodeMessageRow(seq int, role, content string, timestamp int64) (Message, bool) {
	text := content
	roleStr := normalizeRole(role)
	if strings.HasPrefix(strings.TrimSpace(content), "{") {
		var value map[string]any
		if err := json.Unmarshal([]byte(content), &value); err == nil {
			if explicitRole := strValue(value, "role"); explicitRole != "" {
				roleStr = normalizeRole(explicitRole)
			}
			text = extractText(value["content"])
		}
	} else if strings.HasPrefix(strings.TrimSpace(content), "[") {
		var items []any
		if err := json.Unmarshal([]byte(content), &items); err == nil {
			text = extractText(items)
		}
	}

	if strings.TrimSpace(text) == "" {
		return Message{}, false
	}
	return Message{
		Seq:       seq,
		Role:      roleStr,
		Text:      text,
		Timestamp: timestamp,
		CharCount: runeCount(text),
	}, true
}

func (p *OpenCodeProvider) LoadToolCalls(ctx context.Context, filePath string) ([]ToolCall, error) {
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	_, sessionID, ok := parseSessionFilePath(filePath)
	if !ok || sessionID == "" {
		return nil, fmt.Errorf("opencode provider: cannot parse sessionID from filePath %q", filePath)
	}
	db, err := p.openDB()
	if err != nil {
		return nil, err
	}
	defer db.Close()

	toolCalls, err := p.loadToolCallsV2(ctx, db, sessionID)
	if err != nil {
		return nil, err
	}
	if len(toolCalls) > 0 {
		return toolCalls, nil
	}
	return p.loadToolCallsV1(ctx, db, sessionID)
}

func (p *OpenCodeProvider) loadToolCallsV2(ctx context.Context, db *sql.DB, sessionID string) ([]ToolCall, error) {
	rows, err := db.QueryContext(ctx, `
SELECT role, content
FROM session_message
WHERE session_id = ? AND role = 'assistant'
ORDER BY time_created ASC, id ASC
`, sessionID)
	if err != nil {
		// V1-only DBs have no session_message table; let the caller fall back.
		if isOpenCodeNoSuchTableError(err) {
			return nil, nil
		}
		return nil, err
	}
	defer rows.Close()
	return scanOpenCodeToolCalls(ctx, rows)
}

func (p *OpenCodeProvider) loadToolCallsV1(ctx context.Context, db *sql.DB, sessionID string) ([]ToolCall, error) {
	rows, err := db.QueryContext(ctx, `
SELECT role, content
FROM message
WHERE session_id = ? AND role = 'assistant'
ORDER BY time_created ASC, id ASC
`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanOpenCodeToolCalls(ctx, rows)
}

func scanOpenCodeToolCalls(ctx context.Context, rows *sql.Rows) ([]ToolCall, error) {
	var toolCalls []ToolCall
	for rows.Next() {
		if ctx.Err() != nil {
			return toolCalls, ctx.Err()
		}
		var role, content string
		if err := rows.Scan(&role, &content); err != nil {
			return toolCalls, err
		}
		toolCalls = appendOpenCodeToolCalls(toolCalls, content)
	}
	if err := rows.Err(); err != nil {
		return toolCalls, err
	}
	return toolCalls, nil
}

// appendOpenCodeToolCalls parses the assistant message content for toolcall items and appends them.
func appendOpenCodeToolCalls(toolCalls []ToolCall, content string) []ToolCall {
	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return toolCalls
	}
	var items []any
	if strings.HasPrefix(trimmed, "{") {
		var value map[string]any
		if err := json.Unmarshal([]byte(trimmed), &value); err != nil {
			return toolCalls
		}
		rawItems, ok := value["content"].([]any)
		if !ok {
			return toolCalls
		}
		items = rawItems
	} else if strings.HasPrefix(trimmed, "[") {
		if err := json.Unmarshal([]byte(trimmed), &items); err != nil {
			return toolCalls
		}
	} else {
		return toolCalls
	}

	for _, item := range items {
		itemMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if strValue(itemMap, "type") != "toolcall" {
			continue
		}
		name := strValue(itemMap, "name")
		if name == "" {
			name = "unknown"
		}
		toolCalls = append(toolCalls, ToolCall{
			Seq:     len(toolCalls) + 1,
			Name:    name,
			Summary: summarizeToolInput(itemMap["args"]),
		})
	}
	return toolCalls
}
