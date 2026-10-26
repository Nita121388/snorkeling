// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func TestResolvePrompt_UsesBuiltInDefault(t *testing.T) {
	prompt := ResolvePrompt(PromptFeatureSessionNoteTags, wconfig.AIPromptConfigType{})
	if !strings.Contains(prompt, "metadata extractor") {
		t.Fatalf("default prompt missing identity: %q", prompt)
	}
	if !strings.Contains(prompt, "note <= 160") {
		t.Fatalf("default prompt missing note limit: %q", prompt)
	}
	if !strings.Contains(prompt, "tags <= 5") {
		t.Fatalf("default prompt missing tag limit: %q", prompt)
	}
}

func TestResolvePrompt_OverrideAndExtraInstructions(t *testing.T) {
	cfg := wconfig.AIPromptConfigType{
		SystemPrompt:      "CUSTOM BASE",
		ExtraInstructions: "reply in Chinese",
	}
	prompt := ResolvePrompt(PromptFeatureSessionNoteTags, cfg)
	if strings.Contains(prompt, "metadata extractor") {
		t.Fatalf("override should replace the built-in base: %q", prompt)
	}
	if !strings.Contains(prompt, "CUSTOM BASE") {
		t.Fatalf("override missing: %q", prompt)
	}
	if !strings.Contains(prompt, "Additional instructions:\nreply in Chinese") {
		t.Fatalf("extra instructions missing: %q", prompt)
	}
}

func TestResolvePrompt_TitleFeature(t *testing.T) {
	prompt := ResolvePrompt(PromptFeatureSessionTitle, wconfig.AIPromptConfigType{})
	if !strings.Contains(prompt, "title generator") {
		t.Fatalf("title default prompt missing identity: %q", prompt)
	}
	if !strings.Contains(prompt, "title <= 40") {
		t.Fatalf("title default prompt missing limit: %q", prompt)
	}
}

func TestResolvePrompt_CapsRunawayPrompt(t *testing.T) {
	cfg := wconfig.AIPromptConfigType{SystemPrompt: strings.Repeat("x", MaxPromptChars+1000)}
	prompt := ResolvePrompt(PromptFeatureSessionTitle, cfg)
	if len([]rune(prompt)) != MaxPromptChars {
		t.Fatalf("prompt length = %d, want %d", len([]rune(prompt)), MaxPromptChars)
	}
}

func TestClampHelpers(t *testing.T) {
	if got := ClampNoteChars(0); got != DefaultMaxNoteChars {
		t.Errorf("ClampNoteChars(0) = %d", got)
	}
	if got := ClampNoteChars(10); got != 40 {
		t.Errorf("ClampNoteChars(10) = %d", got)
	}
	if got := ClampNoteChars(99999); got != 2000 {
		t.Errorf("ClampNoteChars(99999) = %d", got)
	}
	if got := ClampTagCount(0); got != DefaultMaxTags {
		t.Errorf("ClampTagCount(0) = %d", got)
	}
	if got := ClampTagCount(99); got != 10 {
		t.Errorf("ClampTagCount(99) = %d", got)
	}
	if got := ClampTitleChars(0); got != DefaultMaxTitleChars {
		t.Errorf("ClampTitleChars(0) = %d", got)
	}
	if got := ClampTitleChars(5); got != 10 {
		t.Errorf("ClampTitleChars(5) = %d", got)
	}
}

func TestPromptEnabled(t *testing.T) {
	if !PromptEnabled(wconfig.AIPromptConfigType{}) {
		t.Fatal("unset enabled should default to true")
	}
	disabled := false
	if PromptEnabled(wconfig.AIPromptConfigType{Enabled: &disabled}) {
		t.Fatal("explicit false should disable")
	}
}

func TestListPromptFeatures(t *testing.T) {
	features := ListPromptFeatures()
	if len(features) != 3 {
		t.Fatalf("features = %d, want 3", len(features))
	}
	if features[0].Key != PromptFeatureSessionNoteTags ||
		features[1].Key != PromptFeatureSessionTitle ||
		features[2].Key != PromptFeatureSessionAnnotations {
		t.Fatalf("unexpected feature order: %+v", features)
	}
	if features[0].DefaultPrompt == "" || features[1].DefaultPrompt == "" || features[2].DefaultPrompt == "" {
		t.Fatal("default prompts must be populated")
	}
	// Raw defaults must not embed hard limits; the settings page appends them
	// once, and ResolvePrompt adds them for generation.
	if strings.Contains(features[0].DefaultPrompt, "Hard limits:") {
		t.Fatalf("default prompt should not embed hard limits: %q", features[0].DefaultPrompt)
	}
	if len(features[0].Parameters) != 2 {
		t.Fatalf("note feature parameters = %d, want 2", len(features[0].Parameters))
	}
}
