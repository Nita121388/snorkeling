// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package persona

// A6: shift journal + human-gated memory proposals + distillation.
//
// The journal is the machine-owned append-only shift log. facts / lessons /
// CHARTER are long-term assets: agents may only PROPOSE (A2.5 appendInbox),
// and a human explicitly ApproveInbox's the proposal. Nothing here writes a
// long-term memory file without that human action.

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Journal state whitelist (mirrors agentstatus vocabulary, no second taxonomy).
var journalStates = map[string]bool{
	"working": true,
	"blocked": true,
	"done":    true,
	"stale":   true,
}

const (
	InboxStatusPending   = "pending"
	InboxStatusApproved  = "approved"
	InboxStatusDismissed = "dismissed"
)

// Inbox targets are deliberately relative to .persona/ and hardcoded: a
// proposal must never be able to point at an arbitrary path on disk.
var inboxTargets = map[string]string{
	"MEMORY/facts.md":   "facts",
	"MEMORY/lessons.md": "lessons",
	"MEMORY/CHARTER.md": "charter",
}

var (
	ErrInboxNotFound   = errors.New("inbox proposal not found")
	ErrInboxNotPending = errors.New("inbox proposal is not pending")
)

// JournalEntry is one shift-log line. Source is a free-form provenance label
// (agent:x / human:x / supervisor); State comes from journalStates.
type JournalEntry struct {
	State   string
	Summary string
	Source  string
	Now     func() time.Time
}

// JournalResult reports the exact line written (useful for the CLI/JSON).
type JournalResult struct {
	ID        string `json:"id"`
	Path      string `json:"path"`
	Line      string `json:"line"`
	Timestamp string `json:"timestamp"`
}

// AppendJournal appends one timestamped shift entry and refreshes the roster
// (the journal is A1's last-active proxy for the 💤 dormant marker).
func AppendJournal(root, id string, entry JournalEntry) (*JournalResult, error) {
	resolved, err := ResolveRoot(root)
	if err != nil {
		return nil, err
	}
	if err := ValidateID(id); err != nil {
		return nil, err
	}
	state := strings.ToLower(strings.TrimSpace(entry.State))
	if state == "" {
		state = "done"
	}
	if !journalStates[state] {
		return nil, fmt.Errorf("invalid journal state %q (want working|blocked|done|stale)", entry.State)
	}
	summary := strings.TrimSpace(entry.Summary)
	if summary == "" {
		return nil, errors.New("journal summary must not be empty")
	}
	personaPath := filepath.Join(personaDir(resolved, id), ".persona", "persona.json")
	if _, err := os.Stat(personaPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("%w: %s", ErrNotFound, id)
		}
		return nil, err
	}
	now := time.Now()
	if entry.Now != nil {
		now = entry.Now()
	}
	// A5.5: crossing a month boundary rotates the old entries into
	// MEMORY/archive/YYYY-MM.md before the new line lands, so journal.md never
	// grows without bound. Best effort: a rotation failure must not lose the
	// shift entry the caller asked for.
	_, _ = MaybeRotateJournal(resolved, id, func() time.Time { return now })
	ts := now.UTC().Format(time.RFC3339)
	source := strings.TrimSpace(entry.Source)
	if source == "" {
		source = "human:" + currentUser()
	}
	line := fmt.Sprintf("- %s [%s] %s — %s\n", ts, state, source, summary)
	path := filepath.Join(personaDir(resolved, id), ".persona", "MEMORY", "journal.md")
	if err := appendToFile(path, line); err != nil {
		return nil, err
	}
	if _, err := WriteRoster(resolved); err != nil {
		return nil, err
	}
	return &JournalResult{ID: id, Path: path, Line: line, Timestamp: ts}, nil
}

// InboxItem is one parsed proposal block from MEMORY/inbox.md.
type InboxItem struct {
	Stamp   string `json:"stamp"`
	Section string `json:"section"`
	Source  string `json:"source"`
	Target  string `json:"target"`
	Content string `json:"content"`
	Status  string `json:"status"`
}

