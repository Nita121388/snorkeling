// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package syncconflict

import (
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/syncproto"
)

func setup(t *testing.T) {
	t.Helper()
	SetDirForTesting(t.TempDir())
	t.Cleanup(func() { SetDirForTesting("") })
}

func conflict(id, localText, remoteText string) syncproto.Conflict {
	return syncproto.Conflict{
		Id:     id,
		Fields: []string{syncproto.ConflictFieldText},
		Local:  &syncproto.SnapshotItem{Id: id, Title: "Checklist", Text: localText, UpdatedAt: 1000},
		Remote: &syncproto.SnapshotItem{Id: id, Title: "Checklist", Text: remoteText, UpdatedAt: 2000},
		Reason: "both sides changed text",
	}
}

func TestRecordAndList(t *testing.T) {
	setup(t)
	if err := Record([]syncproto.Conflict{conflict("ct1", "local", "remote")}, "server", "Work Mac"); err != nil {
		t.Fatalf("record: %v", err)
	}
	entries, err := List()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 conflict, got %d", len(entries))
	}
	e := entries[0]
	if e.Id != "ct1" || e.Title != "Checklist" || e.DeviceName != "Work Mac" || e.Transport != "server" {
		t.Fatalf("entry lost data: %+v", e)
	}
	// Both versions must survive: without them the conflict cannot be resolved.
	if e.Local == nil || e.Local.Text != "local" || e.Remote == nil || e.Remote.Text != "remote" {
		t.Fatalf("both sides must be kept: %+v", e)
	}
}

func TestRecordKeepsOriginalDetectionTime(t *testing.T) {
	setup(t)
	if err := Record([]syncproto.Conflict{conflict("ct1", "a", "b")}, "server", ""); err != nil {
		t.Fatalf("record: %v", err)
	}
	first, _ := List()
	if len(first) != 1 {
		t.Fatalf("expected 1, got %d", len(first))
	}
	time.Sleep(1100 * time.Millisecond) // RFC3339 has second resolution
	if err := Record([]syncproto.Conflict{conflict("ct1", "a2", "b2")}, "server", ""); err != nil {
		t.Fatalf("re-record: %v", err)
	}
	second, _ := List()
	// A repeated sync must not reshuffle the list or reset the "how long has this been waiting" clock.
	if second[0].DetectedAt != first[0].DetectedAt {
		t.Fatalf("DetectedAt must be stable across syncs: %q vs %q", first[0].DetectedAt, second[0].DetectedAt)
	}
	// But the content must update to the latest versions.
	if second[0].Local.Text != "a2" {
		t.Fatalf("versions must refresh: %+v", second[0].Local)
	}
	if len(second) != 1 {
		t.Fatalf("re-record must not duplicate: got %d", len(second))
	}
}

func TestMarkResolvedHidesFromList(t *testing.T) {
	setup(t)
	if err := Record([]syncproto.Conflict{conflict("ct1", "a", "b")}, "server", ""); err != nil {
		t.Fatalf("record: %v", err)
	}
	if err := MarkResolved("ct1"); err != nil {
		t.Fatalf("resolve: %v", err)
	}
	entries, _ := List()
	if len(entries) != 0 {
		t.Fatalf("resolved conflict must leave the list, got %+v", entries)
	}
	// Resolving an unknown id is an error, not a silent success: it usually means the caller
	// has a stale id and should know.
	if err := MarkResolved("nope"); err == nil {
		t.Fatal("resolving an unknown id must fail")
	}
}

func TestPruneDropsOnlyOldResolved(t *testing.T) {
	setup(t)
	if err := Record([]syncproto.Conflict{
		conflict("old", "a", "b"),
		conflict("fresh", "a", "b"),
	}, "server", ""); err != nil {
		t.Fatalf("record: %v", err)
	}
	if err := MarkResolved("old"); err != nil {
		t.Fatalf("resolve: %v", err)
	}
	// A zero window prunes everything already resolved, which is the observable behaviour.
	if err := Prune(time.Nanosecond); err != nil {
		t.Fatalf("prune: %v", err)
	}
	kept, _ := List()
	if len(kept) != 1 || kept[0].Id != "fresh" {
		t.Fatalf("only the unresolved entry must survive, got %+v", kept)
	}
}

