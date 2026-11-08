// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package syncjournal

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func setup(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	SetDirForTesting(dir)
	t.Cleanup(func() { SetDirForTesting("") })
	return dir
}

func TestAppendAndReadBack(t *testing.T) {
	setup(t)

	if err := Append(Event{Type: EventRunStart, Trigger: "manual"}); err != nil {
		t.Fatalf("append: %v", err)
	}
	if err := Append(Event{Type: EventPush, Items: 2, Rev: 7}); err != nil {
		t.Fatalf("append: %v", err)
	}
	if err := Append(Event{Type: EventRunEnd, OK: true, Ms: 120}); err != nil {
		t.Fatalf("append: %v", err)
	}

	events, err := ReadRecent(10)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(events) != 3 {
		t.Fatalf("expected 3 events, got %d", len(events))
	}
	// Order must be chronological (oldest first) so a reader can render a timeline.
	if events[0].Type != EventRunStart || events[2].Type != EventRunEnd {
		t.Fatalf("unexpected order: %+v", events)
	}
	if events[1].Items != 2 || events[1].Rev != 7 {
		t.Fatalf("payload lost: %+v", events[1])
	}
	// TS is filled in automatically; a missing timestamp would make the log useless.
	if events[0].TS == "" {
		t.Fatal("TS must be stamped")
	}
}

func TestReadRecentKeepsNewestWhenOverLimit(t *testing.T) {
	setup(t)
	for i := 0; i < 10; i++ {
		if err := Append(Event{Type: EventPull, Items: i}); err != nil {
			t.Fatalf("append: %v", err)
		}
	}
	events, err := ReadRecent(3)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(events) != 3 {
		t.Fatalf("expected 3, got %d", len(events))
	}
	// Must be the LAST three (7,8,9), not the first three: "recent activity" is the point.
	if events[0].Items != 7 || events[2].Items != 9 {
		t.Fatalf("expected newest three, got items %d..%d", events[0].Items, events[2].Items)
	}
}

func TestReadRecentOnEmptyDirIsNotAnError(t *testing.T) {
	setup(t)
	events, err := ReadRecent(5)
	if err != nil {
		t.Fatalf("missing journal must not be an error: %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("expected no events, got %d", len(events))
	}
}

func TestMalformedLineIsSkippedNotFatal(t *testing.T) {
	dir := setup(t)
	if err := Append(Event{Type: EventRunStart, Trigger: "manual"}); err != nil {
		t.Fatalf("append: %v", err)
	}
	// Simulate a process killed mid-write.
	path := filepath.Join(dir, "journal-"+time.Now().Format("20060102")+".jsonl")
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if _, err := f.WriteString("{\"ts\":\"truncated"); err != nil {
		t.Fatalf("write: %v", err)
	}
	f.Close()

	events, err := ReadRecent(10)
	if err != nil {
		t.Fatalf("a truncated line must not abort the read: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected the one valid event, got %d", len(events))
	}
}

func TestPruneRemovesOnlyOldFiles(t *testing.T) {
	dir := setup(t)

	old := filepath.Join(dir, "journal-20200101.jsonl")
	fresh := filepath.Join(dir, "journal-"+time.Now().Format("20060102")+".jsonl")
	for _, p := range []string{old, fresh} {
		if err := os.WriteFile(p, []byte("{}"), 0600); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	if err := Prune(time.Now()); err != nil {
		t.Fatalf("prune: %v", err)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatal("journal older than the retention window must be pruned")
	}
	if _, err := os.Stat(fresh); err != nil {
		t.Fatalf("today's journal must survive: %v", err)
	}
}

func TestUnrelatedFilesAreIgnored(t *testing.T) {
	dir := setup(t)
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("hello"), 0600); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := Prune(time.Now()); err != nil {
		t.Fatalf("prune: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "notes.txt")); err != nil {
		t.Fatalf("prune must not touch non-journal files: %v", err)
	}
}
