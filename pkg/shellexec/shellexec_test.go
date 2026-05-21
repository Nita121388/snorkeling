// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellexec

import "testing"

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
