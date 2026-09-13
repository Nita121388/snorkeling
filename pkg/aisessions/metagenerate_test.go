// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"strings"
	"testing"
)

func TestParseMetadataResponse_ValidJSON(t *testing.T) {
	sug, err := parseMetadataResponse(`{"note":"fixed cwd fallback","tags":["bugfix","agent-block"],"confidence":0.9}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sug.Note != "fixed cwd fallback" {
		t.Errorf("note = %q, want %q", sug.Note, "fixed cwd fallback")
	}
	if len(sug.Tags) != 2 || sug.Tags[0] != "bugfix" || sug.Tags[1] != "agent-block" {
		t.Errorf("tags = %v", sug.Tags)
	}
	if sug.Confidence != 0.9 {
		t.Errorf("confidence = %v, want 0.9", sug.Confidence)
	}
}

func TestParseMetadataResponse_MarkdownFence(t *testing.T) {
	sug, err := parseMetadataResponse("```json\n{\"note\":\"note here\",\"tags\":[\"Fix\"],\"confidence\":0.5}\n```")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sug.Note != "note here" {
		t.Errorf("note = %q", sug.Note)
	}
	// tags are normalized to lowercase / hash-stripped / deduped
	if len(sug.Tags) != 1 || sug.Tags[0] != "fix" {
		t.Errorf("tags = %v, want [fix]", sug.Tags)
	}
}

func TestParseMetadataResponse_InvalidJSON(t *testing.T) {
	if _, err := parseMetadataResponse("this is not json"); err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestParseMetadataResponse_NormalizesAndBounds(t *testing.T) {
	longNote := strings.Repeat("x", 600)
	sug, err := parseMetadataResponse(`{"note":"` + longNote + `","tags":["a","a","#b",""],"confidence":1.5}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// note rune-capped to metadataMaxNoteRunes
	if len([]rune(sug.Note)) != metadataMaxNoteRunes {
		t.Errorf("note length = %d, want %d", len([]rune(sug.Note)), metadataMaxNoteRunes)
	}
	// dedup + strip hash + drop empty
	if len(sug.Tags) != 2 || sug.Tags[0] != "a" || sug.Tags[1] != "b" {
		t.Errorf("tags = %v", sug.Tags)
	}
	// out-of-range confidence clamped to 0
	if sug.Confidence != 0 {
		t.Errorf("confidence = %v, want 0", sug.Confidence)
	}
}

func TestParseMetadataResponse_CapsTagCount(t *testing.T) {
	tags := make([]string, 0, 12)
	for i := 0; i < 12; i++ {
		tags = append(tags, "tag"+string(rune('a'+i)))
	}
	raw := `{"note":"n","tags":["` + strings.Join(tags, `","`) + `"]}`
	sug, err := parseMetadataResponse(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(sug.Tags) != metadataMaxTags {
		t.Errorf("tags length = %d, want %d", len(sug.Tags), metadataMaxTags)
	}
}

func TestBuildMetadataUserPrompt_IncludesExistingAndTruncates(t *testing.T) {
	req := MetadataGenerateRequest{
		Source:       "codex",
		ProjectPath:  "/tmp/proj",
		ExistingNote: "old note",
		ExistingTags: []string{"test"},
		Messages: []Message{
			{Role: RoleUser, Text: "hello"},
			{Role: RoleTool, ToolName: "read", Text: "file contents"},
		},
	}
	prompt := buildMetadataUserPrompt(req)
	if !strings.Contains(prompt, "old note") {
		t.Errorf("prompt missing existing note")
	}
	if !strings.Contains(prompt, "test") {
		t.Errorf("prompt missing existing tags")
	}
	if !strings.Contains(prompt, "/tmp/proj") {
		t.Errorf("prompt missing project path")
	}
	if !strings.Contains(prompt, "[user] hello") {
		t.Errorf("prompt missing user message")
	}
	if !strings.Contains(prompt, "[read] file contents") {
		t.Errorf("prompt missing tool message")
	}

	// Long message gets truncated to ~metadataMaxMessageRunes.
	longReq := MetadataGenerateRequest{
		Messages: []Message{{Role: RoleAssistant, Text: strings.Repeat("y", 20000)}},
	}
	longPrompt := buildMetadataUserPrompt(longReq)
	if len([]rune(longPrompt)) >= 10000 {
		t.Errorf("long prompt not truncated, length = %d", len([]rune(longPrompt)))
	}
}

func TestBuildMetadataUserPrompt_CapsMessageCount(t *testing.T) {
	msgs := make([]Message, 0, metadataMaxMessages+20)
	for i := 0; i < metadataMaxMessages+20; i++ {
		msgs = append(msgs, Message{Role: RoleUser, Text: "m"})
	}
	req := MetadataGenerateRequest{Messages: msgs}
	prompt := buildMetadataUserPrompt(req)
	// only the most recent metadataMaxMessages are included
	if strings.Count(prompt, "[user] m") != metadataMaxMessages {
		t.Errorf("prompt message count = %d, want %d", strings.Count(prompt, "[user] m"), metadataMaxMessages)
	}
}