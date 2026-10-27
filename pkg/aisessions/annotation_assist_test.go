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

func TestParseAnnotationReplyRecoversTruncatedJSON(t *testing.T) {
	// 真实事故：模型写到第 3 条被输出上限切断，第 1、2 条是完整的。
	raw := `{"annotations":[{"anchorKey":"e1:t0 seq=1","kind":"note","title":"a"},{"anchorKey":"e2:t0 seq=2","kind":"milestone","title":"b"},{"anchorKey":"e3:t0 se`
	drafts, issue, err := parseAnnotationReply(raw)
	if err != nil {
		t.Fatalf("expected truncation to be repaired, got %v (issue=%s)", err, issue)
	}
	if issue != annotationIssueNone {
		t.Fatalf("expected no issue, got %s", issue)
	}
	if len(drafts) != 2 {
		t.Fatalf("expected the 2 complete drafts to be recovered, got %#v", drafts)
	}
}

func TestParseAnnotationReplyTruncationWithNoCompleteItemReportsTruncated(t *testing.T) {
	raw := `{"annotations":[{"anchorKey":"e1:t0","ti`
	_, issue, err := parseAnnotationReply(raw)
	if err == nil {
		t.Fatalf("expected error")
	}
	if issue != annotationIssueTruncated {
		t.Fatalf("expected truncated issue, got %s", issue)
	}
}

func TestParseAnnotationReplyStripsReasoningBeforeJSON(t *testing.T) {
	// 真实事故：思考模型先吐一段英文独白，再给 JSON。
	raw := "We need respond exact JSON object with annotations. Need choose important anchors.\n<thinking>plan the answer</thinking>\n" +
		`{"annotations":[{"anchorKey":"e1:m0","kind":"note","title":"t"}]}`
	drafts, issue, err := parseAnnotationReply(raw)
	if err != nil {
		t.Fatalf("expected reasoning wrapper to be stripped: %v (issue=%s)", err, issue)
	}
	if len(drafts) != 1 {
		t.Fatalf("unexpected drafts: %#v", drafts)
	}
}

func TestParseAnnotationReplyPureProseReportsNoJSON(t *testing.T) {
	raw := "We need respond exact JSON object with annotations. Need choose important anchors."
	_, issue, err := parseAnnotationReply(raw)
	if err == nil {
		t.Fatalf("expected error")
	}
	if issue != annotationIssueNoJSON {
		t.Fatalf("expected no-json issue, got %s", issue)
	}
}

func TestNormalizeAnnotationAnchorKey(t *testing.T) {
	cases := map[string]string{
		"7de4c9c0:t0 seq=618":              "7de4c9c0:t0",
		`"7de4c9c0:t0"`:                    "7de4c9c0:t0",
		"`7de4c9c0:t0`":                    "7de4c9c0:t0",
		"7de4c9c0:t0 seq=618 role=tool":    "7de4c9c0:t0",
		"  7de4c9c0:t0  ":                  "7de4c9c0:t0",
	}
	for raw, want := range cases {
		if got := normalizeAnnotationAnchorKey(raw); got != want {
			t.Fatalf("normalizeAnnotationAnchorKey(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestAnnotationOutputBudgetScalesWithWorkload(t *testing.T) {
	if got := annotationOutputBudget(1, 100); got != annotationMinOutputTokens {
		t.Fatalf("small request should clamp to the floor, got %d", got)
	}
	mid := annotationOutputBudget(12, 600)
	if mid <= annotationMinOutputTokens || mid >= annotationMaxOutputTokensCap {
		t.Fatalf("expected a mid-range budget for 12 x 600, got %d", mid)
	}
	if got := annotationOutputBudget(30, 2000); got != annotationMaxOutputTokensCap {
		t.Fatalf("large request should clamp to the cap, got %d", got)
	}
}

func TestBuildAnnotationAssistPromptUsesJSONLines(t *testing.T) {
	prompt := buildAnnotationAssistPrompt(AnnotationAssistInput{Scope: AnnotationScopeTimeline}, []annotationDigestEntry{
		{AnchorKey: "e1:t0", Seq: 7, Role: "tool", Text: "bash ls"},
	})
	if !strings.Contains(prompt, `{"anchorKey":"e1:t0","seq":7,"role":"tool","text":"bash ls"}`) {
		t.Fatalf("digest line should be one JSON object, got:\n%s", prompt)
	}
	if !strings.Contains(prompt, "Never append seq/role/text") {
		t.Fatalf("prompt should forbid the seq suffix, got:\n%s", prompt)
	}
}
