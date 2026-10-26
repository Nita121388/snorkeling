// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Annotation AI drafts (manual, user-triggered).
//
// The caller always reviews drafts; nothing here writes to the annotation table.
// Anchor keys are validated against the digest built from the actual session
// messages, so a hallucinated node is dropped instead of landing in the DB.

package aisessions

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

const (
	AnnotationScopeTimeline   = "timeline"
	AnnotationScopeEntryTitle = "entry-title"
	AnnotationScopeEntryBody  = "entry-body"
	AnnotationScopeEntryTags  = "entry-tags"
)

const annotationDigestNodeChars = 500
const annotationDigestMaxNodes = 200

type AnnotationDraft struct {
	AnchorKey string   `json:"anchorKey"`
	Kind      string   `json:"kind"`
	Title     string   `json:"title"`
	Body      string   `json:"body"`
	Tags      []string `json:"tags,omitempty"`
}

type AnnotationAssistInput struct {
	SessionKey   string
	Scope        string
	AnchorKey    string
	Title        string
	Body         string
	ExistingTags []string
	Messages     []Message
	ToolCalls    []ToolCall
	MaxEntries   int
	AIMode       string
	PromptConfig wconfig.AIPromptConfigType
}

type annotationDigestEntry struct {
	AnchorKey string
	Seq       int
	Role      string
	Text      string
}

func normalizeAnnotationScope(scope string) string {
	switch strings.TrimSpace(strings.ToLower(scope)) {
	case AnnotationScopeEntryTitle, AnnotationScopeEntryBody, AnnotationScopeEntryTags:
		return strings.TrimSpace(strings.ToLower(scope))
	default:
		return AnnotationScopeTimeline
	}
}

func buildAnnotationDigest(messages []Message, toolCalls []ToolCall) []annotationDigestEntry {
	entries := make([]annotationDigestEntry, 0, len(messages)+len(toolCalls))
	for _, message := range messages {
		if strings.TrimSpace(message.ItemKey) == "" {
			continue
		}
		text := message.Text
		if strings.TrimSpace(text) == "" {
			text = message.Thinking
		}
		entries = append(entries, annotationDigestEntry{
			AnchorKey: message.ItemKey,
			Seq:       message.Seq,
			Role:      message.Role,
			Text:      truncateAnnotationText(text, annotationDigestNodeChars),
		})
	}
	for _, toolCall := range toolCalls {
		if strings.TrimSpace(toolCall.ItemKey) == "" {
			continue
		}
		text := strings.TrimSpace(strings.Join([]string{toolCall.Name, toolCall.Summary}, " "))
		entries = append(entries, annotationDigestEntry{
			AnchorKey: toolCall.ItemKey,
			Seq:       toolCall.Seq,
			Role:      "tool",
			Text:      truncateAnnotationText(text, annotationDigestNodeChars),
		})
	}
	if len(entries) > annotationDigestMaxNodes {
		entries = entries[len(entries)-annotationDigestMaxNodes:]
	}
	return entries
}

func truncateAnnotationText(text string, limit int) string {
	trimmed := strings.TrimSpace(text)
	runes := []rune(trimmed)
	if len(runes) <= limit {
		return trimmed
	}
	return string(runes[:limit]) + "…"
}

func buildAnnotationAssistPrompt(in AnnotationAssistInput, digest []annotationDigestEntry) string {
	var b strings.Builder
	switch normalizeAnnotationScope(in.Scope) {
	case AnnotationScopeEntryTitle, AnnotationScopeEntryBody, AnnotationScopeEntryTags:
		b.WriteString("Current annotation\n")
		b.WriteString("title: " + in.Title + "\n")
		b.WriteString("body: " + in.Body + "\n")
		if len(in.ExistingTags) > 0 {
			b.WriteString("tags: " + strings.Join(in.ExistingTags, ", ") + "\n")
		}
		b.WriteString("\nAnchored node\n")
		for _, entry := range digest {
			if entry.AnchorKey == in.AnchorKey {
				b.WriteString("anchorKey: " + entry.AnchorKey + "\n")
				b.WriteString("role: " + entry.Role + "\n")
				b.WriteString("text:\n" + entry.Text + "\n")
				break
			}
		}
		return b.String()
	default:
		b.WriteString("Session anchors (only these anchorKey values are valid):\n")
		for _, entry := range digest {
			b.WriteString(fmt.Sprintf("- anchorKey=%s seq=%d role=%s text=%s\n", entry.AnchorKey, entry.Seq, entry.Role, entry.Text))
		}
		return b.String()
	}
}

func parseAnnotationDraftResponse(reply string) ([]AnnotationDraft, error) {
	raw := stripJSONFence(reply)
	var wrapper struct {
		Annotations []AnnotationDraft `json:"annotations"`
	}
	if err := json.Unmarshal([]byte(raw), &wrapper); err == nil && wrapper.Annotations != nil {
		return wrapper.Annotations, nil
	}
	var list []AnnotationDraft
	if err := json.Unmarshal([]byte(raw), &list); err == nil {
		return list, nil
	}
	var single AnnotationDraft
	if err := json.Unmarshal([]byte(raw), &single); err == nil {
		return []AnnotationDraft{single}, nil
	}
	// 模型经常在 JSON 前后夹一句解释、或把 JSON 包在 ``` 里。这里按括号
	// 配对切出第一个完整的对象/数组再试一次，而不是直接判失败。
	if extracted := extractFirstJSONValue(raw); extracted != "" {
		var wrapperRetry struct {
			Annotations []AnnotationDraft `json:"annotations"`
		}
		if err := json.Unmarshal([]byte(extracted), &wrapperRetry); err == nil && wrapperRetry.Annotations != nil {
			return wrapperRetry.Annotations, nil
		}
		var listRetry []AnnotationDraft
		if err := json.Unmarshal([]byte(extracted), &listRetry); err == nil {
			return listRetry, nil
		}
		var singleRetry AnnotationDraft
		if err := json.Unmarshal([]byte(extracted), &singleRetry); err == nil {
			return []AnnotationDraft{singleRetry}, nil
		}
	}
	return nil, fmt.Errorf("annotation AI response was not valid JSON")
}

