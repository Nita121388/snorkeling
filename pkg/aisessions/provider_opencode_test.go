// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

// opencodeMessageRowV2 holds one legacy (role/content) row used for the
// session_message fallback fixture.
type opencodeMessageRowV2 struct {
	SessionID string
	Role      string
	Content   string
	Time      int64
	ToolCall  string // nullable JSON
}

// opencodeSessionRow holds one row of the real OpenCode `session` table.
type opencodeSessionRow struct {
	ID          string
	Title       string
	Directory   string
	ParentID    string
	ModelJSON   string
	TimeCreated int64
	TimeUpdated int64
}

// opencodeMessageRow models a row of the real `message` table.
type opencodeMessageRow struct {
	ID          string
	SessionID   string
	Role        string
	ModelID     string
	TimeCreated int64
}

// opencodePartRow models a row of the real `part` table.
type opencodePartRow struct {
	ID          string
	MessageID   string
	SessionID   string
	Type        string // text | tool | reasoning | ...
	Text        string // set when Type==text
	Tool        string // set when Type==tool (tool name)
	Input       string // set when Type==tool (JSON input)
	TimeCreated int64
}

// createTestOpenCodeDBV2 builds an in-memory SQLite DB with the real OpenCode
// schema (session + message + part) plus a legacy session_message table carrying
// role/content rows so the fallback readers can be exercised.
func createTestOpenCodeDBV2(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open in-memory sqlite: %v", err)
	}
	_, err = db.Exec(`
CREATE TABLE session (
	id TEXT PRIMARY KEY,
	title TEXT NOT NULL DEFAULT '',
	directory TEXT NOT NULL DEFAULT '',
	parent_id TEXT NOT NULL DEFAULT '',
	model TEXT NOT NULL DEFAULT '',
	time_created INTEGER NOT NULL DEFAULT 0,
	time_updated INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE message (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	time_created INTEGER NOT NULL DEFAULT 0,
	time_updated INTEGER NOT NULL DEFAULT 0,
	data TEXT NOT NULL
);
CREATE TABLE part (
	id TEXT PRIMARY KEY,
	message_id TEXT NOT NULL,
	session_id TEXT NOT NULL,
	time_created INTEGER NOT NULL DEFAULT 0,
	time_updated INTEGER NOT NULL DEFAULT 0,
	data TEXT NOT NULL
);
CREATE TABLE session_message (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	role TEXT NOT NULL,
	content TEXT NOT NULL DEFAULT '',
	time_created INTEGER NOT NULL DEFAULT 0,
	tool_call TEXT
);
`)
	if err != nil {
		db.Close()
		t.Fatalf("create schema: %v", err)
	}

	sessions := []opencodeSessionRow{
		{ID: "session-1", Title: "First session", Directory: "/tmp/project-a", ParentID: "", ModelJSON: `{"id":"claude-sonnet-4","providerID":"anthropic"}`, TimeCreated: 1732800000, TimeUpdated: 1732800600},
		{ID: "session-2", Title: "Sub session", Directory: "/tmp/project-b", ParentID: "session-1", ModelJSON: `{"id":"gpt-4o","providerID":"openai"}`, TimeCreated: 1732900000, TimeUpdated: 1732900600},
	}
	for _, r := range sessions {
		_, err = db.Exec(`INSERT INTO session (id, title, directory, parent_id, model, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			r.ID, r.Title, r.Directory, r.ParentID, r.ModelJSON, r.TimeCreated, r.TimeUpdated)
		if err != nil {
			db.Close()
			t.Fatalf("insert session: %v", err)
		}
	}

	messages := []opencodeMessageRow{
		{ID: "m1", SessionID: "session-1", Role: "user", ModelID: "claude-sonnet-4", TimeCreated: 1732800010},
		{ID: "m2", SessionID: "session-1", Role: "assistant", ModelID: "claude-sonnet-4", TimeCreated: 1732800020},
		{ID: "m3", SessionID: "session-2", Role: "user", ModelID: "gpt-4o", TimeCreated: 1732900010},
		{ID: "m4", SessionID: "session-2", Role: "assistant", ModelID: "gpt-4o", TimeCreated: 1732900020},
	}
	for _, m := range messages {
		data := fmt.Sprintf(`{"role":%q,"modelID":%q}`, m.Role, m.ModelID)
		_, err = db.Exec(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`,
			m.ID, m.SessionID, m.TimeCreated, m.TimeCreated, data)
		if err != nil {
			db.Close()
			t.Fatalf("insert message: %v", err)
		}
	}

	parts := []opencodePartRow{
		{ID: "p1", MessageID: "m1", SessionID: "session-1", Type: "text", Text: "plan the work", TimeCreated: 1732800011},
		{ID: "p2", MessageID: "m2", SessionID: "session-1", Type: "text", Text: "_OK", TimeCreated: 1732800021},
		{ID: "p3", MessageID: "m2", SessionID: "session-1", Type: "tool", Tool: "shell", Input: `{"cmd":"ls"}`, TimeCreated: 1732800022},
		{ID: "p4", MessageID: "m3", SessionID: "session-2", Type: "text", Text: "review the work", TimeCreated: 1732900011},
		{ID: "p5", MessageID: "m4", SessionID: "session-2", Type: "text", Text: "done", TimeCreated: 1732900021},
		{ID: "p6", MessageID: "m4", SessionID: "session-2", Type: "reasoning", Text: "thinking...", TimeCreated: 1732900022},
	}
	for _, pt := range parts {
		var data string
		switch pt.Type {
		case "text":
			data = fmt.Sprintf(`{"type":"text","text":%q}`, pt.Text)
		case "tool":
			data = fmt.Sprintf(`{"type":"tool","tool":%q,"state":{"input":%s}}`, pt.Tool, pt.Input)
		case "reasoning":
			data = fmt.Sprintf(`{"type":"reasoning","text":%q}`, pt.Text)
		}
		_, err = db.Exec(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`,
			pt.ID, pt.MessageID, pt.SessionID, pt.TimeCreated, pt.TimeCreated, data)
		if err != nil {
			db.Close()
			t.Fatalf("insert part: %v", err)
		}
	}

	// Legacy role/content rows for the fallback path (session_message).
	legacy := []opencodeMessageRowV2{
		{SessionID: "session-1", Role: "user", Content: `{"role":"user","content":"legacy request"}`, Time: 1732800010},
		{SessionID: "session-1", Role: "assistant", Content: `{"role":"assistant","content":"legacy response"}`, Time: 1732800030},
	}
	for _, m := range legacy {
		_, err = db.Exec(`INSERT INTO session_message (id, session_id, role, content, time_created, tool_call) VALUES (?, ?, ?, ?, ?, ?)`,
			fmt.Sprintf("%s-%d", m.SessionID, m.Time), m.SessionID, m.Role, m.Content, m.Time, nil)
		if err != nil {
			db.Close()
			t.Fatalf("insert session_message: %v", err)
		}
	}

	return db
}

// createTestOpenCodeDBV1 builds an in-memory SQLite DB using only the legacy
// `message(role, content)` table (no message/part), to exercise the legacy
// fallback reader.
func createTestOpenCodeDBV1(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open in-memory sqlite: %v", err)
	}
	_, err = db.Exec(`
CREATE TABLE session (
	id TEXT PRIMARY KEY,
	title TEXT NOT NULL DEFAULT '',
	directory TEXT NOT NULL DEFAULT '',
	parent_id TEXT NOT NULL DEFAULT '',
	model TEXT NOT NULL DEFAULT '',
	time_created INTEGER NOT NULL DEFAULT 0,
	time_updated INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE message (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	role TEXT NOT NULL,
	content TEXT NOT NULL DEFAULT '',
	time_created INTEGER NOT NULL DEFAULT 0
);
`)
	if err != nil {
		db.Close()
		t.Fatalf("create schema: %v", err)
	}

	_, err = db.Exec(`INSERT INTO session (id, title, directory, model, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?)`,
		"session-1", "First session", "/tmp/project-a", `{"id":"claude-sonnet-4","providerID":"anthropic"}`, 1732800000, 1732800600)
	if err != nil {
		db.Close()
		t.Fatalf("insert session: %v", err)
	}
	_, err = db.Exec(`INSERT INTO message (id, session_id, role, content, time_created) VALUES (?, ?, ?, ?, ?)`,
		"msg-1", "session-1", "user", `{"role":"user","content":"planner request"}`, 1732800010)
	if err != nil {
		db.Close()
		t.Fatalf("insert message: %v", err)
	}
	_, err = db.Exec(`INSERT INTO message (id, session_id, role, content, time_created) VALUES (?, ?, ?, ?, ?)`,
		"msg-2", "session-1", "assistant", `{"role":"assistant","content":"planner response"}`, 1732800020)
	if err != nil {
		db.Close()
		t.Fatalf("insert message: %v", err)
	}
	return db
}

func nullableString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// persistDBToTempFile dumps an in-memory DB to a temp .sqlite file so it can be opened read-only by the provider.
func persistDBToTempFile(t *testing.T, db *sql.DB) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "opencode.db")
	// SQLite identifiers use '' to escape a single quote.
	quotedPath := strings.ReplaceAll(path, "'", "''")
	if _, err := db.Exec(fmt.Sprintf("VACUUM INTO '%s'", quotedPath)); err != nil {
		t.Fatalf("vacuum into: %v", err)
	}
	return path
}

func TestOpenCodeProvider_ListV2(t *testing.T) {
	db := createTestOpenCodeDBV2(t)
	defer db.Close()
	path := persistDBToTempFile(t, db)

	p := NewOpenCodeProvider(path)
	summaries, err := p.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(summaries) != 2 {
		t.Fatalf("expected 2 summaries, got %d: %#v", len(summaries), summaries)
	}

	prefix := map[string]int{"session-1": -1, "session-2": -1}
	for _, s := range summaries {
		prefix[s.ID]++
	}
	for id, count := range prefix {
		if count < 0 {
			t.Fatalf("missing %s from summaries: %#v", id, summaries)
		}
		if count > 0 {
			t.Fatalf("duplicate %s in summaries: %#v", id, summaries)
		}
	}

	for _, s := range summaries {
		if s.Source != "opencode" {
			t.Fatalf("expected source opencode, got %q", s.Source)
		}
		if s.ID != "session-1" && s.ID != "session-2" {
			t.Fatalf("unexpected session id %q", s.ID)
		}
	}
}

func TestOpenCodeProvider_ParseSummaryV2(t *testing.T) {
	db := createTestOpenCodeDBV2(t)
	defer db.Close()
	path := persistDBToTempFile(t, db)

	p := NewOpenCodeProvider(path)
	summary, ok := p.ParseSummary(context.Background(), SessionFile{Source: SourceOpenCode, Path: p.sessionFilePath("session-1")})
	if !ok {
		t.Fatalf("expected ParseSummary to return ok for session-1")
	}
	if summary.ID != "session-1" {
		t.Fatalf("unexpected id: %q", summary.ID)
	}
	if summary.Source != SourceOpenCode {
		t.Fatalf("expected source %q, got %q", SourceOpenCode, summary.Source)
	}
	if summary.FilePath == "" {
		t.Fatalf("expected non-empty FilePath")
	}
	if summary.Key == "" {
		t.Fatalf("expected non-empty Key")
	}
	// session-1's last message is the assistant reply "_OK" (the toolcall item
	// carries no readable text), so it must surface as the snippet.
	if summary.Snippet != "_OK" {
		t.Fatalf("expected snippet %q, got %q", "_OK", summary.Snippet)
	}
}

func TestOpenCodeProvider_ParseSummarySnippetV1(t *testing.T) {
	db := createTestOpenCodeDBV1(t)
	defer db.Close()
	path := persistDBToTempFile(t, db)

	p := NewOpenCodeProvider(path)
	summary, ok := p.ParseSummary(context.Background(), SessionFile{Source: SourceOpenCode, Path: p.sessionFilePath("session-1")})
	if !ok {
		t.Fatalf("expected ParseSummary to return ok for session-1")
	}
	// V1 fallback: last message in the `message` table is "planner response".
	if summary.Snippet != "planner response" {
		t.Fatalf("expected snippet %q, got %q", "planner response", summary.Snippet)
	}
}

func TestOpenCodeProvider_ParseSummaryRoundTripsList(t *testing.T) {
	db := createTestOpenCodeDBV2(t)
	defer db.Close()
	path := persistDBToTempFile(t, db)

	p := NewOpenCodeProvider(path)
	files, err := p.ListFiles(context.Background())
	if err != nil {
		t.Fatalf("ListFiles: %v", err)
	}
	for _, f := range files {
		summary, ok := p.ParseSummary(context.Background(), f)
		if !ok {
			t.Fatalf("ParseSummary failed for %#v", f)
		}
		if summary.ID == "" || summary.Source != SourceOpenCode {
			t.Fatalf("unexpected summary: %#v", summary)
		}
	}
}

func TestOpenCodeProvider_ListFilesV2(t *testing.T) {
	db := createTestOpenCodeDBV2(t)
	defer db.Close()
	path := persistDBToTempFile(t, db)

	p := NewOpenCodeProvider(path)
	files, err := p.ListFiles(context.Background())
	if err != nil {
		t.Fatalf("ListFiles: %v", err)
	}
	if len(files) != 2 {
		t.Fatalf("expected 2 files, got %d", len(files))
	}
	for _, f := range files {
		if f.Source != SourceOpenCode {
			t.Fatalf("expected source %q, got %q", SourceOpenCode, f.Source)
		}
	}
}

func TestOpenCodeProvider_LoadMessagesV2(t *testing.T) {
	db := createTestOpenCodeDBV2(t)
	defer db.Close()
	path := persistDBToTempFile(t, db)

	p := NewOpenCodeProvider(path)
	summaries, err := p.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}

	var s1 SessionSummary
	for _, s := range summaries {
		if s.ID == "session-1" {
			s1 = s
		}
	}
	if s1.ID == "" {
		t.Fatalf("did not find session-1 in summaries: %#v", summaries)
	}

	messages, err := p.LoadMessages(context.Background(), s1.FilePath)
	if err != nil {
		t.Fatalf("LoadMessages: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("expected 2 messages for session-1, got %d: %#v", len(messages), messages)
	}
	if messages[0].Role != RoleUser {
		t.Fatalf("expected first message role user, got %q", messages[0].Role)
	}
	if messages[1].Role != RoleAssistant {
		t.Fatalf("expected second message role assistant, got %q", messages[1].Role)
	}
	if messages[1].Text == "" {
		t.Fatalf("expected non-empty assistant text")
	}
}

func TestOpenCodeProvider_LoadToolCallsV2(t *testing.T) {
	db := createTestOpenCodeDBV2(t)
	defer db.Close()
	path := persistDBToTempFile(t, db)

	p := NewOpenCodeProvider(path)
	summaries, err := p.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}

	var s1 SessionSummary
	for _, s := range summaries {
		if s.ID == "session-1" {
			s1 = s
		}
	}
	if s1.ID == "" {
		t.Fatalf("did not find session-1 in summaries: %#v", summaries)
	}

	toolCalls, err := p.LoadToolCalls(context.Background(), s1.FilePath)
	if err != nil {
		t.Fatalf("LoadToolCalls: %v", err)
	}
	if len(toolCalls) != 1 {
		t.Fatalf("expected 1 tool call for session-1, got %d: %#v", len(toolCalls), toolCalls)
	}
	if toolCalls[0].Name != "shell" {
		t.Fatalf("expected tool name shell, got %q", toolCalls[0].Name)
	}
	if toolCalls[0].Summary == "" {
		t.Fatalf("expected non-empty tool summary")
	}
}

func TestOpenCodeProvider_ListV1Fallback(t *testing.T) {
	db := createTestOpenCodeDBV1(t)
	defer db.Close()
	path := persistDBToTempFile(t, db)

	p := NewOpenCodeProvider(path)
	summaries, err := p.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(summaries) != 1 {
		t.Fatalf("expected 1 summary, got %d: %#v", len(summaries), summaries)
	}
	if summaries[0].ID != "session-1" {
		t.Fatalf("unexpected id: %q", summaries[0].ID)
	}
	if summaries[0].Source != SourceOpenCode {
		t.Fatalf("unexpected source: %q", summaries[0].Source)
	}

	messages, err := p.LoadMessages(context.Background(), summaries[0].FilePath)
	if err != nil {
		t.Fatalf("LoadMessages: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("expected 2 messages, got %d: %#v", len(messages), messages)
	}
}

func TestOpenCodeProvider_MissingDB(t *testing.T) {
	p := NewOpenCodeProvider(filepath.Join(os.TempDir(), "nonexistent-opencode.db"))
	summaries, err := p.List(context.Background())
	if err == nil {
		t.Fatalf("expected error from List on missing DB, got summaries: %#v", summaries)
	}
	if summaries != nil {
		t.Fatalf("expected nil summaries, got %#v", summaries)
	}
}

func TestOpenCodeProvider_ModelAndParentID(t *testing.T) {
	db := createTestOpenCodeDBV2(t)
	defer db.Close()
	path := persistDBToTempFile(t, db)

	p := NewOpenCodeProvider(path)
	summaries, err := p.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	byID := map[string]SessionSummary{}
	for _, sm := range summaries {
		byID[sm.ID] = sm
	}
	s1, ok := byID["session-1"]
	if !ok {
		t.Fatalf("session-1 missing: %#v", byID)
	}
	if s1.VendorID != "anthropic" {
		t.Fatalf("expected vendorID anthropic, got %q", s1.VendorID)
	}
	if s1.Kind != SessionKindSession {
		t.Fatalf("expected session-1 kind session, got %q", s1.Kind)
	}
	s2, ok := byID["session-2"]
	if !ok {
		t.Fatalf("session-2 missing: %#v", byID)
	}
	if s2.Kind != SessionKindSubagent {
		t.Fatalf("expected session-2 kind subagent, got %q", s2.Kind)
	}
	if s2.ParentKey == "" {
		t.Fatalf("expected non-empty ParentKey for subagent session-2")
	}
	if s2.ParentKey != s1.Key {
		t.Fatalf("expected ParentKey == session-1 Key, got %q vs %q", s2.ParentKey, s1.Key)
	}
}

func TestOpenCodeProvider_MessagesCarryModel(t *testing.T) {
	db := createTestOpenCodeDBV2(t)
	defer db.Close()
	path := persistDBToTempFile(t, db)

	p := NewOpenCodeProvider(path)
	messages, err := p.LoadMessages(context.Background(), p.sessionFilePath("session-1"))
	if err != nil {
		t.Fatalf("LoadMessages: %v", err)
	}
	if len(messages) == 0 {
		t.Fatalf("expected messages")
	}
	if messages[0].Model != "claude-sonnet-4" {
		t.Fatalf("expected message model claude-sonnet-4, got %q", messages[0].Model)
	}
}

func TestOpenCodeProvider_DeltaIncremental(t *testing.T) {
	db := createTestOpenCodeDBV2(t)
	defer db.Close()
	path := persistDBToTempFile(t, db)

	p := NewOpenCodeProvider(path)
	fp := p.sessionFilePath("session-1")
	all, err := p.LoadMessages(context.Background(), fp)
	if err != nil {
		t.Fatalf("LoadMessages: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(all))
	}

	d1, err := p.LoadMessageDelta(context.Background(), fp, SessionMessageCursor{}, 5)
	if err != nil {
		t.Fatalf("LoadMessageDelta 1: %v", err)
	}
	if len(d1.Messages) != 1 {
		t.Fatalf("expected 1 message in first frame, got %d", len(d1.Messages))
	}
	if !d1.HasMore {
		t.Fatalf("expected HasMore true after first frame")
	}
	d2, err := p.LoadMessageDelta(context.Background(), fp, d1.Cursor, 1<<20)
	if err != nil {
		t.Fatalf("LoadMessageDelta 2: %v", err)
	}
	if len(d2.Messages) != 1 {
		t.Fatalf("expected 1 message in second frame, got %d", len(d2.Messages))
	}
	if d2.HasMore {
		t.Fatalf("expected HasMore false after second frame")
	}
	if d2.Messages[0].Seq != 2 {
		t.Fatalf("expected second frame to carry message seq 2, got %d", d2.Messages[0].Seq)
	}
}
