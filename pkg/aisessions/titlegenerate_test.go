// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"strings"
	"testing"
)

func TestParseTitleResponse_ValidJSON(t *testing.T) {
	sug, err := parseTitleResponse(`{"title":"Fix cwd fallback","confidence":0.8}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sug.Title != "Fix cwd fallback" {
		t.Errorf("title = %q", sug.Title)
	}
	if sug.Confidence != 0.8 {
		t.Errorf("confidence = %v", sug.Confidence)
	}
}

func TestParseTitleResponse_MarkdownFenceAndQuotes(t *testing.T) {
	sug, err := parseTitleResponse("```json\n{\"title\":\"\\\"Add note AI\\\".\",\"confidence\":0.5}\n```")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sug.Title != "Add note AI" {
		t.Errorf("title = %q, want %q", sug.Title, "Add note AI")
	}
}

func TestParseTitleResponse_TrimsTrailingPeriod(t *testing.T) {
	sug, err := parseTitleResponse(`{"title":"Ship release."}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sug.Title != "Ship release" {
		t.Errorf("title = %q", sug.Title)
	}
}

func TestParseTitleResponse_InvalidJSON(t *testing.T) {
	if _, err := parseTitleResponse("not json"); err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestParseTitleResponse_Limit(t *testing.T) {
	sug, err := parseTitleResponseWithLimit(`{"title":"`+strings.Repeat("a", 200)+`"}`, 20)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len([]rune(sug.Title)) != 20 {
		t.Errorf("title length = %d, want 20", len([]rune(sug.Title)))
	}
	// out-of-range confidence clamped to 0
	sug, err = parseTitleResponse(`{"title":"x","confidence":2}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sug.Confidence != 0 {
		t.Errorf("confidence = %v, want 0", sug.Confidence)
	}
}

func TestBuildTitleUserPrompt_IncludesContext(t *testing.T) {
	req := TitleGenerateRequest{
		Source:        "codex",
		ProjectPath:   "/tmp/proj",
		ExistingTitle: "Old title",
		Messages: []Message{
			{Role: RoleUser, Text: "hello"},
			{Role: RoleTool, ToolName: "read", Text: "contents"},
		},
	}
	prompt := buildTitleUserPrompt(req)
	for _, want := range []string{"Old title", "/tmp/proj", "codex", "[user] hello", "[read] contents"} {
		if !strings.Contains(prompt, want) {
			t.Errorf("prompt missing %q: %q", want, prompt)
		}
	}
}
