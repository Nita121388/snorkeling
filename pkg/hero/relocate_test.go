// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package hero

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeBucketFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestRelocatePlanIsZeroWrite(t *testing.T) {
	root := makeHeroRoot(t, "alpha", "beta")
	newRoot := filepath.Join(t.TempDir(), "newhome")
	plan, err := PlanRelocate(root, newRoot, []string{"beta"})
	if err != nil {
		t.Fatalf("PlanRelocate: %v", err)
	}
	if len(plan.Entries) != 1 || plan.Entries[0].ID != "alpha" {
		t.Fatalf("plan entries = %+v", plan.Entries)
	}
	if len(plan.Excluded) != 1 || plan.Excluded[0] != "beta" {
		t.Fatalf("excluded = %+v", plan.Excluded)
	}
	if plan.Files == 0 || plan.Bytes == 0 {
		t.Fatalf("plan did not measure files: %+v", plan)
	}
	if _, err := os.Stat(newRoot); !os.IsNotExist(err) {
		t.Fatalf("dry-run created the target root (err=%v)", err)
	}
	if _, err := os.Stat(filepath.Join(root, "alpha", ".hero", "hero.json")); err != nil {
		t.Fatalf("dry-run moved the source: %v", err)
	}
	result, err := Relocate(root, newRoot, RelocateOptions{DryRun: true})
	if err != nil {
		t.Fatalf("dry Relocate: %v", err)
	}
	if result.Applied || result.Verified {
		t.Fatalf("dry result = %+v, want not applied", result)
	}
}

