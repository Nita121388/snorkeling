// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcontrol

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestSchemaScopeFor(t *testing.T) {
	cases := []struct {
		name       string
		apiScope   string
		sessionKey string
		wantScope  string
		wantUpdate bool
		wantErr    bool
	}{
		{"empty means session", "", "pi:a:/f.jsonl", "", false, false},
		{"session explicit", "session", "pi:a:/f.jsonl", "", false, false},
		{"session case-insensitive", " Session ", "pi:a:/f.jsonl", "", false, false},
		{"all publishes globally", "all", "pi:a:/f.jsonl", "", true, false},
		{"agent derives provider from key", "agent", "pi:a:/f.jsonl", "agent:pi", true, false},
		{"agent on codex session", "agent", "codex:x:/f.jsonl", "agent:codex", true, false},
		{"agent without provider errors", "agent", "noprovider", "", false, true},
		{"unknown scope errors", "team", "pi:a:/f.jsonl", "", false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			scope, update, err := schemaScopeFor(tc.apiScope, tc.sessionKey)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error for scope %q", tc.apiScope)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if scope != tc.wantScope || update != tc.wantUpdate {
				t.Fatalf("got (%q,%v), want (%q,%v)", scope, update, tc.wantScope, tc.wantUpdate)
			}
		})
	}
}

func TestUpsertSchemaDef(t *testing.T) {
	current := []wconfig.AgentPropertyDefType{
		{Key: "priority", Name: "Priority", Type: "select", Order: 1},
		{Key: "owner", Name: "Owner", Type: "text", Order: 2, Scope: "agent:codex"},
	}

	// Insert a new agent-scoped definition.
	next := upsertSchemaDef(current, "risk", "Risk", "status", "agent:pi")
	if len(next) != 3 {
		t.Fatalf("expected 3 defs, got %d", len(next))
	}
	if next[2].Key != "risk" || next[2].Scope != "agent:pi" || next[2].Order != 3 {
		t.Fatalf("inserted def wrong: %#v", next[2])
	}

	// Update keeps unrelated defs byte-identical (key, order, name).
	updated := upsertSchemaDef(next, "owner", "Owner", "text", "agent:pi")
	if len(updated) != 3 {
		t.Fatalf("expected 3 defs, got %d", len(updated))
	}
	if updated[1].Key != "owner" || updated[1].Scope != "agent:pi" {
		t.Fatalf("scope not updated: %#v", updated[1])
	}
	if updated[0].Key != "priority" || updated[0].Order != 1 || updated[0].Scope != "" {
		t.Fatalf("unrelated def changed: %#v", updated[0])
	}

	// Key match is case-insensitive (schema keys are normalized elsewhere too).
	caseMatch := upsertSchemaDef(current, "Priority", "Prio", "select", "")
	if len(caseMatch) != 2 || caseMatch[0].Name != "Prio" {
		t.Fatalf("case-insensitive upsert failed: %#v", caseMatch)
	}
}

func TestFilterSchemaForSession(t *testing.T) {
	defs := []wconfig.AgentPropertyDefType{
		{Key: "global1", Type: "text"},
		{Key: "pi-only", Type: "text", Scope: "agent:pi"},
		{Key: "codex-only", Type: "text", Scope: "agent:codex"},
	}
	pi := filterSchemaForSession(defs, "pi")
	if len(pi) != 2 || pi[0].Key != "global1" || pi[1].Key != "pi-only" {
		t.Fatalf("pi session should see global + agent:pi, got %#v", pi)
	}
	codex := filterSchemaForSession(defs, "codex")
	if len(codex) != 2 || codex[1].Key != "codex-only" {
		t.Fatalf("codex session should see global + agent:codex, got %#v", codex)
	}
	// Unknown provider: only global defs remain visible (safe degradation).
	other := filterSchemaForSession(defs, "")
	if len(other) != 1 || other[0].Key != "global1" {
		t.Fatalf("empty provider should see globals only, got %#v", other)
	}
}

func TestValidateCardPropScopes(t *testing.T) {
	valid := map[string]wshrpc.AgentCardPropPatch{
		"a": {Type: "text", Value: "x", Scope: ""},
		"b": {Type: "text", Value: "x", Scope: "agent"},
		"c": {Type: "text", Value: "x", Scope: "all"},
	}
	if err := validateCardPropScopes(valid); err != nil {
		t.Fatalf("valid scopes rejected: %v", err)
	}
	invalid := map[string]wshrpc.AgentCardPropPatch{
		"a": {Type: "text", Value: "x", Scope: "team"},
	}
	err := validateCardPropScopes(invalid)
	if err == nil || !strings.Contains(err.Error(), "team") {
		t.Fatalf("invalid scope must be rejected with the offending value, got %v", err)
	}
}

func TestBuildCardOperationsCarriesPropScope(t *testing.T) {
	ops, err := buildCardOperations("pi:a:/f.jsonl", wshrpc.AgentCardSetRequest{
		Props: map[string]wshrpc.AgentCardPropPatch{
			"priority": {Type: "select", Value: "P1", Scope: "agent"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(ops) != 1 || ops[0].Type != "session_prop.update" {
		t.Fatalf("unexpected ops: %#v", ops)
	}
	if got := ops[0].Props["priority"].Scope; got != "agent" {
		t.Fatalf("scope not carried into patch op: %q", got)
	}
}
