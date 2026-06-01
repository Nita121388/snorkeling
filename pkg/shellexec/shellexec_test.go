// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellexec

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
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

func TestApplyCwdToShellCommandLeavesInteractiveShellBlank(t *testing.T) {
	got := applyCwdToShellCommand("", CommandOptsType{Cwd: "~/Primary/projects/snorkeling"})
	if got != "" {
		t.Fatalf("expected blank command for interactive shell, got %q", got)
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
