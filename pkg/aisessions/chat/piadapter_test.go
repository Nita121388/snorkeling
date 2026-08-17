// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chat

import (
	"testing"
)

// feed runs a raw pi RPC event through the mapper and returns the mapped
// ChatEvent (or nil — mapper must tolerate unknown/boot events).
func feed(evtType string, raw map[string]any) *ChatEvent {
	m := &piMapper{}
	return m.mapEvent(RpcEvent{Type: evtType, Raw: raw})
}

func TestPiMapper_TurnLifecycle(t *testing.T) {
	if evt := feed("agent_start", nil); evt == nil || evt.Type != ThreadStart {
		t.Fatalf("agent_start → ThreadStart, got %+v", evt)
	}
	if evt := feed("turn_start", map[string]any{"turnId": "t1"}); evt == nil || evt.Type != TurnStart || evt.TurnID != "t1" {
		t.Fatalf("turn_start → TurnStart(t1), got %+v", evt)
	}
	if evt := feed("agent_end", map[string]any{"messages": []any{}}); evt == nil || evt.Type != TurnEnd {
		t.Fatalf("agent_end → TurnEnd, got %+v", evt)
	}
}

func TestPiMapper_TextDeltaAccumulates(t *testing.T) {
	m := &piMapper{}
	evt := m.mapEvent(RpcEvent{Type: "message_update", Raw: map[string]any{
		"assistantMessageEvent": map[string]any{"type": "text_delta", "delta": "Hello "},
	}})
	if evt == nil || evt.Type != AssistantDelta || evt.Text != "Hello " {
		t.Fatalf("expected AssistantDelta(Hello ), got %+v", evt)
	}
	if evt := m.mapEvent(RpcEvent{Type: "message_update", Raw: map[string]any{
		"assistantMessageEvent": map[string]any{"type": "text_delta", "delta": "world"},
	}}); evt == nil || evt.Text != "world" {
		t.Fatalf("expected second delta, got %+v", evt)
	}
	if evt := m.mapEvent(RpcEvent{Type: "message_update", Raw: map[string]any{
		"assistantMessageEvent": map[string]any{"type": "thinking_delta", "delta": "thinking..."},
	}}); evt == nil || evt.Type != ThinkingDelta {
		t.Fatalf("expected ThinkingDelta, got %+v", evt)
	}
}

func TestPiMapper_ToolExecutionLifecycle(t *testing.T) {
	m := &piMapper{}
	evt := m.mapEvent(RpcEvent{Type: "tool_execution_start", Raw: map[string]any{"toolCallId": "c1", "toolName": "bash"}})
	if evt == nil || evt.Type != ToolCallStart || evt.ToolName != "bash" || evt.ToolStatus != "running" {
		t.Fatalf("tool start: got %+v", evt)
	}
	evt = m.mapEvent(RpcEvent{Type: "tool_execution_end", Raw: map[string]any{"toolCallId": "c1", "toolName": "bash", "isError": false, "result": "ok"}})
	if evt == nil || evt.Type != ToolCallEnd || evt.ToolStatus != "completed" {
		t.Fatalf("tool end completed: got %+v", evt)
	}
	evt = m.mapEvent(RpcEvent{Type: "tool_execution_end", Raw: map[string]any{"toolCallId": "c2", "toolName": "bash", "isError": true}})
	if evt == nil || evt.ToolStatus != "failed" {
		t.Fatalf("tool end failed: got %+v", evt)
	}
}

func TestPiMapper_ToleratesUnknownAndExtensionEvents(t *testing.T) {
	// Boot/extension events must be silently ignored (i-am-cooking setStatus etc.).
	if evt := feed("extension_ui_request", map[string]any{"method": "setStatus"}); evt != nil {
		t.Fatalf("extension_ui_request must be ignored, got %+v", evt)
	}
	// Unknown future event types must not break the mapper.
	if evt := feed("totally_new_event", map[string]any{"x": 1}); evt != nil {
		t.Fatalf("unknown event must be ignored, got %+v", evt)
	}
	// message_start for a user message maps to a user MessageStart.
	if evt := feed("message_start", map[string]any{"message": map[string]any{"role": "user", "content": []any{map[string]any{"type": "text", "text": "hi"}}}}); evt == nil || evt.Role != "user" || evt.Text != "hi" {
		t.Fatalf("user message_start: got %+v", evt)
	}
	// message_start for assistant yields nothing (text arrives via deltas).
	if evt := feed("message_start", map[string]any{"message": map[string]any{"role": "assistant", "content": []any{}}}); evt != nil {
		t.Fatalf("assistant message_start should yield no event, got %+v", evt)
	}
}

func TestPiMapper_UsageFromAgentEnd(t *testing.T) {
	m := &piMapper{}
	// Last assistant message carries usage; agent_end surfaces it on TurnEnd.
	m.mapEvent(RpcEvent{Type: "agent_end", Raw: map[string]any{"messages": []any{
		map[string]any{"role": "user", "content": "q"},
		map[string]any{"role": "assistant", "usage": map[string]any{
			"input": 10.0, "output": 20.0, "cacheRead": 5.0, "cacheWrite": 0.0,
			"cost": map[string]any{"total": 0.0004},
		}},
	}}})
	// Note: agent_end returns TurnEnd with Usage — the mapper stores usage but
	// the returned event in mapEvent already has Usage set; verify via the
	// last TurnEnd event produced.
	evt := m.mapEvent(RpcEvent{Type: "agent_end", Raw: map[string]any{"messages": []any{
		map[string]any{"role": "assistant", "usage": map[string]any{
			"input": 10.0, "output": 20.0, "cacheRead": 5.0, "cacheWrite": 0.0,
			"cost": map[string]any{"total": 0.0004},
		}},
	}}})
	if evt == nil || evt.Type != TurnEnd || evt.Usage == nil {
		t.Fatalf("expected TurnEnd with usage, got %+v", evt)
	}
	if evt.Usage.InputTokens != 10 || evt.Usage.OutputTokens != 20 || evt.Usage.CacheReadTokens != 5 {
		t.Fatalf("usage mismatch: %+v", evt.Usage)
	}
}