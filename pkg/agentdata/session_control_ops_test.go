// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentdata

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
)

func TestSessionTitleUpdateWritesAITitle(t *testing.T) {
	sessionID, manager := setupAgentDataSession(t)
	ctx := context.Background()
	before, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}

	title := "ACS 设计"
	patch := Patch{
		Version: PatchVersion,
		Source:  "test",
		Operations: []PatchOperation{{
			Type:         "session_title.update",
			SessionKey:   sessionID,
			Title:        &title,
			ExpectedHash: HashSession(before),
		}},
	}
	if _, err := ApplyPatch(ctx, patch, ApplyOptions{Yes: true}); err != nil {
		t.Fatal(err)
	}

	after, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	if after.Title != "ACS 设计" {
		t.Fatalf("title not written: %#v", after)
	}
	if after.TitleSource != aisessions.TitleSourceAI {
		t.Fatalf("titleSource must be ai, got %q", after.TitleSource)
	}
	// The ai-title write must not touch the note/tags layer (setMetaTx merge rule).
	if after.Note != before.Note || strings.Join(after.Tags, ",") != strings.Join(before.Tags, ",") {
		t.Fatalf("title write must not modify note/tags: before=%#v after=%#v", before, after)
	}
}

func TestSessionTitleUpdateProtectsUserTitle(t *testing.T) {
	sessionID, manager := setupAgentDataSession(t)
	ctx := context.Background()
	if _, err := manager.SetTitle(ctx, sessionID, "用户手写标题"); err != nil {
		t.Fatal(err)
	}
	before, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	if before.TitleSource != aisessions.TitleSourceUser {
		t.Fatalf("fixture precondition failed: %#v", before)
	}

	title := "AI 想改的标题"
	patch := Patch{
		Version: PatchVersion,
		Source:  "test",
		Operations: []PatchOperation{{
			Type:         "session_title.update",
			SessionKey:   sessionID,
			Title:        &title,
			ExpectedHash: HashSession(before),
		}},
	}
	_, err = ApplyPatch(ctx, patch, ApplyOptions{Yes: true})
	if err == nil {
		t.Fatal("expected a user-title conflict without force")
	}
	if !strings.Contains(err.Error(), "title conflict") {
		t.Fatalf("unexpected error: %v", err)
	}

	after, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	if after.Title != "用户手写标题" || after.TitleSource != aisessions.TitleSourceUser {
		t.Fatalf("user title must survive a refused overwrite: %#v", after)
	}
}

func TestSessionTitleUpdateForceOverwritesUserTitle(t *testing.T) {
	sessionID, manager := setupAgentDataSession(t)
	ctx := context.Background()
	if _, err := manager.SetTitle(ctx, sessionID, "用户手写标题"); err != nil {
		t.Fatal(err)
	}
	before, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}

	title := "AI 覆盖后的标题"
	patch := Patch{
		Version: PatchVersion,
		Source:  "test",
		Operations: []PatchOperation{{
			Type:         "session_title.update",
			SessionKey:   sessionID,
			Title:        &title,
			Force:        true,
			ExpectedHash: HashSession(before),
		}},
	}
	if _, err := ApplyPatch(ctx, patch, ApplyOptions{Yes: true}); err != nil {
		t.Fatal(err)
	}
	after, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	if after.Title != "AI 覆盖后的标题" || after.TitleSource != aisessions.TitleSourceAI {
		t.Fatalf("forced overwrite must land as ai: %#v", after)
	}
}

func TestSessionTitleUpdateDryRunDoesNotWrite(t *testing.T) {
	sessionID, manager := setupAgentDataSession(t)
	ctx := context.Background()
	before, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}

	title := "dry run title"
	patch := Patch{
		Version: PatchVersion,
		Operations: []PatchOperation{{
			Type:       "session_title.update",
			SessionKey: sessionID,
			Title:      &title,
		}},
	}
	report, err := ApplyPatch(ctx, patch, ApplyOptions{DryRun: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Operations) != 1 || !report.Operations[0].Changed {
		t.Fatalf("dry run should report the pending change: %#v", report)
	}
	after, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	if after.Title != before.Title {
		t.Fatalf("dry run wrote a title: before=%q after=%q", before.Title, after.Title)
	}
}

func TestSessionPropUpdateWritesCustomProps(t *testing.T) {
	sessionID, manager := setupAgentDataSession(t)
	ctx := context.Background()
	before, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}

	patch := Patch{
		Version: PatchVersion,
		Source:  "test",
		Operations: []PatchOperation{{
			Type:         "session_prop.update",
			SessionKey:   sessionID,
			Props:        map[string]PropPatch{"priority": {Type: "select", Value: "P1"}},
			ExpectedHash: HashSession(before),
		}},
	}
	if _, err := ApplyPatch(ctx, patch, ApplyOptions{Yes: true}); err != nil {
		t.Fatal(err)
	}
	after, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	cell, ok := after.Props["priority"]
	if !ok {
		t.Fatalf("prop not written: %#v", after.Props)
	}
	if cell.Value != "P1" || cell.Type != "select" || cell.Source != aisessions.PropertySourceAI {
		t.Fatalf("unexpected prop cell: %#v", cell)
	}
}

