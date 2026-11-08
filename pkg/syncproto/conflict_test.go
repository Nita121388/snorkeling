// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package syncproto

import (
	"reflect"
	"testing"
)

// Three-way merge is the core of "don't bother the user unnecessarily". These tests pin the
// cases that decide whether a real user ever sees a conflict dialog.

func item(text, title string) *SnapshotItem {
	return &SnapshotItem{Id: "ct1", Text: text, Title: title}
}

func TestOnlyOneSideChangedIsNotAConflict(t *testing.T) {
	base := item("original", "T")
	// Local edited the body; remote is untouched.
	local := item("local edit", "T")
	remote := item("original", "T")

	if fields := DetectConflictFields(base, local, remote); len(fields) != 0 {
		t.Fatalf("one-sided edit must merge automatically, got conflict on %v", fields)
	}

	// And the mirror image.
	local = item("original", "T")
	remote = item("remote edit", "T")
	if fields := DetectConflictFields(base, local, remote); len(fields) != 0 {
		t.Fatalf("one-sided remote edit must merge automatically, got conflict on %v", fields)
	}
}

func TestBothSidesChangedDifferentFieldsIsNotAConflict(t *testing.T) {
	// The classic row-merge win: local fixed a typo in the body, remote renamed the title.
	base := item("original", "Old title")
	local := item("original + fix", "Old title")
	remote := item("original", "New title")

	if fields := DetectConflictFields(base, local, remote); len(fields) != 0 {
		t.Fatalf("different fields edited on each side must merge, got conflict on %v", fields)
	}
}

func TestBothSidesChangedSameFieldIsAConflict(t *testing.T) {
	base := item("original", "T")
	local := item("local", "T")
	remote := item("remote", "T")

	fields := DetectConflictFields(base, local, remote)
	if !reflect.DeepEqual(fields, []string{ConflictFieldText}) {
		t.Fatalf("expected a text conflict, got %v", fields)
	}
}

func TestBothSidesMadeTheSameEditIsNotAConflict(t *testing.T) {
	// Both machines fixed the same typo: the values agree, so there is nothing to resolve.
	base := item("origional", "T")
	local := item("original", "T")
	remote := item("original", "T")

	if fields := DetectConflictFields(base, local, remote); len(fields) != 0 {
		t.Fatalf("identical edits must not conflict, got %v", fields)
	}
}

func TestTagsConflictUsesStableComparison(t *testing.T) {
	base := &SnapshotItem{Id: "ct1", Text: "x", Tags: []string{"a"}}
	local := &SnapshotItem{Id: "ct1", Text: "x", Tags: []string{"a", "b"}}
	remote := &SnapshotItem{Id: "ct1", Text: "x", Tags: []string{"a", "c"}}

	fields := DetectConflictFields(base, local, remote)
	if !reflect.DeepEqual(fields, []string{ConflictFieldTags}) {
		t.Fatalf("expected a tags conflict, got %v", fields)
	}
	// Same tags rebuilt in a different slice must NOT conflict (slice identity is not content).
	if fields := DetectConflictFields(base, local, &SnapshotItem{Id: "ct1", Text: "x", Tags: []string{"a", "b"}}); len(fields) != 0 {
		t.Fatalf("equal tag content must not conflict, got %v", fields)
	}
}

func TestMultipleFieldsConflictReported(t *testing.T) {
	base := item("original", "Old")
	local := item("local text", "Local title")
	remote := item("remote text", "Remote title")

	fields := DetectConflictFields(base, local, remote)
	want := []string{ConflictFieldText, ConflictFieldTitle}
	if !reflect.DeepEqual(fields, want) {
		t.Fatalf("expected %v, got %v", want, fields)
	}
}

func TestNoBaseStillDetectsConflict(t *testing.T) {
	// A first sync has no base. We cannot attribute the change, so differing content must be
	// reported rather than silently overwritten — asking is safer than guessing.
	local := item("local", "T")
	remote := item("remote", "T")
	fields := DetectConflictFields(nil, local, remote)
	if !reflect.DeepEqual(fields, []string{ConflictFieldText}) {
		t.Fatalf("no-base divergence must be reported, got %v", fields)
	}
}

func TestDetectHandlesNilSides(t *testing.T) {
	if fields := DetectConflictFields(nil, nil, item("x", "y")); len(fields) != 0 {
		t.Fatalf("nil local must not conflict, got %v", fields)
	}
	if fields := DetectConflictFields(nil, item("x", "y"), nil); len(fields) != 0 {
		t.Fatalf("nil remote must not conflict, got %v", fields)
	}
}

func TestJoinSplitTagsRoundTrip(t *testing.T) {
	tags := []string{"sql", "report", "work"}
	if got := SplitTags(JoinTags(tags)); !reflect.DeepEqual(got, tags) {
		t.Fatalf("round trip lost data: %v -> %v", tags, got)
	}
	if JoinTags(nil) != "" {
		t.Fatal("nil tags must join to empty string")
	}
	if SplitTags("") != nil {
		t.Fatal("empty string must split to nil")
	}
}
