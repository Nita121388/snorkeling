// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"strings"
	"testing"
)

func TestParseAnnotationDraftResponse(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want int
	}{
		{"object wrapper", `{"annotations":[{"anchorKey":"e1:m0","kind":"note","title":"t"}]}`, 1},
		{"bare array", `[{"anchorKey":"e1:m0","kind":"milestone","title":"t"}]`, 1},
		{"single object", `{"anchorKey":"e1:m0","kind":"note","title":"t"}`, 1},
		{"fenced", "```json\n{\"annotations\":[{\"anchorKey\":\"e1:m0\"}]}\n```", 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			drafts, err := parseAnnotationDraftResponse(tc.raw)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(drafts) != tc.want {
				t.Fatalf("got %d drafts, want %d", len(drafts), tc.want)
			}
		})
	}
	if _, err := parseAnnotationDraftResponse("not json"); err == nil {
		t.Fatalf("expected parse error")
	}
}

func TestBuildAnnotationDigest(t *testing.T) {
	messages := []Message{
		{ItemKey: "", Seq: 1, Role: "user", Text: "dropped"},
		{ItemKey: "e1:m0", Seq: 1, Role: "user", Text: "hello"},
		{ItemKey: "e2:m0", Seq: 2, Role: "assistant", Thinking: "thinking text"},
	}
	tools := []ToolCall{{ItemKey: "e2:t0", Seq: 2, Name: "bash", Summary: "ls"}}
	digest := buildAnnotationDigest(messages, tools)
	if len(digest) != 3 {
		t.Fatalf("expected 3 anchored entries, got %#v", digest)
	}
	if digest[0].AnchorKey != "e1:m0" || digest[1].Text != "thinking text" || digest[2].Role != "tool" {
		t.Fatalf("unexpected digest: %#v", digest)
	}
}

func TestAnnotationScopeNormalization(t *testing.T) {
	if normalizeAnnotationScope("entry-title") != AnnotationScopeEntryTitle {
		t.Fatalf("entry-title not preserved")
	}
	if normalizeAnnotationScope("nonsense") != AnnotationScopeTimeline {
		t.Fatalf("unknown scope must fall back to timeline")
	}
}

func TestParseAnnotationDraftResponseExtractsEmbeddedJSON(t *testing.T) {
	raw := `Sure! Here are the annotations:
{"annotations":[{"anchorKey":"e1:m0","kind":"note","title":"Found it"}]}
Let me know if you need more.`
	drafts, err := parseAnnotationDraftResponse(raw)
	if err != nil {
		t.Fatalf("expected embedded JSON to parse: %v", err)
	}
	if len(drafts) != 1 || drafts[0].AnchorKey != "e1:m0" {
		t.Fatalf("unexpected drafts: %#v", drafts)
	}
}

func TestParseAnnotationDraftResponseExtractsArrayWithBracesInStrings(t *testing.T) {
	raw := `[{"anchorKey":"e1:m0","body":"use {\"a\":1} here"}]`
	drafts, err := parseAnnotationDraftResponse(raw)
	if err != nil {
		t.Fatalf("expected array to parse: %v", err)
	}
	if len(drafts) != 1 || !strings.Contains(drafts[0].Body, "{\"a\":1}") {
		t.Fatalf("unexpected drafts: %#v", drafts)
	}
}

func TestExtractFirstJSONValue(t *testing.T) {
	if got := extractFirstJSONValue("no json here"); got != "" {
		t.Fatalf("expected empty, got %q", got)
	}
	if got := extractFirstJSONValue("x [1,2] y"); got != "[1,2]" {
		t.Fatalf("unexpected extraction %q", got)
	}
	if got := extractFirstJSONValue("a {\"k\":\"}\"} b"); got != "{\"k\":\"}\"}" {
		t.Fatalf("brace inside string mishandled: %q", got)
	}
}
