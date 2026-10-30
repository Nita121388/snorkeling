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
// (typically ~/.local/share/opencode/opencode.db on Linux/macOS under the XDG
// data home; the Wave-side default probe also covers %LOCALAPPDATA% style
// per-platform installs — see DefaultOpenCodeDBPath).
//
// Real OpenCode schema (verified against opencode 1.18.x):
//
//	session(id, title, directory, path, parent_id, agent, model, time_created, time_updated, ...)
//	    model is JSON: {"id":..., "providerID":..., "variant":...}
//	    parent_id non-empty (and != own id) => this row is a subagent child session
//	message(id, session_id, time_created, time_updated, data)
//	    data is JSON: {"role":"user"|"assistant"|"system", "modelID":..., "providerID":...}
//	part(id, message_id, session_id, time_created, time_updated, data)
//	    data.type in {text, reasoning, patch, tool, step-start, step-finish, compaction, file}
//	    text part: data.text carries the body
//	    tool part: data.tool (name) + data.state.input / data.state.output
//
// The older `session_message(role, content)` shape this provider originally
// targeted does not exist in current OpenCode builds (the table exists but has
// `type/seq/data` columns and, on a live install, zero rows). The legacy
// role/content readers below are retained only as a defensive fallback for
// older databases; the primary path is message + part.
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
// SQLite table/column does not exist, so callers can fall back to a legacy
// schema.
func isOpenCodeNoSuchTableError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "no such table") || strings.Contains(msg, "no such column")
}

// openCodeSessionSelect selects the real OpenCode session columns. Nullable
// columns are COALESCE'd to '' so the scan targets plain strings.
const openCodeSessionSelect = `
SELECT id, title, COALESCE(directory,''), COALESCE(parent_id,''), COALESCE(model,''), time_created, time_updated
FROM session`

func (p *OpenCodeProvider) List(ctx context.Context) ([]SessionSummary, error) {
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	db, err := p.openDB()
	if err != nil {
		return nil, err
	}
	defer db.Close()

	rows, err := db.QueryContext(ctx, openCodeSessionSelect+`
ORDER BY time_updated DESC`)
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
			id          string
			title       string
			directory   string
			parentID    string
			modelJSON   string
			timeCreated int64
			timeUpdated int64
		)
		if err := rows.Scan(&id, &title, &directory, &parentID, &modelJSON, &timeCreated, &timeUpdated); err != nil {
			return summaries, err
		}
		summaries = append(summaries, p.rowToSummary(id, title, directory, parentID, modelJSON, timeCreated, timeUpdated))
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
	row := db.QueryRowContext(ctx, openCodeSessionSelect+`
WHERE id = ?`, sessionID)
	var (
		id          string
		title       string
		directory   string
		parentID    string
		modelJSON   string
		timeCreated int64
		timeUpdated int64
	)
	if err := row.Scan(&id, &title, &directory, &parentID, &modelJSON, &timeCreated, &timeUpdated); err != nil {
		return SessionSummary{}, err
	}
	summary := p.rowToSummary(id, title, directory, parentID, modelJSON, timeCreated, timeUpdated)
	summary.Snippet = p.loadSnippet(ctx, db, sessionID)
	return summary, nil
}

