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

func memoryPath(root, id, file string) string {
	return filepath.Join(root, id, ".hero", "MEMORY", file)
}

func TestMemoryJournalDirectAppend(t *testing.T) {
	root := t.TempDir()
	if _, err := Create(Options{Root: root, Name: "smoke", Now: time.Now}); err != nil {
		t.Fatal(err)
	}
	res, err := AddMemory(root, "smoke", MemorySectionJournal, "ran the backup", agentProvenance("pi", "sess-1"), false)
	if err != nil {
		t.Fatalf("journal append must succeed: %v", err)
	}
	if !res.Written || res.Inboxed {
		t.Fatalf("journal must be a direct write, got %+v", res)
	}
	body, err := os.ReadFile(memoryPath(root, "smoke", "journal.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "ran the backup") {
		t.Fatalf("journal must contain the text:\n%s", body)
	}
	if !strings.Contains(string(body), "agent:pi") {
		t.Fatalf("journal line must record its source:\n%s", body)
	}
	// the timestamp line starts with "- <RFC3339>"
	if !strings.Contains(string(body), "- 20") {
		t.Fatalf("journal line must carry a timestamp:\n%s", body)
	}
	inbox, err := os.ReadFile(memoryPath(root, "smoke", "inbox.md"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(inbox), "ran the backup") {
		t.Fatal("journal entries must not leak into inbox.md")
	}
}

func TestMemoryFactsAndLessonsGoToInbox(t *testing.T) {
	root := t.TempDir()
	if _, err := Create(Options{Root: root, Name: "smoke", Now: time.Now}); err != nil {
		t.Fatal(err)
	}
	for _, section := range []string{MemorySectionFacts, MemorySectionLessons} {
		text := "proposal for " + section
		res, err := AddMemory(root, "smoke", section, text, agentProvenance("pi", "sess-1"), false)
		if !errors.Is(err, ErrRefusedDirectWrite) {
			t.Fatalf("%s must be refused with ErrRefusedDirectWrite, got %v", section, err)
		}
		if res == nil || !res.Inboxed || res.Written {
			t.Fatalf("%s must be inboxed, not written, got %+v", section, res)
		}
		inbox, _ := os.ReadFile(memoryPath(root, "smoke", "inbox.md"))
		if !strings.Contains(string(inbox), text) {
			t.Fatalf("inbox must contain the %s proposal:\n%s", section, inbox)
		}
		target, _ := os.ReadFile(memoryPath(root, "smoke", section+".md"))
		if strings.Contains(string(target), text) {
			t.Fatalf("%s.md must NOT be written directly:\n%s", section, target)
		}
	}
}

func TestMemoryHumanHeroWording(t *testing.T) {
	root := t.TempDir()
	// human path: createdBy.kind == human
	if _, err := Create(Options{Root: root, Name: "smoke", Now: time.Now}); err != nil {
		t.Fatal(err)
	}
	_, err := AddMemory(root, "smoke", MemorySectionLessons, "lesson text", agentProvenance("pi", "sess-1"), false)
	if !errors.Is(err, ErrRefusedDirectWrite) {
		t.Fatalf("human-authored hero must still refuse facts/lessons, got %v", err)
	}
	if !strings.Contains(err.Error(), "human-authored") {
		t.Fatalf("human-authored wording must be firmer, got %q", err.Error())
	}
	inbox, _ := os.ReadFile(memoryPath(root, "smoke", "inbox.md"))
	if !strings.Contains(string(inbox), "lesson text") {
		t.Fatal("human-authored refusal must still write the inbox proposal")
	}
}

func TestMemoryDryRunAndNotFound(t *testing.T) {
	root := t.TempDir()
	if _, err := Create(Options{Root: root, Name: "smoke", Now: time.Now}); err != nil {
		t.Fatal(err)
	}
	res, err := AddMemory(root, "smoke", MemorySectionJournal, "not yet", nil, true)
	if err != nil {
		t.Fatalf("dry-run journal must not error: %v", err)
	}
	if res.Written || res.Inboxed || !res.DryRun {
		t.Fatalf("dry-run must write nothing, got %+v", res)
	}
	body, _ := os.ReadFile(memoryPath(root, "smoke", "journal.md"))
	if strings.Contains(string(body), "not yet") {
		t.Fatal("dry-run must not append to journal.md")
	}
	res, err = AddMemory(root, "smoke", MemorySectionFacts, "not yet", nil, true)
	if err != nil || res.Inboxed {
		t.Fatalf("dry-run facts must write nothing and not error, got %+v %v", res, err)
	}
	if _, err := AddMemory(root, "nope", MemorySectionJournal, "x", nil, false); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown hero must return ErrNotFound, got %v", err)
	}
	if _, err := AddMemory(root, "smoke", "bogus", "x", nil, false); err == nil {
		t.Fatal("unknown section must be refused")
	}
}