func TestRenderMarkdownIsSelfContainedForAI(t *testing.T) {
	setup(t)
	e := Entry{
		Id:         "ct1",
		Fields:     []string{syncproto.ConflictFieldText},
		Title:      "Monthly SQL checklist",
		Local:      &syncproto.SnapshotItem{Text: "- verify billing", UpdatedAt: 1000},
		Remote:     &syncproto.SnapshotItem{Text: "- verify billing\n- new item", UpdatedAt: 2000},
		DetectedAt: "2026-11-07T22:10:00Z",
		DeviceName: "Work Mac",
		Transport:  "server",
	}
	out := RenderMarkdown(e)

	// Everything the reader needs to act, without asking a follow-up question.
	for _, want := range []string{
		"## Sync conflict: Monthly SQL checklist",
		"`ct1`",
		"conflicting field(s): text",
		"### This machine",
		"### Work Mac",
		"- verify billing",
		"- new item",
		"### Task",                           // the instruction block
		"Reply with the merged content only", // output contract
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("rendered block is missing %q\n---\n%s", want, out)
		}
	}
	// The remote device name must be used, not a generic "Remote".
	if strings.Contains(out, "### Remote") {
		t.Fatalf("should name the remote device, got:\n%s", out)
	}
}

func TestRenderOnlyShowsConflictingFields(t *testing.T) {
	// Non-conflicting fields must not be dumped: it buries the difference and wastes context.
	e := Entry{
		Id:     "ct1",
		Fields: []string{syncproto.ConflictFieldTitle},
		Title:  "T",
		Local:  &syncproto.SnapshotItem{Title: "Local title", Text: "SAME BODY TEXT"},
		Remote: &syncproto.SnapshotItem{Title: "Remote title", Text: "SAME BODY TEXT"},
	}
	out := RenderMarkdown(e)
	if strings.Contains(out, "SAME BODY TEXT") {
		t.Fatalf("non-conflicting text must not be rendered:\n%s", out)
	}
	if !strings.Contains(out, "title: `Local title`") || !strings.Contains(out, "title: `Remote title`") {
		t.Fatalf("both titles must be shown:\n%s", out)
	}
}

func TestRenderAllSeparatesBlocks(t *testing.T) {
	if RenderAll(nil) != "" {
		t.Fatal("no conflicts must render to an empty string")
	}
	out := RenderAll([]Entry{
		{Id: "a", Title: "A", Local: &syncproto.SnapshotItem{Text: "x"}, Remote: &syncproto.SnapshotItem{Text: "y"}},
		{Id: "b", Title: "B", Local: &syncproto.SnapshotItem{Text: "x"}, Remote: &syncproto.SnapshotItem{Text: "y"}},
	})
	if !strings.Contains(out, "# Sync conflicts (2)") {
		t.Fatalf("expected a header for the batch:\n%s", out)
	}
	// Each block must be independently pasteable.
	if strings.Count(out, "### Task") != 2 {
		t.Fatalf("each conflict needs its own task block:\n%s", out)
	}
}

func TestCorruptStoreDoesNotBlockSyncing(t *testing.T) {
	setup(t)
	if err := Record([]syncproto.Conflict{conflict("ct1", "a", "b")}, "server", ""); err != nil {
		t.Fatalf("record: %v", err)
	}
	// Simulate a truncated write.
	if err := writeRaw("{not json"); err != nil {
		t.Fatalf("seed corrupt: %v", err)
	}
	entries, err := List()
	if err != nil {
		t.Fatalf("a corrupt conflict store must not return an error: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("corrupt store should read as empty, got %+v", entries)
	}
	// And it must remain writable.
	if err := Record([]syncproto.Conflict{conflict("ct2", "a", "b")}, "server", ""); err != nil {
		t.Fatalf("record after corruption: %v", err)
	}
}