// loadSnippet returns a short content preview: the most recent message that
// carries readable text, truncated to snippetMaxChars. It reads a bounded slice
// of the (message JOIN part) rows so a large session does not pull the whole
// transcript during a scan.
func (p *OpenCodeProvider) loadSnippet(ctx context.Context, db *sql.DB, sessionID string) string {
	rows, err := db.QueryContext(ctx, `
SELECT m.id, m.time_created, p.time_created, p.id, p.data
FROM message m JOIN part p ON p.message_id = m.id
WHERE m.session_id = ?
ORDER BY m.time_created DESC, m.id DESC, p.time_created ASC, p.id ASC
LIMIT 200`, sessionID)
	if err != nil {
		// No message/part tables: fall back to the legacy role/content tables.
		return p.loadSnippetLegacy(ctx, db, sessionID)
	}
	defer rows.Close()
	curMsg := ""
	var sb strings.Builder
	for rows.Next() {
		if ctx.Err() != nil {
			return ""
		}
		var (
			mid    string
			mtc    int64
			ptc    int64
			pid    string
			pdata  string
		)
		if err := rows.Scan(&mid, &mtc, &ptc, &pid, &pdata); err != nil {
			continue
		}
		// Newest message first; once we step into an older message, finalize the
		// current one if it produced text.
		if curMsg != "" && mid != curMsg {
			if text := strings.TrimSpace(sb.String()); text != "" {
				return truncateSummary(text, snippetMaxChars)
			}
			sb.Reset()
		}
		curMsg = mid
		var pm map[string]any
		if json.Unmarshal([]byte(pdata), &pm) != nil {
			continue
		}
		if strValue(pm, "type") != "text" {
			continue
		}
		if t := strValue(pm, "text"); t != "" {
			if sb.Len() > 0 {
				sb.WriteString("\n")
			}
			sb.WriteString(t)
		}
	}
	if err := rows.Err(); err != nil {
		return ""
	}
	if text := strings.TrimSpace(sb.String()); text != "" {
		return truncateSummary(text, snippetMaxChars)
	}
	return ""
}

// parseOpenCodeModel parses the session.model JSON blob into (modelID, providerID).
// Older / odd shapes fall back to the raw string as the model id.
func parseOpenCodeModel(raw string) (modelID, providerID string) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", ""
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return raw, ""
	}
	modelID = strValue(m, "id")
	if modelID == "" {
		modelID = strValue(m, "modelID")
	}
	providerID = strValue(m, "providerID")
	return modelID, providerID
}

func (p *OpenCodeProvider) rowToSummary(id, title, directory, parentID, modelJSON string, timeCreated, timeUpdated int64) SessionSummary {
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

	_, providerID := parseOpenCodeModel(modelJSON)

	summary := SessionSummary{
		ID:          id,
		Source:      SourceOpenCode,
		Title:       title,
		TitleSource: titleSource,
		ProjectPath: directory,
		CreatedAt:   timeCreated,
		UpdatedAt:   timeUpdated,
		FilePath:    p.sessionFilePath(id),
		VendorID:    providerID,
	}
	if parentID != "" && parentID != id {
		summary.Kind = SessionKindSubagent
		summary.ParentKey = StableKey(SourceOpenCode, parentID, p.sessionFilePath(parentID))
	} else {
		summary.Kind = SessionKindSession
	}
	summary.Key = StableKey(summary.Source, summary.ID, summary.FilePath)
	return summary
}

// ocMessage is an intermediate message+parts aggregate.
type ocMessage struct {
	id          string
	timeCreated int64
	role        string
	model       string
	text        string
	tools       []ToolCall
}

