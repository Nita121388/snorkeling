// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentstatus

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
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
	expectedScriptToken := "wsh_bin"
	if runtime.GOOS == "windows" {
		expectedScriptToken = "WSH_BIN"
	}
	if !strings.Contains(string(script), expectedScriptToken) || !strings.Contains(string(script), "--provider") {
		t.Fatalf("hook script missing expected wsh call:\n%s", string(script))
	}
	if runtime.GOOS == "windows" && strings.Contains(string(script), "ReadToEnd") {
		t.Fatalf("windows hook script must not block while reading stdin:\n%s", string(script))
	}
	if runtime.GOOS == "windows" && strings.Contains(string(script), "powershell.exe") {
		t.Fatalf("windows hook command must not require PowerShell startup:\n%s", string(script))
	}
	if runtime.GOOS == "windows" && strings.Contains(string(script), "Get-Command") {
		t.Fatalf("windows hook script must not scan PATH while resolving wsh:\n%s", string(script))
	}
	if strings.Contains(string(script), "%!(EXTRA") {
		t.Fatalf("hook script contains fmt residue:\n%s", string(script))
	}
	if strings.Contains(string(script), `[ "${WAVETERM:-}" = "1" ]`) {
		t.Fatalf("hook script should not require legacy WAVETERM=1:\n%s", string(script))
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(result.HookPath)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode()&0o111 == 0 {
			t.Fatalf("expected hook script to be executable, mode=%v", info.Mode())
		}
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
	if !commandHookInstalled(result.HooksPath, "PreToolUse", hookCommand(result.HookPath, StateWorking, PhaseTool)) {
		t.Fatalf("expected PreToolUse hook command to include tool phase")
	}
	if runtime.GOOS == "windows" && strings.Contains(hookCommand(result.HookPath, StateWorking, PhaseTool), "powershell.exe") {
		t.Fatalf("windows hook command must not use PowerShell")
	}
	config, err := os.ReadFile(result.ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(config), "hooks = true") || strings.Contains(string(config), "codex_hooks") {
		t.Fatalf("unexpected config:\n%s", string(config))
	}

	statusResult, err := CheckHooks(HookTargetCodex)
	if err != nil {
		t.Fatalf("CheckHooks returned error: %v", err)
	}
	if len(statusResult.Statuses) != 1 || !statusResult.Statuses[0].Current || statusResult.Statuses[0].NeedsInstall {
		t.Fatalf("expected installed codex hook to be current: %+v", statusResult)
	}
}

func TestCheckCodexHooksDetectsLegacyScript(t *testing.T) {
	tmpDir := t.TempDir()
	codexDir := filepath.Join(tmpDir, ".codex")
	if err := os.MkdirAll(codexDir, 0o755); err != nil {
		t.Fatal(err)
	}
	legacyScript := "# SNORKELING_AGENT_STATUS_INTEGRATION_ID=codex\n# SNORKELING_AGENT_STATUS_INTEGRATION_VERSION=1\n[ \"${WAVETERM:-}\" = \"1\" ] || exit 0\n"
	if err := os.WriteFile(filepath.Join(codexDir, hookInstallName()), []byte(legacyScript), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv(codexHomeEnvVar, codexDir)

	statusResult, err := CheckHooks(HookTargetCodex)
	if err != nil {
		t.Fatalf("CheckHooks returned error: %v", err)
	}
	if len(statusResult.Statuses) != 1 {
		t.Fatalf("expected one status: %+v", statusResult)
	}
	status := statusResult.Statuses[0]
	if !status.Installed || status.Current || !status.NeedsInstall {
		t.Fatalf("expected legacy hook to need install: %+v", status)
	}
}

func TestCheckCodexHooksDetectsVersionTwoScript(t *testing.T) {
	tmpDir := t.TempDir()
	codexDir := filepath.Join(tmpDir, ".codex")
	if err := os.MkdirAll(codexDir, 0o755); err != nil {
		t.Fatal(err)
	}
	legacyScript := "# SNORKELING_AGENT_STATUS_INTEGRATION_ID=codex\n# SNORKELING_AGENT_STATUS_INTEGRATION_VERSION=2\n$inputText = [Console]::In.ReadToEnd()\n"
	if err := os.WriteFile(filepath.Join(codexDir, hookInstallName()), []byte(legacyScript), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv(codexHomeEnvVar, codexDir)

	statusResult, err := CheckHooks(HookTargetCodex)
	if err != nil {
		t.Fatalf("CheckHooks returned error: %v", err)
	}
	if len(statusResult.Statuses) != 1 {
		t.Fatalf("expected one status: %+v", statusResult)
	}
	status := statusResult.Statuses[0]
	if !status.Installed || status.Current || !status.NeedsInstall {
		t.Fatalf("expected version 2 hook to need install: %+v", status)
	}
	if status.InstalledVersion != 2 || status.RequiredVersion != hookInstallVersion {
		t.Fatalf("unexpected hook versions: %+v", status)
	}
}

func TestInstallCodexHooksPrunesLegacyManagedCommands(t *testing.T) {
	tmpDir := t.TempDir()
	codexDir := filepath.Join(tmpDir, ".codex")
	if err := os.MkdirAll(codexDir, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv(codexHomeEnvVar, codexDir)

	legacyCommand := "bash '" + filepath.Join(codexDir, hookInstallBaseName+".sh") + "' working"
	existing := map[string]any{
		"hooks": map[string]any{
			"PreToolUse": []any{
				map[string]any{
					"hooks": []any{
						map[string]any{
							"type":    "command",
							"command": legacyCommand,
							"timeout": float64(10),
						},
						map[string]any{
							"type":    "command",
							"command": "echo keep-me",
							"timeout": float64(10),
						},
					},
				},
			},
		},
	}
	hooksBytes, err := json.Marshal(existing)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(codexDir, "hooks.json"), hooksBytes, 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := InstallCodexHooks()
	if err != nil {
		t.Fatalf("InstallCodexHooks returned error: %v", err)
	}

	if commandHookInstalled(result.HooksPath, "PreToolUse", legacyCommand) {
		t.Fatalf("legacy managed hook command should be pruned")
	}
	if !commandHookInstalled(result.HooksPath, "PreToolUse", "echo keep-me") {
		t.Fatalf("unmanaged hook command should be preserved")
	}
	if !commandHookInstalled(result.HooksPath, "PreToolUse", hookCommand(result.HookPath, StateWorking, PhaseTool)) {
		t.Fatalf("new managed hook command missing")
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
	claudeGuardToken := `provider == "claude"`
	if runtime.GOOS == "windows" {
		claudeGuardToken = `--provider "claude"`
	}
	if runtime.GOOS != "windows" && !strings.Contains(string(script), "SubagentStop") {
		t.Fatalf("hook script missing Claude-specific guards:\n%s", string(script))
	}
	if !strings.Contains(string(script), claudeGuardToken) {
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
