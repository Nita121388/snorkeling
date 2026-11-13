// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package persona

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func requireGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
}

func makePersonaRoot(t *testing.T, names ...string) string {
	t.Helper()
	root := t.TempDir()
	for _, name := range names {
		if _, err := Create(Options{Root: root, Name: name, Role: "duty"}); err != nil {
			t.Fatalf("Create(%s): %v", name, err)
		}
	}
	return root
}

func readFileString(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(b)
}

func TestSyncEnsureRootGitignoreIsIdempotentAndNonDestructive(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, ".gitignore")
	if err := os.WriteFile(path, []byte("# my own rule\ncustom.tmp\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gotPath, changed, err := EnsureRootGitignore(root)
	if err != nil {
		t.Fatalf("EnsureRootGitignore: %v", err)
	}
	if gotPath != path || !changed {
		t.Fatalf("first call = (%q, %v), want (path, true)", gotPath, changed)
	}
	body := readFileString(t, path)
	for _, pattern := range RootGitignorePatterns {
		if !strings.Contains(body, "\n"+pattern+"\n") {
			t.Fatalf("missing pattern %q in:\n%s", pattern, body)
		}
	}
	if !strings.Contains(body, "custom.tmp") {
		t.Fatalf("user rule lost:\n%s", body)
	}
	before := body
	_, changed, err = EnsureRootGitignore(root)
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if changed || readFileString(t, path) != before {
		t.Fatalf("second call changed the file (changed=%v)", changed)
	}
}

func TestSyncInitKeepsWorkAndGeneratedOutOfGit(t *testing.T) {
	requireGit(t)
	root := makePersonaRoot(t, "alpha")
	status, err := SyncInit(root)
	if err != nil {
		t.Fatalf("SyncInit: %v", err)
	}
	if !status.Initialized || !status.Clean {
		t.Fatalf("status after init = %+v, want initialized+clean", status)
	}

	// Only machine-local work/ changes: git status must stay empty.
	workFile := filepath.Join(root, "alpha", "work", "scratch.txt")
	if err := os.WriteFile(workFile, []byte("machine local"), 0o644); err != nil {
		t.Fatal(err)
	}
	status, err = SyncStatusOf(root)
	if err != nil {
		t.Fatalf("SyncStatusOf: %v", err)
	}
	if !status.Clean {
		t.Fatalf("work/ leaked into git status: %+v", status.Changes)
	}

	// Tracked file set must not contain any ignored class.
	out, err := runGit(root, "ls-files")
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{".index/", "/agents/", "/AGENTS.md", ".local.json", "/work/"} {
		for _, line := range strings.Split(strings.ReplaceAll(out, "\r\n", "\n"), "\n") {
			if line == "" {
				continue
			}
			if strings.Contains(line, forbidden) || (forbidden == ".index/" && strings.HasPrefix(line, ".index/")) {
				t.Fatalf("ignored path %q tracked: %s", forbidden, line)
			}
		}
	}
	for _, want := range []string{".gitignore", "alpha/.persona/persona.json", "alpha/.persona/CHARTER.md"} {
		if !strings.Contains(out, want) {
			t.Fatalf("archive file %q not tracked in:\n%s", want, out)
		}
	}
}

func TestSyncStatusUninitializedIsNotAnError(t *testing.T) {
	status, err := SyncStatusOf(t.TempDir())
	if err != nil {
		t.Fatalf("SyncStatusOf on bare dir: %v", err)
	}
	if status.Initialized {
		t.Fatalf("bare dir reported initialized: %+v", status)
	}
}

func TestSyncRebuildGeneratedKeepsTruthSources(t *testing.T) {
	root := makePersonaRoot(t, "alpha", "beta")
	truthPaths := []string{
		"alpha/.persona/CHARTER.md",
		"alpha/.persona/MEMORY/facts.md",
		"alpha/.persona/persona.json",
		"beta/.persona/MEMORY/journal.md",
	}
	truth := make(map[string]string, len(truthPaths))
	for _, rel := range truthPaths {
		path := filepath.Join(root, filepath.FromSlash(rel))
		truth[rel] = readFileString(t, path)
		// Dirty one human-owned file: rebuild must not overwrite it.
		if rel == "alpha/.persona/CHARTER.md" {
			if err := os.WriteFile(path, []byte("# human edited\n"), 0o644); err != nil {
				t.Fatal(err)
			}
			truth[rel] = "# human edited\n"
		}
	}

	// Simulate a fresh clone: derived artifacts are gitignored and absent.
	for _, id := range []string{"alpha", "beta"} {
		for _, rel := range generatedPaths {
			if err := os.Remove(filepath.Join(root, id, filepath.FromSlash(rel))); err != nil && !os.IsNotExist(err) {
				t.Fatal(err)
			}
		}
	}
	_ = os.RemoveAll(filepath.Join(root, ".index"))

	result, err := RebuildGenerated(root)
	if err != nil {
		t.Fatalf("RebuildGenerated: %v", err)
	}
	if result.Personas != 2 || result.Files != 2*len(generatedPaths) {
		t.Fatalf("result = %+v, want 2 personas / %d files", result, 2*len(generatedPaths))
	}
	for _, rel := range truthPaths {
		if got := readFileString(t, filepath.Join(root, filepath.FromSlash(rel))); got != truth[rel] {
			t.Fatalf("truth source %s changed on rebuild", rel)
		}
	}
	roster := readFileString(t, result.Roster)
	for _, id := range []string{"alpha", "beta"} {
		if !strings.Contains(roster, id) {
			t.Fatalf("roster missing %s:\n%s", id, roster)
		}
	}
	contract := readFileString(t, filepath.Join(root, "alpha", ".persona", "agents", "AGENTS.md"))
	if !strings.Contains(contract, GeneratedHeader) || !strings.Contains(contract, "MEMORY") {
		t.Fatalf("regenerated contract looks wrong:\n%s", contract)
	}
	// Idempotency: rebuilding again yields identical content.
	again, err := RebuildGenerated(root)
	if err != nil || again.Files != result.Files {
		t.Fatalf("second rebuild = %+v, err %v", again, err)
	}
}

func TestSyncJournalConflictKeepsBothSides(t *testing.T) {
	ours := "<!-- header -->\n- A 09:00 完成扫描\n- B 09:05 共用条目\n"
	theirs := "<<<<<<< HEAD\n- C 09:10 远端写入\n- B 09:05 共用条目\n=======\n- A 09:00 完成扫描\n>>>>>>> origin/main\n"
	merged := MergeJournalTexts(ours, theirs)
	for _, want := range []string{"- A 09:00 完成扫描", "- B 09:05 共用条目", "- C 09:10 远端写入"} {
		if !strings.Contains(merged, want) {
			t.Fatalf("lost entry %q in:\n%s", want, merged)
		}
	}
	if strings.Contains(merged, "<<<<<<<") || strings.Contains(merged, ">>>>>>>") || strings.Contains(merged, "=======") {
		t.Fatalf("conflict markers leaked:\n%s", merged)
	}
	if strings.Count(merged, "- B 09:05 共用条目") != 1 {
		t.Fatalf("duplicate entry not deduped:\n%s", merged)
	}
	note := MergeJournalNote("alpha", 3)
	if !strings.Contains(note, "alpha") || !strings.Contains(note, "3") || !strings.Contains(note, "合并") {
		t.Fatalf("conflict note = %q", note)
	}
	if MergeJournalTexts("", "") != "" {
		t.Fatal("empty merge should be empty")
	}
}

func TestSyncModeValidationAndPreservesLocalFields(t *testing.T) {
	if got, err := NormalizeSyncMode(""); err != nil || got != SyncModeShared {
		t.Fatalf("empty mode = (%q, %v), want shared", got, err)
	}
	if got, err := NormalizeSyncMode("OWN"); err != nil || got != SyncModeOwn {
		t.Fatalf("OWN = (%q, %v), want own", got, err)
	}
	if _, err := NormalizeSyncMode("bogus"); err == nil {
		t.Fatal("invalid mode accepted")
	}
	root := makePersonaRoot(t, "alpha")
	path, err := SetSyncMode(root, "alpha", SyncModeOwn)
	if err != nil {
		t.Fatalf("SetSyncMode: %v", err)
	}
	body := readFileString(t, path)
	if !strings.Contains(body, `"mode": "own"`) {
		t.Fatalf("mode missing in %s:\n%s", path, body)
	}
	// Workdir is a separate local field and must survive the update.
	if _, err := SetSyncMode(root, "alpha", "shared"); err != nil {
		t.Fatalf("second SetSyncMode: %v", err)
	}
	var local PersonaLocal
	b, _ := os.ReadFile(path)
	if err := json.Unmarshal(b, &local); err != nil {
		t.Fatal(err)
	}
	if local.Sync == nil || local.Sync.Mode != SyncModeShared {
		t.Fatalf("mode not updated: %+v", local.Sync)
	}
	if local.SchemaVersion != SchemaVersion {
		t.Fatalf("schemaVersion lost: %+v", local)
	}
}

// TestSyncTwoCloneRoundTrip is the §8 "persona follows the person" proof: two
// clones of one rootdir repo, a facts.md write on A, push, pull on B, and B
// reads the same memory back. work/ and generated files must not travel.
func TestSyncTwoCloneRoundTrip(t *testing.T) {
	requireGit(t)
	base := t.TempDir()
	rootA := filepath.Join(base, "A")
	if _, err := Create(Options{Root: rootA, Name: "alpha"}); err != nil {
		t.Fatalf("Create on A: %v", err)
	}
	if _, err := SyncInit(rootA); err != nil {
		t.Fatalf("SyncInit A: %v", err)
	}
	bare := filepath.Join(base, "remote.git")
	if out, err := runGitForTest(base, "init", "--bare", bare); err != nil {
		t.Fatalf("bare init: %v %s", err, out)
	}
	if _, err := runGit(rootA, "remote", "add", "origin", bare); err != nil {
		t.Fatal(err)
	}
	if _, err := runGit(rootA, "push", "-u", "origin", "HEAD"); err != nil {
		t.Fatal(err)
	}
	rootB := filepath.Join(base, "B")
	if out, err := runGitForTest(base, "clone", bare, rootB); err != nil {
		t.Fatalf("clone B: %v %s", err, out)
	}

	factsA := filepath.Join(rootA, "alpha", ".persona", "MEMORY", "facts.md")
	if err := os.WriteFile(factsA, []byte("# facts\n- cross-machine truth\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := runGit(rootA, "add", "-A"); err != nil {
		t.Fatal(err)
	}
	if _, err := runGit(rootA, "-c", "user.name=test", "-c", "user.email=test@local", "commit", "-m", "facts from A"); err != nil {
		t.Fatal(err)
	}
	if _, err := SyncPush(rootA); err != nil {
		t.Fatalf("SyncPush A: %v", err)
	}
	if _, err := SyncPull(rootB); err != nil {
		t.Fatalf("SyncPull B: %v", err)
	}
	factsB := readFileString(t, filepath.Join(rootB, "alpha", ".persona", "MEMORY", "facts.md"))
	if !strings.Contains(factsB, "cross-machine truth") {
		t.Fatalf("B did not receive the memory: %s", factsB)
	}
	// The clone has no derived artifacts; rebuild restores them from the
	// archived identity card alone (the single source of truth).
	if _, err := RebuildGenerated(rootB); err != nil {
		t.Fatalf("RebuildGenerated B: %v", err)
	}
	if _, err := os.Stat(filepath.Join(rootB, "alpha", ".persona", "agents", "AGENTS.md")); err != nil {
		t.Fatalf("generated contract missing on B: %v", err)
	}
	if _, err := os.Stat(filepath.Join(rootB, ".index", "PERSONAS.md")); err != nil {
		t.Fatalf("roster missing on B: %v", err)
	}
	// work/ is machine local: writing it on A must never show up on B.
	if err := os.MkdirAll(filepath.Join(rootA, "alpha", "work"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(rootA, "alpha", "work", "secret.txt"), []byte("local"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(rootB, "alpha", "work", "secret.txt")); !os.IsNotExist(err) {
		t.Fatalf("machine-local work leaked to B (err=%v)", err)
	}
}

func runGitForTest(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	return string(out), err
}
