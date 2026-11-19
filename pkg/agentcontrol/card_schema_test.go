// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcontrol

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
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
	next := upsertSchemaDef(current, "risk", "Risk", "status", "agent:pi", nil)
	if len(next) != 3 {
		t.Fatalf("expected 3 defs, got %d", len(next))
	}
	if next[2].Key != "risk" || next[2].Scope != "agent:pi" || next[2].Order != 3 {
		t.Fatalf("inserted def wrong: %#v", next[2])
	}

	// Update keeps unrelated defs byte-identical (key, order, name).
	updated := upsertSchemaDef(next, "owner", "Owner", "text", "agent:pi", nil)
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
	caseMatch := upsertSchemaDef(current, "Priority", "Prio", "select", "", nil)
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

// --- --prop-add-option: appending candidate options to a definition ----------

func TestUpsertSchemaDefAppendsWithAddOptions(t *testing.T) {
	current := []wconfig.AgentPropertyDefType{
		{Key: "priority", Name: "Priority", Type: "select", Order: 1, Options: []string{"P1", "P2"}, AIManaged: true},
		{Key: "owner", Name: "Owner", Type: "text", Order: 2, Scope: "agent:codex", AIInstruction: "keep me"},
	}

	// Appends, dedupes (case-insensitive), keeps original order, appends new at end.
	next := upsertSchemaDef(current, "priority", "", "", "", []string{"P2", "P3", "p3"})
	if !reflect.DeepEqual(next[0].Options, []string{"P1", "P2", "P3"}) {
		t.Fatalf("options must append deduped in order, got %#v", next[0].Options)
	}

	// Idempotent re-run: nothing new, options stay byte-identical.
	again := upsertSchemaDef(next, "priority", "", "", "", []string{"P1", "P2", "P3"})
	if !reflect.DeepEqual(again[0].Options, []string{"P1", "P2", "P3"}) {
		t.Fatalf("idempotent re-run must not duplicate options, got %#v", again[0].Options)
	}

	// Key match is case-insensitive.
	caseMatch := upsertSchemaDef(current, "Priority", "", "", "", []string{"P9"})
	if !reflect.DeepEqual(caseMatch[0].Options, []string{"P1", "P2", "P9"}) {
		t.Fatalf("case-insensitive key match must append, got %#v", caseMatch[0].Options)
	}

	// Unrelated definitions stay byte-identical (order/scope/aiManaged/aiInstruction/options).
	untouched := next[1]
	if untouched.Key != "owner" || untouched.Order != 2 || untouched.Scope != "agent:codex" ||
		untouched.AIManaged || untouched.AIInstruction != "keep me" || untouched.Options != nil {
		t.Fatalf("unrelated definition must not change, got %#v", untouched)
	}

	// The updated definition keeps its other fields.
	if !next[0].AIManaged || next[0].Name != "Priority" || next[0].Order != 1 {
		t.Fatalf("updated definition must keep name/order/aiManaged, got %#v", next[0])
	}

	// A brand-new definition starts from the given options.
	created := upsertSchemaDef(current, "risk", "Risk", "status", "agent:pi", []string{"high", "low", "High"})
	if len(created) != 3 || !reflect.DeepEqual(created[2].Options, []string{"high", "low"}) {
		t.Fatalf("new definition must carry the deduped options, got %#v", created[2].Options)
	}
}

func TestUpsertSchemaDefWithoutAddOptionsKeepsLegacyBehaviour(t *testing.T) {
	current := []wconfig.AgentPropertyDefType{
		{Key: "priority", Name: "Priority", Type: "select", Order: 1, Options: []string{"P1"}},
	}
	// No addOptions: existing def options untouched, new def gets nil Options.
	next := upsertSchemaDef(current, "priority", "Prio", "select", "agent:pi", nil)
	if !reflect.DeepEqual(next[0].Options, []string{"P1"}) {
		t.Fatalf("nil addOptions must not touch existing options, got %#v", next[0].Options)
	}
	created := upsertSchemaDef(current, "risk", "Risk", "status", "", nil)
	if created[1].Options != nil {
		t.Fatalf("new definition without addOptions must keep nil options, got %#v", created[1].Options)
	}
}