// extractFirstJSONValue returns the first balanced {...} or [...] substring.
// It is string-aware so braces inside quoted values do not confuse the scan.
func extractFirstJSONValue(text string) string {
	start := -1
	var open, close byte
	for i := 0; i < len(text); i++ {
		switch text[i] {
		case '{':
			start, open, close = i, '{', '}'
		case '[':
			start, open, close = i, '[', ']'
		}
		if start >= 0 {
			break
		}
	}
	if start < 0 {
		return ""
	}
	depth := 0
	inString := false
	escaped := false
	for i := start; i < len(text); i++ {
		ch := text[i]
		if inString {
			if escaped {
				escaped = false
			} else if ch == '\\' {
				escaped = true
			} else if ch == '"' {
				inString = false
			}
			continue
		}
		if ch == '"' {
			inString = true
			continue
		}
		switch ch {
		case open:
			depth++
		case close:
			depth--
			if depth == 0 {
				return text[start : i+1]
			}
		}
	}
	return ""
}

func stripJSONFence(text string) string {
	s := strings.TrimSpace(text)
	if strings.HasPrefix(s, "```") {
		if idx := strings.Index(s, "\n"); idx >= 0 {
			s = s[idx+1:]
		}
		s = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(s), "```"))
	}
	return s
}

// GenerateAnnotationDrafts runs one AI call and returns validated drafts.
// Invalid anchor keys and kinds are dropped; body/tag lengths are clamped.
// annotationDraftGenerator is a seam so tests can inject a stub model call.
var annotationDraftGenerator = generateAnnotationDraftsReal

func GenerateAnnotationDrafts(ctx context.Context, in AnnotationAssistInput) ([]AnnotationDraft, string, error) {
	return GenerateAnnotationDraftsWithContext(ctx, in)
}

func GenerateAnnotationDraftsWithContext(ctx context.Context, in AnnotationAssistInput) ([]AnnotationDraft, string, error) {
	return annotationDraftGenerator(ctx, in)
}

func generateAnnotationDraftsReal(ctx context.Context, in AnnotationAssistInput) ([]AnnotationDraft, string, error) {
	scope := normalizeAnnotationScope(in.Scope)
	cfg := promptConfigWithFallbackMode(in.PromptConfig, in.AIMode)
	mode := ResolveAIMode(cfg)
	opts, err := aiusechat.GetAIOptsForMode(mode, 2048)
	if err != nil {
		return nil, "", fmt.Errorf("resolving AI annotation model: %w", err)
	}
	digest := buildAnnotationDigest(in.Messages, in.ToolCalls)
	if len(digest) == 0 {
		return nil, mode, fmt.Errorf("session has no anchorable messages")
	}
	valid := make(map[string]bool, len(digest))
	for _, entry := range digest {
		valid[entry.AnchorKey] = true
	}
	userPrompt := buildAnnotationAssistPrompt(in, digest)
	systemPrompt := ResolvePrompt(PromptFeatureSessionAnnotations, cfg)

	var drafts []AnnotationDraft
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		reply, runErr := aiusechat.RunCompletion(ctx, *opts, systemPrompt, userPrompt)
		if runErr != nil {
			lastErr = runErr
			continue
		}
		parsed, parseErr := parseAnnotationDraftResponse(reply)
		if parseErr != nil {
			lastErr = parseErr
			continue
		}
		drafts = parsed
		lastErr = nil
		break
	}
	if lastErr != nil {
		return nil, mode, lastErr
	}

	maxEntries := ClampAnnotationCount(in.MaxEntries)
	if scope == AnnotationScopeTimeline {
		if maxEntries > 0 && len(drafts) > maxEntries {
			drafts = drafts[:maxEntries]
		}
	} else if len(drafts) > 1 {
		drafts = drafts[:1]
	}
	bodyLimit := ClampAnnotationBodyChars(cfg.MaxBodyChars)
	tagLimit := ClampTagCount(cfg.MaxTags)
	result := make([]AnnotationDraft, 0, len(drafts))
	for _, draft := range drafts {
		draft.AnchorKey = strings.TrimSpace(draft.AnchorKey)
		if draft.AnchorKey == "" {
			if scope != AnnotationScopeTimeline {
				draft.AnchorKey = in.AnchorKey
			}
			if draft.AnchorKey == "" {
				continue
			}
		}
		if !valid[draft.AnchorKey] {
			continue
		}
		draft.Kind = normalizeAnnotationKind(draft.Kind)
		draft.Title = strings.TrimSpace(draft.Title)
		draft.Body = strings.TrimSpace(draft.Body)
		if r := []rune(draft.Body); len(r) > bodyLimit {
			draft.Body = strings.TrimSpace(string(r[:bodyLimit]))
		}
		draft.Tags = NormalizeSessionTags(draft.Tags)
		if len(draft.Tags) > tagLimit {
			draft.Tags = draft.Tags[:tagLimit]
		}
		if draft.Title == "" && draft.Body == "" && len(draft.Tags) == 0 {
			continue
		}
		result = append(result, draft)
	}
	return result, mode, nil
}
