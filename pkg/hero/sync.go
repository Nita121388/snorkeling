// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package hero

// Cross-machine sync v1 (design §3.2/§3.3/§8): the hero rootdir itself is
// a single git repo. Only the archive (.hero/CHARTER.md + MEMORY/) travels;
// machine-local state (hero.local.json), work products (work/), generated
// provider contracts (agents/ + root AGENTS.md) and derived indexes (.index/)
// are ignored and rebuilt on first use on the new machine.

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

const (
	// SyncModeShared keeps a hero inside the rootdir repo (default).
	SyncModeShared = "shared"
	// SyncModeOwn marks a hero that syncs as its own repository (v2 wiring;
	// v1 only stores/validates the flag).
	SyncModeOwn = "own"
)

// RootGitignorePatterns is the rootdir-level §3.2 list. The per-hero
// .gitignore scaffolded by A1 covers a single home base; this one covers the
// whole repo so a `git add -A` at the root can never sweep machine-local data.
var RootGitignorePatterns = []string{
	"*.local.json",
	"work/",
	"agents/",
	"AGENTS.md",
	".index/",
	"*.lock",
	".DS_Store",
	"Thumbs.db",
}

// generatedPaths is the ONLY set RebuildGenerated may write. Everything else
// under a home base is a human/AI-authored truth source and must never be
// touched by a sync operation.
var generatedPaths = []string{
	".hero/agents/AGENTS.md",
	".hero/agents/CLAUDE.md",
	".hero/agents/GEMINI.md",
	"AGENTS.md",
}

// ErrGitMissing means git is not on PATH; callers report it instead of
// degrading silently (design §8: sync is an explicit action, never a guess).
var ErrGitMissing = errors.New("git not found on PATH")

func runGit(root string, args ...string) (string, error) {
	if _, err := exec.LookPath("git"); err != nil {
		return "", ErrGitMissing
	}
	fullArgs := append([]string{"-C", root}, args...)
	out, err := exec.Command("git", fullArgs...).CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

// EnsureRootGitignore is idempotent: missing patterns are appended, existing
// lines (including user additions) are preserved verbatim.
func EnsureRootGitignore(root string) (path string, changed bool, err error) {
	if strings.TrimSpace(root) == "" {
		return "", false, errors.New("hero root must not be empty")
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return "", false, fmt.Errorf("creating hero root: %w", err)
	}
	path = filepath.Join(root, ".gitignore")
	existing := ""
	if barr, readErr := os.ReadFile(path); readErr == nil {
		existing = string(barr)
	} else if !errors.Is(readErr, os.ErrNotExist) {
		return "", false, fmt.Errorf("reading %s: %w", path, readErr)
	}
	lines := strings.Split(strings.ReplaceAll(existing, "\r\n", "\n"), "\n")
	seen := make(map[string]bool, len(lines))
	for _, line := range lines {
		seen[strings.TrimSpace(line)] = true
	}
	missing := make([]string, 0, len(RootGitignorePatterns))
	for _, pattern := range RootGitignorePatterns {
		if !seen[pattern] {
			missing = append(missing, pattern)
		}
	}
	if len(missing) == 0 {
		return path, false, nil
	}
	var b strings.Builder
	b.WriteString(existing)
	if existing != "" && !strings.HasSuffix(existing, "\n") {
		b.WriteString("\n")
	}
	if existing != "" {
		b.WriteString("\n# wsh hero sync (design §3.2)\n")
	} else {
		b.WriteString("# wsh hero sync (design §3.2)\n")
	}
	for _, pattern := range missing {
		b.WriteString(pattern + "\n")
	}
	if err := writeFileAtomic(path, []byte(b.String()), 0o644); err != nil {
		return "", false, err
	}
	return path, true, nil
}

// SyncStatus is the machine-readable state of the rootdir repo.
type SyncStatus struct {
	Root        string   `json:"root"`
	Initialized bool     `json:"initialized"`
	Clean       bool     `json:"clean"`
	Branch      string   `json:"branch,omitempty"`
	Remote      string   `json:"remote,omitempty"`
	Changes     []string `json:"changes,omitempty"`
	Unmerged    []string `json:"unmerged,omitempty"`
}

// SyncStatusOf reports the repo state without mutating anything.
func SyncStatusOf(root string) (*SyncStatus, error) {
	if strings.TrimSpace(root) == "" {
		return nil, errors.New("hero root must not be empty")
	}
	status := &SyncStatus{Root: root}
	if _, err := os.Stat(filepath.Join(root, ".git")); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return status, nil // not initialized is a valid state, not an error
		}
		return nil, fmt.Errorf("checking .git: %w", err)
	}
	status.Initialized = true
	porcelain, err := runGit(root, "status", "--porcelain")
	if err != nil {
		return nil, err
	}
	for _, line := range strings.Split(strings.ReplaceAll(porcelain, "\r\n", "\n"), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		status.Changes = append(status.Changes, line)
		if strings.HasPrefix(line, "UU ") || strings.HasPrefix(line, "AA ") || strings.HasPrefix(line, "DU ") || strings.HasPrefix(line, "UD ") {
			if len(line) > 3 {
				status.Unmerged = append(status.Unmerged, strings.TrimSpace(line[3:]))
			}
		}
	}
	status.Clean = len(status.Changes) == 0
	if branch, err := runGit(root, "branch", "--show-current"); err == nil {
		status.Branch = strings.TrimSpace(branch)
	}
	if remotes, err := runGit(root, "remote"); err == nil {
		for _, line := range strings.Split(strings.ReplaceAll(remotes, "\r\n", "\n"), "\n") {
			if strings.TrimSpace(line) != "" {
				status.Remote = strings.TrimSpace(line)
				break
			}
		}
	}
	return status, nil
}

