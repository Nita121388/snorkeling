// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import "testing"

func TestBuildAnnotationAnchorsPrefersMirroringMessageSeq(t *testing.T) {
	messages := []Message{
		{Seq: 1, Role: "user", ItemKey: "e1:m0", Text: "hi"},
		{Seq: 7, Role: "tool", ItemKey: "e1:t0", Text: "bash ls"},
	}
	toolCalls := []ToolCall{
		// ToolCall.Seq 只是顺序计数，不能被当成时间线行号。
		{Seq: 1, Name: "bash", Summary: "ls", ItemKey: "e1:t0"},
	}

	anchors := BuildAnnotationAnchors(messages, toolCalls)
	if len(anchors) != 2 {
		t.Fatalf("expected 2 anchors, got %#v", anchors)
	}
	byKey := map[string]AnnotationAnchor{}
	for _, anchor := range anchors {
		byKey[anchor.AnchorKey] = anchor
	}
	if got := byKey["e1:m0"]; got.Seq != 1 || got.Role != "user" {
		t.Fatalf("message anchor wrong: %#v", got)
	}
	if got := byKey["e1:t0"]; got.Seq != 7 || got.Role != "tool" {
		t.Fatalf("tool anchor must reuse the mirroring message seq (7), got %#v", got)
	}
	if byKey["e1:t0"].Hash != AnchorHash("bash\nls") {
		t.Fatalf("tool anchor hash mismatch: %#v", byKey["e1:t0"])
	}
}

func TestBuildAnnotationAnchorsDropsToolWithoutMessageTwin(t *testing.T) {
	anchors := BuildAnnotationAnchors(
		[]Message{{Seq: 1, Role: "user", ItemKey: "e1:m0", Text: "hi"}},
		[]ToolCall{{Seq: 3, Name: "bash", Summary: "ls", ItemKey: "e1:t9"}},
	)
	if len(anchors) != 1 || anchors[0].AnchorKey != "e1:m0" {
		t.Fatalf("tool anchor without a mirroring message must be dropped: %#v", anchors)
	}
}

func TestBuildAnnotationAnchorsUsesThinkingWhenTextEmpty(t *testing.T) {
	anchors := BuildAnnotationAnchors([]Message{{Seq: 2, Role: "assistant", ItemKey: "e1:m1", Text: "  ", Thinking: "why"}}, nil)
	if len(anchors) != 1 || anchors[0].Hash != AnchorHash("why") {
		t.Fatalf("expected thinking-based hash, got %#v", anchors)
	}
}

func TestResolveAnnotationRowAnchorsFillsSeqHashPreview(t *testing.T) {
	rows := []AnnotationRow{
		{AnchorKey: "e1:t0", Title: "tool note"},
		{AnchorKey: "missing", Title: "unresolved", Seq: 4},
	}
	anchors := []AnnotationAnchor{{AnchorKey: "e1:t0", Seq: 7, Role: "tool", Hash: "h"}}
	previews := map[string]string{"e1:t0": "bash ls"}

	ResolveAnnotationRowAnchors(rows, anchors, previews)

	if rows[0].Seq != 7 || rows[0].AnchorHash != "h" || rows[0].AnchorPreview != "bash ls" {
		t.Fatalf("resolvable row not filled: %#v", rows[0])
	}
	if rows[1].Seq != 4 || rows[1].AnchorPreview != "" {
		t.Fatalf("unresolvable row must be left untouched: %#v", rows[1])
	}
}
