// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package hero

import (
	"strings"
	"testing"
)

// TestRootAGENTSIdentifiesHero guards the stage-entry identity contract: the
// root AGENTS.md is the ONLY file a provider (pi/codex) auto-injects from the
// hero home base, so it must carry the hero's identity (emoji + name + role)
// and a hard rule to read CHARTER.md — not merely point at it. Regression:
// rootPointerTemplate used to emit a 6-line pointer with zero identity text,
// so a hero launched in its own base could not answer "who are you".
func TestRootAGENTSIdentifiesHero(t *testing.T) {
	const role = "看护活跃 agent 的 Note/Tags/状态：120s 一轮 · 证据可解释 · 永不覆盖"
	out := rootPointerTemplate(Hero{
		ID:      "hero-feaa3f86",
		Name:    "状态维护Hero",
		Emoji:   "🦸",
		Role:    role,
	})

	if !strings.Contains(out, role) {
		t.Errorf("root AGENTS.md must inline the hero role (identity summary), got:\n%s", out)
	}
	if !strings.Contains(out, "🦸 状态维护Hero") {
		t.Errorf("root AGENTS.md must name the hero (emoji + name), got:\n%s", out)
	}
	if !strings.Contains(out, "必读") || !strings.Contains(out, ".hero/CHARTER.md") {
		t.Errorf("root AGENTS.md must carry a hard rule to read .hero/CHARTER.md before answering, got:\n%s", out)
	}
}

// TestScaffoldedRootAGENTSIdentifiesHero runs the same contract end-to-end
// through Create, so the disk artifact — not just the template — is covered.
func TestScaffoldedRootAGENTSIdentifiesHero(t *testing.T) {
	const role = "备份归档与恢复演练，负责每周完整性与可恢复性检查"
	res, err := Create(Options{
		Root:     t.TempDir(),
		Name:     "备份Hero",
		Emoji:    "🛡️",
		Role:     role,
		Provider: "pi",
		Now:      fixedNow,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range res.Files {
		if strings.HasSuffix(f.Path, "AGENTS.md") && !strings.Contains(f.Path, ".hero") {
			body := string(f.Bytes)
			if !strings.Contains(body, role) {
				t.Errorf("scaffolded %s must inline the role, got:\n%s", f.Path, body)
			}
			if !strings.Contains(body, "必读") {
				t.Errorf("scaffolded %s must carry the read-CHARTER hard rule, got:\n%s", f.Path, body)
			}
			return
		}
	}
	t.Fatal("no root-level AGENTS.md in scaffold output")
}
