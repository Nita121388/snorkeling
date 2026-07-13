// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentstatus

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
)

func TestInstallClaudeHooksOnWindowsUsesCmdHookWithoutStdinRedirection(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows command quoting")
	}
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
	if filepath.Ext(result.HookPath) != ".cmd" {
		t.Fatalf("expected Claude windows hook path to be a command script, got %q", result.HookPath)
	}
	settingsBytes, err := os.ReadFile(result.SettingsPath)
	if err != nil {
		t.Fatal(err)
	}
	var settings map[string]any
	if err := json.Unmarshal(settingsBytes, &settings); err != nil {
		t.Fatal(err)
	}
	for _, command := range hookCommands(settings) {
		if !strings.HasPrefix(command, `cmd.exe /d /q /c "call ""`) {
			t.Fatalf("expected Claude windows hook command to call cmd hook directly: %q", command)
		}
		if !strings.Contains(command, hookInstallBaseName+".cmd") {
			t.Fatalf("expected Claude windows hook command to call the cmd hook script: %q", command)
		}
		for _, forbidden := range []string{"bash ", "bash.exe", "<nul", ">nul", hookInstallBaseName + ".sh"} {
			if strings.Contains(command, forbidden) {
				t.Fatalf("Claude windows hook command should not contain %q: %q", forbidden, command)
			}
		}
	}
}

func TestClaudeHookCommandExecutesOnWindows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows command quoting")
	}
	hookPath := filepath.Join(t.TempDir(), "hook.cmd")
	if err := os.WriteFile(hookPath, []byte("@echo claude-hook-ran\r\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	command := claudeHookCommand(hookPath, StateWorking, PhaseThinking)
	output, err := runWindowsHookCommand(command)
	if err != nil {
		t.Fatalf("Claude hook command failed: %v\n%s", err, output)
	}
	if strings.TrimSpace(string(output)) != "claude-hook-ran" {
		t.Fatalf("unexpected Claude hook output: %q", output)
	}
}

func TestCodexStructuredHookCommandsReturnContinueJSONOnWindows(t *testing.T) {
	hookPath := filepath.Join(t.TempDir(), "hook.cmd")
	if err := os.WriteFile(hookPath, []byte("@echo hook-noise\r\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	tests := []agentStatusHookSpec{
		{event: "SessionStart", action: StateIdle, phase: PhaseNone},
		{event: "UserPromptSubmit", action: StateWorking, phase: PhaseThinking},
		{event: "PreToolUse", action: StateWorking, phase: PhaseTool},
		{event: "PermissionRequest", action: StateBlocked, phase: PhaseApproval},
		{event: "Stop", action: StateIdle, phase: PhaseNone},
	}
	for _, test := range tests {
		t.Run(test.event, func(t *testing.T) {
			output, err := runWindowsHookCommand(codexHookCommand(hookPath, test))
			if err != nil {
				t.Fatalf("Codex hook command failed: %v\n%s", err, output)
			}
			var result struct {
				Continue bool `json:"continue"`
			}
			if err := json.Unmarshal([]byte(strings.TrimSpace(string(output))), &result); err != nil {
				t.Fatalf("Codex hook output is not JSON: %v\n%s", err, output)
			}
			if !result.Continue {
				t.Fatalf("Codex hook output did not continue: %s", output)
			}
		})
	}
}

func runWindowsHookCommand(command string) ([]byte, error) {
	cmd := exec.Command("cmd.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: "cmd.exe /d /q /c " + command}
	return cmd.CombinedOutput()
}

// TestBatchScriptHasUnconditionalProbe asserts the installed .cmd writes an "alive"
// debug line before any early-exit gate (missing-action / invalid-action /
// missing-block / missing-jwt / missing-wsh), so a hook that fails to reach the
// body is observable in the log. Benign DEBUG_LOG-assigning ifs are allowed before it.
func TestBatchScriptHasUnconditionalProbe(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows batch script")
	}
	script := agentStatusBatchHookScript(HookTargetClaude)
	probeIdx := strings.Index(script, `alive provider=`)
	if probeIdx < 0 {
		t.Fatalf("batch hook script is missing the unconditional alive probe:\n%s", script)
	}
	startIdx := strings.Index(script, `start provider=`)
	if startIdx < 0 {
		t.Fatalf("batch hook script is missing the start debug line:\n%s", script)
	}
	if probeIdx > startIdx {
		t.Fatalf("alive probe must precede the start debug line")
	}
	// None of the early-exit gates may appear before the alive probe.
	for _, gate := range []string{
		`exit missing-action`,
		`exit invalid-action`,
		`exit missing-block`,
		`exit missing-jwt`,
		`exit missing-wsh`,
		`exit missing-userprofile`,
	} {
		if gateIdx := strings.Index(script, gate); gateIdx >= 0 && gateIdx < probeIdx {
			t.Fatalf("alive probe at %d must precede early-exit gate %q at %d", probeIdx, gate, gateIdx)
		}
	}
}

// TestHooksScriptHasCRLFWindows asserts the installed .cmd uses CRLF line endings
// so cmd.exe parses if/goto blocks reliably.
func TestHooksScriptHasCRLFWindows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows CRLF")
	}
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
	if !bytes.Contains(script, []byte("\r\n")) {
		t.Fatalf("installed windows .cmd must use CRLF line endings")
	}
	// No bare LF should remain after CRLF normalization. Confirm every \n is preceded by \r.
	for i, b := range script {
		if b == '\n' && (i == 0 || script[i-1] != '\r') {
			t.Fatalf("installed windows .cmd has bare LF at byte %d (should be CRLF)", i)
		}
	}
}
