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

// MetadataSuggestion is the outcome of AI session metadata generation. It is
// always a proposal: the caller decides whether (and how) to persist it, so the
// AI never silently overwrites a user's hand-written note or tags.
type MetadataSuggestion struct {
	Note       string   `json:"note"`
	Tags       []string `json:"tags"`
	Confidence float64  `json:"confidence,omitempty"`
}

// MetadataGenerateRequest carries the session content a metadata generator
// should summarize. Keeping it a plain struct decouples the generator from
// storage, so it can later serve group chats or other session kinds unchanged.
type MetadataGenerateRequest struct {
	SessionKey   string
	Source       string
	ProjectPath  string
	Messages     []Message
	ExistingNote string
	ExistingTags []string
	AIMode       string
	// PromptConfig carries the user's per-feature overrides from aiprompts.json.
	// A zero value resolves to the built-in prompt and default limits.
	PromptConfig wconfig.AIPromptConfigType
}

const (
	// metadataMaxMessages caps how many recent messages feed the summary so long
	// sessions stay within a predictable token budget.
	metadataMaxMessages = 120
	// metadataMaxMessageRunes truncates a single very long message before it is
	// sent to the model.
	metadataMaxMessageRunes = 4000
	// metadataMaxNoteRunes is the defensive ceiling for a generated note. It
	// matches the settings UI upper bound so a user-configured limit is honored.
	metadataMaxNoteRunes = 2000
	// metadataMaxTags is the defensive ceiling for generated tags. It matches the
	// settings UI upper bound so a user-configured limit is honored.
	metadataMaxTags = 10
	// metadataDefaultNoteRunes keeps the historical truncation when no note limit
	// is configured, so removing aiprompts.json stays behavior-compatible.
	metadataDefaultNoteRunes = 500
)

// GenerateSessionMetadata runs the AI metadata generation for a session and
// returns a proposed note + tags. It never writes anything to storage.
func GenerateSessionMetadata(ctx context.Context, req MetadataGenerateRequest) (MetadataSuggestion, error) {
	mode := ResolveAIMode(promptConfigWithFallbackMode(req.PromptConfig, req.AIMode))
	opts, err := aiusechat.GetAIOptsForMode(mode, 2048)
	if err != nil {
		return MetadataSuggestion{}, fmt.Errorf("resolving AI metadata model: %w", err)
	}
	prompt := ResolvePrompt(PromptFeatureSessionNoteTags, req.PromptConfig)
	reply, err := aiusechat.RunCompletion(ctx, *opts, prompt, buildMetadataUserPrompt(req))
	if err != nil {
		return MetadataSuggestion{}, err
	}
	if strings.TrimSpace(reply) == "" {
		return MetadataSuggestion{}, fmt.Errorf("AI metadata generation returned an empty response")
	}
	noteLimit := ClampNoteChars(req.PromptConfig.MaxNoteChars)
	if req.PromptConfig.MaxNoteChars == 0 {
		// Unconfigured limit: keep the pre-aiprompts truncation (500 runes).
		noteLimit = metadataDefaultNoteRunes
	}
	return parseMetadataResponseWithLimits(reply, noteLimit, ClampTagCount(req.PromptConfig.MaxTags))
}

// promptConfigWithFallbackMode lets callers pass an explicit aiMode without
// having to build a full AIPromptConfigType.
func promptConfigWithFallbackMode(cfg wconfig.AIPromptConfigType, fallbackMode string) wconfig.AIPromptConfigType {
	if strings.TrimSpace(cfg.AIMode) == "" && strings.TrimSpace(fallbackMode) != "" {
		cfg.AIMode = fallbackMode
	}
	return cfg
}

func buildMetadataUserPrompt(req MetadataGenerateRequest) string {
	var b strings.Builder
	b.WriteString("Existing note (keep if still accurate):\n")
	if req.ExistingNote == "" {
		b.WriteString("(none)")
	} else {
		b.WriteString(req.ExistingNote)
	}
	b.WriteString("\n\nExisting tags:\n")
	if len(req.ExistingTags) == 0 {
		b.WriteString("(none)")
	} else {
		b.WriteString(strings.Join(req.ExistingTags, ", "))
	}
	b.WriteString("\n\nProject path:\n")
	writeOptionalLine(&b, req.ProjectPath)
	b.WriteString("\n\nSession source:\n")
	writeOptionalLine(&b, req.Source)
	b.WriteString("\n\nSession transcript:\n")
	writeSessionTranscript(&b, req.Messages)
	return b.String()
}

// writeOptionalLine writes a value or "(unknown)" so prompts always carry an
// explicit, parseable field even when the source metadata is missing.
func writeOptionalLine(b *strings.Builder, value string) {
	if value == "" {
		b.WriteString("(unknown)")
		return
	}
	b.WriteString(value)
}

// writeSessionTranscript renders the most recent messages with per-message
// truncation. Shared by note/tags and title generation so both features respect
// the same token budget.
func writeSessionTranscript(b *strings.Builder, messages []Message) {
	start := 0
	if len(messages) > metadataMaxMessages {
		start = len(messages) - metadataMaxMessages
	}
	for i := start; i < len(messages); i++ {
		msg := messages[i]
		text := truncateRunes(msg.Text, metadataMaxMessageRunes)
		switch msg.Role {
		case RoleUser:
			b.WriteString("[user] " + text + "\n")
		case RoleAssistant:
			b.WriteString("[assistant] " + text + "\n")
		case RoleTool:
			name := msg.ToolName
			if name == "" {
				name = "tool"
			}
			b.WriteString("[" + name + "] " + text + "\n")
		case RoleSystem:
			b.WriteString("[system] " + text + "\n")
		default:
			b.WriteString("[" + msg.Role + "] " + text + "\n")
		}
	}
}

func parseMetadataResponse(text string) (MetadataSuggestion, error) {
	return parseMetadataResponseWithLimits(text, metadataDefaultNoteRunes, DefaultMaxTags)
}

// parseMetadataResponseWithLimits applies the active per-feature limits while
// keeping the historical defensive caps as hard ceilings.
func parseMetadataResponseWithLimits(text string, noteLimit int, tagLimit int) (MetadataSuggestion, error) {
	s := strings.TrimSpace(text)
	if strings.HasPrefix(s, "```") {
		if idx := strings.Index(s, "\n"); idx >= 0 {
			s = s[idx+1:]
		}
		s = strings.TrimSpace(strings.TrimSuffix(s, "```"))
	}
	var raw struct {
		Note       string   `json:"note"`
		Tags       []string `json:"tags"`
		Confidence float64  `json:"confidence"`
	}
	if err := json.Unmarshal([]byte(s), &raw); err != nil {
		return MetadataSuggestion{}, fmt.Errorf("AI metadata response was not valid JSON: %w", err)
	}
	tags := NormalizeSessionTags(raw.Tags)
	if tagLimit <= 0 || tagLimit > metadataMaxTags {
		tagLimit = metadataMaxTags
	}
	if len(tags) > tagLimit {
		tags = tags[:tagLimit]
	}
	confidence := raw.Confidence
	if confidence < 0 || confidence > 1 {
		confidence = 0
	}
	note := strings.TrimSpace(raw.Note)
	if noteLimit <= 0 || noteLimit > metadataMaxNoteRunes {
		noteLimit = metadataMaxNoteRunes
	}
	if r := []rune(note); len(r) > noteLimit {
		note = string(r[:noteLimit])
	}
	return MetadataSuggestion{Note: note, Tags: tags, Confidence: confidence}, nil
}
