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
		if !strings.HasPrefix(command, `cmd.exe /d /q /c \"call \"\"`) {
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
