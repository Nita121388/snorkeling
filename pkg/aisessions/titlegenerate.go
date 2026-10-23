// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

// TitleSuggestion is the outcome of AI session title generation. Like the
// note/tags suggestion it is never persisted here; the caller decides whether
// to apply it.
type TitleSuggestion struct {
	Title      string  `json:"title"`
	Confidence float64 `json:"confidence,omitempty"`
}

// TitleGenerateRequest carries the content a title generator should read.
type TitleGenerateRequest struct {
	SessionKey    string
	Source        string
	ProjectPath   string
	Messages      []Message
	ExistingTitle string
	AIMode        string
	PromptConfig  wconfig.AIPromptConfigType
}

// GenerateSessionTitle proposes a session title. It never writes to storage.
func GenerateSessionTitle(ctx context.Context, req TitleGenerateRequest) (TitleSuggestion, error) {
	cfg := promptConfigWithFallbackMode(req.PromptConfig, req.AIMode)
	mode := ResolveAIMode(cfg)
	opts, err := aiusechat.GetAIOptsForMode(mode, 512)
	if err != nil {
		return TitleSuggestion{}, fmt.Errorf("resolving AI title model: %w", err)
	}
	reply, err := aiusechat.RunCompletion(ctx, *opts, ResolvePrompt(PromptFeatureSessionTitle, cfg), buildTitleUserPrompt(req))
	if err != nil {
		return TitleSuggestion{}, err
	}
	if strings.TrimSpace(reply) == "" {
		return TitleSuggestion{}, fmt.Errorf("AI title generation returned an empty response")
	}
	return parseTitleResponseWithLimit(reply, ClampTitleChars(cfg.MaxTitleChars))
}

func buildTitleUserPrompt(req TitleGenerateRequest) string {
	var b strings.Builder
	b.WriteString("Existing title (keep if still accurate):\n")
	writeOptionalLine(&b, req.ExistingTitle)
	b.WriteString("\n\nProject path:\n")
	writeOptionalLine(&b, req.ProjectPath)
	b.WriteString("\n\nSession source:\n")
	writeOptionalLine(&b, req.Source)
	b.WriteString("\n\nSession transcript:\n")
	writeSessionTranscript(&b, req.Messages)
	return b.String()
}

func parseTitleResponse(text string) (TitleSuggestion, error) {
	return parseTitleResponseWithLimit(text, DefaultMaxTitleChars)
}

// parseTitleResponseWithLimit parses the JSON proposal and enforces the active
// title length bound. Markdown fences are tolerated the same way as metadata.
func parseTitleResponseWithLimit(text string, maxTitleChars int) (TitleSuggestion, error) {
	s := strings.TrimSpace(text)
	if strings.HasPrefix(s, "```") {
		if idx := strings.Index(s, "\n"); idx >= 0 {
			s = s[idx+1:]
		}
		s = strings.TrimSpace(strings.TrimSuffix(s, "```"))
	}
	var raw struct {
		Title      string  `json:"title"`
		Confidence float64 `json:"confidence"`
	}
	if err := json.Unmarshal([]byte(s), &raw); err != nil {
		return TitleSuggestion{}, fmt.Errorf("AI title response was not valid JSON: %w", err)
	}
	title := strings.TrimSpace(raw.Title)
	title = strings.TrimSpace(strings.TrimSuffix(title, "."))
	title = strings.Trim(title, "\"'`“”‘’")
	title = strings.TrimSpace(strings.TrimSuffix(title, "."))
	if maxTitleChars <= 0 {
		maxTitleChars = DefaultMaxTitleChars
	}
	if r := []rune(title); len(r) > maxTitleChars {
		title = strings.TrimSpace(string(r[:maxTitleChars]))
	}
	confidence := raw.Confidence
	if confidence < 0 || confidence > 1 {
		confidence = 0
	}
	return TitleSuggestion{Title: title, Confidence: confidence}, nil
}
