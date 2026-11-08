// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentskill

import (
	"os"
	"runtime"
	"path/filepath"
	"strings"
	"testing"
)

func TestEmbeddedFilesExist(t *testing.T) {
	files, err := Files()
	if err != nil {
		t.Fatal(err)
	}
	if len(files) < 4 {
		t.Fatalf("expected the skill to ship several files, got %v", files)
	}
	want := []string{"SKILL.md", "reference/commands.md", "reference/recipes.md", "scripts/ensure-token.sh"}
	have := map[string]bool{}
	for _, f := range files {
		have[f] = true
	}
	for _, w := range want {
		if !have[w] {
			t.Fatalf("missing embedded file %q (have %v)", w, files)
		}
	}
}

// TestSkillStatesTheRedLines guards the security contract: the skill is where an
// agent learns what it must not do, so the red lines have to be in the shipped
// text, not only in the design doc.
func TestSkillStatesTheRedLines(t *testing.T) {
	data, err := Read("SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, want := range []string{
		"Never write a token into a skill file",
		"Do not poll",
		"If the token is missing, stop and ask",
		"Assume the UI moved",
		"E_UNAUTHORIZED",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("SKILL.md must state %q", want)
		}
	}
}

func TestInstallWritesFiles(t *testing.T) {
	root := t.TempDir()
	written, err := Install(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(written) < 4 {
		t.Fatalf("expected several files, got %v", written)
	}
	skill := filepath.Join(root, SkillName, "SKILL.md")
	if _, err := os.Stat(skill); err != nil {
		t.Fatalf("SKILL.md not installed: %v", err)
	}
	// scripts stay executable (Windows has no POSIX mode bits)
	info, err := os.Stat(filepath.Join(root, SkillName, "scripts", "ensure-token.sh"))
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o100 == 0 {
		t.Fatalf("script must be executable, got %v", info.Mode().Perm())
	}
}

func TestInstallIsIdempotentAndContained(t *testing.T) {
	root := t.TempDir()
	if _, err := Install(root); err != nil {
		t.Fatal(err)
	}
	if _, err := Install(root); err != nil {
		t.Fatalf("second install must succeed: %v", err)
	}
	// it must not touch siblings
	if _, err := os.Stat(filepath.Join(root, "SKILL.md")); err == nil {
		t.Fatal("install must only write inside its own skill directory")
	}
	if _, err := Install(""); err == nil {
		t.Fatal("empty root must be refused")
	}
}