func TestSessionPropUpdateRejectsBuiltinKeys(t *testing.T) {
	sessionID, manager := setupAgentDataSession(t)
	ctx := context.Background()
	before, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}

	patch := Patch{
		Version: PatchVersion,
		Operations: []PatchOperation{{
			Type:         "session_prop.update",
			SessionKey:   sessionID,
			Props:        map[string]PropPatch{"note": {Type: "text", Value: "shadow note"}},
			ExpectedHash: HashSession(before),
		}},
	}
	report, err := ApplyPatch(ctx, patch, ApplyOptions{Yes: true})
	if err != nil {
		t.Fatal(err)
	}
	op := report.Operations[0]
	if op.Changed {
		t.Fatalf("built-in key must not be written: %#v", op)
	}
	if len(op.Skipped) == 0 || !strings.Contains(op.Skipped[0], "built-in") {
		t.Fatalf("expected a skipped reason for the built-in key, got %#v", op.Skipped)
	}
	after, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	if after.Note != before.Note {
		t.Fatalf("built-in note must be untouched: before=%q after=%q", before.Note, after.Note)
	}
	if _, ok := after.Props["note"]; ok {
		t.Fatalf("built-in key leaked into the custom prop layer: %#v", after.Props)
	}
}

func TestSessionPropUpdateSkipsUserValueUnlessForced(t *testing.T) {
	sessionID, manager := setupAgentDataSession(t)
	ctx := context.Background()
	idx, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := setUserPropForTest(ctx, manager, idx.Key, "owner", "text", "nita"); err != nil {
		t.Fatal(err)
	}
	before, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	if before.Props["owner"].Source != aisessions.PropertySourceUser {
		t.Fatalf("fixture precondition failed: %#v", before.Props["owner"])
	}

	patch := Patch{
		Version: PatchVersion,
		Operations: []PatchOperation{{
			Type:         "session_prop.update",
			SessionKey:   sessionID,
			Props:        map[string]PropPatch{"owner": {Type: "text", Value: "someone-else"}},
			ExpectedHash: HashSession(before),
		}},
	}
	report, err := ApplyPatch(ctx, patch, ApplyOptions{Yes: true})
	if err != nil {
		t.Fatal(err)
	}
	op := report.Operations[0]
	if op.Changed {
		t.Fatalf("user-authored prop must not be overwritten without force: %#v", op)
	}
	if len(op.Skipped) == 0 {
		t.Fatalf("expected the user value to be reported as skipped: %#v", op)
	}
	after, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	if after.Props["owner"].Value != "nita" {
		t.Fatalf("user value changed without force: %#v", after.Props["owner"])
	}
}

func TestSessionPropUpdateForceOverwritesUserValue(t *testing.T) {
	sessionID, manager := setupAgentDataSession(t)
	ctx := context.Background()
	summary, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := setUserPropForTest(ctx, manager, summary.Key, "owner", "text", "nita"); err != nil {
		t.Fatal(err)
	}
	before, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}

	patch := Patch{
		Version: PatchVersion,
		Operations: []PatchOperation{{
			Type:         "session_prop.update",
			SessionKey:   sessionID,
			Props:        map[string]PropPatch{"owner": {Type: "text", Value: "someone-else"}},
			Force:        true,
			ExpectedHash: HashSession(before),
		}},
	}
	if _, err := ApplyPatch(ctx, patch, ApplyOptions{Yes: true}); err != nil {
		t.Fatal(err)
	}
	after, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	if after.Props["owner"].Value != "someone-else" {
		t.Fatalf("forced overwrite did not land: %#v", after.Props["owner"])
	}
}

func TestSessionControlOpsRejectUnknownFields(t *testing.T) {
	for _, raw := range []string{
		`{"version":1,"operations":[{"type":"session_title.update","sessionKey":"k","title":"t","bogus":1}]}`,
		`{"version":1,"operations":[{"type":"session_prop.update","sessionKey":"k","props":{},"bogus":1}]}`,
	} {
		var patch Patch
		if err := json.Unmarshal([]byte(raw), &patch); err == nil {
			t.Fatalf("expected unknown field rejection for %s", raw)
		}
	}
}

func TestSessionPropUpdateRejectsUnsupportedType(t *testing.T) {
	sessionID, manager := setupAgentDataSession(t)
	ctx := context.Background()
	before, err := manager.Summary(ctx, sessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	patch := Patch{
		Version: PatchVersion,
		Operations: []PatchOperation{{
			Type:         "session_prop.update",
			SessionKey:   sessionID,
			Props:        map[string]PropPatch{"weird": {Type: "formula", Value: "1+1"}},
			ExpectedHash: HashSession(before),
		}},
	}
	if _, err := ApplyPatch(ctx, patch, ApplyOptions{Yes: true}); err == nil {
		t.Fatal("expected unsupported property type to be rejected")
	}
}

// setUserPropForTest writes a user-sourced custom property, the same way the UI
// property editor does, so the "user value is protected" contract is exercised
// against real data rather than a hand-built map.
func setUserPropForTest(ctx context.Context, manager *aisessions.Manager, key, propKey, propType string, value any) error {
	_, err := manager.SetProps(ctx, key, map[string]aisessions.PropertyCell{
		propKey: {Type: propType, Value: value, Source: aisessions.PropertySourceUser, UpdatedAt: 1},
	})
	return err
}
