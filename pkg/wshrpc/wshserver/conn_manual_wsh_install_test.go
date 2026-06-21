// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
)

func TestMakeManualRemoteTempPathUsesUserTempForWindows(t *testing.T) {
	path := makeManualRemoteTempPath("windows", "x64", "abc123")
	if strings.HasPrefix(path, "/tmp/") {
		t.Fatalf("expected windows temp path outside /tmp, got %q", path)
	}
	if !strings.HasPrefix(path, ".snorkeling/tmp/") {
		t.Fatalf("expected windows temp path under .snorkeling/tmp, got %q", path)
	}
}

func TestMakeManualRemoteWshPathUsesExeForWindows(t *testing.T) {
	path := makeManualRemoteWshPath("windows")
	if path != "$HOME/.snorkeling/bin/wsh.exe" {
		t.Fatalf("expected windows remote wsh path to use .exe, got %q", path)
	}
}

func TestBuildManualWshInstallPowerShellCommandPreparesRemoteDirs(t *testing.T) {
	remotePrepareCmd, _ := buildManualRemoteInstallCommands("windows", ".snorkeling/tmp/wsh.tmp", "$HOME/.snorkeling/bin/wsh.exe")
	cmd := buildManualWshInstallPowerShellCommand("break@100.65.122.71", `E:\wsh.exe`, "break@100.65.122.71", "", ".snorkeling/tmp/wsh.tmp", remotePrepareCmd, "true")
	if !strings.Contains(cmd, "==> Preparing remote directories") {
		t.Fatalf("expected powershell installer to prepare remote directories")
	}
	if !strings.Contains(cmd, "powershell -NoProfile -NonInteractive") {
		t.Fatalf("expected powershell installer to invoke remote powershell")
	}
	if !strings.Contains(cmd, "-EncodedCommand") {
		t.Fatalf("expected remote powershell command to be encoded")
	}
	if strings.Contains(cmd, "Out-Null") {
		t.Fatalf("expected remote powershell script to be encoded before passing to ssh")
	}
}

func TestBuildManualRemoteInstallCommandsUsesPosixForNonWindows(t *testing.T) {
	remotePrepareCmd, remoteInstallCmd := buildManualRemoteInstallCommands("linux", "/tmp/wsh.tmp", "$HOME/.snorkeling/bin/wsh")
	if strings.Contains(remotePrepareCmd, "powershell") || strings.Contains(remoteInstallCmd, "powershell") {
		t.Fatalf("expected non-windows remote commands to remain posix")
	}
}

func TestEncodePowerShellCommand(t *testing.T) {
	encoded := shellutil.EncodePowerShellCommand(`Write-Host "ok"`)
	if encoded == "" {
		t.Fatalf("expected encoded command")
	}
	if strings.Contains(encoded, "Write-Host") {
		t.Fatalf("expected encoded command not to contain raw script")
	}
}
