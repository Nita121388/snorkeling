// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentstatus

import (
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
		{event: "UserPromptSubmit", action: StateWorking, phase: PhaseThinking},
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
