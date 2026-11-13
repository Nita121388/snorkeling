// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package hero

// A5.5: moving the hero home to another disk, storage accounting and
// journal rotation. Everything here is plain filesystem work; the settings
// key (`hero:rootdir`) is written by the CLI layer, because pkg/hero
// deliberately stays stdlib-only so the CLI and MCP tools share one path.

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// RelocateOptions controls a relocation.
type RelocateOptions struct {
	// DryRun plans only: zero writes, zero renames.
	DryRun bool
	// Exclude lists hero ids that stay behind.
	Exclude []string
	// CopyNotMove keeps the old tree as a second copy (insurance).
	CopyNotMove bool
}

// RelocateEntry is one hero directory in the plan.
type RelocateEntry struct {
	ID    string `json:"id"`
	From  string `json:"from"`
	To    string `json:"to"`
	Files int    `json:"files"`
	Bytes int64  `json:"bytes"`
}

// RelocatePlan is the machine-readable dry-run output.
type RelocatePlan struct {
	From     string          `json:"from"`
	To       string          `json:"to"`
	Entries  []RelocateEntry `json:"entries"`
	Excluded []string        `json:"excluded,omitempty"`
	Files    int             `json:"files"`
	Bytes    int64           `json:"bytes"`
}

// RelocateResult reports what an applied relocation did.
type RelocateResult struct {
	Plan    RelocatePlan `json:"plan"`
	Applied bool         `json:"applied"`
	// Verified is true when every moved hero kept its file count and byte
	// total, and the source directory is gone (or kept under CopyNotMove).
	Verified bool `json:"verified"`
	// RolledBack is true when a failure triggered an automatic undo.
	RolledBack bool `json:"rolledBack"`
}

// relocateMover is a test seam: production uses rename-with-copy-fallback.
var relocateMover = moveHeroDir

// PlanRelocate lists what would move, without touching the disk.
func PlanRelocate(root, newRoot string, exclude []string) (*RelocatePlan, error) {
	resolved, err := ResolveRoot(root)
	if err != nil {
		return nil, err
	}
	target, err := ResolveRoot(newRoot)
	if err != nil {
		return nil, err
	}
	if samePath(resolved, target) {
		return nil, fmt.Errorf("new root is the current root: %s", resolved)
	}
	heroes, err := List(resolved)
	if err != nil {
		return nil, err
	}
	excluded := make(map[string]bool, len(exclude))
	for _, id := range exclude {
		id = strings.TrimSpace(id)
		if id != "" {
			excluded[id] = true
		}
	}
	plan := &RelocatePlan{From: resolved, To: target}
	for _, p := range heroes {
		if excluded[p.ID] {
			plan.Excluded = append(plan.Excluded, p.ID)
			continue
		}
		from := heroDir(resolved, p.ID)
		files, bytes, err := countTree(from)
		if err != nil {
			return nil, err
		}
		plan.Entries = append(plan.Entries, RelocateEntry{
			ID: p.ID, From: from, To: heroDir(target, p.ID), Files: files, Bytes: bytes,
		})
		plan.Files += files
		plan.Bytes += bytes
	}
	sort.Slice(plan.Entries, func(i, j int) bool { return plan.Entries[i].ID < plan.Entries[j].ID })
	return plan, nil
}

