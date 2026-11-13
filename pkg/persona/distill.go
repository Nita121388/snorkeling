// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package persona

// Distillation keeps long-term memory small without losing facts. It is a
// deterministic, pure-text transformation (no AI worker): duplicates are
// dropped, facts.md's machine-owned "## TL;DR" is rebuilt from the newest 5
// unique entries, and a backup is written before any file changes so --undo
// can restore the exact previous bytes.

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	DefaultDistillThreshold = 20
	TLDREntryCap            = 5
	distillBackupPrefix     = ".distill-backup-"
)

// DistillOptions controls one distillation pass.
type DistillOptions struct {
	Threshold int
	DryRun    bool
	Now       func() time.Time
}

// DistillResult is the machine-readable diff summary.
type DistillResult struct {
	ID      string `json:"id"`
	Before  int    `json:"before"`
	After   int    `json:"after"`
	Removed int    `json:"removed"`
	TLDR    int    `json:"tldr"`
	Changed bool   `json:"changed"`
	DryRun  bool   `json:"dryRun"`
	Backup  string `json:"backup,omitempty"`
	Facts   string `json:"facts"`
	Lessons string `json:"lessons"`
}

type distillBackup struct {
	TS      string `json:"ts"`
	ID      string `json:"id"`
	Facts   string `json:"facts"`
	Lessons string `json:"lessons"`
}

func personaMemoryPath(root, id, name string) string {
	return filepath.Join(personaDir(root, id), ".persona", "MEMORY", name)
}

func distillBackupDir(root, id string) string {
	return filepath.Join(personaDir(root, id), ".persona", "MEMORY", "archive")
}

// Distill de-duplicates facts/lessons bullet entries and refreshes the TL;DR.
// Non-bullet prose, section headers and comments are preserved verbatim.
func Distill(root, id string, opts DistillOptions) (*DistillResult, error) {
	resolved, err := ResolveRoot(root)
	if err != nil {
		return nil, err
	}
	if err := ValidateID(id); err != nil {
		return nil, err
	}
	threshold := opts.Threshold
	if threshold <= 0 {
		threshold = DefaultDistillThreshold
	}
	factsPath := personaMemoryPath(resolved, id, "facts.md")
	lessonsPath := personaMemoryPath(resolved, id, "lessons.md")
	factsBytes, err := os.ReadFile(factsPath)
	if err != nil {
		return nil, fmt.Errorf("reading facts.md: %w", err)
	}
	lessonsBytes, err := os.ReadFile(lessonsPath)
	if err != nil {
		return nil, fmt.Errorf("reading lessons.md: %w", err)
	}
	factsIn, lessonsIn := string(factsBytes), string(lessonsBytes)

	factsOut, factsBefore, factsAfter, tldrCount := distillFactsText(factsIn)
	lessonsOut, lessonsBefore, lessonsAfter := distillLessonsText(lessonsIn)
	before := factsBefore + lessonsBefore
	after := factsAfter + lessonsAfter
	removed := before - after
	result := &DistillResult{
		ID:      id,
		Before:  before,
		After:   after,
		Removed: removed,
		TLDR:    tldrCount,
		DryRun:  opts.DryRun,
		Facts:   factsPath,
		Lessons: lessonsPath,
	}
	changed := removed > 0 || factsOut != factsIn || lessonsOut != lessonsIn
	// Distillation is opt-in by pressure: below the entry threshold and with no
	// duplicates, leave the human's files byte-for-byte alone (no backup, no
	// TL;DR churn). A duplicate is worth cleaning even below the threshold.
	if before <= threshold && removed == 0 {
		return result, nil
	}
	result.Changed = changed
	if opts.DryRun || !changed {
		return result, nil
	}

	now := time.Now()
	if opts.Now != nil {
		now = opts.Now()
	}
	backup := distillBackup{
		TS:      now.UTC().Format("20060102T150405Z"),
		ID:      id,
		Facts:   factsIn,
		Lessons: lessonsIn,
	}
	dir := distillBackupDir(resolved, id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	backupPath := filepath.Join(dir, distillBackupPrefix+backup.TS+".json")
	if err := writeFileAtomic(backupPath, []byte(marshalIndent(backup)+"\n"), 0o644); err != nil {
		return nil, err
	}
	if err := writeFileAtomic(factsPath, []byte(factsOut), 0o644); err != nil {
		return nil, err
	}
	if err := writeFileAtomic(lessonsPath, []byte(lessonsOut), 0o644); err != nil {
		return nil, err
	}
	result.Backup = backupPath
	return result, nil
}

// distillFactsText rewrites only the machine-owned TL;DR section and drops
// duplicate bullet entries from the body. Every unique body entry survives.
func distillFactsText(body string) (string, int, int, int) {
	normalized := strings.ReplaceAll(body, "\r\n", "\n")
	lines := strings.Split(normalized, "\n")
	tldrIdx, bodyIdx := -1, -1
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "## TL;DR" && tldrIdx < 0 {
			tldrIdx = i
		} else if tldrIdx >= 0 && bodyIdx < 0 && strings.HasPrefix(trimmed, "## ") {
			bodyIdx = i
		}
	}
	if tldrIdx < 0 {
		// No TL;DR section (hand-edited vault): just de-duplicate bullets.
		out, before, after := dedupeBullets(lines)
		return out, before, after, 0
	}
	if bodyIdx < 0 {
		bodyIdx = len(lines)
	}
	bodyLines := lines[bodyIdx:]
	unique := make([]string, 0, len(bodyLines))
	seen := make(map[string]bool)
	for _, line := range bodyLines {
		if entry, ok := bulletEntry(line); ok {
			key := normalizeEntry(entry)
			if seen[key] {
				continue
			}
			seen[key] = true
			unique = append(unique, entry)
		}
	}
	// A hand-curated TL;DR with no body entries must survive: never replace it
	// with an empty section (the human owns curated facts until they move them).
	if len(unique) == 0 {
		for _, line := range lines[tldrIdx+1 : bodyIdx] {
			if entry, ok := bulletEntry(line); ok {
				key := normalizeEntry(entry)
				if !seen[key] {
					seen[key] = true
					unique = append(unique, entry)
				}
			}
		}
	}
	var rebuilt []string
	rebuilt = append(rebuilt, lines[:tldrIdx]...)
	rebuilt = append(rebuilt, "## TL;DR", "", "<!-- 机器维护的精选（≤5 条）；注入面只带本节 -->", "")
	start := len(unique) - TLDREntryCap
	if start < 0 {
		start = 0
	}
	for _, entry := range unique[start:] {
		rebuilt = append(rebuilt, "- "+entry)
	}
	rebuilt = append(rebuilt, "")
	// Body: keep all non-bullet lines, keep the first occurrence of each bullet.
	bodySeen := make(map[string]bool)
	for _, line := range bodyLines {
		if entry, ok := bulletEntry(line); ok {
			key := normalizeEntry(entry)
			if bodySeen[key] {
				continue
			}
			bodySeen[key] = true
			rebuilt = append(rebuilt, "- "+entry)
		} else {
			rebuilt = append(rebuilt, line)
		}
	}
	out := strings.Join(rebuilt, "\n")
	if !strings.HasSuffix(out, "\n") {
		out += "\n"
	}
	before := countBullets(bodyLines)
	return out, before, len(unique), len(unique) - start
}

