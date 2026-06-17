// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentdata

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/commontextstore"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

var commonTextTestOnce sync.Once
var commonTextTestRoot string
var commonTextTestRootErr error

func TestMain(m *testing.M) {
	code := m.Run()
	if commonTextTestRoot != "" {
		_ = os.RemoveAll(commonTextTestRoot)
	}
	os.Exit(code)
}

func setupAgentDataCommonTextRoot(t *testing.T) string {
	t.Helper()
	commonTextTestOnce.Do(func() {
		commonTextTestRoot, commonTextTestRootErr = os.MkdirTemp("", "snorkeling-agentdata-commontext-*")
	})
	if commonTextTestRootErr != nil {
		t.Fatal(commonTextTestRootErr)
	}
	return commonTextTestRoot
}

func setupAgentDataSession(t *testing.T) (string, *aisessions.Manager) {
	t.Helper()
	dir := t.TempDir()
	wavebase.DataHome_VarCache = filepath.Join(dir, "data")
	wavebase.ConfigHome_VarCache = filepath.Join(dir, "config")
	codexHome := filepath.Join(dir, "codex")
	t.Setenv("CODEX_HOME", codexHome)
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(dir, "meta.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_SQLITE_INDEX", filepath.Join(dir, "index-v2.sqlite"))
	sessionDir := filepath.Join(codexHome, "sessions")
	if err := os.MkdirAll(sessionDir, 0o700); err != nil {
		t.Fatal(err)
	}
	sessionID := "agentdata-session"
	sessionPath := filepath.Join(sessionDir, "rollout-2026-06-16T00-00-00-agentdata-session.jsonl")
	if err := os.WriteFile(sessionPath, []byte(
		`{"timestamp":"2026-06-16T00:00:00Z","type":"session_meta","payload":{"id":"`+sessionID+`","cwd":"/tmp/project"}}`+"\n"+
			`{"timestamp":"2026-06-16T00:00:01Z","type":"response_item","payload":{"type":"message","role":"user","content":"Initial request"}}`+"\n",
	), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := aisessions.NewManagerWithOptions(aisessions.ManagerOptions{
		Providers: []aisessions.Provider{aisessions.NewCodexProvider(sessionDir)},
	})
	if _, errs := manager.Index(context.Background()); len(errs) > 0 {
		t.Fatalf("index session: %v", errs[0])
	}
	if _, err := manager.NoteAndTags(context.Background(), sessionID, "old note", []string{"old"}); err != nil {
		t.Fatal(err)
	}
	return sessionID, manager
}

func TestApplyPatchDryRunDoesNotWriteSession(t *testing.T) {
	sessionID, manager := setupAgentDataSession(t)
	note := "new note"
	patch := Patch{
		Version: PatchVersion,
		Source:  "test",
		Operations: []PatchOperation{{
			Type:       "session_note.update",
			SessionKey: sessionID,
			Note:       &note,
			Tags:       &TagPatch{Add: []string{"new"}},
		}},
	}
	report, err := ApplyPatch(context.Background(), patch, ApplyOptions{DryRun: true})
	if err != nil {
		t.Fatal(err)
	}
	if !report.DryRun || len(report.Operations) != 1 || !report.Operations[0].Changed {
		t.Fatalf("unexpected dry-run report: %#v", report)
	}
	if len(report.Operations[0].Changes) != 2 {
		t.Fatalf("expected note and tags changes, got %#v", report.Operations[0].Changes)
	}
	if !strings.Contains(strings.Join(report.Operations[0].Messages, ","), "real apply requires expectedHash or expectedUpdatedAt") {
		t.Fatalf("expected dry-run precondition warning, got %#v", report.Operations[0].Messages)
	}
	changesByField := changesByField(report.Operations[0].Changes)
	if changesByField["note"].Before != "old note" || changesByField["note"].After != "new note" {
		t.Fatalf("expected note before/after change, got %#v", changesByField["note"])
	}
	if fmt.Sprint(changesByField["tags"].Before) != "[old]" || fmt.Sprint(changesByField["tags"].After) != "[old new]" {
		t.Fatalf("expected tags before/after change, got %#v", changesByField["tags"])
	}
	summary, err := manager.Summary(context.Background(), sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Note != "old note" || strings.Join(summary.Tags, ",") != "old" {
		t.Fatalf("dry-run should not write, got %#v", summary)
	}
}

func TestApplyPatchUpdatesSessionAndCreatesBackup(t *testing.T) {
	sessionID, manager := setupAgentDataSession(t)
	before, err := manager.Summary(context.Background(), sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	note := "new note"
	patch := Patch{
		Version: PatchVersion,
		Source:  "test",
		Operations: []PatchOperation{{
			Type:         "session_note.update",
			SessionKey:   sessionID,
			Note:         &note,
			Tags:         &TagPatch{Add: []string{"new"}, Remove: []string{"old"}},
			ExpectedHash: HashSession(before),
		}},
	}
	report, err := ApplyPatch(context.Background(), patch, ApplyOptions{Yes: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Backups) != 1 {
		t.Fatalf("expected one session backup, got %#v", report.Backups)
	}
	if _, err := os.Stat(report.Backups[0].Path); err != nil {
		t.Fatalf("expected backup file: %v", err)
	}
	backups, err := ListBackups()
	if err != nil {
		t.Fatal(err)
	}
	if len(backups) == 0 || backups[0].ID != report.Backups[0].ID || !backups[0].Prunable {
		t.Fatalf("expected backup manifest to include patch backup, got %#v", backups)
	}
	auditPath := filepath.Join(defaultAgentDataDir(), "audit", "patch-audit.jsonl")
	auditBytes, err := os.ReadFile(auditPath)
	if err != nil {
		t.Fatalf("expected patch audit log: %v", err)
	}
	if !strings.Contains(string(auditBytes), `"success":true`) || !strings.Contains(string(auditBytes), `"source":"test"`) {
		t.Fatalf("unexpected audit log: %s", string(auditBytes))
	}
	summary, err := manager.Summary(context.Background(), sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Note != "new note" || strings.Join(summary.Tags, ",") != "new" {
		t.Fatalf("expected patched session, got %#v", summary)
	}
}

func TestPruneBackupsDryRunAndPermanent(t *testing.T) {
	dir := t.TempDir()
	backupDir := filepath.Join(dir, "backups")
	if err := os.MkdirAll(backupDir, 0o700); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UnixMilli()
	var backups []BackupManifest
	for idx := 0; idx < 3; idx++ {
		path := filepath.Join(backupDir, fmt.Sprintf("sessions-old-%d.sqlite", idx))
		if err := os.WriteFile(path, []byte("backup"), 0o600); err != nil {
			t.Fatal(err)
		}
		backup := BackupManifest{
			ID:        fmt.Sprintf("sessions-old-%d", idx),
			Type:      "sessions",
			Reason:    "agent-data-patch",
			Path:      path,
			CreatedAt: now - int64((idx+40)*24*60*60*1000),
			Size:      6,
			Prunable:  true,
		}
		if err := appendBackupManifest(backupDir, backup); err != nil {
			t.Fatal(err)
		}
		backups = append(backups, backup)
	}
	t.Setenv("WAVETERM_AI_SESSIONS_SQLITE_INDEX", filepath.Join(dir, "index-v2.sqlite"))
	wavebase.DataHome_VarCache = dir

	dryRunReport, err := PruneBackups(PruneOptions{DryRun: true, Keep: 1, Days: 1, Permanent: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(dryRunReport.Deleted) != 2 {
		t.Fatalf("expected dry-run to select 2 old backups, got %#v", dryRunReport)
	}
	if _, err := os.Stat(backups[2].Path); err != nil {
		t.Fatalf("dry-run should not delete: %v", err)
	}

	report, err := PruneBackups(PruneOptions{Yes: true, Keep: 1, Days: 1, Permanent: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Deleted) != 2 {
		t.Fatalf("expected 2 deleted backups, got %#v", report)
	}
	if _, err := os.Stat(backups[2].Path); !os.IsNotExist(err) {
		t.Fatalf("expected old backup to be deleted, stat err=%v", err)
	}
	if _, err := os.Stat(backups[0].Path); err != nil {
		t.Fatalf("expected newest backup to be kept: %v", err)
	}
}

func TestApplyPatchRejectsSessionHashMismatch(t *testing.T) {
	sessionID, manager := setupAgentDataSession(t)
	note := "new note"
	patch := Patch{
		Version: PatchVersion,
		Source:  "test",
		Operations: []PatchOperation{{
			Type:         "session_note.update",
			SessionKey:   sessionID,
			Note:         &note,
			ExpectedHash: "bad-hash",
		}},
	}
	_, err := ApplyPatch(context.Background(), patch, ApplyOptions{Yes: true})
	if err == nil || !strings.Contains(err.Error(), "hash mismatch") {
		t.Fatalf("expected hash mismatch, got %v", err)
	}
	summary, err := manager.Summary(context.Background(), sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Note != "old note" {
		t.Fatalf("hash mismatch should not write, got %#v", summary)
	}
}

func TestApplyPatchRequiresPreconditionForRealUpdate(t *testing.T) {
	sessionID, _ := setupAgentDataSession(t)
	note := "new note"
	patch := Patch{
		Version: PatchVersion,
		Source:  "test",
		Operations: []PatchOperation{{
			Type:       "session_note.update",
			SessionKey: sessionID,
			Note:       &note,
		}},
	}
	_, err := ApplyPatch(context.Background(), patch, ApplyOptions{})
	if err == nil || !strings.Contains(err.Error(), "apply requires explicit confirmation") {
		t.Fatalf("expected explicit confirmation rejection before precondition check, got %v", err)
	}
	_, err = ApplyPatch(context.Background(), patch, ApplyOptions{Yes: true})
	if err == nil || !strings.Contains(err.Error(), "requires expectedHash or expectedUpdatedAt") {
		t.Fatalf("expected missing precondition rejection, got %v", err)
	}
}

func TestPatchRejectsUnknownOperationFields(t *testing.T) {
	raw := []byte(`{
		"version": 1,
		"operations": [
			{"type": "session_note.update", "sessionKey": "abc", "sql": "drop table"}
		]
	}`)
	var patch Patch
	if err := json.Unmarshal(raw, &patch); err != nil {
		if strings.Contains(err.Error(), "unknown field") {
			return
		}
		t.Fatalf("expected unknown field rejection, got %v", err)
	}
	_, err := ApplyPatch(context.Background(), patch, ApplyOptions{DryRun: true})
	if err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("expected unknown field rejection, got %v", err)
	}
}

func setupAgentDataCommonText(t *testing.T) string {
	t.Helper()
	dir := setupAgentDataCommonTextRoot(t)
	wavebase.DataHome_VarCache = filepath.Join(dir, "data")
	wavebase.ConfigHome_VarCache = filepath.Join(dir, "config")
	commonTextDBPath = filepath.Join(wavebase.DataHome_VarCache, wavebase.WaveDBDir, wstore.WStoreDBName)
	if err := os.MkdirAll(filepath.Join(wavebase.DataHome_VarCache, wavebase.WaveDBDir), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(wavebase.ConfigHome_VarCache, 0o700); err != nil {
		t.Fatal(err)
	}
	if !wstore.IsInitialized() {
		if err := wstore.InitWStore(); err != nil {
			t.Fatal(err)
		}
	}
	if err := wstore.WithTx(context.Background(), func(tx *wstore.TxWrap) error {
		tx.Exec(`DELETE FROM db_common_text`)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := wconfig.WriteWaveHomeConfigFile(wconfig.SettingsFile, waveobj.MetaMapType{}); err != nil {
		t.Fatal(err)
	}
	id := "88888888-8888-8888-8888-888888888888"
	title := "Common"
	text := "common text"
	updated, err := commontextstore.SaveFromConfigMap(waveobj.MetaMapType{
		wconfig.ConfigKey_CommonTextItems: []wconfig.CommonTextItemType{{
			Id:        id,
			Title:     title,
			Text:      text,
			Tags:      []string{"old"},
			CreatedAt: 1700000000000,
			UpdatedAt: 1700000000000,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !updated {
		t.Fatal("expected common text config save to be handled")
	}
	return id
}

func TestApplyPatchUpdatesCommonTextAndCreatesBackup(t *testing.T) {
	id := setupAgentDataCommonText(t)
	before, found, err := commontextstore.Get(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("expected common text item")
	}
	title := "Updated common"
	content := "updated common text"
	patch := Patch{
		Version: PatchVersion,
		Source:  "test",
		Operations: []PatchOperation{{
			Type:         "common_text.update",
			ID:           id,
			Title:        &title,
			Content:      &content,
			Tags:         &TagPatch{Set: []string{"new", "New"}},
			ExpectedHash: HashCommonText(before),
		}},
	}
	report, err := ApplyPatch(context.Background(), patch, ApplyOptions{Yes: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Backups) != 1 || report.Backups[0].Type != "common_text" {
		t.Fatalf("expected one common text backup, got %#v", report.Backups)
	}
	item, found, err := commontextstore.Get(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("expected common text item")
	}
	if item.Title != title || item.Text != content || strings.Join(item.Tags, ",") != "new" {
		t.Fatalf("expected patched common text item, got %#v", item)
	}
}

func TestApplyPatchDryRunReportsCommonTextChangesAndRejectsEmptyContent(t *testing.T) {
	id := setupAgentDataCommonText(t)
	title := "Updated common"
	content := "updated common text"
	patch := Patch{
		Version: PatchVersion,
		Source:  "test",
		Operations: []PatchOperation{{
			Type:    "common_text.update",
			ID:      id,
			Title:   &title,
			Content: &content,
			Tags:    &TagPatch{Set: []string{"new", "New"}},
		}},
	}
	report, err := ApplyPatch(context.Background(), patch, ApplyOptions{DryRun: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Operations) != 1 || !report.Operations[0].Changed || len(report.Operations[0].Changes) != 3 {
		t.Fatalf("expected title, text, and tags changes, got %#v", report.Operations)
	}
	changesByField := changesByField(report.Operations[0].Changes)
	if changesByField["title"].Before != "Common" || changesByField["title"].After != title {
		t.Fatalf("expected title before/after change, got %#v", changesByField["title"])
	}
	if changesByField["text"].Before != "common text" || changesByField["text"].After != content {
		t.Fatalf("expected text before/after change, got %#v", changesByField["text"])
	}
	if fmt.Sprint(changesByField["tags"].Before) != "[old]" || fmt.Sprint(changesByField["tags"].After) != "[new]" {
		t.Fatalf("expected tags before/after change, got %#v", changesByField["tags"])
	}

	emptyContent := " "
	patch.Operations[0].Content = &emptyContent
	report, err = ApplyPatch(context.Background(), patch, ApplyOptions{DryRun: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Operations) != 1 || !strings.Contains(report.Operations[0].Error, "common text content cannot be empty") {
		t.Fatalf("expected dry-run to reject empty content, got %#v", report.Operations)
	}
}

func TestRestoreFromBackupsRestoresSessionAndCommonTextTables(t *testing.T) {
	sessionID, manager := setupAgentDataSession(t)
	id := setupAgentDataCommonText(t)
	beforeSession, err := manager.Summary(context.Background(), sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	beforeCommonText, found, err := commontextstore.Get(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("expected common text item")
	}
	sessionBackup, err := backupSQLite(context.Background(), "sessions", aisessions.DefaultSQLiteIndexPath(), "test-restore")
	if err != nil {
		t.Fatal(err)
	}
	commonTextBackup, err := backupSQLite(context.Background(), "common_text", commonTextSQLitePath(), "test-restore")
	if err != nil {
		t.Fatal(err)
	}
	backups := []BackupManifest{sessionBackup, commonTextBackup}
	if len(backups) != 2 {
		t.Fatalf("expected session and common text backups, got %#v", backups)
	}

	note := "patched before failure"
	if _, err := manager.NoteAndTags(context.Background(), sessionID, note, []string{"patched"}); err != nil {
		t.Fatal(err)
	}
	content := "patched common text"
	if _, err := commontextstore.Update(context.Background(), commontextstore.UpdateRequest{
		ID:      id,
		Content: &content,
		Tags:    []string{"patched"},
		SetTags: true,
	}); err != nil {
		t.Fatal(err)
	}
	if err := restoreFromBackups(context.Background(), backups); err != nil {
		t.Fatal(err)
	}

	afterSession, err := manager.Summary(context.Background(), sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	if HashSession(afterSession) != HashSession(beforeSession) {
		t.Fatalf("expected session restore, before=%#v after=%#v", beforeSession, afterSession)
	}
	afterCommonText, found, err := commontextstore.Get(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("expected common text item")
	}
	if HashCommonText(afterCommonText) != HashCommonText(beforeCommonText) {
		t.Fatalf("expected common text unchanged, before=%#v after=%#v", beforeCommonText, afterCommonText)
	}
}

func TestTagPatchSetEmptyClearsTags(t *testing.T) {
	raw := []byte(`{
		"version": 1,
		"operations": [
			{"type": "session_note.update", "sessionKey": "abc", "tags": {"set": []}}
		]
	}`)
	var patch Patch
	if err := json.Unmarshal(raw, &patch); err != nil {
		t.Fatal(err)
	}
	if patch.Operations[0].Tags == nil || !patch.Operations[0].Tags.hasSet {
		t.Fatalf("expected empty set to be tracked as explicit set: %#v", patch.Operations[0].Tags)
	}
	tags := applySessionTagPatch([]string{"old"}, patch.Operations[0].Tags)
	if len(tags) != 0 {
		t.Fatalf("expected empty set to clear tags, got %#v", tags)
	}
}

func changesByField(changes []ChangeReport) map[string]ChangeReport {
	indexed := make(map[string]ChangeReport, len(changes))
	for _, change := range changes {
		indexed[change.Field] = change
	}
	return indexed
}
