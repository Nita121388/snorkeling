// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcontrol

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestBuildCardOperationsNoteAndTagsShareOneOperation(t *testing.T) {
	note := "整理完成"
	ops, err := buildCardOperations("codex:abc:/f.jsonl", wshrpc.AgentCardSetRequest{
		Note: &note,
		Tags: &wshrpc.AgentCardTagPatch{Add: []string{"已整理"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(ops) != 1 {
		t.Fatalf("note+tags must be one atomic operation, got %d: %#v", len(ops), ops)
	}
	if ops[0].Type != "session_note.update" {
		t.Fatalf("unexpected op type %q", ops[0].Type)
	}
	if ops[0].Note == nil || *ops[0].Note != note {
		t.Fatalf("note not carried: %#v", ops[0].Note)
	}
	if ops[0].Tags == nil || len(ops[0].Tags.Add) != 1 || ops[0].Tags.Add[0] != "已整理" {
		t.Fatalf("tags not carried: %#v", ops[0].Tags)
	}
}

func TestBuildCardOperationsTitleAndPropsAreSeparate(t *testing.T) {
	title := "ACS 设计"
	ops, err := buildCardOperations("codex:abc:/f.jsonl", wshrpc.AgentCardSetRequest{
		Title: &title,
		Props: map[string]wshrpc.AgentCardPropPatch{"priority": {Type: "select", Value: "P1"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(ops) != 2 {
		t.Fatalf("title and props must be separate operations, got %#v", ops)
	}
	if ops[0].Type != "session_title.update" || ops[1].Type != "session_prop.update" {
		t.Fatalf("unexpected op types %q %q", ops[0].Type, ops[1].Type)
	}
	if ops[1].Props["priority"].Type != "select" {
		t.Fatalf("prop type not carried: %#v", ops[1].Props)
	}
}

func TestBuildCardOperationsCarriesForce(t *testing.T) {
	title := "t"
	ops, err := buildCardOperations("k", wshrpc.AgentCardSetRequest{
		Title: &title,
		Props: map[string]wshrpc.AgentCardPropPatch{"p": {Type: "text", Value: "v"}},
		Force: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, op := range ops {
		if !op.Force {
			t.Fatalf("force must propagate to %q: %#v", op.Type, op)
		}
	}
}

func TestBuildCardOperationsEmptyRequest(t *testing.T) {
	ops, err := buildCardOperations("k", wshrpc.AgentCardSetRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(ops) != 0 {
		t.Fatalf("an empty request must build no operations, got %#v", ops)
	}
}

func TestMapApplyErrorCodes(t *testing.T) {
	tests := []struct {
		name string
		err  string
		want string
	}{
		{"title conflict", "session \"k\" title conflict: title is user-authored", CodeConflict},
		{"hash mismatch", "session \"k\" hash mismatch: expected a got b", CodeConflict},
		{"updatedAt mismatch", "session \"k\" updatedAt mismatch: expected 1 got 2", CodeConflict},
		{"missing precondition", "operation 0 session_note.update requires expectedHash or expectedUpdatedAt for real apply", CodeUsage},
		{"not found", "session not found: abc", CodeNotFound},
		{"bad prop type", "operation 0 property \"x\" has unsupported type \"formula\"", CodeUsage},
		{"unknown field", "unknown field \"bogus\" for operation \"session_note.update\"", CodeUsage},
		{"anything else", "disk on fire", CodeInternal},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mapped := mapApplyError(errString(tt.err))
			ctrl, ok := mapped.(*Error)
			if !ok {
				t.Fatalf("expected *Error, got %T", mapped)
			}
			if ctrl.Code != tt.want {
				t.Fatalf("code = %q, want %q (%s)", ctrl.Code, tt.want, ctrl.Message)
			}
		})
	}
}

func TestMapApplyErrorNil(t *testing.T) {
	if got := mapApplyError(nil); got != nil {
		t.Fatalf("nil error must stay nil, got %v", got)
	}
}

func TestResolveSessionIdentifierPassesThroughExplicitKeys(t *testing.T) {
	got, err := ResolveSessionIdentifier(nil, "codex:abc:/f.jsonl", "")
	if err != nil {
		t.Fatal(err)
	}
	if got != "codex:abc:/f.jsonl" {
		t.Fatalf("explicit identifier must pass through, got %q", got)
	}
}

func TestResolveSessionIdentifierRequiresBlockForThis(t *testing.T) {
	_, err := ResolveSessionIdentifier(nil, "this", "")
	if err == nil {
		t.Fatal("expected an error when 'this' has no block context")
	}
	ctrl, ok := err.(*Error)
	if !ok || ctrl.Code != CodeUsage {
		t.Fatalf("expected E_USAGE, got %#v", err)
	}
	if !strings.Contains(ctrl.Hint, "explicit session key") {
		t.Fatalf("expected an actionable hint, got %q", ctrl.Hint)
	}
}

// errString is a tiny error type so the table above can name raw messages
// without importing fmt in every case.
type errString string

func (e errString) Error() string { return string(e) }