func distillLessonsText(body string) (string, int, int) {
	lines := strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n")
	out, before, after := dedupeBullets(lines)
	return out, before, after
}

// dedupeBullets keeps the first occurrence of each bullet line (by normalized
// text) and preserves every other line verbatim.
func dedupeBullets(lines []string) (string, int, int) {
	seen := make(map[string]bool)
	out := make([]string, 0, len(lines))
	before, after := 0, 0
	for _, line := range lines {
		entry, ok := bulletEntry(line)
		if !ok {
			out = append(out, line)
			continue
		}
		before++
		key := normalizeEntry(entry)
		if seen[key] {
			continue
		}
		seen[key] = true
		after++
		out = append(out, "- "+entry)
	}
	return strings.Join(out, "\n"), before, after
}

func bulletEntry(line string) (string, bool) {
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "- ") {
		return "", false
	}
	entry := strings.TrimSpace(strings.TrimPrefix(trimmed, "- "))
	if entry == "" {
		return "", false
	}
	return entry, true
}

func normalizeEntry(entry string) string {
	return strings.ToLower(strings.Join(strings.Fields(entry), " "))
}

func countBullets(lines []string) int {
	n := 0
	for _, line := range lines {
		if _, ok := bulletEntry(line); ok {
			n++
		}
	}
	return n
}

// UndoDistill restores the most recent distillation backup (exact bytes).
func UndoDistill(root, id string) (string, error) {
	resolved, err := ResolveRoot(root)
	if err != nil {
		return "", err
	}
	if err := ValidateID(id); err != nil {
		return "", err
	}
	dir := distillBackupDir(resolved, id)
	matches, err := filepath.Glob(filepath.Join(dir, distillBackupPrefix+"*.json"))
	if err != nil {
		return "", err
	}
	if len(matches) == 0 {
		return "", errors.New("no distill backup to undo")
	}
	sort.Strings(matches)
	path := matches[len(matches)-1]
	barr, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	var backup distillBackup
	if err := json.Unmarshal(barr, &backup); err != nil {
		return "", fmt.Errorf("parsing %s: %w", path, err)
	}
	if err := writeFileAtomic(personaMemoryPath(resolved, id, "facts.md"), []byte(backup.Facts), 0o644); err != nil {
		return "", err
	}
	if err := writeFileAtomic(personaMemoryPath(resolved, id, "lessons.md"), []byte(backup.Lessons), 0o644); err != nil {
		return "", err
	}
	return path, nil
}
