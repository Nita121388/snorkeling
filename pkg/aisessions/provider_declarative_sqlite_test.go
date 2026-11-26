// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

// The fixture below mirrors the real Antigravity schema (verified 2026-11-26 on
// ~/.gemini/antigravity-cli/conversation_summaries.db) with the columns the
// default mapping touches. The two rows carry the observed timestamp shape
// ("2026-11-26 03:44:28.0252345+00:00", 7 fractional digits, +00:00 offset) and
// the observed workspace_uris JSON-array-of-file-URIs shape.
const declarativeFixtureSchema = `
CREATE TABLE conversation_summaries (
	conversation_id text,
	title text NOT NULL DEFAULT "",
	preview text NOT NULL DEFAULT "",
	step_count integer NOT NULL DEFAULT 0,
	last_modified_time datetime NOT NULL,
	workspace_uris text NOT NULL,
	status text NOT NULL DEFAULT "",
	parent_conversation_id text NOT NULL DEFAULT "",
	last_user_input_time datetime NOT NULL,
	PRIMARY KEY (conversation_id)
)`

const (
	fixtureGreetingID   = "935d90c4-62a1-4da1-8e97-77b036154d17"
	fixtureIndexPlanID  = "38739590-8362-4df9-a8df-689248d67ca2"
	fixtureGreetingUpd  = "2026-11-26 03:11:36.4127802+00:00"
	fixtureGreetingCrt  = "2026-11-26 03:11:32.5382864+00:00"
	fixtureIndexPlanUpd = "2026-11-26 03:44:28.0252345+00:00"
	fixtureIndexPlanCrt = "2026-11-26 03:29:47.7279059+00:00"
)

const (
	fixtureGreetingUpdatedMS  int64 = 1795662696412
	fixtureGreetingCreatedMS  int64 = 1795662692538
	fixtureIndexPlanUpdatedMS int64 = 1795664668025
	fixtureIndexPlanCreatedMS int64 = 1795663787727
)

// nativeProjectPath returns the OS-native path a file:// URI decodes into, so the
// assertions below stay honest on both Windows and POSIX hosts.
func nativeProjectPath(t *testing.T, uri string) string {
	t.Helper()
	if path := fileURIToNativePath(uri); path != "" {
		return path
	}
	t.Fatalf("cannot decode fixture URI %q", uri)
	return ""
}

// createDeclarativeFixtureDB writes the fixture db to a temp file and returns
// its path (also used by paths_test.go for registration tests).
func createDeclarativeFixtureDB(t *testing.T) string {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "conversation_summaries.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open fixture sqlite: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(declarativeFixtureSchema); err != nil {
		t.Fatalf("create fixture schema: %v", err)
	}
	insert := `INSERT INTO conversation_summaries
		(conversation_id, title, last_modified_time, workspace_uris, last_user_input_time)
		VALUES (?, ?, ?, ?, ?)`
	if _, err := db.Exec(insert, fixtureGreetingID, "General Greeting", fixtureGreetingUpd, `["file:///C:/Users/chemclin"]`, fixtureGreetingCrt); err != nil {
		t.Fatalf("insert greeting row: %v", err)
	}
	if _, err := db.Exec(insert, fixtureIndexPlanID, "Index Performance Plan Handoff", fixtureIndexPlanUpd, `["file:///E:/code/snorkeling"]`, fixtureIndexPlanCrt); err != nil {
		t.Fatalf("insert index plan row: %v", err)
	}
	return dbPath
}

func newFixtureDeclarativeProvider(t *testing.T) *DeclarativeSQLiteProvider {
	t.Helper()
	dbPath := createDeclarativeFixtureDB(t)
	cfg := wconfig.AgentSessionProviderConfigType{
		Label:   "Antigravity",
		Type:    SessionProviderTypeSQLite,
		DB:      dbPath,
		Table:   "conversation_summaries",
		Columns: defaultSessionProviderColumns(),
	}
	provider := NewDeclarativeSQLiteProvider(SourceAntigravity, cfg)
	// Normalize the way registration does (list limit default, db abs path).
	provider.cfg = normalizeSessionProviderConfig(cfg, cfg)
	return provider
}