// Relocate moves every (non-excluded) hero to newRoot, verifies counts and
// bytes, and rolls back the directories it already moved when any step fails.
func Relocate(root, newRoot string, opts RelocateOptions) (*RelocateResult, error) {
	plan, err := PlanRelocate(root, newRoot, opts.Exclude)
	if err != nil {
		return nil, err
	}
	result := &RelocateResult{Plan: *plan}
	if opts.DryRun {
		return result, nil
	}
	if err := os.MkdirAll(plan.To, 0o755); err != nil {
		return nil, fmt.Errorf("creating new root: %w", err)
	}
	moved := make([]RelocateEntry, 0, len(plan.Entries))
	rollback := func() {
		for i := len(moved) - 1; i >= 0; i-- {
			entry := moved[i]
			_ = os.MkdirAll(filepath.Dir(entry.From), 0o755)
			_ = relocateMover(entry.To, entry.From)
		}
		result.RolledBack = true
	}
	for _, entry := range plan.Entries {
		if _, err := os.Stat(entry.From); errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err := relocateMover(entry.From, entry.To); err != nil {
			rollback()
			return nil, fmt.Errorf("moving %s: %w", entry.ID, err)
		}
		moved = append(moved, entry)
		if opts.CopyNotMove {
			// moveHeroDir already removed the source; restore a copy so the
			// insurance flag really leaves two copies behind.
			if err := copyHeroDir(entry.To, entry.From); err != nil {
				rollback()
				return nil, fmt.Errorf("keeping a copy of %s: %w", entry.ID, err)
			}
		}
	}
	// Verify: file counts and bytes must match, source must be gone unless the
	// caller asked for a copy.
	for _, entry := range plan.Entries {
		files, bytes, err := countTree(entry.To)
		if err != nil {
			rollback()
			return nil, fmt.Errorf("verifying %s: %w", entry.ID, err)
		}
		if files != entry.Files || bytes != entry.Bytes {
			rollback()
			return nil, fmt.Errorf("verification failed for %s: files %d→%d, bytes %d→%d",
				entry.ID, entry.Files, files, entry.Bytes, bytes)
		}
		if !opts.CopyNotMove {
			if _, err := os.Stat(entry.From); err == nil {
				rollback()
				return nil, fmt.Errorf("source still exists after move: %s", entry.From)
			}
		}
	}
	if _, err := WriteRoster(plan.To); err != nil {
		rollback()
		return nil, err
	}
	result.Applied = true
	result.Verified = true
	return result, nil
}

// moveHeroDir renames when possible and falls back to copy+remove across
// devices (a hero home on another disk is the whole point of A5.5).
func moveHeroDir(from, to string) error {
	if err := os.MkdirAll(filepath.Dir(to), 0o755); err != nil {
		return err
	}
	if err := os.Rename(from, to); err == nil {
		return nil
	}
	if err := copyHeroDir(from, to); err != nil {
		return err
	}
	return os.RemoveAll(from)
}

func copyHeroDir(from, to string) error {
	return filepath.Walk(from, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(from, path)
		if err != nil {
			return err
		}
		dest := filepath.Join(to, rel)
		if info.IsDir() {
			return os.MkdirAll(dest, 0o755)
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return err
		}
		return copyFile(path, dest)
	})
}

func copyFile(from, to string) error {
	src, err := os.Open(from)
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := os.OpenFile(to, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		return err
	}
	return dst.Close()
}

func countTree(root string) (int, int64, error) {
	files := 0
	var bytes int64
	err := filepath.Walk(root, func(_ string, info os.FileInfo, err error) error {
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
			return err
		}
		if info.IsDir() {
			return nil
		}
		files++
		bytes += info.Size()
		return nil
	})
	return files, bytes, err
}

func samePath(a, b string) bool {
	absA, errA := filepath.Abs(a)
	absB, errB := filepath.Abs(b)
	if errA != nil || errB != nil {
		return filepath.Clean(a) == filepath.Clean(b)
	}
	return strings.EqualFold(filepath.Clean(absA), filepath.Clean(absB))
}

// StorageStats splits the three capacity buckets (design §3.4): archive (the
// syncable .hero/ minus MEMORY/archive), history (MEMORY/archive) and work
// products (work/). Only archive + history affect cross-machine size.
type StorageStats struct {
	ID            string `json:"id"`
	ArchiveBytes  int64  `json:"archiveBytes"`
	ArchiveFiles  int    `json:"archiveFiles"`
	HistoryBytes  int64  `json:"historyBytes"`
	HistoryFiles  int    `json:"historyFiles"`
	WorkBytes     int64  `json:"workBytes"`
	WorkFiles     int    `json:"workFiles"`
	TotalBytes    int64  `json:"totalBytes"`
	SyncableBytes int64  `json:"syncableBytes"`
}

