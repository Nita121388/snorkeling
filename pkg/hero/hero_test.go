// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package hero

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newTestOptions(tb testing.TB, name string) Options {
	return Options{
		Root: tb.TempDir(),
		Name: name,
		Now:  func() time.Time { return time.Date(2024, 11, 12, 12, 0, 0, 0, time.UTC) },
	}
}

func TestSlugify(t *testing.T) {
	cases := map[string]string{
		"backup-guard":      "backup-guard",
		"Backup Guard":      "backup-guard",
		"  spaced  name  ":  "spaced-name",
		"Weird/Chars:Here!": "weird-chars-here",
		"a__b--c":           "a__b--c",
		"":                  "hero-da39a3ee",
	}
	for in, want := range cases {
		if got := Slugify(in); got != want {
			t.Errorf("Slugify(%q) = %q, want %q", in, got, want)
		}
	}
	// Non-ASCII names get a deterministic hash suffix so distinct names
	// cannot collapse onto one slug.
	a := Slugify("备份guard")
	b := Slugify("归档guard")
	if a == b {
		t.Fatalf("distinct non-ASCII names must not share a slug: %q", a)
	}
	if !strings.HasPrefix(a, "guard-") {
		t.Errorf("mixed name should keep its ascii part: %q", a)
	}
	if Slugify("备份guard") != a {
		t.Errorf("slug must be deterministic: %q vs %q", Slugify("备份guard"), a)
	}
}

func TestCreateDryRunWritesNothing(t *testing.T) {
	opts := newTestOptions(t, "smoke")
	opts.DryRun = true
	res, err := Create(opts)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Created || res.Applied {
		t.Fatalf("dry-run must be Created=true Applied=false, got %+v", res)
	}
	if len(res.Files) == 0 {
		t.Fatal("dry-run must list the planned files")
	}
	// zero writes: the root stays empty
	ents, err := os.ReadDir(opts.Root)
	if err != nil {
		t.Fatal(err)
	}
	if len(ents) != 0 {
		t.Fatalf("dry-run must not create anything under the root, found %d entries", len(ents))
	}
}

func TestCreateScaffoldAndIdempotency(t *testing.T) {
	opts := newTestOptions(t, "smoke")
	opts.Role = "duty check"
	res, err := Create(opts)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Created || !res.Applied {
		t.Fatalf("expected applied create, got %+v", res)
	}
	// >= 9 files under .hero/
	n := 0
	_ = filepath.Walk(filepath.Join(res.Dir, ".hero"), func(path string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			n++
		}
		return nil
	})
	if n < 9 {
		t.Fatalf(".hero/ must hold >= 9 files, got %d", n)
	}
	// root AGENTS.md pointer stays small (<= 20 lines)
	rootAgents, err := os.ReadFile(filepath.Join(res.Dir, "AGENTS.md"))
	if err != nil {
		t.Fatal(err)
	}
	if lines := strings.Count(string(rootAgents), "\n"); lines > 20 {
		t.Fatalf("root AGENTS.md must stay <= 20 lines, got %d", lines)
	}
	// idempotent: second create is a read-back, zero writes
	charter := filepath.Join(res.Dir, ".hero", "CHARTER.md")
	before, _ := os.ReadFile(charter)
	res2, err := Create(opts)
	if err != nil {
		t.Fatal(err)
	}
	if res2.Created || res2.Applied {
		t.Fatalf("second create must be an idempotent hit, got %+v", res2)
	}
	after, _ := os.ReadFile(charter)
	if string(before) != string(after) {
		t.Fatal("second create must not touch CHARTER.md")
	}
}