func inboxPath(root, id string) string {
	return filepath.Join(personaDir(root, id), ".persona", "MEMORY", "inbox.md")
}

// ListInbox parses A2.5's structured blocks. A block without a `- 状态:` line
// is a legacy pending proposal (backwards compatible with existing vaults).
func ListInbox(root, id string) ([]InboxItem, error) {
	resolved, err := ResolveRoot(root)
	if err != nil {
		return nil, err
	}
	if err := ValidateID(id); err != nil {
		return nil, err
	}
	barr, err := os.ReadFile(inboxPath(resolved, id))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	blocks := splitInboxBlocks(string(barr))
	out := make([]InboxItem, 0, len(blocks))
	for _, block := range blocks {
		item, ok := parseInboxBlock(block)
		if ok {
			out = append(out, item)
		}
	}
	return out, nil
}

// splitInboxBlocks keeps the "## " header attached to its own body.
func splitInboxBlocks(body string) []string {
	normalized := strings.ReplaceAll(body, "\r\n", "\n")
	var blocks []string
	var current strings.Builder
	for _, line := range strings.Split(normalized, "\n") {
		if strings.HasPrefix(line, "## ") {
			if current.Len() > 0 {
				blocks = append(blocks, current.String())
				current.Reset()
			}
		}
		if current.Len() > 0 || strings.HasPrefix(line, "## ") {
			current.WriteString(line + "\n")
		}
	}
	if current.Len() > 0 {
		blocks = append(blocks, current.String())
	}
	return blocks
}

func parseInboxBlock(block string) (InboxItem, bool) {
	lines := strings.Split(block, "\n")
	if len(lines) == 0 || !strings.HasPrefix(lines[0], "## ") {
		return InboxItem{}, false
	}
	header := strings.TrimSpace(strings.TrimPrefix(lines[0], "## "))
	fields := strings.Fields(header)
	if len(fields) < 3 || fields[2] != "propose" {
		return InboxItem{}, false
	}
	item := InboxItem{Stamp: fields[0], Section: fields[1], Status: InboxStatusPending}
	for _, line := range lines[1:] {
		trimmed := strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(trimmed, "- 来源:"):
			item.Source = strings.TrimSpace(strings.TrimPrefix(trimmed, "- 来源:"))
		case strings.HasPrefix(trimmed, "- 目标:"):
			item.Target = strings.TrimSpace(strings.TrimPrefix(trimmed, "- 目标:"))
		case strings.HasPrefix(trimmed, "- 内容:"):
			item.Content = strings.TrimSpace(strings.TrimPrefix(trimmed, "- 内容:"))
		case strings.HasPrefix(trimmed, "- 状态:"):
			status := strings.TrimSpace(strings.TrimPrefix(trimmed, "- 状态:"))
			if status != "" {
				item.Status = status
			}
		}
	}
	if item.Target == "" || item.Content == "" {
		return InboxItem{}, false
	}
	return item, true
}

// InboxActionResult reports an approve/dismiss decision.
type InboxActionResult struct {
	ID      string `json:"id"`
	Stamp   string `json:"stamp"`
	Status  string `json:"status"`
	Target  string `json:"target,omitempty"`
	Changed bool   `json:"changed"`
	Path    string `json:"path"`
}

