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

// opencodeRowV2 holds one row of the OpenCode V2 session table.
type opencodeRowV2 struct {
	ID            string
	Title         string
	Directory     string
	TimeCreated   int64
	TimeUpdated   int64
	ModelProvider string
	ModelID       string
}

// opencodeMessageRowV2 holds one row of the OpenCode V2 session_message table.
type opencodeMessageRowV2 struct {
	SessionID string
	Role      string
	Content   string
	Time      int64
	ToolCall  string // nullable JSON
}

// createTestOpenCodeDBV2 builds an in-memory SQLite DB with the V2 schema and two sessions + messages.
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
    time_created INTEGER NOT NULL DEFAULT 0,
    time_updated INTEGER NOT NULL DEFAULT 0,
    model_provider TEXT NOT NULL DEFAULT '',
    model_id TEXT NOT NULL DEFAULT ''
);
CREATE TABLE session_message (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    time_created INTEGER NOT NULL DEFAULT 0,
    tool_call TEXT
);
CREATE TABLE message (
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

	sessions := []opencodeRowV2{
		{ID: "session-1", Title: "First session", Directory: "/tmp/project-a", TimeCreated: 1732800000, TimeUpdated: 1732800600, ModelProvider: "anthropic", ModelID: "claude-sonnet-4"},
		{ID: "session-2", Title: "Second session", Directory: "/tmp/project-b", TimeCreated: 1732900000, TimeUpdated: 1732900600, ModelProvider: "openai", ModelID: "gpt-4o"},
	}
	for _, s := range sessions {
		_, err = db.Exec(`INSERT INTO session (id, title, directory, time_created, time_updated, model_provider, model_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			s.ID, s.Title, s.Directory, s.TimeCreated, s.TimeUpdated, s.ModelProvider, s.ModelID)
		if err != nil {
			db.Close()
			t.Fatalf("insert session: %v", err)
		}
	}

	messages := []opencodeMessageRowV2{
		{SessionID: "session-1", Role: "user", Content: `{"role":"user","content":"plan the work"}`, Time: 1732800010},
		{SessionID: "session-1", Role: "assistant", Content: `{"role":"assistant","content":[{"type":"text","text":"_OK"},{"type":"toolcall","name":"shell","args":{"cmd":"ls"}}]}`, Time: 1732800020, ToolCall: `{"name":"shell","args":{"cmd":"ls"}}`},
		{SessionID: "session-2", Role: "user", Content: `{"role":"user","content":"review the work"}`, Time: 1732900010},
		{SessionID: "session-2", Role: "assistant", Content: `{"role":"assistant","content":"done"}`, Time: 1732900020},
	}
	for _, m := range messages {
		_, err = db.Exec(`INSERT INTO session_message (id, session_id, role, content, time_created, tool_call) VALUES (?, ?, ?, ?, ?, ?)`,
			fmt.Sprintf("%s-%d", m.SessionID, m.Time), m.SessionID, m.Role, m.Content, m.Time, nullableString(m.ToolCall))
		if err != nil {
			db.Close()
			t.Fatalf("insert session_message: %v", err)
		}
	}

	return db
}

// createTestOpenCodeDBV1 builds an in-memory SQLite DB using only the V1 `message` table.
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
    time_created INTEGER NOT NULL DEFAULT 0,
    time_updated INTEGER NOT NULL DEFAULT 0,
    model_provider TEXT NOT NULL DEFAULT '',
    model_id TEXT NOT NULL DEFAULT ''
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

	_, err = db.Exec(`INSERT INTO session (id, title, directory, time_created, time_updated, model_provider, model_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"session-1", "First session", "/tmp/project-a", 1732800000, 1732800600, "anthropic", "claude-sonnet-4")
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
