// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellexec

import (
	"encoding/base64"
	"strings"
	"testing"
	"unicode/utf16"

	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestApplyCwdToShellCommandPreservesRemoteHomeExpansion(t *testing.T) {
	got := applyCwdToShellCommand("codex", CommandOptsType{Cwd: "~/Primary/projects/snorkeling"})
	expected := `cd ~/Primary/projects/snorkeling && codex`
	if got != expected {
		t.Fatalf("expected %q, got %q", expected, got)
	}
}

func TestApplyCwdToShellCommandQuotesUnsafeCwd(t *testing.T) {
	got := applyCwdToShellCommand("codex", CommandOptsType{Cwd: `~/Project Files/snorkeling`})
	expected := `cd ~/"Project Files/snorkeling" && codex`
	if got != expected {
		t.Fatalf("expected %q, got %q", expected, got)
	}
}

func TestApplyCwdToPowerShellCommandUsesCompatibleSeparator(t *testing.T) {
	got := applyCwdToPowerShellCommand("codex", CommandOptsType{Cwd: `C:\Users\chemclin`})
	expected := `Set-Location -LiteralPath 'C:\Users\chemclin'; if ($?) { codex }`
	if got != expected {
		t.Fatalf("expected %q, got %q", expected, got)
	}
}

func TestMakeNoWshShellCommandAppliesEnvAfterCwd(t *testing.T) {
	got := makeNoWshShellCommand("codex", CommandOptsType{
		Cwd: "~/Project Files",
		SwapToken: &shellutil.TokenSwapEntry{Env: map[string]string{
			"ANTHROPIC_API_KEY": "anthropic-key",
		}},
	})
	expected := `cd ~/"Project Files" && ANTHROPIC_API_KEY=anthropic-key codex`
	if got != expected {
		t.Fatalf("expected %q, got %q", expected, got)
	}
}

func TestMakeNoWshShellCommandAppliesInteractiveEnvAfterCwd(t *testing.T) {
	got := makeNoWshShellCommand("", CommandOptsType{
		Cwd: "/srv/app",
		SwapToken: &shellutil.TokenSwapEntry{Env: map[string]string{
			"WAVETERM_BLOCKID": "block-1",
		}},
	})
	expected := `cd /srv/app && WAVETERM_BLOCKID=block-1 exec "${SHELL:-sh}" -l`
	if got != expected {
		t.Fatalf("expected %q, got %q", expected, got)
	}
}

func TestApplyCwdToShellCommandLeavesInteractiveShellBlank(t *testing.T) {
	got := applyCwdToShellCommand("", CommandOptsType{Cwd: "~/Primary/projects/snorkeling"})
	if got != "" {
		t.Fatalf("expected blank command for interactive shell, got %q", got)
	}
}

func TestApplyCwdToInteractiveShellCommandWrapsShell(t *testing.T) {
	got := applyCwdToInteractiveShellCommand("/bin/bash --rcfile ~/.snorkeling/shell/bash/.bashrc", CommandOptsType{Cwd: "/srv/app"})
	expected := `cd /srv/app && /bin/bash --rcfile ~/.snorkeling/shell/bash/.bashrc`
	if got != expected {
		t.Fatalf("expected %q, got %q", expected, got)
	}
}

func TestWrapShellInvocationWithCwdQuotesShellArgs(t *testing.T) {
	shellPath, shellOpts := wrapShellInvocationWithCwd("/bin/bash", []string{"--rcfile", "/home/user/Project Files/.bashrc"}, CommandOptsType{Cwd: "~/Project Files"})
	if shellPath != "sh" {
		t.Fatalf("expected sh wrapper, got %q", shellPath)
	}
	expected := []string{"-c", `cd ~/"Project Files" && exec /bin/bash --rcfile "/home/user/Project Files/.bashrc"`}
	if len(shellOpts) != len(expected) {
		t.Fatalf("expected opts %#v, got %#v", expected, shellOpts)
	}
	for idx := range expected {
		if shellOpts[idx] != expected[idx] {
			t.Fatalf("expected opts %#v, got %#v", expected, shellOpts)
		}
	}
}

func TestForcedWaveEnvIncludesAgentHookContext(t *testing.T) {
	env := forcedWaveEnv(CommandOptsType{
		ForceJwt: true,
		SwapToken: &shellutil.TokenSwapEntry{Env: map[string]string{
			wavebase.WaveJwtTokenVarName: "jwt-token",
			"WAVETERM_BLOCKID":           "block-1",
			"WAVETERM_AGENT_PROVIDER":    "codex",
			"WAVETERM_AGENT_SESSIONID":   "session-1",
			"UNRELATED":                  "ignored",
		}},
	})
	if env[wavebase.WaveJwtTokenVarName] != "jwt-token" || env["WAVETERM_BLOCKID"] != "block-1" {
		t.Fatalf("expected forced Wave auth env, got %#v", env)
	}
	if env["WAVETERM_AGENT_PROVIDER"] != "codex" || env["WAVETERM_AGENT_SESSIONID"] != "session-1" {
		t.Fatalf("expected forced agent env, got %#v", env)
	}
	if _, ok := env["UNRELATED"]; ok {
		t.Fatalf("unexpected unrelated env copied: %#v", env)
	}
}

func TestForcedWaveEnvRequiresForceJwt(t *testing.T) {
	env := forcedWaveEnv(CommandOptsType{
		SwapToken: &shellutil.TokenSwapEntry{Env: map[string]string{
			wavebase.WaveJwtTokenVarName: "jwt-token",
			"WAVETERM_BLOCKID":           "block-1",
		}},
	})
	if env != nil {
		t.Fatalf("expected nil env without ForceJwt, got %#v", env)
	}
}

func TestCommandEnvIncludesSwapTokenEnvironment(t *testing.T) {
	env := commandEnv(CommandOptsType{
		ForceJwt: true,
		SwapToken: &shellutil.TokenSwapEntry{Env: map[string]string{
			wavebase.WaveJwtTokenVarName: "jwt-token",
			"WAVETERM_BLOCKID":           "block-1",
			"ANTHROPIC_API_KEY":          "anthropic-key",
		}},
	})
	if env[wavebase.WaveJwtTokenVarName] != "jwt-token" || env["WAVETERM_BLOCKID"] != "block-1" {
		t.Fatalf("expected Wave environment, got %#v", env)
	}
	if env["ANTHROPIC_API_KEY"] != "anthropic-key" {
		t.Fatalf("expected custom command environment, got %#v", env)
	}
}

func TestMakeRemoteShellCommandUsesPowerShellWrapperForWindowsInteractiveShell(t *testing.T) {
	remoteInfo := wshrpc.RemoteInfo{
		ClientOs: "windows",
		HomeDir:  `C:\Users\break`,
	}
	got := makeRemoteShellCommand(remoteInfo, `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, shellutil.ShellType_pwsh, "", CommandOptsType{
		Cwd:      `C:\Users\break\project`,
		ForceJwt: true,
		SwapToken: &shellutil.TokenSwapEntry{Env: map[string]string{
			wavebase.WaveJwtTokenVarName: "jwt-token",
			"WAVETERM_BLOCKID":           "block-1",
			"ANTHROPIC_API_KEY":          "ignored-interactive",
		}},
	}, "packed-token")
	if strings.Contains(got, "WAVETERM_SWAPTOKEN=") {
		t.Fatalf("windows remote shell command used a POSIX env prefix: %q", got)
	}
	script := decodePowerShellEncodedCommand(t, got)
	for _, want := range []string{
		`$env:WAVETERM_SWAPTOKEN = "packed-token"`,
		`$env:WAVETERM_BLOCKID = "block-1"`,
		`Set-Location -LiteralPath "C:\Users\break\project"`,
		`$ShellPath = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"`,
		`"C:\Users\break\.snorkeling\shell\pwsh\wavepwsh.ps1"`,
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("expected decoded script to contain %q, got:\n%s", want, script)
		}
	}
	if strings.Contains(script, "ANTHROPIC_API_KEY") {
		t.Fatalf("interactive shell should only receive forced Wave env, got:\n%s", script)
	}
}