// loadConversation reads all messages for a session in order, aggregating text
// parts into each message body and collecting tool parts as ToolCall entries.
func (p *OpenCodeProvider) loadConversation(ctx context.Context, db *sql.DB, sessionID string) ([]*ocMessage, error) {
	mrows, err := db.QueryContext(ctx, `
SELECT id, time_created, data
FROM message
WHERE session_id = ?
ORDER BY time_created ASC, id ASC`, sessionID)
	if err != nil {
		return nil, err
	}
	var msgs []*ocMessage
	index := make(map[string]*ocMessage)
	for mrows.Next() {
		if ctx.Err() != nil {
			mrows.Close()
			return msgs, ctx.Err()
		}
		var (
			id   string
			tc   int64
			data string
		)
		if err := mrows.Scan(&id, &tc, &data); err != nil {
			mrows.Close()
			return msgs, err
		}
		role := ""
		model := ""
		if strings.HasPrefix(strings.TrimSpace(data), "{") {
			var dm map[string]any
			if json.Unmarshal([]byte(data), &dm) == nil {
				role = strValue(dm, "role")
				model = strValue(dm, "modelID")
				if model == "" {
					if mo, ok := dm["model"].(map[string]any); ok {
						model = strValue(mo, "modelID")
						if model == "" {
							model = strValue(mo, "id")
						}
					}
				}
			}
		}
		m := &ocMessage{id: id, timeCreated: tc, role: role, model: model}
		msgs = append(msgs, m)
		index[id] = m
	}
	err = mrows.Err()
	mrows.Close()
	if err != nil {
		return msgs, err
	}

	prows, err := db.QueryContext(ctx, `
SELECT message_id, time_created, id, data
FROM part
WHERE session_id = ?
ORDER BY message_id ASC, time_created ASC, id ASC`, sessionID)
	if err != nil {
		// A message-only DB (no part table) still yields role/text-less messages;
		// callers treat empty text as "no body" and skip them.
		if isOpenCodeNoSuchTableError(err) {
			return msgs, nil
		}
		return nil, err
	}
	defer prows.Close()
	for prows.Next() {
		if ctx.Err() != nil {
			return msgs, ctx.Err()
		}
		var (
			mid   string
			ptc   int64
			pid   string
			pdata string
		)
		if err := prows.Scan(&mid, &ptc, &pid, &pdata); err != nil {
			continue
		}
		m := index[mid]
		if m == nil {
			continue
		}
		var pm map[string]any
		if json.Unmarshal([]byte(pdata), &pm) != nil {
			continue
		}
		switch strValue(pm, "type") {
		case "text":
			if t := strValue(pm, "text"); t != "" {
				if m.text != "" {
					m.text += "\n"
				}
				m.text += t
			}
		case "tool":
			name := strValue(pm, "tool")
			if name == "" {
				name = strValue(pm, "name")
			}
			if name == "" {
				name = "unknown"
			}
			input := pm["input"]
			if state, ok := pm["state"].(map[string]any); ok {
				if v, ok := state["input"]; ok {
					input = v
				}
			}
			m.tools = append(m.tools, ToolCall{
				Name:    name,
				Summary: summarizeToolInput(input),
				ItemKey: strValue(pm, "callID"),
			})
		}
	}
	if err := prows.Err(); err != nil {
		return msgs, err
	}
	return msgs, nil
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

	convo, err := p.loadConversation(ctx, db, sessionID)
	if err != nil {
		if isOpenCodeNoSuchTableError(err) {
			return p.loadMessagesLegacy(ctx, db, sessionID)
		}
		return nil, err
	}
	var messages []Message
	seq := 0
	for _, m := range convo {
		text := strings.TrimSpace(m.text)
		if text == "" {
			continue
		}
		seq++
		messages = append(messages, Message{
			Seq:       seq,
			Role:      normalizeRole(m.role),
			Text:      text,
			Model:     m.model,
			Timestamp: m.timeCreated,
			CharCount: runeCount(text),
		})
	}
	return messages, nil
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

	convo, err := p.loadConversation(ctx, db, sessionID)
	if err != nil {
		if isOpenCodeNoSuchTableError(err) {
			return p.loadToolCallsLegacy(ctx, db, sessionID)
		}
		return nil, err
	}
	var toolCalls []ToolCall
	for _, m := range convo {
		for _, tc := range m.tools {
			tc.Seq = len(toolCalls) + 1
			toolCalls = append(toolCalls, tc)
		}
	}
	return toolCalls, nil
}

// LoadMessageDelta implements MessageDeltaProvider for the SQLite-backed
// OpenCode session. There is no byte stream, so the cursor's LastSeq carries the
// number of messages already delivered and the frame advances that offset. A
// count shrink (session truncated) triggers ResetRequired so the client reloads.
func (p *OpenCodeProvider) LoadMessageDelta(ctx context.Context, filePath string, cursor SessionMessageCursor, maxBytes int64) (MessageDelta, error) {
	_, sessionID, ok := parseSessionFilePath(filePath)
	if !ok || sessionID == "" {
		return MessageDelta{}, fmt.Errorf("opencode provider: cannot parse sessionID from filePath %q", filePath)
	}
	db, err := p.openDB()
	if err != nil {
		return MessageDelta{}, err
	}
	defer db.Close()

	all, err := p.LoadMessages(ctx, filePath)
	if err != nil {
		return MessageDelta{}, err
	}
	total := len(all)
	nextCursor := SessionMessageCursor{FileSize: int64(total), MTime: cursor.MTime}
	if cursor.LastSeq > total {
		nextCursor.LastSeq = 0
		return MessageDelta{Messages: []Message{}, Cursor: nextCursor, ResetRequired: true}, nil
	}
	offset := cursor.LastSeq
	if offset < 0 {
		offset = 0
	}
	maxBytes = normalizeMessageDeltaMaxBytes(maxBytes)

	var frame []Message
	var used int64
	for _, m := range all[offset:] {
		if len(frame) > 0 && used+int64(m.CharCount) > maxBytes {
			break
		}
		frame = append(frame, m)
		used += int64(m.CharCount)
	}
	nextOffset := offset + len(frame)
	nextCursor.LastSeq = nextOffset
	hasMore := nextOffset < total
	if frame == nil {
		frame = []Message{}
	}
	summary := SessionSummary{
		Source:       SourceOpenCode,
		FilePath:     p.sessionFilePath(sessionID),
		MTime:        nextCursor.MTime,
		Size:         nextCursor.FileSize,
		MessageCount: nextOffset,
	}
	return MessageDelta{
		Summary:  summary,
		Messages: frame,
		Cursor:   nextCursor,
		HasMore:  hasMore,
	}, nil
}