// SyncInit turns the rootdir into a git repo (first run) and commits the
// initial archive snapshot. It never commits anything on later calls: a user's
// in-flight edits must stay uncommitted until they explicitly push.
func SyncInit(root string) (*SyncStatus, error) {
	if _, err := exec.LookPath("git"); err != nil {
		return nil, ErrGitMissing
	}
	if _, _, err := EnsureRootGitignore(root); err != nil {
		return nil, err
	}
	firstInit := false
	if _, err := os.Stat(filepath.Join(root, ".git")); errors.Is(err, os.ErrNotExist) {
		if _, err := runGit(root, "init"); err != nil {
			return nil, err
		}
		firstInit = true
	}
	if firstInit {
		if _, err := runGit(root, "add", "-A"); err != nil {
			return nil, err
		}
		if _, err := runGit(root,
			"-c", "user.name=wsh hero", "-c", "user.email=hero@localhost",
			"commit", "--allow-empty", "-m", "hero: init sync repo"); err != nil {
			return nil, err
		}
	}
	return SyncStatusOf(root)
}

// SyncPull / SyncPush are thin wrappers; a missing remote surfaces git's own
// error rather than being silently swallowed.
func SyncPull(root string) (string, error) { return runGit(root, "pull") }
func SyncPush(root string) (string, error) { return runGit(root, "push") }

// RebuildResult reports what the post-clone rebuild wrote.
type RebuildResult struct {
	Root   string `json:"root"`
	Heroes int    `json:"heroes"`
	Files  int    `json:"files"`
	Roster string `json:"roster"`
}

