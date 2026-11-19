// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"errors"
	"fmt"
	"strings"
	"unicode"

	"github.com/rivo/uniseg"
)

// ErrInvalidEmoji is returned by NormalizeEmoji when the input is not a single
// pictographic emoji grapheme. The P2 CLI/MCP layer maps it to error code
// E_INVALID_EMOJI (design.md §3.4).
var ErrInvalidEmoji = errors.New("invalid emoji: must be a single pictographic grapheme")

// NormalizeEmoji validates a single emoji grapheme and returns the canonical
// (trimmed) form. It mirrors the TS validator in
// frontend/app/view/term/agent-logo.tsx (normalizeAgentEmoji) so both runtimes
// accept exactly the same inputs; the shared vectors live in
// fixtures/emoji-grapheme-cases.json and both sides test against them.
//
// Rejected: multi-grapheme strings ("🦊🦊", "ab", "42"), empty /
// whitespace-only strings, control/format-only fragments (a lone ZWJ), degenerate
// ZWJ fragments ("🦊\u200d", "\u200d🦊", "\u200d\u200d"), and anything that would
// not render as a color emoji (bare "9", "#", "*", "©" without VS16).
//
// Accepted: exactly one grapheme cluster (UAX #29, via uniseg) that contains an
// Emoji_Presentation code point, or carries U+FE0F (VS16) which upgrades
// text-default symbols and keycaps (9 + VS16 + U+20E3) to color emoji.
func NormalizeEmoji(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", fmt.Errorf("%w: empty input", ErrInvalidEmoji)
	}
	clusterCount := uniseg.GraphemeClusterCount(value)
	if clusterCount != 1 {
		return "", fmt.Errorf("%w: %d grapheme clusters, want exactly one", ErrInvalidEmoji, clusterCount)
	}
	// Whitespace / control / format-only (e.g. a lone ZWJ) is not a persona.
	if isWhitespaceControlOrFormatOnly(value) {
		return "", fmt.Errorf("%w: input is whitespace/control/format-only", ErrInvalidEmoji)
	}
	// A ZWJ only at the start/end ("🦊\u200d") or doubled is malformed. A ZWJ that
	// joins two pictographs ("👨\u200d👩\u200d👧", "🏳️\u200d🌈") is a valid single
	// emoji and must NOT be rejected wholesale.
	if strings.HasPrefix(value, "\u200d") || strings.HasSuffix(value, "\u200d") || strings.Contains(value, "\u200d\u200d") {
		return "", fmt.Errorf("%w: malformed ZWJ sequence", ErrInvalidEmoji)
	}
	// Require the grapheme to actually render as a color emoji, not just live in
	// the Unicode Emoji property set (which also holds bare digits, "#", "*" and
	// text-default symbols like ©/®/™). Emoji_Presentation covers all
	// default-emoji-presentation code points; VS16 covers keycaps and
	// text-default emoji like "©️".
	if !isPictographicGrapheme(value) {
		return "", fmt.Errorf("%w: no Emoji_Presentation code point and no VS16", ErrInvalidEmoji)
	}
	return value, nil
}

// isWhitespaceControlOrFormatOnly reports whether every code point of s is
// whitespace, a control character, or a format character — the Go equivalent of
// the TS /^[\s\p{Cc}\p{Cf}]+$/u check.
func isWhitespaceControlOrFormatOnly(s string) bool {
	for _, r := range s {
		if !(unicode.IsSpace(r) || unicode.Is(unicode.Cc, r) || unicode.Is(unicode.Cf, r)) {
			return false
		}
	}
	return true
}

// isPictographicGrapheme reports whether the grapheme contains an
// Emoji_Presentation code point or a U+FE0F variation selector, mirroring the
// TS rule (/\p{Emoji_Presentation}/u.test(g) || g.includes("\uFE0F")).
func isPictographicGrapheme(s string) bool {
	if strings.ContainsRune(s, '\uFE0F') {
		return true
	}
	for _, r := range s {
		if emojiPresentationContains(r) {
			return true
		}
	}
	return false
}
