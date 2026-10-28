// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package ccswitch

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jmoiron/sqlx"
	_ "github.com/mattn/go-sqlite3"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

func useTestWaveDataDir(t *testing.T) string {
	t.Helper()
	previous := wavebase.DataHome_VarCache
	dir := t.TempDir()
	wavebase.DataHome_VarCache = dir
	t.Cleanup(func() {
		wavebase.DataHome_VarCache = previous
	})
	return dir
}

func writeTestFile(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func readJSONDocument(t *testing.T, path string) map[string]json.RawMessage {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	return document
}

func TestMaterializeClaudeConfigDirInheritsOnlyGlobalHooks(t *testing.T) {
	useTestWaveDataDir(t)
	globalSettings := filepath.Join(t.TempDir(), "settings.json")
	writeTestFile(t, globalSettings, []byte(`{
  "hooks": {"PreToolUse": [{"hooks": [{"type": "command", "command": "test-hook"}]}]},
  "permissions": {"allow": ["Bash"]}
}`))
	hooks, err := readClaudeHooks(globalSettings)
	if err != nil {
		t.Fatal(err)
	}
	dir, err := materializeClaudeConfigDir("vendor-a", map[string]string{"ANTHROPIC_MODEL": "test-model"}, hooks)
	if err != nil {
		t.Fatal(err)
	}
	document := readJSONDocument(t, filepath.Join(dir, "settings.json"))
	if len(document) != 2 || document["env"] == nil || document["hooks"] == nil {
		t.Fatalf("expected only env and hooks, got keys %#v", document)
	}
	if document["permissions"] != nil {
		t.Fatal("global permissions leaked into vendor settings")
	}
}

func TestClaudeVendorModelRequiresUnambiguousConfig(t *testing.T) {
	tests := []struct {
		name string
		env  map[string]string
		want string
	}{
		{name: "explicit", env: map[string]string{"ANTHROPIC_MODEL": " model-a "}, want: "model-a"},
		{name: "same aliases", env: map[string]string{
			"ANTHROPIC_DEFAULT_OPUS_MODEL":   "model-b",
			"ANTHROPIC_DEFAULT_SONNET_MODEL": "model-b",
			"ANTHROPIC_DEFAULT_HAIKU_MODEL":  "model-b",
		}, want: "model-b"},
		{name: "different aliases", env: map[string]string{
			"ANTHROPIC_DEFAULT_OPUS_MODEL":   "model-opus",
			"ANTHROPIC_DEFAULT_SONNET_MODEL": "model-sonnet",
		}},
		{name: "missing", env: map[string]string{"ANTHROPIC_BASE_URL": "https://example.invalid"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := claudeVendorModel(test.env); got != test.want {
				t.Fatalf("claudeVendorModel() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestMaterializeClaudeConfigDirWithoutHooksPreservesLegacyShape(t *testing.T) {
	useTestWaveDataDir(t)
	dir, err := materializeClaudeConfigDir("vendor-a", map[string]string{"A": "B"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	document := readJSONDocument(t, filepath.Join(dir, "settings.json"))
	if len(document) != 1 || document["env"] == nil || document["hooks"] != nil {
		t.Fatalf("expected env-only document, got %#v", document)
	}
}

func TestMaterializeClaudeConfigDirIsIdempotentAndRefreshesHooks(t *testing.T) {
	useTestWaveDataDir(t)
	hooksA := json.RawMessage(`{"Stop":[{"hooks":[{"type":"command","command":"a"}]}]}`)
	dir, err := materializeClaudeConfigDir("vendor-a", map[string]string{"A": "B"}, hooksA)
	if err != nil {
		t.Fatal(err)
	}
	settingsPath := filepath.Join(dir, "settings.json")
	firstInfo, err := os.Stat(settingsPath)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(20 * time.Millisecond)
	if _, err := materializeClaudeConfigDir("vendor-a", map[string]string{"A": "B"}, hooksA); err != nil {
		t.Fatal(err)
	}
	secondInfo, err := os.Stat(settingsPath)
	if err != nil {
		t.Fatal(err)
	}
	if !firstInfo.ModTime().Equal(secondInfo.ModTime()) {
		t.Fatal("unchanged settings were rewritten")
	}
	hooksB := json.RawMessage(`{"Stop":[{"hooks":[{"type":"command","command":"b"}]}]}`)
	if _, err := materializeClaudeConfigDir("vendor-a", map[string]string{"A": "B"}, hooksB); err != nil {
		t.Fatal(err)
	}
	document := readJSONDocument(t, settingsPath)
	if string(document["hooks"]) == string(hooksA) {
		t.Fatal("updated hooks were not materialized")
	}
}

func TestMaterializeClaudeConfigDirRejectsUnsafeVendorIDs(t *testing.T) {
	dataDir := useTestWaveDataDir(t)
	for _, vendorID := range []string{"", ".", "..", "../escape", `..\escape`, "nested/vendor"} {
		if _, err := materializeClaudeConfigDir(vendorID, map[string]string{"A": "B"}, nil); err == nil {
			t.Fatalf("expected %q to be rejected", vendorID)
		}
	}
	entries, err := os.ReadDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("invalid IDs created data: %#v", entries)
	}
}

func TestGCVendorsPreservesClaudeSessionData(t *testing.T) {
	useTestWaveDataDir(t)
	orphan := filepath.Join(claudeVendorsRoot(), "orphan")
	settingsPath := filepath.Join(orphan, "settings.json")
	sessionPath := filepath.Join(orphan, "projects", "project", "session.jsonl")
	writeTestFile(t, settingsPath, []byte(`{"env":{"TOKEN":"redacted"}}`))
	writeTestFile(t, sessionPath, []byte(`{"type":"user"}`))

	gcVendors(context.Background(), CcSwitchProviderAppType, nil)

	if _, err := os.Stat(settingsPath); !os.IsNotExist(err) {
		t.Fatalf("expected Wave-owned settings to be removed, got %v", err)
	}
	if _, err := os.Stat(sessionPath); err != nil {
		t.Fatalf("session data was not preserved: %v", err)
	}
}

func TestGCVendorsRemovesOnlyEmptyOrphans(t *testing.T) {
	useTestWaveDataDir(t)
	orphan := filepath.Join(claudeVendorsRoot(), "orphan")
	writeTestFile(t, filepath.Join(orphan, "settings.json"), []byte(`{"env":{}}`))
	live := filepath.Join(claudeVendorsRoot(), "live")
	writeTestFile(t, filepath.Join(live, "settings.json"), []byte(`{"env":{}}`))

	gcVendors(context.Background(), CcSwitchProviderAppType, []Vendor{{ID: "live"}})

	if _, err := os.Stat(orphan); !os.IsNotExist(err) {
		t.Fatalf("expected empty orphan to be removed, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(live, "settings.json")); err != nil {
		t.Fatalf("live vendor was modified: %v", err)
	}
}

func TestMaterializeOpenCodeConfigDir(t *testing.T) {
	useTestWaveDataDir(t)
	dir, err := materializeOpenCodeConfigDir("vendor-a", map[string]string{"OPENCODE_PROVIDER": "test-opencode", "OPENCODE_API_KEY": "sk-opencode-test"})
	if err != nil {
		t.Fatal(err)
	}
	if dir == "" {
		t.Fatal("materializeOpenCodeConfigDir returned empty dir")
	}
	document := readJSONDocument(t, filepath.Join(dir, "opencode.json"))
	if len(document) != 1 || document["env"] == nil {
		t.Fatalf("expected env-only document, got keys %#v", document)
	}
	var env map[string]json.RawMessage
	if err := json.Unmarshal(document["env"], &env); err != nil {
		t.Fatal(err)
	}
	if got := string(env["OPENCODE_PROVIDER"]); !strings.Contains(got, "test-opencode") {
		t.Fatalf("OPENCODE_PROVIDER = %q, want %q", got, "test-opencode")
	}
}

func TestMaterializeOpenCodeConfigDirRejectsUnsafeVendorIDs(t *testing.T) {
	dataDir := useTestWaveDataDir(t)
	for _, vendorID := range []string{"", ".", "..", "../escape", `..\escape`, "nested/vendor"} {
		if _, err := materializeOpenCodeConfigDir(vendorID, map[string]string{"A": "B"}); err == nil {
			t.Fatalf("expected %q to be rejected", vendorID)
		}
	}
	entries, err := os.ReadDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("invalid IDs created data: %#v", entries)
	}
}

func TestMaterializePiConfigDir(t *testing.T) {
	useTestWaveDataDir(t)
	dir, err := materializePiConfigDir("vendor-a", map[string]string{"PI_CODING_AGENT_API_KEY": "sk-pi-test", "PI_CODING_AGENT_BASE_URL": "https://pi.example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	if dir == "" {
		t.Fatal("materializePiConfigDir returned empty dir")
	}
	document := readJSONDocument(t, filepath.Join(dir, "config.json"))
	if len(document) != 1 || document["env"] == nil {
		t.Fatalf("expected env-only document, got keys %#v", document)
	}
	var env map[string]json.RawMessage
	if err := json.Unmarshal(document["env"], &env); err != nil {
		t.Fatal(err)
	}
	if got := string(env["PI_CODING_AGENT_API_KEY"]); !strings.Contains(got, "sk-pi-test") {
		t.Fatalf("PI_CODING_AGENT_API_KEY = %q, want %q", got, "sk-pi-test")
	}
}

func TestMaterializePiConfigDirRejectsUnsafeVendorIDs(t *testing.T) {
	dataDir := useTestWaveDataDir(t)
	for _, vendorID := range []string{"", ".", "..", "../escape", `..\escape`, "nested/vendor"} {
		if _, err := materializePiConfigDir(vendorID, map[string]string{"A": "B"}); err == nil {
			t.Fatalf("expected %q to be rejected", vendorID)
		}
	}
	entries, err := os.ReadDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("invalid IDs created data: %#v", entries)
	}
}

// withTestCcSwitchDB writes a cc-switch SQLite DB (mirroring the real schema) under
// a temp HOME dir and returns that dir. DBPath() resolves ~/.cc-switch/cc-switch.db
// against $HOME (via wavebase.ExpandHomeDir → os.UserHomeDir), so overriding HOME
// in the test keeps the production API untouched.
func withTestCcSwitchDB(t *testing.T, rows []struct {
	ID, AppType, Name, Settings string
}) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	dbPath := filepath.Join(home, ".cc-switch", "cc-switch.db")
	writeTestFile(t, dbPath, nil)
	if err := os.WriteFile(dbPath, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	// Use a writable handle for schema + fixture setup (openReadOnly is mode=ro).
	db, err := sqlx.Open("sqlite3", "file:"+dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.PingContext(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(context.Background(), `CREATE TABLE providers (
		id TEXT NOT NULL, app_type TEXT NOT NULL, name TEXT NOT NULL,
		settings_config TEXT NOT NULL, category TEXT, is_current BOOLEAN NOT NULL DEFAULT 0,
		PRIMARY KEY (id, app_type))`); err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if _, err := db.ExecContext(context.Background(),
			`INSERT INTO providers (id, app_type, name, settings_config, category, is_current) VALUES (?,?,?,?,?,0)`,
			row.ID, row.AppType, row.Name, row.Settings, nil); err != nil {
			t.Fatal(err)
		}
	}
	return home
}

func TestListWaveAIVendorsFiltersEligibleAppTypes(t *testing.T) {
	withTestCcSwitchDB(t, []struct {
		ID, AppType, Name, Settings string
	}{
		{"hermes-glm", "hermes", "GLM", `{"name":"glm","base_url":"https://api.supxh.xin","api_key":"sk-hermes","api_mode":"anthropic_messages","models":[{"id":"glm-5.2","name":"glm-5.2"}]}`},
		{"pi-deepseek", "pi", "deepseek", `{"baseUrl":"https://api.inferaiapi.com/v1","api":"openai-completions","apiKey":"sk-pi","models":[{"id":"deepseek-v4-pro","name":"deepseek-v4-pro"}]}`},
		{"mycodex", "codex", "My Codex", `{"auth":{"OPENAI_API_KEY":"sk-x"},"config":"base_url = \"https://x/v1\""}`},
		{"glm", "claude", "GLM", `{"env":{"ANTHROPIC_BASE_URL":"https://x"}}`},
	})
	list, err := ListWaveAIVendors(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !list.Detected {
		t.Fatal("expected Detected=true when DB exists")
	}
	if len(list.Vendors) != 2 {
		t.Fatalf("expected 2 eligible vendors (pi+hermes), got %d: %#v", len(list.Vendors), list.Vendors)
	}
	byID := map[string]WaveAIVendor{}
	for _, v := range list.Vendors {
		byID[v.ID+"@"+v.AppType] = v
	}
	// hermes (snake_case base_url/api_key/api_mode) must be parsed.
	h := byID["hermes-glm@hermes"]
	if h.Endpoint != "https://api.supxh.xin" || h.APIType != "anthropic-messages" {
		t.Fatalf("hermes parse wrong: %#v", h)
	}
	if len(h.Models) != 1 || h.Models[0] != "glm-5.2" {
		t.Fatalf("hermes models wrong: %#v", h.Models)
	}
	// pi (camelCase) must be parsed, and openai-completions normalizes to openai-chat.
	p := byID["pi-deepseek@pi"]
	if p.Endpoint != "https://api.inferaiapi.com/v1" || p.APIType != "openai-chat" {
		t.Fatalf("pi parse wrong: %#v", p)
	}
}

func TestGetWaveAIImportDataDisambiguatesByAppType(t *testing.T) {
	withTestCcSwitchDB(t, []struct {
		ID, AppType, Name, Settings string
	}{
		{"deepseek", "hermes", "mydeepseek", `{"name":"mydeepseek","base_url":"https://api.inferaiapi.com/v1","api_key":"sk-hermes-ds","api_mode":"openai-completions","models":[{"id":"deepseek-v4-pro","name":"deepseek-v4-pro"}]}`},
		{"deepseek", "pi", "deepseek", `{"baseUrl":"https://api.inferaiapi.com/v1","api":"openai-completions","apiKey":"sk-pi-ds","models":[{"id":"deepseek-v4-flash","name":"deepseek-v4-flash"}]}`},
	})
	// Without appType, the pi row wins (ORDER BY name is stable, but both match
	// the IN clause; the parser must return *one* of them deterministically). We
	// assert the disambiguated lookups instead.
	hermes, err := GetWaveAIImportData(context.Background(), "deepseek", "hermes")
	if err != nil {
		t.Fatal(err)
	}
	if hermes.Token != "sk-hermes-ds" || !contains(hermes.Vendor.Models, "deepseek-v4-pro") {
		t.Fatalf("hermes lookup wrong: %#v", hermes)
	}
	pi, err := GetWaveAIImportData(context.Background(), "deepseek", "pi")
	if err != nil {
		t.Fatal(err)
	}
	if pi.Token != "sk-pi-ds" || !contains(pi.Vendor.Models, "deepseek-v4-flash") {
		t.Fatalf("pi lookup wrong: %#v", pi)
	}
	// Unknown appType variant must not match.
	if _, err := GetWaveAIImportData(context.Background(), "deepseek", "codex"); err == nil {
		t.Fatal("expected codex appType to not match the deepseek providers")
	}
}

func contains(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}