func TestRelocateMovesVerifiesAndRebuildsRoster(t *testing.T) {
	root := makeHeroRoot(t, "alpha")
	// A work product must travel with the hero directory (it is part of the
	// move; only git sync ignores it).
	writeBucketFile(t, filepath.Join(root, "alpha", "work", "draft.md"), "draft")
	newRoot := filepath.Join(t.TempDir(), "newhome")
	result, err := Relocate(root, newRoot, RelocateOptions{})
	if err != nil {
		t.Fatalf("Relocate: %v", err)
	}
	if !result.Applied || !result.Verified || result.RolledBack {
		t.Fatalf("result = %+v", result)
	}
	if _, err := os.Stat(filepath.Join(newRoot, "alpha", ".hero", "hero.json")); err != nil {
		t.Fatalf("hero not at new root: %v", err)
	}
	if _, err := os.Stat(filepath.Join(newRoot, "alpha", "work", "draft.md")); err != nil {
		t.Fatalf("work product lost in move: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "alpha")); !os.IsNotExist(err) {
		t.Fatalf("old directory still exists (err=%v)", err)
	}
	roster := readFileString(t, filepath.Join(newRoot, ".index", "HEROES.md"))
	if !strings.Contains(roster, "alpha") {
		t.Fatalf("roster not rebuilt at new root:\n%s", roster)
	}
	// A second relocation to the same root is refused instead of half-moving.
	if _, err := Relocate(newRoot, newRoot, RelocateOptions{}); err == nil {
		t.Fatal("relocating to the current root was accepted")
	}
}

func TestRelocateRollsBackOnFailure(t *testing.T) {
	root := makeHeroRoot(t, "alpha", "beta")
	newRoot := filepath.Join(t.TempDir(), "newhome")
	original := relocateMover
	calls := 0
	relocateMover = func(from, to string) error {
		calls++
		if calls == 2 {
			return errors.New("injected move failure")
		}
		return original(from, to)
	}
	defer func() { relocateMover = original }()

	if _, err := Relocate(root, newRoot, RelocateOptions{}); err == nil {
		t.Fatal("injected failure was swallowed")
	}
	// alpha moved then must be back; both sources exist again.
	for _, id := range []string{"alpha", "beta"} {
		if _, err := os.Stat(filepath.Join(root, id, ".hero", "hero.json")); err != nil {
			t.Fatalf("%s not restored after rollback: %v", id, err)
		}
	}
	if _, err := os.Stat(filepath.Join(newRoot, "alpha")); !os.IsNotExist(err) {
		t.Fatalf("rolled-back copy still at new root (err=%v)", err)
	}
}

func TestStorageStatsSplitsThreeBuckets(t *testing.T) {
	root := makeHeroRoot(t, "alpha")
	writeBucketFile(t, filepath.Join(root, "alpha", ".hero", "CHARTER.md"), "charter-1234")
	writeBucketFile(t, filepath.Join(root, "alpha", ".hero", "MEMORY", "archive", "2026-10.md"), "archived-line")
	writeBucketFile(t, filepath.Join(root, "alpha", "work", "artifact.bin"), "work-product")
	stats, err := StorageOf(root, "alpha")
	if err != nil {
		t.Fatalf("StorageOf: %v", err)
	}
	if stats.ArchiveBytes == 0 || stats.HistoryBytes == 0 || stats.WorkBytes == 0 {
		t.Fatalf("a bucket is empty: %+v", stats)
	}
	if stats.HistoryBytes >= stats.ArchiveBytes {
		// archive bucket excludes MEMORY/archive; it still holds hero.json,
		// MEMORY/facts.md etc., so it must be the bigger side here.
		t.Fatalf("history counted inside archive: %+v", stats)
	}
	if stats.TotalBytes != stats.ArchiveBytes+stats.HistoryBytes+stats.WorkBytes {
		t.Fatalf("total != sum: %+v", stats)
	}
	if stats.SyncableBytes != stats.ArchiveBytes+stats.HistoryBytes {
		t.Fatalf("syncable != archive+history: %+v", stats)
	}
	if _, err := StorageOf(root, "ghost"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing hero error = %v", err)
	}
}

func TestRotateJournalMovesOldMonthsOnly(t *testing.T) {
	root := makeHeroRoot(t, "alpha")
	journal := filepath.Join(root, "alpha", ".hero", "MEMORY", "journal.md")
	body := strings.Join([]string{
		"<!-- GENERATED by wsh hero -->",
		"",
		"# 当班流水（journal）",
		"",
		"- 2026-10-31T23:00:00Z [done] human:nita — 十月收尾",
		"- 2026-10-30T10:00:00Z [done] agent:pi — 十月另一条",
		"- 2026-11-13T04:00:00Z [done] human:nita — 十一月条目",
		"",
	}, "\n")
	if err := os.WriteFile(journal, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	rotated, archivePath, err := RotateJournal(root, "alpha", func() time.Time { return testNow })
	if err != nil {
		t.Fatalf("RotateJournal: %v", err)
	}
	if rotated != 2 {
		t.Fatalf("rotated = %d, want 2", rotated)
	}
	if filepath.Base(archivePath) != "2026-10.md" {
		t.Fatalf("archive path = %s, want 2026-10.md", archivePath)
	}
	archive := readFileString(t, archivePath)
	if !strings.Contains(archive, "十月收尾") || !strings.Contains(archive, "十月另一条") {
		t.Fatalf("archive missing rotated lines:\n%s", archive)
	}
	live := readFileString(t, journal)
	if strings.Contains(live, "十月收尾") {
		t.Fatalf("old month survived in live journal:\n%s", live)
	}
	if !strings.Contains(live, "十一月条目") || !strings.Contains(live, "# 当班流水") {
		t.Fatalf("current month / header lost:\n%s", live)
	}
	// Second rotation is a no-op.
	again, _, err := RotateJournal(root, "alpha", func() time.Time { return testNow })
	if err != nil || again != 0 {
		t.Fatalf("second rotate = %d, %v", again, err)
	}
}

func TestAppendJournalAutoRotatesAcrossMonths(t *testing.T) {
	root := makeHeroRoot(t, "alpha")
	journal := filepath.Join(root, "alpha", ".hero", "MEMORY", "journal.md")
	if err := os.WriteFile(journal, []byte("- 2026-10-31T23:00:00Z [done] human:nita — 上个月\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := AppendJournal(root, "alpha", JournalEntry{
		State: "done", Summary: "本月新条目", Now: func() time.Time { return testNow },
	}); err != nil {
		t.Fatalf("AppendJournal: %v", err)
	}
	live := readFileString(t, journal)
	if strings.Contains(live, "上个月") {
		t.Fatalf("cross-month append did not rotate:\n%s", live)
	}
	if !strings.Contains(live, "本月新条目") {
		t.Fatalf("new entry missing:\n%s", live)
	}
	if _, err := os.Stat(filepath.Join(root, "alpha", ".hero", "MEMORY", "archive", "2026-10.md")); err != nil {
		t.Fatalf("archive file missing: %v", err)
	}
}