// --- legacy role/content fallback (older OpenCode DBs / defensive) ----------

// loadSnippetLegacy reads the last readable message text from the legacy
// role/content tables (session_message or message), mirroring the historical
// snippet logic retained in scanOpenCodeMessages.
func (p *OpenCodeProvider) loadSnippetLegacy(ctx context.Context, db *sql.DB, sessionID string) string {
	rows, err := db.QueryContext(ctx, `
SELECT role, content, time_created
FROM session_message
WHERE session_id = ?
ORDER BY time_created DESC, id DESC
LIMIT 30`, sessionID)
	if err != nil {
		if isOpenCodeNoSuchTableError(err) {
			rows, err = db.QueryContext(ctx, `
SELECT role, content, time_created
FROM message
WHERE session_id = ?
ORDER BY time_created DESC, id DESC
LIMIT 30`, sessionID)
		}
		if err != nil {
			return ""
		}
	}
	defer rows.Close()
	for rows.Next() {
		if ctx.Err() != nil {
			return ""
		}
		var role, content string
		var timestamp int64
		if err := rows.Scan(&role, &content, &timestamp); err != nil {
			return ""
		}
		msg, ok := parseOpenCodeMessageRow(0, role, content, timestamp)
		if !ok {
			continue
		}
		text := strings.TrimSpace(msg.Text)
		if text == "" || strings.HasPrefix(text, "[Tool: ") {
			continue
		}
		return truncateSummary(text, snippetMaxChars)
	}
	return ""
}

func (p *OpenCodeProvider) loadMessagesLegacy(ctx context.Context, db *sql.DB, sessionID string) ([]Message, error) {
	rows, err := db.QueryContext(ctx, `
SELECT role, content, time_created
FROM session_message
WHERE session_id = ?
ORDER BY time_created ASC, id ASC`, sessionID)
	if err != nil {
		rows2, err2 := db.QueryContext(ctx, `
SELECT role, content, time_created
FROM message
WHERE session_id = ?
ORDER BY time_created ASC, id ASC`, sessionID)
		if err2 != nil {
			return nil, nil
		}
		defer rows2.Close()
		return scanOpenCodeMessages(ctx, rows2)
	}
	defer rows.Close()
	return scanOpenCodeMessages(ctx, rows)
}

func (p *OpenCodeProvider) loadToolCallsLegacy(ctx context.Context, db *sql.DB, sessionID string) ([]ToolCall, error) {
	rows, err := db.QueryContext(ctx, `
SELECT role, content
FROM session_message
WHERE session_id = ? AND role = 'assistant'
ORDER BY time_created ASC, id ASC`, sessionID)
	if err != nil {
		rows2, err2 := db.QueryContext(ctx, `
SELECT role, content
FROM message
WHERE session_id = ? AND role = 'assistant'
ORDER BY time_created ASC, id ASC`, sessionID)
		if err2 != nil {
			return nil, nil
		}
		defer rows2.Close()
		return scanOpenCodeToolCalls(ctx, rows2)
	}
	defer rows.Close()
	return scanOpenCodeToolCalls(ctx, rows)
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

// parseOpenCodeMessageRow turns a legacy (role, content, timestamp) DB row into a
// Message. `content` is JSON-ish — a JSON object with role/content, a JSON array
// of content items, or a plain string.
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