func TestSyncPropertySchemaAppendsOptionsAndKeepsOtherDefs(t *testing.T) {
	configDir := filepath.Join(t.TempDir(), "config")
	wavebase.ConfigHome_VarCache = configDir
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		t.Fatal(err)
	}
	seed := `{"agent:propertyschema":[{"key":"status","name":"Status","type":"status","options":["Active"],"order":1,"aiManaged":true},{"key":"owner","name":"Owner","type":"text","order":2,"aiInstruction":"keep me"}]}`
	if err := os.WriteFile(filepath.Join(configDir, "settings.json"), []byte(seed), 0o600); err != nil {
		t.Fatal(err)
	}

	err := syncPropertySchema("pi:a:/f.jsonl", map[string]wshrpc.AgentCardPropPatch{
		"status": {Type: "status", Value: "闲置", Scope: "agent", AddOptions: []string{"闲置"}},
	})
	if err != nil {
		t.Fatal(err)
	}

	defs := wconfig.ReadFullConfig().Settings.AgentPropertySchema
	if len(defs) != 2 {
		t.Fatalf("schema must stay two definitions, got %#v", defs)
	}
	status := defs[0]
	if !reflect.DeepEqual(status.Options, []string{"Active", "闲置"}) {
		t.Fatalf("status options must be appended in order, got %#v", status.Options)
	}
	if status.Name != "Status" || status.Order != 1 || !status.AIManaged || status.Type != "status" || status.Scope != "agent:pi" {
		t.Fatalf("existing status definition fields must survive the append, got %#v", status)
	}
	owner := defs[1]
	if owner.Name != "Owner" || owner.Order != 2 || owner.AIInstruction != "keep me" || owner.Options != nil || owner.Scope != "" {
		t.Fatalf("unrelated definition must be untouched, got %#v", owner)
	}

	// Idempotency: the same command again must not duplicate the option.
	if err := syncPropertySchema("pi:a:/f.jsonl", map[string]wshrpc.AgentCardPropPatch{
		"status": {Type: "status", Value: "闲置", Scope: "agent", AddOptions: []string{"闲置"}},
	}); err != nil {
		t.Fatal(err)
	}
	defs = wconfig.ReadFullConfig().Settings.AgentPropertySchema
	if !reflect.DeepEqual(defs[0].Options, []string{"Active", "闲置"}) {
		t.Fatalf("re-running the append must stay idempotent, got %#v", defs[0].Options)
	}
}

func TestSchemaSyncMessagesMentionAppendedOptions(t *testing.T) {
	messages := schemaSyncMessages("pi:a:/f.jsonl", map[string]wshrpc.AgentCardPropPatch{
		"status": {Type: "status", Value: "闲置", Scope: "agent", AddOptions: []string{"闲置"}},
	})
	joined := strings.Join(messages, "\n")
	if !strings.Contains(joined, "agent:propertyschema") || !strings.Contains(joined, "options: 闲置") {
		t.Fatalf("real-apply message must name the published definition and the appended options, got %v", messages)
	}
}

func TestValidateCardPropAddOptions(t *testing.T) {
	valid := map[string]wshrpc.AgentCardPropPatch{
		"a": {Type: "status", Value: "x", Scope: "agent", AddOptions: []string{"new"}},
		"b": {Type: "select", Value: "x", Scope: "all", AddOptions: []string{"new"}},
		"c": {Type: "text", Value: "x"}, // no options, any scope
	}
	if err := validateCardPropAddOptions(valid); err != nil {
		t.Fatalf("agent/all scoped appends must be accepted: %v", err)
	}
	for _, scope := range []string{"", "session", "Session"} {
		invalid := map[string]wshrpc.AgentCardPropPatch{
			"a": {Type: "status", Value: "x", Scope: scope, AddOptions: []string{"new"}},
		}
		err := validateCardPropAddOptions(invalid)
		if err == nil || !strings.Contains(err.Error(), "agent/all") {
			t.Fatalf("session scope %q must reject option appends, got %v", scope, err)
		}
	}
}