func TestDeclarativeProviderList(t *testing.T) {
	provider := newFixtureDeclarativeProvider(t)
	dbPath := provider.cfg.DB

	summaries, err := provider.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(summaries) != 2 {
		t.Fatalf("expected 2 summaries, got %d", len(summaries))
	}

	newest := summaries[0]
	if newest.ID != fixtureIndexPlanID {
		t.Errorf("newest id = %q, want %q (ORDER BY updated DESC)", newest.ID, fixtureIndexPlanID)
	}
	if newest.Source != SourceAntigravity {
		t.Errorf("source = %q, want %q", newest.Source, SourceAntigravity)
	}
	if newest.Title != "Index Performance Plan Handoff" {
		t.Errorf("title = %q", newest.Title)
	}
	if newest.TitleSource != "source_title" {
		t.Errorf("titleSource = %q, want source_title", newest.TitleSource)
	}
	wantProject := nativeProjectPath(t, "file:///E:/code/snorkeling")
	if newest.ProjectPath != wantProject {
		t.Errorf("projectPath = %q, want %q", newest.ProjectPath, wantProject)
	}
	if newest.UpdatedAt != fixtureIndexPlanUpdatedMS {
		t.Errorf("updatedAt = %d, want %d", newest.UpdatedAt, fixtureIndexPlanUpdatedMS)
	}
	if newest.CreatedAt != fixtureIndexPlanCreatedMS {
		t.Errorf("createdAt = %d, want %d", newest.CreatedAt, fixtureIndexPlanCreatedMS)
	}
	if newest.Kind != SessionKindSession {
		t.Errorf("kind = %q, want %q", newest.Kind, SessionKindSession)
	}
	// No sibling conversations/<id>.db in the fixture: the summary db carries an
	// "#<id>" suffix so sessions never share a file path.
	wantFilePath := dbPath + "#" + fixtureIndexPlanID
	if newest.FilePath != wantFilePath {
		t.Errorf("filePath = %q, want %q", newest.FilePath, wantFilePath)
	}
	if newest.Key != StableKey(SourceAntigravity, fixtureIndexPlanID, wantFilePath) {
		t.Errorf("key = %q", newest.Key)
	}

	older := summaries[1]
	if older.ID != fixtureGreetingID {
		t.Errorf("older id = %q, want %q", older.ID, fixtureGreetingID)
	}
	if older.UpdatedAt != fixtureGreetingUpdatedMS || older.CreatedAt != fixtureGreetingCreatedMS {
		t.Errorf("greeting timestamps = (%d, %d), want (%d, %d)",
			older.UpdatedAt, older.CreatedAt, fixtureGreetingUpdatedMS, fixtureGreetingCreatedMS)
	}
	wantGreetingProject := nativeProjectPath(t, "file:///C:/Users/chemclin")
	if older.ProjectPath != wantGreetingProject {
		t.Errorf("greeting projectPath = %q, want %q", older.ProjectPath, wantGreetingProject)
	}
}

func TestDeclarativeProviderLoadMessagesIsEmpty(t *testing.T) {
	provider := newFixtureDeclarativeProvider(t)
	summaries, err := provider.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	messages, err := provider.LoadMessages(context.Background(), summaries[0].FilePath)
	if err != nil {
		t.Fatalf("LoadMessages must not error (detail view degrades to placeholder): %v", err)
	}
	if messages == nil {
		t.Error("LoadMessages should return an empty slice, not nil")
	}
	if len(messages) != 0 {
		t.Errorf("expected 0 messages, got %d", len(messages))
	}
}