func TestMakeRemoteShellCommandUsesPowerShellWrapperForWindowsCommand(t *testing.T) {
	remoteInfo := wshrpc.RemoteInfo{
		ClientOs: "windows",
		HomeDir:  `C:\Users\break`,
	}
	got := makeRemoteShellCommand(remoteInfo, `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, shellutil.ShellType_pwsh, "npm run dev", CommandOptsType{
		Cwd: `C:\Users\break\project`,
		SwapToken: &shellutil.TokenSwapEntry{Env: map[string]string{
			"ANTHROPIC_API_KEY": "anthropic-key",
		}},
	}, "packed-token")
	if strings.Contains(got, "WAVETERM_SWAPTOKEN=") {
		t.Fatalf("windows remote command used a POSIX env prefix: %q", got)
	}
	script := decodePowerShellEncodedCommand(t, got)
	for _, want := range []string{
		`$env:WAVETERM_SWAPTOKEN = "packed-token"`,
		`$env:ANTHROPIC_API_KEY = "anthropic-key"`,
		`Set-Location -LiteralPath "C:\Users\break\project"`,
		`"-Command", "npm run dev"`,
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("expected decoded script to contain %q, got:\n%s", want, script)
		}
	}
}

func TestMakeRemoteShellCommandKeepsPosixPrefixForLinux(t *testing.T) {
	remoteInfo := wshrpc.RemoteInfo{
		ClientOs: "linux",
		HomeDir:  "/home/break",
	}
	got := makeRemoteShellCommand(remoteInfo, "/bin/bash", shellutil.ShellType_bash, "", CommandOptsType{
		ForceJwt: true,
		SwapToken: &shellutil.TokenSwapEntry{Env: map[string]string{
			wavebase.WaveJwtTokenVarName: "jwt-token",
			"WAVETERM_BLOCKID":           "block-1",
		}},
	}, "packed-token")
	for _, want := range []string{
		`WAVETERM_BLOCKID=block-1`,
		`WAVETERM_JWT=jwt-token`,
		`WAVETERM_SWAPTOKEN=packed-token`,
		`/bin/bash --rcfile /home/break/.snorkeling/shell/bash/.bashrc`,
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("expected POSIX command to contain %q, got %q", want, got)
		}
	}
	if strings.Contains(got, "-EncodedCommand") {
		t.Fatalf("linux remote command should not use PowerShell wrapper: %q", got)
	}
}

func decodePowerShellEncodedCommand(t *testing.T, cmd string) string {
	t.Helper()
	fields := strings.Fields(cmd)
	for idx, field := range fields {
		if !strings.EqualFold(field, "-EncodedCommand") {
			continue
		}
		if idx+1 >= len(fields) {
			t.Fatalf("missing encoded command argument in %q", cmd)
		}
		data, err := base64.StdEncoding.DecodeString(fields[idx+1])
		if err != nil {
			t.Fatalf("error decoding encoded command: %v", err)
		}
		if len(data)%2 != 0 {
			t.Fatalf("encoded command is not UTF-16LE: %q", cmd)
		}
		words := make([]uint16, len(data)/2)
		for wordIdx := range words {
			words[wordIdx] = uint16(data[wordIdx*2]) | uint16(data[wordIdx*2+1])<<8
		}
		return string(utf16.Decode(words))
	}
	t.Fatalf("missing -EncodedCommand in %q", cmd)
	return ""
}
