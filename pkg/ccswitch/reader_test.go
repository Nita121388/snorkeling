// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package ccswitch

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

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