func TestDeclarativeProviderListFilesAndParseSummaryRoundTrip(t *testing.T) {
	provider := newFixtureDeclarativeProvider(t)
	files, err := provider.ListFiles(context.Background())
	if err != nil {
		t.Fatalf("ListFiles: %v", err)
	}
	if len(files) != 2 {
		t.Fatalf("expected 2 session files, got %d", len(files))
	}
	for _, file := range files {
		if file.Source != SourceAntigravity {
			t.Errorf("file source = %q", file.Source)
		}
		if file.MTime == 0 {
			t.Errorf("file %q has zero mtime (change detection would never fire)", file.Path)
		}
		summary, ok := provider.ParseSummary(context.Background(), file)
		if !ok {
			t.Fatalf("ParseSummary(%q) failed", file.Path)
		}
		if summary.FilePath != file.Path {
			t.Errorf("round-trip filePath = %q, want %q", summary.FilePath, file.Path)
		}
		if summary.ID == "" || summary.Title == "" {
			t.Errorf("round-trip summary lost identity: %+v", summary)
		}
	}
}

func TestDeclarativeProviderPrefersConversationDB(t *testing.T) {
	provider := newFixtureDeclarativeProvider(t)
	conversationDir := filepath.Join(filepath.Dir(provider.cfg.DB), declarativeConvDir)
	if err := os.MkdirAll(conversationDir, 0o700); err != nil {
		t.Fatal(err)
	}
	conversationDB := filepath.Join(conversationDir, fixtureIndexPlanID+".db")
	if err := os.WriteFile(conversationDB, []byte("placeholder"), 0o600); err != nil {
		t.Fatal(err)
	}

	summaries, err := provider.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	var target SessionSummary
	for _, summary := range summaries {
		if summary.ID == fixtureIndexPlanID {
			target = summary
		}
	}
	if target.FilePath != conversationDB {
		t.Fatalf("filePath = %q, want the per-conversation db %q", target.FilePath, conversationDB)
	}
	parsed, ok := provider.ParseSummary(context.Background(), SessionFile{Source: SourceAntigravity, Path: conversationDB})
	if !ok || parsed.ID != fixtureIndexPlanID {
		t.Fatalf("ParseSummary on the per-conversation db path failed: ok=%v id=%q", ok, parsed.ID)
	}
}

func TestDeclarativeProviderToleratesMissingColumns(t *testing.T) {
	dbPath := createDeclarativeFixtureDB(t)
	cfg := normalizeSessionProviderConfig(wconfig.AgentSessionProviderConfigType{}, wconfig.AgentSessionProviderConfigType{
		Type:  SessionProviderTypeSQLite,
		DB:    dbPath,
		Table: "conversation_summaries",
		Columns: wconfig.AgentSessionProviderColumnsType{
			ID:    "conversation_id",
			Title: "title",
		},
	})
	provider := NewDeclarativeSQLiteProvider("custom", cfg)

	summaries, err := provider.List(context.Background())
	if err != nil {
		t.Fatalf("List with a partial column mapping: %v", err)
	}
	if len(summaries) != 2 {
		t.Fatalf("expected 2 summaries, got %d", len(summaries))
	}
	for _, summary := range summaries {
		if summary.Title == "" {
			t.Errorf("mapped title is empty for %q", summary.ID)
		}
		if summary.ProjectPath != "" || summary.UpdatedAt != 0 || summary.CreatedAt != 0 {
			t.Errorf("unmapped fields should stay empty: %+v", summary)
		}
		if summary.Source != "custom" {
			t.Errorf("source = %q, want the config key", summary.Source)
		}
	}
	// No "updated" column mapped: the query must not ORDER BY it.
	if strings.Contains(provider.listQuery(provider.selectColumns()), "ORDER BY") {
		t.Error("list query must not order by an unmapped column")
	}
}

