// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessionsservice

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
)

// withInjectedSourceStatuses swaps the provider-status source behind
// GetSourceList so the RPC test does not depend on the machine's real
// settings.json / agent directories.
func withInjectedSourceStatuses(t *testing.T, statuses []aisessions.SourceStatus) {
	t.Helper()
	previous := sessionSourceStatuses
	sessionSourceStatuses = func() []aisessions.SourceStatus { return statuses }
	t.Cleanup(func() { sessionSourceStatuses = previous })
}

func TestGetSourceListReturnsLabelsAndAvailability(t *testing.T) {
	withInjectedSourceStatuses(t, []aisessions.SourceStatus{
		{Source: "antigravity", Label: "Antigravity", Available: true},
		{Source: "claude", Label: "claude", Available: true},
		{Source: "codex", Label: "codex", Available: true},
		{Source: "opencode", Label: "opencode", Available: false},
		{Source: "pi", Label: "pi", Available: true},
	})

	svc := &AISessionsService{}
	resp, err := svc.GetSourceList(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Sources) != 5 {
		t.Fatalf("got %d source entries, want 5: %#v", len(resp.Sources), resp.Sources)
	}
	// Stable order is the provider-status order (source-lexicographic upstream);
	// the RPC must not reshuffle it.
	wantOrder := []string{"antigravity", "claude", "codex", "opencode", "pi"}
	for idx, want := range wantOrder {
		if resp.Sources[idx].Source != want {
			t.Errorf("sources[%d].source = %q, want %q", idx, resp.Sources[idx].Source, want)
		}
	}
	// Declarative label survives: the GUI shows the config label, not the id.
	if got := resp.Sources[0].Label; got != "Antigravity" {
		t.Errorf("antigravity label = %q, want Antigravity", got)
	}
	// Availability is per-source, not "everything the list contains".
	if resp.Sources[3].Available {
		t.Error("opencode should be reported as unavailable")
	}
	if !resp.Sources[4].Available {
		t.Error("pi should be reported as available")
	}
}

func TestGetSourceListEmptyMachine(t *testing.T) {
	// A machine with no agent data at all: the RPC still answers (no error) so
	// the frontend keeps its built-in source table instead of erroring out.
	withInjectedSourceStatuses(t, nil)

	svc := &AISessionsService{}
	resp, err := svc.GetSourceList(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if resp == nil || len(resp.Sources) != 0 {
		t.Fatalf("expected an empty (non-nil) response, got %#v", resp)
	}
}

func TestSourceStatusesRegistrationUsedByRPC(t *testing.T) {
	// Guard: production wiring must go through aisessions.SourceStatuses (the
	// merged config + os.Stat gate), not a hardcoded list in the service.
	if sessionSourceStatuses == nil {
		t.Fatal("sessionSourceStatuses must default to aisessions.SourceStatuses")
	}
	statuses := sessionSourceStatuses()
	seen := map[string]bool{}
	for _, status := range statuses {
		if seen[status.Source] {
			t.Errorf("duplicate source %q in source statuses", status.Source)
		}
		seen[status.Source] = true
		if status.Label == "" {
			t.Errorf("source %q has an empty label", status.Source)
		}
	}
	for _, id := range []string{aisessions.SourceClaude, aisessions.SourceCodex, aisessions.SourceOpenCode, aisessions.SourcePi} {
		if !seen[id] {
			t.Errorf("compile-time source %q missing from source statuses", id)
		}
	}
	if !seen[aisessions.SourceAntigravity] {
		t.Error("built-in declarative source antigravity missing from source statuses")
	}
}
