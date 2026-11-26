// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import "strings"

// LabeledProvider is the optional provider capability that exposes a
// user-facing source label (source filter entry / source badge).
//
// The four compile-time providers (codex / claude / opencode / pi) do not
// implement it: their labels stay in the frontend's built-in CHAT_SOURCES table.
// Declarative providers get their label from settings, so without this
// capability the UI could only show a bare config key.
type LabeledProvider interface {
	Label() string
}

// ProviderLabel returns the provider's configured label, falling back to the
// source id when the provider has no label (or is nil).
func ProviderLabel(provider Provider) string {
	if provider == nil {
		return ""
	}
	if labeled, ok := provider.(LabeledProvider); ok {
		if label := strings.TrimSpace(labeled.Label()); label != "" {
			return label
		}
	}
	return provider.Source()
}