func TestDeclarativeProviderMissingTableReturnsError(t *testing.T) {
	dbPath := createDeclarativeFixtureDB(t)
	cfg := normalizeSessionProviderConfig(wconfig.AgentSessionProviderConfigType{}, wconfig.AgentSessionProviderConfigType{
		Type:    SessionProviderTypeSQLite,
		DB:      dbPath,
		Table:   "no_such_table",
		Columns: defaultSessionProviderColumns(),
	})
	provider := NewDeclarativeSQLiteProvider("broken", cfg)
	if _, err := provider.List(context.Background()); err == nil {
		t.Fatal("expected an error for a missing table (scan layer aggregates it, no panic)")
	}
}

func TestDeclarativeProviderMissingDBReturnsError(t *testing.T) {
	cfg := normalizeSessionProviderConfig(wconfig.AgentSessionProviderConfigType{}, wconfig.AgentSessionProviderConfigType{
		Type:    SessionProviderTypeSQLite,
		DB:      filepath.Join(t.TempDir(), "nope.db"),
		Table:   "conversation_summaries",
		Columns: defaultSessionProviderColumns(),
	})
	provider := NewDeclarativeSQLiteProvider("missing", cfg)
	if _, err := provider.List(context.Background()); err == nil {
		t.Fatal("expected an error when the db file does not exist")
	}
}

func TestDeclarativeProviderRespectsListLimit(t *testing.T) {
	dbPath := createDeclarativeFixtureDB(t)
	cfg := normalizeSessionProviderConfig(wconfig.AgentSessionProviderConfigType{}, wconfig.AgentSessionProviderConfigType{
		Type:      SessionProviderTypeSQLite,
		DB:        dbPath,
		Table:     "conversation_summaries",
		Columns:   defaultSessionProviderColumns(),
		ListLimit: 1,
	})
	provider := NewDeclarativeSQLiteProvider("limited", cfg)
	summaries, err := provider.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(summaries) != 1 {
		t.Fatalf("listlimit=1 should cap the query, got %d rows", len(summaries))
	}
}

func TestDeclarativeProviderParentSession(t *testing.T) {
	dbPath := createDeclarativeFixtureDB(t)
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE conversation_summaries SET parent_conversation_id = ? WHERE conversation_id = ?`, fixtureGreetingID, fixtureIndexPlanID); err != nil {
		t.Fatal(err)
	}
	db.Close()

	cfg := normalizeSessionProviderConfig(wconfig.AgentSessionProviderConfigType{}, wconfig.AgentSessionProviderConfigType{
		Type:    SessionProviderTypeSQLite,
		DB:      dbPath,
		Table:   "conversation_summaries",
		Columns: defaultSessionProviderColumns(),
	})
	provider := NewDeclarativeSQLiteProvider("nested", cfg)
	summaries, err := provider.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	var child SessionSummary
	for _, summary := range summaries {
		if summary.ID == fixtureIndexPlanID {
			child = summary
		}
	}
	if child.Kind != SessionKindSubagent {
		t.Errorf("kind = %q, want %q", child.Kind, SessionKindSubagent)
	}
	if child.ParentKey == "" || !strings.Contains(child.ParentKey, fixtureGreetingID) {
		t.Errorf("parentKey = %q, want it to reference %q", child.ParentKey, fixtureGreetingID)
	}
}

func TestProviderLabel(t *testing.T) {
	provider := newFixtureDeclarativeProvider(t)
	if label := ProviderLabel(provider); label != "Antigravity" {
		t.Errorf("declarative label = %q, want the configured label", label)
	}
	// The compile-time providers have no LabeledProvider capability: the source id
	// is the fallback (the frontend keeps its own built-in labels for them).
	if label := ProviderLabel(NewOpenCodeProvider("x.db")); label != SourceOpenCode {
		t.Errorf("opencode label = %q, want the source id", label)
	}
	if label := ProviderLabel(nil); label != "" {
		t.Errorf("nil provider label = %q, want empty", label)
	}
}

func TestDecodeWorkspaceURIs(t *testing.T) {
	wantWindowsDrive := "/E:/code/snorkeling"
	wantSpacedPath := "/E:/my code/snorkeling"
	wantFirstURI := "/C:/Users/chemclin"
	if runtime.GOOS == "windows" {
		wantWindowsDrive = `E:\code\snorkeling`
		wantSpacedPath = `E:\my code\snorkeling`
		wantFirstURI = `C:\Users\chemclin`
	}
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{"json array", `["file:///E:/code/snorkeling"]`, wantWindowsDrive},
		{"json array takes first", `["file:///C:/Users/chemclin","file:///E:/code/snorkeling"]`, wantFirstURI},
		{"single uri", "file:///E:/code/snorkeling", wantWindowsDrive},
		{"percent encoded", "file:///E:/my%20code/snorkeling", wantSpacedPath},
		{"plain path passthrough", "/home/user/project", "/home/user/project"},
		{"empty", "", ""},
		{"invalid json", `["file:///E:/code`, ""},
		{"json object", `{"uri":"file:///E:/code"}`, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := decodeWorkspaceURIs(tc.raw); got != tc.want {
				t.Errorf("decodeWorkspaceURIs(%q) = %q, want %q", tc.raw, got, tc.want)
			}
		})
	}
}