// ApproveInbox is the HUMAN gate: it appends the proposed content to the
// whitelisted long-term memory file, marks the block approved, and leaves a
// journal audit line. Approving twice is an idempotent no-op.
func ApproveInbox(root, id, stamp string, now func() time.Time) (*InboxActionResult, error) {
	resolved, err := ResolveRoot(root)
	if err != nil {
		return nil, err
	}
	if err := ValidateID(id); err != nil {
		return nil, err
	}
	items, err := ListInbox(resolved, id)
	if err != nil {
		return nil, err
	}
	idx := findInbox(items, stamp)
	if idx < 0 {
		return nil, ErrInboxNotFound
	}
	item := items[idx]
	result := &InboxActionResult{ID: id, Stamp: item.Stamp, Status: item.Status, Path: inboxPath(resolved, id)}
	if item.Status == InboxStatusApproved {
		return result, nil // idempotent
	}
	if item.Status != InboxStatusPending {
		return nil, fmt.Errorf("%w: %s (%s)", ErrInboxNotPending, item.Stamp, item.Status)
	}
	if _, ok := inboxTargets[item.Target]; !ok {
		return nil, fmt.Errorf("inbox target %q is not a whitelisted memory file", item.Target)
	}
	targetPath := filepath.Join(personaDir(resolved, id), ".persona", filepath.FromSlash(item.Target))
	if err := appendToFile(targetPath, "- "+item.Content+"\n"); err != nil {
		return nil, err
	}
	if err := markInboxStatus(resolved, id, item.Stamp, InboxStatusApproved); err != nil {
		return nil, err
	}
	journalNow := now
	if _, err := AppendJournal(resolved, id, JournalEntry{
		State:   "done",
		Summary: fmt.Sprintf("批准 %s 提议 %s → %s", item.Section, item.Stamp, item.Target),
		Source:  "human:" + currentUser(),
		Now:     journalNow,
	}); err != nil {
		return nil, err
	}
	result.Status = InboxStatusApproved
	result.Target = item.Target
	result.Changed = true
	return result, nil
}

// DismissInbox marks a proposal dismissed but keeps it (and its provenance)
// on disk. Dismissing an approved proposal is refused.
func DismissInbox(root, id, stamp string) (*InboxActionResult, error) {
	resolved, err := ResolveRoot(root)
	if err != nil {
		return nil, err
	}
	if err := ValidateID(id); err != nil {
		return nil, err
	}
	items, err := ListInbox(resolved, id)
	if err != nil {
		return nil, err
	}
	idx := findInbox(items, stamp)
	if idx < 0 {
		return nil, ErrInboxNotFound
	}
	item := items[idx]
	result := &InboxActionResult{ID: id, Stamp: item.Stamp, Status: item.Status, Path: inboxPath(resolved, id)}
	if item.Status == InboxStatusDismissed {
		return result, nil
	}
	if item.Status != InboxStatusPending {
		return nil, fmt.Errorf("%w: %s (%s)", ErrInboxNotPending, item.Stamp, item.Status)
	}
	if err := markInboxStatus(resolved, id, item.Stamp, InboxStatusDismissed); err != nil {
		return nil, err
	}
	result.Status = InboxStatusDismissed
	result.Changed = true
	return result, nil
}

func findInbox(items []InboxItem, stamp string) int {
	stamp = strings.TrimSpace(stamp)
	matched := -1
	for i, item := range items {
		if item.Stamp == stamp || strings.HasPrefix(item.Stamp, stamp) {
			if matched >= 0 {
				return -1 // ambiguous prefix: refuse to guess
			}
			matched = i
		}
	}
	return matched
}

// markInboxStatus rewrites only the status line of the matching block; all
// other bytes (including human edits inside other blocks) stay untouched.
func markInboxStatus(root, id, stamp, status string) error {
	path := inboxPath(root, id)
	barr, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	body := string(barr)
	normalized := strings.ReplaceAll(body, "\r\n", "\n")
	blocks := splitInboxBlocks(normalized)
	found := false
	for i, block := range blocks {
		item, ok := parseInboxBlock(block)
		if !ok || item.Stamp != stamp {
			continue
		}
		found = true
		lines := strings.Split(strings.TrimRight(block, "\n"), "\n")
		replaced := false
		for j, line := range lines {
			if strings.HasPrefix(strings.TrimSpace(line), "- 状态:") {
				lines[j] = "- 状态: " + status
				replaced = true
				break
			}
		}
		if !replaced {
			lines = append(lines, "- 状态: "+status)
		}
		blocks[i] = strings.Join(lines, "\n") + "\n"
		break
	}
	if !found {
		return ErrInboxNotFound
	}
	// Preserve a file-level preamble (the scaffold's "# 提议区" header).
	preamble := ""
	if idx := strings.Index(normalized, "## "); idx > 0 {
		preamble = normalized[:idx]
	}
	return writeFileAtomic(path, []byte(preamble+strings.Join(blocks, "")), 0o644)
}