// StorageOf measures one hero home base.
func StorageOf(root, id string) (*StorageStats, error) {
	resolved, err := ResolveRoot(root)
	if err != nil {
		return nil, err
	}
	if err := ValidateID(id); err != nil {
		return nil, err
	}
	dir := heroDir(resolved, id)
	if _, err := os.Stat(filepath.Join(dir, ".hero", "hero.json")); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("%w: %s", ErrNotFound, id)
		}
		return nil, err
	}
	stats := &StorageStats{ID: id}
	archiveDir := filepath.Join(dir, ".hero")
	historyDir := filepath.Join(dir, ".hero", "MEMORY", "archive")
	workDir := filepath.Join(dir, "work")
	if err := walkBucket(archiveDir, historyDir, func(files int, bytes int64) {
		stats.ArchiveFiles, stats.ArchiveBytes = files, bytes
	}); err != nil {
		return nil, err
	}
	if err := walkBucket(historyDir, "", func(files int, bytes int64) {
		stats.HistoryFiles, stats.HistoryBytes = files, bytes
	}); err != nil {
		return nil, err
	}
	if err := walkBucket(workDir, "", func(files int, bytes int64) {
		stats.WorkFiles, stats.WorkBytes = files, bytes
	}); err != nil {
		return nil, err
	}
	stats.TotalBytes = stats.ArchiveBytes + stats.HistoryBytes + stats.WorkBytes
	stats.SyncableBytes = stats.ArchiveBytes + stats.HistoryBytes
	return stats, nil
}

func walkBucket(dir, skipDir string, set func(files int, bytes int64)) error {
	if _, err := os.Stat(dir); errors.Is(err, os.ErrNotExist) {
		set(0, 0)
		return nil
	}
	files := 0
	var bytes int64
	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
			return err
		}
		if info.IsDir() {
			if skipDir != "" && samePath(path, skipDir) {
				return filepath.SkipDir
			}
			return nil
		}
		files++
		bytes += info.Size()
		return nil
	})
	set(files, bytes)
	return err
}

// RotateJournal moves journal lines from months before `now` into
// MEMORY/archive/YYYY-MM.md and leaves the live journal with only the current
// month (design §3.5: the journal grows forever otherwise).
func RotateJournal(root, id string, now func() time.Time) (int, string, error) {
	resolved, err := ResolveRoot(root)
	if err != nil {
		return 0, "", err
	}
	if err := ValidateID(id); err != nil {
		return 0, "", err
	}
	journalPath := heroMemoryPath(resolved, id, "journal.md")
	barr, err := os.ReadFile(journalPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return 0, "", nil
		}
		return 0, "", err
	}
	at := time.Now()
	if now != nil {
		at = now()
	}
	currentMonth := at.UTC().Format("2006-01")
	normalized := strings.ReplaceAll(string(barr), "\r\n", "\n")
	lines := strings.Split(normalized, "\n")
	var keep, rotate []string
	rotated := 0
	for _, line := range lines {
		month := journalLineMonth(line)
		if month != "" && month != currentMonth {
			rotate = append(rotate, line)
			rotated++
			continue
		}
		keep = append(keep, line)
	}
	if rotated == 0 {
		return 0, journalPath, nil
	}
	// Group by the month of each line so an archive file never mixes months.
	byMonth := map[string][]string{}
	for _, line := range rotate {
		month := journalLineMonth(line)
		byMonth[month] = append(byMonth[month], line)
	}
	months := make([]string, 0, len(byMonth))
	for month := range byMonth {
		months = append(months, month)
	}
	sort.Strings(months)
	for _, month := range months {
		path := filepath.Join(heroDir(resolved, id), ".hero", "MEMORY", "archive", month+".md")
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return 0, "", err
		}
		body := strings.Join(byMonth[month], "\n")
		if !strings.HasSuffix(body, "\n") {
			body += "\n"
		}
		if err := appendToFile(path, body); err != nil {
			return 0, "", err
		}
	}
	archivePath := filepath.Join(heroDir(resolved, id), ".hero", "MEMORY", "archive", months[0]+".md")
	if err := writeFileAtomic(journalPath, []byte(strings.Join(keep, "\n")), 0o644); err != nil {
		return 0, "", err
	}
	return rotated, archivePath, nil
}

// journalLineMonth extracts YYYY-MM from the first RFC3339-looking token of a
// journal line; non-journal lines (comments, blank lines) return "".
func journalLineMonth(line string) string {
	for _, field := range strings.Fields(line) {
		if len(field) < 10 || field[4] != '-' || field[7] != '-' {
			continue
		}
		if _, err := time.Parse(time.RFC3339, field); err != nil {
			continue
		}
		return field[:7]
	}
	return ""
}

// MaybeRotateJournal is the write-path hook: rotate only when the journal
// already holds lines from an earlier month (cheap string scan).
func MaybeRotateJournal(root, id string, now func() time.Time) (int, error) {
	rotated, _, err := RotateJournal(root, id, now)
	return rotated, err
}