func TestDeclarativeCellTime(t *testing.T) {
	cases := []struct {
		name  string
		value any
		want  int64
	}{
		{"antigravity layout", fixtureIndexPlanUpd, fixtureIndexPlanUpdatedMS},
		{"rfc3339 nano", "2026-11-26T03:44:28.0252345Z", fixtureIndexPlanUpdatedMS},
		{"no zone", "2026-11-26 03:44:28", 1795664668000},
		{"unix seconds as int", int64(1795664668), 1795664668000},
		{"unix millis as int", int64(1795664668025), 1795664668025},
		{"unix seconds as text", "1795664668", 1795664668000},
		{"float", float64(1795664668025), 1795664668025},
		{"nil", nil, 0},
		{"garbage", "not-a-time", 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := declarativeCellTime(tc.value); got != tc.want {
				t.Errorf("declarativeCellTime(%v) = %d, want %d", tc.value, got, tc.want)
			}
		})
	}
	// time.Time values (some sqlite drivers convert declared datetime columns).
	want := time.Date(2026, 11, 26, 3, 44, 28, 25234500, time.UTC).UnixMilli()
	if got := declarativeCellTime(time.UnixMilli(want)); got != want {
		t.Errorf("time.Time cell = %d, want %d", got, want)
	}
}

func TestNormalizeRunState(t *testing.T) {
	now := time.Now().UnixMilli()
	cases := []struct {
		name          string
		status        string
		lastModified int64
		want          string
	}{
		{"running fresh", "CASCADE_RUN_STATUS_RUNNING", now - time.Minute.Milliseconds(), RunStateRunning},
		{"running case-insensitive", "cascade_run_status_running", now - time.Minute.Milliseconds(), RunStateRunning},
		{"running exactly at ttl edge", "CASCADE_RUN_STATUS_RUNNING", now - declarativeRunStateTTL.Milliseconds(), RunStateRunning},
		{"running stale past ttl", "CASCADE_RUN_STATUS_RUNNING", now - declarativeRunStateTTL.Milliseconds() - 1, ""},
		{"running without updated mapping", "CASCADE_RUN_STATUS_RUNNING", 0, ""},
		{"idle", "CASCADE_RUN_STATUS_IDLE", now, ""},
		{"empty", "", now, ""},
		{"unknown value", "CASCADE_RUN_STATUS_SOMETHING", now, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := normalizeRunState(tc.status, tc.lastModified, now); got != tc.want {
				t.Errorf("normalizeRunState(%q, %d, now) = %q, want %q", tc.status, tc.lastModified, got, tc.want)
			}
		})
	}
}

