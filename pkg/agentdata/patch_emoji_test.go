// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentdata

import (
	"context"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
)

// TestSessionPropUpdateIfAbsent covers the emoji-preference track's idempotence
// contract (design.md §3.1): a prop write with ifabsent is a no-op when the
// slot already holds any value (any source), and lands when the slot is empty.
func TestSessionPropUpdateIfAbsent(t *testing.T) {
	sessionID, manager := setupAgentDataSession(t)
	ctx := context.Background()
	before, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	hash := HashSession(before)

	// Empty slot + ifabsent → write lands.
	patch := Patch{
		Version: PatchVersion,
		Source:  "test-emoji-ifabsent",
		Operations: []PatchOperation{{
			Type:         "session_prop.update",
			SessionKey:   sessionID,
			Props:        map[string]PropPatch{"emoji": {Type: "text", Value: "🛡️", IfAbsent: true}},
			ExpectedHash: hash,
		}},
	}
	report, err := ApplyPatch(ctx, patch, ApplyOptions{Yes: true})
	if err != nil {
		t.Fatal(err)
	}
	if !report.Operations[0].Changed {
		t.Fatalf("expected the empty-slot write to land: %#v", report.Operations[0])
	}

	// Existing slot + ifabsent → skip (idempotent no-op), even for source=ai.
	report, err = ApplyPatch(ctx, patch, ApplyOptions{Yes: true})
	if err != nil {
		t.Fatal(err)
	}
	op := report.Operations[0]
	if op.Changed {
		t.Fatalf("expected the exists-slot write to be skipped: %#v", op)
	}
	if len(op.Skipped) != 1 || !strings.Contains(op.Skipped[0], "emoji: exists (--if-absent)") {
		t.Fatalf("expected exists skip reason, got %#v", op.Skipped)
	}
	// The dry-run preview reports the same skip shape.
	preview, err := ApplyPatch(ctx, patch, ApplyOptions{DryRun: true})
	if err != nil {
		t.Fatal(err)
	}
	if preview.Operations[0].Changed || len(preview.Operations[0].Skipped) != 1 {
		t.Fatalf("preview mismatch: %#v", preview.Operations[0])
	}
}

// TestSessionEmojiUpdateOpDowngradesToSessionProp covers the PRD's
// session_emoji.update op: it validates the emoji through NormalizeEmoji and
// degrades to session_prop.update{emoji, ifAbsent} internally.
func TestSessionEmojiUpdateOpDowngradesToSessionProp(t *testing.T) {
	sessionID, manager := setupAgentDataSession(t)
	ctx := context.Background()
	before, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}

	patch := Patch{
		Version: PatchVersion,
		Source:  "test-emoji-op",
		Operations: []PatchOperation{{
			Type:         "session_emoji.update",
			SessionKey:   sessionID,
			Props:        map[string]PropPatch{"emoji": {Type: "text", Value: "🦊"}},
			ExpectedHash: HashSession(before),
		}},
	}
	report, err := ApplyPatch(ctx, patch, ApplyOptions{Yes: true})
	if err != nil {
		t.Fatal(err)
	}
	if !report.Operations[0].Changed {
		t.Fatalf("expected the emoji write to land: %#v", report.Operations[0])
	}
	summary, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	cell, ok := summary.Props["emoji"]
	if !ok || cell.Value != "🦊" || cell.Source != aisessions.PropertySourceAI {
		t.Fatalf("emoji prop = %#v, want {value:🦊 source:ai}", cell)
	}
	// Second apply is an idempotent no-op (ifAbsent forced by the downgrade).
	report, err = ApplyPatch(ctx, patch, ApplyOptions{Yes: true})
	if err != nil {
		t.Fatal(err)
	}
	if report.Operations[0].Changed {
		t.Fatalf("expected idempotent skip, got %#v", report.Operations[0])
	}

	// Invalid emoji rejects the whole patch (E_INVALID_EMOJI family).
	badPatch := Patch{
		Version: PatchVersion,
		Source:  "test-emoji-op-bad",
		Operations: []PatchOperation{{
			Type:         "session_emoji.update",
			SessionKey:   sessionID,
			Props:        map[string]PropPatch{"emoji": {Type: "text", Value: "42"}},
			ExpectedHash: HashSession(before),
		}},
	}
	if _, err := ApplyPatch(ctx, badPatch, ApplyOptions{Yes: true}); err == nil {
		t.Fatal("expected invalid emoji to reject the patch")
	} else if !strings.Contains(err.Error(), "invalid emoji") {
		t.Fatalf("unexpected error: %v", err)
	}
}