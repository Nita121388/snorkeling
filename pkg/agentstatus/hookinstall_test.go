// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentstatus

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInstallCodexHooksWritesScriptHooksAndConfig(t *testing.T) {
	tmpDir := t.TempDir()
	codexDir := filepath.Join(tmpDir, ".codex")
	if err := os.MkdirAll(codexDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(codexDir, "config.toml"), []byte("[features]\ncodex_hooks = true\nother = true\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv(codexHomeEnvVar, codexDir)

	result, err := InstallCodexHooks()
	if err != nil {
		t.Fatalf("InstallCodexHooks returned error: %v", err)
	}
	if result.Provider != HookTargetCodex {
		t.Fatalf("unexpected provider: %+v", result)
	}
	script, err := os.ReadFile(result.HookPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(script), "wsh_bin") || !strings.Contains(string(script), "--provider") {
		t.Fatalf("hook script missing expected wsh call:\n%s", string(script))
	}
	info, err := os.Stat(result.HookPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&0o111 == 0 {
		t.Fatalf("expected hook script to be executable, mode=%v", info.Mode())
	}

	var hooksFile map[string]any
	hooksBytes, err := os.ReadFile(result.HooksPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(hooksBytes, &hooksFile); err != nil {
		t.Fatal(err)
	}
	hooks := hooksFile["hooks"].(map[string]any)
	if _, ok := hooks["PreToolUse"].([]any); !ok {
		t.Fatalf("expected PreToolUse hook in %#v", hooks)
	}
	config, err := os.ReadFile(result.ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(config), "hooks = true") || strings.Contains(string(config), "codex_hooks") {
		t.Fatalf("unexpected config:\n%s", string(config))
	}
}

func TestInstallClaudeHooksWritesSettings(t *testing.T) {
	tmpDir := t.TempDir()
	claudeDir := filepath.Join(tmpDir, ".claude")
	if err := os.MkdirAll(claudeDir, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv(claudeConfigEnvVar, claudeDir)

	result, err := InstallClaudeHooks()
	if err != nil {
		t.Fatalf("InstallClaudeHooks returned error: %v", err)
	}
	script, err := os.ReadFile(result.HookPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(script), "SubagentStop") || !strings.Contains(string(script), "provider == \"claude\"") {
		t.Fatalf("hook script missing Claude-specific guards:\n%s", string(script))
	}

	var settings map[string]any
	settingsBytes, err := os.ReadFile(result.SettingsPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(settingsBytes, &settings); err != nil {
		t.Fatal(err)
	}
	hooks := settings["hooks"].(map[string]any)
	sessionEnd, ok := hooks["SessionEnd"].([]any)
	if !ok || len(sessionEnd) == 0 {
		t.Fatalf("expected SessionEnd hook in %#v", hooks)
	}
}

func TestBuildCodexConfigWithHooksOnlyTouchesTopLevelFeatures(t *testing.T) {
	config := "profile = \"work\"\n\n[profiles.work.features]\nhooks = false\ncodex_hooks = false\n\n[features]\ncodex_hooks = true\nother = true\n"
	updated := buildCodexConfigWithHooks(config)
	if !strings.Contains(updated, "[profiles.work.features]\nhooks = false\ncodex_hooks = false") {
		t.Fatalf("profile features should be unchanged:\n%s", updated)
	}
	if !strings.Contains(updated, "[features]\nhooks = true\nother = true") {
		t.Fatalf("top-level features should enable hooks and remove codex_hooks:\n%s", updated)
	}
}
