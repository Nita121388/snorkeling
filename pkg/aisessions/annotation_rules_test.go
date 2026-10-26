// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import "testing"

// TestCanReplaceMatrix exhaustively covers status × source × user_edited.
func TestCanReplaceMatrix(t *testing.T) {
	statuses := []string{AnnotationStatusDraft, AnnotationStatusAccepted}
	sources := []string{AnnotationSourceUser, AnnotationSourceAI}
	edited := []bool{false, true}

	type want struct {
		replace bool
		why     string
	}
	expect := map[string]want{
		"draft|user|0":    {false, "manual draft is still user data"},
		"draft|user|1":    {false, "user data"},
		"draft|ai|0":      {true, "AI draft, untouched"},
		"draft|ai|1":      {false, "AI draft edited by user"},
		"accepted|user|0": {false, "hand-written"},
		"accepted|user|1": {false, "hand-written + edited"},
		"accepted|ai|0":   {true, "AI accepted, untouched"},
		"accepted|ai|1":   {false, "AI accepted, edited by user"},
	}
	for _, status := range statuses {
		for _, source := range sources {
			for _, isEdited := range edited {
				key := status + "|" + source + "|" + boolLabel(isEdited)
				row := AnnotationRow{Status: status, Source: source, UserEdited: isEdited}
				if got := CanReplace(row); got != expect[key].replace {
					t.Fatalf("CanReplace(%s) = %v, want %v (%s)", key, got, expect[key].replace, expect[key].why)
				}
			}
		}
	}
}

func boolLabel(value bool) string {
	if value {
		return "1"
	}
	return "0"
}

func TestAnchorHashStable(t *testing.T) {
	a := AnchorHash("hello   world\n\nsecond line")
	b := AnchorHash("  hello world second line  ")
	if a != b {
		t.Fatalf("whitespace-only differences must hash equal: %q vs %q", a, b)
	}
	if a == AnchorHash("different") {
		t.Fatalf("different text must hash differently")
	}
	if AnchorHash("   ") != "0" || AnchorHash("") != "0" {
		t.Fatalf("empty/whitespace hash must be \"0\"")
	}
}

func TestPickReanchor(t *testing.T) {
	anchors := []AnchorPoint{
		{AnchorKey: "e1:m0", Seq: 1, Role: "user", Hash: "111"},
		{AnchorKey: "e2:m0", Seq: 2, Role: "assistant", Hash: "222"},
		{AnchorKey: "e3:m0", Seq: 3, Role: "assistant", Hash: "333"},
		{AnchorKey: "e4:m0", Seq: 4, Role: "assistant", Hash: "333"},
	}

	// Exact key always wins.
	if got, ok := PickReanchor(anchors, AnchorPoint{AnchorKey: "e3:m0"}); !ok || got.AnchorKey != "e3:m0" {
		t.Fatalf("exact match failed: %#v %v", got, ok)
	}

	// Hash match within ±3 wins over nearest seq.
	got, ok := PickReanchor(anchors, AnchorPoint{AnchorKey: "gone", Seq: 1, Role: "assistant", Hash: "333"})
	if !ok || got.AnchorKey != "e3:m0" {
		t.Fatalf("hash match must win, got %#v ok=%v", got, ok)
	}

	// No hash match: nearest same-role seq is used.
	got, ok = PickReanchor(anchors, AnchorPoint{AnchorKey: "gone", Seq: 5, Role: "assistant", Hash: "999"})
	if !ok || got.AnchorKey != "e4:m0" {
		t.Fatalf("nearest seq fallback failed: %#v ok=%v", got, ok)
	}

	// Role mismatch / too far: orphan.
	if _, ok := PickReanchor(anchors, AnchorPoint{AnchorKey: "gone", Seq: 1, Role: "assistant", Hash: "999"}); ok {
		// seq 1 has no assistant within 3? seq 2 is distance 1 -> should match.
		// This case is intentionally a nearest match, so the real orphan test uses seq 10.
	}
	if _, ok := PickReanchor(anchors, AnchorPoint{AnchorKey: "gone", Seq: 10, Role: "assistant", Hash: "999"}); ok {
		t.Fatalf("far-away anchor must be orphaned")
	}
	if _, ok := PickReanchor(anchors, AnchorPoint{AnchorKey: "gone", Seq: 2, Role: "system", Hash: "222"}); ok {
		t.Fatalf("role mismatch must be orphaned")
	}
}
