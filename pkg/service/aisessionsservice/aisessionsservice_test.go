// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessionsservice

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

func setupVendorSessionServiceTest(t *testing.T) (string, string) {
	t.Helper()
	home := t.TempDir()
	dataDir := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("WAVETERM_AI_SESSIONS_INDEX", filepath.Join(dataDir, "index.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(dataDir, "meta.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_SQLITE_INDEX", filepath.Join(dataDir, "index.sqlite"))
	previous := wavebase.DataHome_VarCache
	wavebase.DataHome_VarCache = dataDir
	t.Cleanup(func() {
		wavebase.DataHome_VarCache = previous
	})
	dbPath := filepath.Join(home, ".cc-switch", "cc-switch.db")
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o700); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE providers (
		id TEXT, name TEXT, settings_config TEXT, is_current INTEGER,
		provider_type TEXT, category TEXT, app_type TEXT, sort_index INTEGER
	)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO providers(id, name, settings_config, is_current, provider_type, category, app_type, sort_index)
		VALUES(?, ?, ?, 0, '', '', 'claude', 0)`, "vendor-live", "Live Vendor", `{"env":{"ANTHROPIC_MODEL":"test"}}`); err != nil {
		t.Fatal(err)
	}
	return home, dataDir
}

func writeClaudeVendorSession(t *testing.T, dataDir string, vendorID string, sessionID string) string {
	t.Helper()
	path := filepath.Join(dataDir, "claude-vendors", vendorID, "projects", "project", sessionID+".jsonl")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	line := fmt.Sprintf(`{"type":"user","message":{"role":"user","content":"Restore vendor session"},"sessionId":%q,"timestamp":"2026-07-25T00:00:00Z","cwd":"C:/work/project"}`, sessionID)
	if err := os.WriteFile(path, []byte(line+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestVendorSessionDetailNoteStatAndRestoreContext(t *testing.T) {
	_, dataDir := setupVendorSessionServiceTest(t)
	livePath := writeClaudeVendorSession(t, dataDir, "vendor-live", "session-live")
	stalePath := writeClaudeVendorSession(t, dataDir, "vendor-stale", "session-stale")
	staleSettings := filepath.Join(dataDir, "claude-vendors", "vendor-stale", "settings.json")
	if err := os.WriteFile(staleSettings, []byte(`{"env":{}}`), 0o600); err != nil {
		t.Fatal(err)
	}

	service := &AISessionsService{}
	detail, err := service.Detail(context.Background(), &AISessionsDetailRequest{ID: "session-live"})
	if err != nil {
		t.Fatal(err)
	}
	if detail.Summary.VendorID != "vendor-live" || detail.Summary.FilePath != livePath || len(detail.Messages) != 1 {
		t.Fatalf("unexpected vendor detail: %#v", detail)
	}
	stat, err := service.Stat(context.Background(), &AISessionsStatRequest{FilePath: livePath})
	if err != nil || stat.Missing || stat.Size == 0 {
		t.Fatalf("unexpected vendor stat: %#v err=%v", stat, err)
	}
	noted, err := service.Note(context.Background(), detail.Summary.Key, "restore note")
	if err != nil || noted.Note != "restore note" {
		t.Fatalf("unexpected vendor note: %#v err=%v", noted, err)
	}
	restore, err := service.RestoreContext(context.Background(), &AISessionsRestoreContextRequest{ID: detail.Summary.Key})
	if err != nil {
		t.Fatal(err)
	}
	if restore.VendorID != "vendor-live" || restore.VendorName != "Live Vendor" || restore.ConfigDir == "" {
		t.Fatalf("unexpected restore context: %#v", restore)
	}

	_, err = service.RestoreContext(context.Background(), &AISessionsRestoreContextRequest{ID: "session-stale"})
	if err == nil || err.Error() != VendorConfigurationUnavailableError {
		t.Fatalf("expected stable stale-vendor error, got %v", err)
	}
	if _, err := os.Stat(stalePath); err != nil {
		t.Fatalf("stale vendor session data was modified: %v", err)
	}
}

func TestStatKnownCodexSessionFile(t *testing.T) {
	codexHome := t.TempDir()
	t.Setenv("CODEX_HOME", codexHome)
	sessionDir := filepath.Join(codexHome, "sessions", "2026", "05", "14")
	if err := os.MkdirAll(sessionDir, 0o700); err != nil {
		t.Fatal(err)
	}
	sessionPath := filepath.Join(sessionDir, "rollout-2026-05-14T00-00-00-test-id.jsonl")
	if err := os.WriteFile(sessionPath, []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	stat, err := (&AISessionsService{}).Stat(context.Background(), &AISessionsStatRequest{FilePath: sessionPath})
	if err != nil {
		t.Fatal(err)
	}
	if stat.FilePath != sessionPath || stat.Size == 0 || stat.MTime == 0 || stat.Missing {
		t.Fatalf("unexpected stat response: %#v", stat)
	}
}

func TestStatRejectsPathOutsideSessionRoots(t *testing.T) {
	codexHome := t.TempDir()
	t.Setenv("CODEX_HOME", codexHome)
	outsidePath := filepath.Join(t.TempDir(), "not-a-session.jsonl")
	if err := os.WriteFile(outsidePath, []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	_, err := (&AISessionsService{}).Stat(context.Background(), &AISessionsStatRequest{FilePath: outsidePath})
	if err == nil {
		t.Fatalf("expected outside path to be rejected")
	}
}

func TestUserOutlineFindsUserMessagesOutsideRecentTail(t *testing.T) {
	codexHome := t.TempDir()
	t.Setenv("CODEX_HOME", codexHome)
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(t.TempDir(), "meta.json"))
	sessionDir := filepath.Join(codexHome, "sessions", "2026", "05", "14")
	if err := os.MkdirAll(sessionDir, 0o700); err != nil {
		t.Fatal(err)
	}
	sessionPath := filepath.Join(sessionDir, "rollout-2026-05-14T00-00-00-outline-test.jsonl")
	var lines []string
	lines = append(lines,
		`{"timestamp":"2026-05-14T00:00:00Z","type":"session_meta","payload":{"id":"outline-test","cwd":"/tmp/project"}}`,
		`{"timestamp":"2026-05-14T00:00:01Z","type":"response_item","payload":{"type":"message","role":"user","content":"Initial user request"}}`,
	)
	for idx := 0; idx < 120; idx++ {
		lines = append(lines, fmt.Sprintf(
			`{"timestamp":"2026-05-14T00:00:02Z","type":"response_item","payload":{"type":"message","role":"assistant","content":"Assistant message %d"}}`,
			idx,
		))
	}
	if err := os.WriteFile(sessionPath, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	detail, err := (&AISessionsService{}).Detail(context.Background(), &AISessionsDetailRequest{
		ID:   "outline-test",
		Tail: 100,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, message := range detail.Messages {
		if message.Role == "user" {
			t.Fatalf("expected tailed detail to omit early user message, got %#v", message)
		}
	}

	outline, err := (&AISessionsService{}).UserOutline(context.Background(), &AISessionsUserOutlineRequest{
		ID:    "outline-test",
		Limit: 5,
	})
	if err != nil {
		t.Fatal(err)
	}
	if outline.UserMessageCount != 1 {
		t.Fatalf("expected one user message, got %d", outline.UserMessageCount)
	}
	if len(outline.Messages) != 1 || outline.Messages[0].Text != "Initial user request" {
		t.Fatalf("unexpected outline messages: %#v", outline.Messages)
	}
}

func TestLatestUserOutlineMessagesLimitsLatestMessages(t *testing.T) {
	messages := []aisessions.Message{
		{Seq: 1, Role: aisessions.RoleUser, Text: "one"},
		{Seq: 2, Role: aisessions.RoleAssistant, Text: "assistant"},
		{Seq: 3, Role: aisessions.RoleUser, Text: "two"},
		{Seq: 4, Role: aisessions.RoleUser, Text: "three"},
	}
	latest, count := latestUserOutlineMessages(messages, 2)
	if count != 3 {
		t.Fatalf("expected total count 3, got %d", count)
	}
	if len(latest) != 2 || latest[0].Seq != 3 || latest[1].Seq != 4 {
		t.Fatalf("expected latest two user messages, got %#v", latest)
	}
}

func TestUserLinesDefaultsToEightAndPagesOlderMessages(t *testing.T) {
	codexHome := t.TempDir()
	t.Setenv("CODEX_HOME", codexHome)
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(t.TempDir(), "meta.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_INDEX", filepath.Join(t.TempDir(), "index.json"))
	sessionDir := filepath.Join(codexHome, "sessions", "2026", "05", "14")
	if err := os.MkdirAll(sessionDir, 0o700); err != nil {
		t.Fatal(err)
	}
	sessionPath := filepath.Join(sessionDir, "rollout-2026-05-14T00-00-00-user-lines-test.jsonl")
	var lines []string
	lines = append(lines, `{"timestamp":"2026-05-14T00:00:00Z","type":"session_meta","payload":{"id":"user-lines-test","cwd":"/tmp/project"}}`)
	for idx := 1; idx <= 12; idx++ {
		lines = append(lines, fmt.Sprintf(
			`{"timestamp":"2026-05-14T00:00:%02dZ","type":"response_item","payload":{"type":"message","role":"user","content":"User line %02d"}}`,
			idx,
			idx,
		))
	}
	if err := os.WriteFile(sessionPath, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	first, err := (&AISessionsService{}).UserLines(context.Background(), &AISessionsUserLinesRequest{
		ID: "user-lines-test",
	})
	if err != nil {
		t.Fatal(err)
	}
	if first.UserMessageCount != 12 || len(first.Messages) != 8 || !first.HasMore {
		t.Fatalf("unexpected first page: %#v", first)
	}
	if first.Messages[0].Seq != 5 || first.Messages[7].Seq != 12 || first.NextBeforeSeq != 5 {
		t.Fatalf("unexpected first page messages: %#v", first.Messages)
	}

	second, err := (&AISessionsService{}).UserLines(context.Background(), &AISessionsUserLinesRequest{
		ID:        "user-lines-test",
		BeforeSeq: first.NextBeforeSeq,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Messages) != 4 || second.HasMore || second.Messages[0].Seq != 1 || second.Messages[3].Seq != 4 {
		t.Fatalf("unexpected second page: %#v", second)
	}

	outline, err := (&AISessionsService{}).UserOutline(context.Background(), &AISessionsUserOutlineRequest{
		ID: "user-lines-test",
	})
	if err != nil {
		t.Fatal(err)
	}
	if outline.UserMessageCount != 12 || len(outline.Messages) != 12 {
		t.Fatalf("expected UserOutline default to keep existing 20 item behavior, got %#v", outline)
	}
}
