// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package persona

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Memory discipline (design/plans/persona-system.md §4.5, task design §6):
//
//   - journal.md is the shift log: any caller (human or agent) may append a
//     timestamped line directly. Memory is a long-lived asset, but the journal
//     is explicitly append-only scratch.
//   - facts.md / lessons.md are long-term memory: an agent may ONLY propose,
//     by appending a structured block to MEMORY/inbox.md. AddMemory returns
//     ErrRefusedDirectWrite even under --yes — that is the gate itself, not a
//     missing confirmation.
//
// The rule is identical for human-authored personas; only the wording is
// firmer ("a human wrote this file").

// Memory sections known to AddMemory.
const (
	MemorySectionJournal = "journal"
	MemorySectionFacts   = "facts"
	MemorySectionLessons = "lessons"
)

// ErrRefusedDirectWrite is returned when a facts/lessons write was routed to
// MEMORY/inbox.md instead of the target file. The inbox block WAS written;
// the caller reports it and exits non-zero.
var ErrRefusedDirectWrite = errors.New("direct write refused: routed to MEMORY/inbox.md")

// MemoryResult reports what AddMemory did.
type MemoryResult struct {
	ID      string `json:"id"`
	Section string `json:"section"`
	// Written is true when a journal line was appended directly.
	Written bool `json:"written"`
	// Inboxed is true when the text was appended to MEMORY/inbox.md as a proposal.
	Inboxed bool        `json:"inboxed"`
	Path    string      `json:"path"`
	DryRun  bool        `json:"dryRun"`
	Agent   *Provenance `json:"agent,omitempty"`
}

// AddMemory appends text to a persona's memory under the memory discipline.
// journal appends directly; facts/lessons always go through inbox and return
// ErrRefusedDirectWrite (the inbox block is still written unless dryRun).
func AddMemory(root, id, section, text string, agent *Provenance, dryRun bool) (*MemoryResult, error) {
	rootResolved, err := ResolveRoot(root)
	if err != nil {
		return nil, err
	}
	if err := ValidateID(id); err != nil {
		return nil, err
	}
	section = strings.ToLower(strings.TrimSpace(section))
	switch section {
	case MemorySectionJournal, MemorySectionFacts, MemorySectionLessons:
	default:
		return nil, fmt.Errorf("invalid --section %q: must be facts|lessons|journal", section)
	}
	if strings.TrimSpace(text) == "" {
		return nil, errors.New("memory text must not be empty")
	}
	p, err := readPersonaFile(filepath.Join(personaDir(rootResolved, id), ".persona", "persona.json"))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("%w: %s", ErrNotFound, id)
		}
		return nil, err
	}
	now := time.Now()
	res := &MemoryResult{ID: id, Section: section, DryRun: dryRun, Agent: agent}
	if section == MemorySectionJournal {
		journalPath := filepath.Join(personaDir(rootResolved, id), ".persona", "MEMORY", "journal.md")
		res.Path = journalPath
		if dryRun {
			return res, nil
		}
		line := fmt.Sprintf("- %s [%s] %s\n", now.UTC().Format(time.RFC3339), memorySourceLabel(agent), strings.TrimSpace(text))
		if err := appendToFile(journalPath, line); err != nil {
			return nil, err
		}
		// The journal is the last-active proxy: refresh the roster so the
		// 💤 dormant marker tracks the append.
		if _, err := WriteRoster(rootResolved); err != nil {
			return nil, err
		}
		res.Written = true
		return res, nil
	}
	// facts / lessons: always inbox, for agents and humans alike.
	inboxPath := filepath.Join(personaDir(rootResolved, id), ".persona", "MEMORY", "inbox.md")
	res.Path = inboxPath
	if dryRun {
		return res, nil
	}
	if err := appendInbox(rootResolved, id, section, text, agent, now); err != nil {
		return nil, err
	}
	res.Inboxed = true
	if p.CreatedBy != nil && p.CreatedBy.Kind == "human" {
		return res, fmt.Errorf("%w: %s is a human-authored persona — facts/lessons only ever enter through a human-approved inbox proposal", ErrRefusedDirectWrite, id)
	}
	return res, fmt.Errorf("%w: %s long-term memory is human-approved; the proposal is in MEMORY/inbox.md", ErrRefusedDirectWrite, agentKindLabel(agent))
}

// appendInbox appends one structured proposal block to MEMORY/inbox.md.
// Shared by AddMemory (facts/lessons discipline) and Create (--memory-from-session).
func appendInbox(root, id, section, text string, agent *Provenance, now time.Time) error {
	inboxPath := filepath.Join(personaDir(root, id), ".persona", "MEMORY", "inbox.md")
	ts := now.UTC().Format(time.RFC3339)
	var b strings.Builder
	b.WriteString(fmt.Sprintf("## %s %s propose\n\n", ts, section))
	b.WriteString(fmt.Sprintf("- 来源: %s\n", memorySourceLabel(agent)))
	b.WriteString(fmt.Sprintf("- 目标: MEMORY/%s.md\n", section))
	b.WriteString(fmt.Sprintf("- 内容: %s\n\n", strings.TrimSpace(text)))
	return appendToFile(inboxPath, b.String())
}

// memorySourceLabel renders the provenance line: who proposed this.
// SourceLabel is the exported provenance label for CLI callers that write a
// shift journal line (A6). The single implementation stays here so journal
// lines, inbox proposals and journal audits all read the same way.
func SourceLabel(agent *Provenance) string {
	return memorySourceLabel(agent)
}

func memorySourceLabel(agent *Provenance) string {
	if agent == nil {
		return "human:" + currentUser()
	}
	name := strings.TrimSpace(agent.Name)
	if name == "" {
		name = "agent"
	}
	if sid := strings.TrimSpace(agent.SessionID); sid != "" {
		return fmt.Sprintf("agent:%s（会话 %s）", name, sid)
	}
	return "agent:" + name
}

func agentKindLabel(agent *Provenance) string {
	if agent == nil {
		return "human"
	}
	if strings.TrimSpace(agent.Name) != "" {
		return "agent " + strings.TrimSpace(agent.Name)
	}
	return "agent"
}

func appendToFile(path, text string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("creating directory for %s: %w", path, err)
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("opening %s: %w", path, err)
	}
	defer f.Close()
	if _, err := f.WriteString(text); err != nil {
		return fmt.Errorf("appending %s: %w", path, err)
	}
	return nil
}
