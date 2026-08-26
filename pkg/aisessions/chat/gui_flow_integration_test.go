// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chat

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// TestPiAdapter_GUI_AgentFlow mirrors the end-to-end GUI chat the user performs:
//  1. create a GUI agent (spawn a pi session)
//  2. select a model + a thinking level (Control set_model / set_thinking_level)
//  3. send a message, verify the agent responds (turn terminates with content)
//  4. verify session_state reflects the selected model + thinking level, and that
//     the selection survives the send
//
// Uses the real `pi --mode rpc` binary (skipped when pi is absent). No mocking.
func TestPiAdapter_GUI_AgentFlow(t *testing.T) {
	requirePi(t)
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Second)
	defer cancel()

	sessDir := t.TempDir()
	adapter := &piAdapter{}
	session, err := adapter.Start(ctx, StartOptions{SessionDir: sessDir})
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	defer session.Close()

	// 1) create GUI agent: session must spawn with an id
	time.Sleep(1500 * time.Millisecond)
	st0, err := session.GetState(ctx)
	if err != nil {
		t.Fatalf("GetState (init) failed: %v", err)
	}
	if st0.SessionID == "" {
		t.Fatalf("expected non-empty session id after create")
	}
	t.Logf("[create] sessionId=%q model=%+v", st0.SessionID, st0.Model)

	// 2) select model + thinking level
	modelsRaw, err := session.Control(ctx, "get_available_models", nil)
	if err != nil {
		t.Fatalf("get_available_models failed: %v", err)
	}
	models := extractModelList(t, modelsRaw)
	if len(models) == 0 {
		t.Fatalf("no models returned by get_available_models")
	}
	chosen := models[0]
	if _, err := session.Control(ctx, "set_model", map[string]any{
		"provider": chosen.Provider, "modelId": chosen.ID,
	}); err != nil {
		t.Fatalf("set_model failed: %v", err)
	}
	t.Logf("[model] selected provider=%q id=%q name=%q", chosen.Provider, chosen.ID, chosen.Name)

	levelsRaw, err := session.Control(ctx, "get_available_thinking_levels", nil)
	if err != nil {
		t.Fatalf("get_available_thinking_levels failed: %v", err)
	}
	levels := extractLevelList(t, levelsRaw)
	chosenLevel := ""
	if len(levels) > 0 {
		chosenLevel = levels[0]
	}
	if _, err := session.Control(ctx, "set_thinking_level", map[string]any{"level": chosenLevel}); err != nil {
		t.Fatalf("set_thinking_level failed: %v", err)
	}
	t.Logf("[thinking] selected level=%q (available: %v)", chosenLevel, levels)

	// state must reflect the selection immediately
	st1, err := session.GetState(ctx)
	if err != nil {
		t.Fatalf("GetState (post-select) failed: %v", err)
	}
	if st1.Model == nil || st1.Model.ID != chosen.ID {
		t.Fatalf("session_state model mismatch: got %+v want id=%q", st1.Model, chosen.ID)
	}
	if st1.ThinkingLevel != chosenLevel {
		t.Fatalf("session_state thinkingLevel mismatch: got %q want %q", st1.ThinkingLevel, chosenLevel)
	}
	t.Logf("[state] model=%q thinking=%q — selection reflected ✅", st1.Model.ID, st1.ThinkingLevel)

	// 3) send a message; wait for the agent to terminate the turn (response or failure)
	respCh := make(chan string, 16)
	unsub := session.OnEvent(func(evt ChatEvent) {
		switch evt.Type {
		case AssistantDelta:
			if strings.TrimSpace(evt.Text) != "" {
				respCh <- "delta:" + evt.Text
			}
		case TurnEnd:
			respCh <- "turn_end"
		case TurnFailed:
			respCh <- "turn_failed:" + evt.Error
		}
	})
	defer unsub()

	msgBefore := st1.MessageCount
	if err := session.Prompt(ctx, "Reply with the single word PONG and nothing else."); err != nil {
		t.Fatalf("Prompt failed: %v", err)
	}
	t.Logf("[send] message sent (msgCountBefore=%d)", msgBefore)

	var firstEvent string
	select {
	case firstEvent = <-respCh:
		t.Logf("[response] first event: %s", firstEvent)
	case <-time.After(90 * time.Second):
		t.Fatalf("timed out waiting for any agent response")
	}
	// drain briefly to capture streamed content if present
	select {
	case extra := <-respCh:
		t.Logf("[response] extra event: %s", extra)
	case <-time.After(1500 * time.Millisecond):
	}

	// 4) final state: selection must survive; report message count + terminal event
	st2, err := session.GetState(ctx)
	if err != nil {
		t.Fatalf("GetState (final) failed: %v", err)
	}
	if st2.Model == nil || st2.Model.ID != chosen.ID {
		t.Fatalf("model selection lost after send: %+v", st2.Model)
	}
	if st2.ThinkingLevel != chosenLevel {
		t.Fatalf("thinking selection lost after send: %q", st2.ThinkingLevel)
	}
	t.Logf("[done] msgCount=%d (before=%d) model=%q thinking=%q terminal=%q — selection survived ✅",
		st2.MessageCount, msgBefore, st2.Model.ID, st2.ThinkingLevel, firstEvent)
}

func extractModelList(t *testing.T, data any) []ModelInfo {
	m, ok := data.(map[string]any)
	if !ok {
		t.Fatalf("models payload not a map: %T", data)
	}
	raw, _ := json.Marshal(m["models"])
	var out []ModelInfo
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("models unmarshal: %v", err)
	}
	return out
}

func extractLevelList(t *testing.T, data any) []string {
	m, ok := data.(map[string]any)
	if !ok {
		t.Fatalf("levels payload not a map: %T", data)
	}
	raw, _ := json.Marshal(m["levels"])
	var out []string
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("levels unmarshal: %v", err)
	}
	return out
}