// RebuildGenerated regenerates the derived artifacts after a clone. It uses
// plannedFiles (the same single source of truth as A1's scaffold) and writes
// ONLY generatedPaths, so CHARTER / MEMORY / hero.json survive untouched.
func RebuildGenerated(root string) (*RebuildResult, error) {
	resolved, err := ResolveRoot(root)
	if err != nil {
		return nil, err
	}
	heroes, err := List(resolved)
	if err != nil {
		return nil, err
	}
	result := &RebuildResult{Root: resolved, Heroes: len(heroes)}
	for i := range heroes {
		p := &heroes[i]
		dir := heroDir(resolved, p.ID)
		files := plannedFiles(dir, *p)
		byPath := make(map[string]PlannedFile, len(files))
		for _, f := range files {
			byPath[filepath.ToSlash(f.Path)] = f
		}
		for _, rel := range generatedPaths {
			full := filepath.Join(dir, filepath.FromSlash(rel))
			f, ok := byPath[filepath.ToSlash(full)]
			if !ok {
				return nil, fmt.Errorf("generated file %s missing from scaffold plan", rel)
			}
			if err := os.MkdirAll(filepath.Dir(f.Path), 0o755); err != nil {
				return nil, err
			}
			if err := os.WriteFile(f.Path, []byte(f.Bytes), 0o644); err != nil {
				return nil, err
			}
			result.Files++
		}
	}
	roster, err := WriteRoster(resolved)
	if err != nil {
		return nil, err
	}
	result.Roster = roster
	return result, nil
}

// MergeJournalTexts merges two append-only journal versions without losing
// either side. Git conflict markers are stripped; entries are deduplicated and
// sorted so the result is deterministic (and diff-friendly on the next sync).
func MergeJournalTexts(ours, theirs string) string {
	seen := make(map[string]bool)
	var out []string
	add := func(body string) {
		for _, raw := range strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n") {
			line := strings.TrimSpace(raw)
			if line == "" || isConflictMarker(line) {
				continue
			}
			if !seen[line] {
				seen[line] = true
				out = append(out, line)
			}
		}
	}
	add(ours)
	add(theirs)
	sort.Strings(out)
	if len(out) == 0 {
		return ""
	}
	return strings.Join(out, "\n") + "\n"
}

func isConflictMarker(line string) bool {
	return strings.HasPrefix(line, "<<<<<<<") ||
		strings.HasPrefix(line, ">>>>>>>") ||
		line == "=======" ||
		strings.HasPrefix(line, "=======")
}

// MergeJournalNote is the inbox hint written next to a merged journal: the
// human can see that a conflict happened instead of silently losing an entry.
func MergeJournalNote(id string, kept int) string {
	return fmt.Sprintf("- [sync] 人设 %s 的 journal 双版冲突已合并，保留 %d 条（双方都在）；请人工复核后归档。\n", id, kept)
}

// NormalizeSyncMode accepts an empty value as the shared default.
func NormalizeSyncMode(raw string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "":
		return SyncModeShared, nil
	case SyncModeShared:
		return SyncModeShared, nil
	case SyncModeOwn:
		return SyncModeOwn, nil
	default:
		return "", fmt.Errorf("invalid sync.mode %q (want shared|own)", raw)
	}
}

// SetSyncMode updates only hero.local.json's sync.mode; all other local
// fields survive. The file is gitignored, so this never travels across machines.
func SetSyncMode(root, id, mode string) (string, error) {
	resolved, err := ResolveRoot(root)
	if err != nil {
		return "", err
	}
	if err := ValidateID(id); err != nil {
		return "", err
	}
	normalized, err := NormalizeSyncMode(mode)
	if err != nil {
		return "", err
	}
	path := filepath.Join(heroDir(resolved, id), ".hero", "hero.local.json")
	local := HeroLocal{SchemaVersion: SchemaVersion, Generated: scaffoldStamp}
	if barr, readErr := os.ReadFile(path); readErr == nil {
		if err := json.Unmarshal(barr, &local); err != nil {
			return "", fmt.Errorf("parsing %s: %w", path, err)
		}
	} else if !errors.Is(readErr, os.ErrNotExist) {
		return "", fmt.Errorf("reading %s: %w", path, readErr)
	}
	if local.Sync == nil {
		local.Sync = &SyncConfig{}
	}
	local.Sync.Mode = normalized
	if err := writeFileAtomic(path, []byte(marshalIndent(local)+"\n"), 0o644); err != nil {
		return "", err
	}
	return path, nil
}

func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".hero-tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpName, perm); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}
