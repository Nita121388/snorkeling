// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
)

type emojiGraphemeFixture struct {
	Input string `json:"input"`
	Valid bool   `json:"valid"`
}

// TestNormalizeEmojiSharedFixtures drives NormalizeEmoji with the shared
// vectors in fixtures/emoji-grapheme-cases.json — the same file the TS twin
// (normalizeAgentEmoji in frontend/app/view/term/agent-logo.tsx) is expected to
// assert against, so both runtimes stay in lock-step.
func TestNormalizeEmojiSharedFixtures(t *testing.T) {
	raw, err := os.ReadFile("fixtures/emoji-grapheme-cases.json")
	if err != nil {
		t.Fatalf("read shared fixtures: %v", err)
	}
	var doc struct {
		Cases []emojiGraphemeFixture `json:"cases"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse shared fixtures: %v", err)
	}
	if len(doc.Cases) == 0 {
		t.Fatal("shared fixtures contains no cases")
	}
	for _, c := range doc.Cases {
		got, err := NormalizeEmoji(c.Input)
		if c.Valid {
			if err != nil {
				t.Errorf("NormalizeEmoji(%q): expected valid, got error: %v", c.Input, err)
				continue
			}
			if want := strings.TrimSpace(c.Input); got != want {
				t.Errorf("NormalizeEmoji(%q): canonical = %q, want %q", c.Input, got, want)
			}
		} else {
			if err == nil {
				t.Errorf("NormalizeEmoji(%q): expected invalid, got %q", c.Input, got)
				continue
			}
			if !errors.Is(err, ErrInvalidEmoji) {
				t.Errorf("NormalizeEmoji(%q): error %v does not wrap ErrInvalidEmoji", c.Input, err)
			}
		}
	}
}

// TestNormalizeEmojiZWJSequences verifies the ZWJ-family cases from the spec
// checklist explicitly (they live in the shared fixtures too, this pins the
// grapheme semantics without depending on file layout).
func TestNormalizeEmojiZWJSequences(t *testing.T) {
	valid := []string{"👨\u200d👩\u200d👧", "🏳️\u200d🌈"}
	for _, emoji := range valid {
		if _, err := NormalizeEmoji(emoji); err != nil {
			t.Errorf("NormalizeEmoji(%q): expected valid, got %v", emoji, err)
		}
	}
	invalid := []string{"🦊\u200d", "\u200d", "\u200d🦊", "\u200d\u200d"}
	for _, emoji := range invalid {
		if _, err := NormalizeEmoji(emoji); err == nil {
			t.Errorf("NormalizeEmoji(%q): expected invalid", emoji)
		}
	}
}
