// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import "testing"

// TestShouldPersistAgentSessionId pins the first-writer-wins rule for adopting a
// hook-reported session id into block meta. Regression context: opencode blocks
// never got a persisted session id (no backend-minted id, no disk capture), so
// every session-scoped surface fell back to provider-wide behavior and one emoji
// click rewrote every opencode session.
func TestShouldPersistAgentSessionId(t *testing.T) {
	tests := []struct {
		name     string
		existing string
		session  string
		want     bool
	}{
		{name: "empty meta adopts the hook id", existing: "", session: "sess-open-1", want: true},
		{name: "whitespace meta adopts the hook id", existing: "   ", session: "sess-open-1", want: true},
		{name: "same id already persisted is a no-op", existing: "sess-open-1", session: "sess-open-1", want: false},
		{name: "different id never overwrites", existing: "minted-by-backend", session: "sess-open-1", want: false},
		{name: "empty hook id never writes", existing: "", session: "", want: false},
		{name: "blank hook id never writes", existing: "", session: "  ", want: false},
		{name: "empty hook id keeps an existing id intact", existing: "minted-by-backend", session: "", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := shouldPersistAgentSessionId(tt.existing, tt.session); got != tt.want {
				t.Fatalf("shouldPersistAgentSessionId(%q, %q) = %v, want %v", tt.existing, tt.session, got, tt.want)
			}
		})
	}
}