// declarativeFixtureFreshTime returns a last_modified_time value in the observed
// Antigravity timestamp shape but at "now", so a RUNNING row is provably inside
// the TTL regardless of when the test runs.
func declarativeFixtureFreshTime() string {
	return time.Now().UTC().Format("2006-01-02 15:04:05.999999999+00:00")
}

func TestDeclarativeProviderRunStateFromList(t *testing.T) {
	dbPath := createDeclarativeFixtureDB(t)
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	// Newest row: RUNNING with a fresh last_modified_time → "running".
	if _, err := db.Exec(`UPDATE conversation_summaries SET status = ?, last_modified_time = ? WHERE conversation_id = ?`,
		"CASCADE_RUN_STATUS_RUNNING", declarativeFixtureFreshTime(), fixtureIndexPlanID); err != nil {
		t.Fatal(err)
	}
	// Older row: RUNNING but the fixture's hours-old last_modified_time → stale → "".
	if _, err := db.Exec(`UPDATE conversation_summaries SET status = ? WHERE conversation_id = ?`,
		"CASCADE_RUN_STATUS_RUNNING", fixtureGreetingID); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	cfg := normalizeSessionProviderConfig(wconfig.AgentSessionProviderConfigType{}, wconfig.AgentSessionProviderConfigType{
		Type:  SessionProviderTypeSQLite,
		DB:    dbPath,
		Table: "conversation_summaries",
		Columns: wconfig.AgentSessionProviderColumnsType{
			ID:     "conversation_id",
			Title:  "title",
			Updated: "last_modified_time",
			Status: "status",
		},
	})
	provider := NewDeclarativeSQLiteProvider("runstate", cfg)
	summaries, err := provider.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	runStates := map[string]string{}
	for _, summary := range summaries {
		runStates[summary.ID] = summary.RunState
	}
	if runStates[fixtureIndexPlanID] != RunStateRunning {
		t.Errorf("fresh RUNNING row RunState = %q, want %q", runStates[fixtureIndexPlanID], RunStateRunning)
	}
	if runStates[fixtureGreetingID] != "" {
		t.Errorf("stale RUNNING row RunState = %q, want empty (TTL guard)", runStates[fixtureGreetingID])
	}
}

func TestDeclarativeProviderRunStateNonRunningValues(t *testing.T) {
	dbPath := createDeclarativeFixtureDB(t)
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	// IDLE and an unknown value both normalize to "" (fresh timestamps prove the
	// difference is the status value, not the TTL guard).
	if _, err := db.Exec(`UPDATE conversation_summaries SET status = ?, last_modified_time = ? WHERE conversation_id = ?`,
		"CASCADE_RUN_STATUS_IDLE", declarativeFixtureFreshTime(), fixtureIndexPlanID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE conversation_summaries SET status = ?, last_modified_time = ? WHERE conversation_id = ?`,
		"CASCADE_RUN_STATUS_SOMETHING", declarativeFixtureFreshTime(), fixtureGreetingID); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	cfg := normalizeSessionProviderConfig(wconfig.AgentSessionProviderConfigType{}, wconfig.AgentSessionProviderConfigType{
		Type:  SessionProviderTypeSQLite,
		DB:    dbPath,
		Table: "conversation_summaries",
		Columns: wconfig.AgentSessionProviderColumnsType{
			ID:      "conversation_id",
			Updated: "last_modified_time",
			Status:  "status",
		},
	})
	provider := NewDeclarativeSQLiteProvider("runstate", cfg)
	summaries, err := provider.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	for _, summary := range summaries {
		if summary.RunState != "" {
			t.Errorf("row %q RunState = %q, want empty for a non-running status", summary.ID, summary.RunState)
		}
	}
}

func TestQuoteSQLiteIdentEscapes(t *testing.T) {
	if got := quoteSQLiteIdent(`we"ird`); got != `"we""ird"` {
		t.Errorf("quoteSQLiteIdent = %q", got)
	}
}