func TestRosterAfterCreateAndRename(t *testing.T) {
	opts := newTestOptions(t, "smoke")
	opts.Role = "duty check"
	if _, err := Create(opts); err != nil {
		t.Fatal(err)
	}
	rosterPath, err := RosterPath(opts.Root)
	if err != nil {
		t.Fatal(err)
	}
	roster, err := os.ReadFile(rosterPath)
	if err != nil {
		t.Fatal(err)
	}
	if countRosterIDRefs(string(roster), "smoke") != 1 {
		t.Fatalf("roster must reference smoke once:\n%s", roster)
	}
	// the role line is the L0 injection cell; the display name is not
	if !strings.Contains(string(roster), "duty check") {
		t.Fatal("role must be rendered in the roster line")
	}

	res, err := Rename(opts.Root, "smoke", "second", false)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Applied {
		t.Fatalf("rename must apply, got %+v", res)
	}
	if _, err := os.Stat(filepath.Join(opts.Root, "smoke")); !os.IsNotExist(err) {
		t.Fatal("old dir must be gone after rename")
	}
	if _, err := os.Stat(filepath.Join(opts.Root, "second", ".hero", "hero.json")); err != nil {
		t.Fatal("new dir must hold the identity card")
	}
	roster2, _ := os.ReadFile(rosterPath)
	if strings.Contains(string(roster2), "smoke") {
		t.Fatalf("roster must not reference old id after rename:\n%s", roster2)
	}
	if countRosterIDRefs(string(roster2), "second") != 1 {
		t.Fatalf("roster must reference the new id once:\n%s", roster2)
	}
}

func TestRenameRefusesExistingTarget(t *testing.T) {
	root := t.TempDir()
	if _, err := Create(Options{Root: root, Name: "alpha", Now: time.Now}); err != nil {
		t.Fatal(err)
	}
	if _, err := Create(Options{Root: root, Name: "beta", Now: time.Now}); err != nil {
		t.Fatal(err)
	}
	if _, err := Rename(root, "alpha", "beta", false); err == nil {
		t.Fatal("rename onto an existing id must fail")
	}
	// both untouched after the refusal
	for _, id := range []string{"alpha", "beta"} {
		if _, err := os.Stat(filepath.Join(root, id, ".hero", "hero.json")); err != nil {
			t.Fatalf("%s must be untouched after refused rename: %v", id, err)
		}
	}
}

func TestRenameDryRunKeepsDisk(t *testing.T) {
	opts := newTestOptions(t, "smoke")
	if _, err := Create(opts); err != nil {
		t.Fatal(err)
	}
	res, err := Rename(opts.Root, "smoke", "second", true)
	if err != nil {
		t.Fatal(err)
	}
	if res.Applied {
		t.Fatal("dry-run rename must not apply")
	}
	if _, err := os.Stat(filepath.Join(opts.Root, "smoke", ".hero", "hero.json")); err != nil {
		t.Fatal("source must stay untouched under dry-run")
	}
}

func TestGetAndList(t *testing.T) {
	root := t.TempDir()
	if _, err := Create(Options{Root: root, Name: "alpha", Role: "r1", Now: time.Now}); err != nil {
		t.Fatal(err)
	}
	if _, err := Create(Options{Root: root, Name: "beta", Now: time.Now}); err != nil {
		t.Fatal(err)
	}
	heroes, err := List(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(heroes) != 2 || heroes[0].ID != "alpha" || heroes[1].ID != "beta" {
		t.Fatalf("List must return sorted heroes, got %+v", heroes)
	}
	p, charter, err := Get(root, "alpha")
	if err != nil {
		t.Fatal(err)
	}
	if p.Role != "r1" || !strings.Contains(charter, "CHARTER") {
		t.Fatalf("unexpected hero/card: %+v / %q", p, charter)
	}
	if _, _, err := Get(root, "nope"); err == nil {
		t.Fatal("Get of unknown id must fail")
	}
}

func TestValidateID(t *testing.T) {
	for _, id := range []string{"smoke", "a_1-b", "hero-da39a3ee"} {
		if err := ValidateID(id); err != nil {
			t.Errorf("ValidateID(%q) = %v", id, err)
		}
	}
	for _, id := range []string{"", "Smoke", "../evil", "a/b", "a\\b", "two words"} {
		if err := ValidateID(id); err == nil {
			t.Errorf("ValidateID(%q) must fail", id)
		}
	}
}
