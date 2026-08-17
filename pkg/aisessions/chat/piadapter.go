// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// piAdapter implements Provider for the pi agent ("pi --mode rpc").
//
// Launch shape (mirrors Paseo's buildPiLaunch):
//
//	pi --mode rpc [--session <id>] [--session-dir <dir>] \
//	   [--provider <p>] [--model <m>] [--no-extensions]
//
// The session dir override is only used for tests/isolated runs; in production
// the default (~/.pi/agent/sessions) lets the GUI and TUI share the same files.
type piAdapter struct{}

// NewPiAdapter builds the pi chat provider.
func NewPiAdapter() Provider { return &piAdapter{} }

func (a *piAdapter) Source() string { return SourcePi }

func (a *piAdapter) Capabilities() Capabilities {
	return Capabilities{
		SupportsStreaming: true,
		SupportsAbort:     true,
		SupportsSetModel:  false, // model switching UI deferred (M4)
		SupportsSetThinking: false,
		SupportsAskUser:   true,
		ProtocolStability: "stable",
	}
}

func (a *piAdapter) Start(ctx context.Context, opts StartOptions) (*Session, error) {
	argv := []string{"--mode", "rpc"}
	if opts.SessionID != "" {
		argv = append(argv, "--session", opts.SessionID)
	}
	if opts.SessionDir != "" {
		argv = append(argv, "--session-dir", opts.SessionDir)
	}
	if opts.Provider != "" {
		argv = append(argv, "--provider", opts.Provider)
	}
	if opts.Model != "" {
		argv = append(argv, "--model", opts.Model)
	}
	if opts.NoExtensions {
		argv = append(argv, "--no-extensions")
	}
	cmd := exec.Command("pi", argv...)
	if opts.ProjectPath != "" {
		cmd.Dir = opts.ProjectPath
	}
	cmd.Env = os.Environ()
	return NewSession("pi", opts, cmd)
}

// ---------------------------------------------------------------------------
// pi event mapping
// ---------------------------------------------------------------------------

// piMapper accumulates per-session state while mapping raw pi RPC events to
// ChatEvents. Because the underlying rpc reader loop invokes the mapper on a
// single goroutine, piMapper fields are not subject to races.
type piMapper struct {
	session   *Session
	turnID    string
	usage     *ChatUsage
}

func (m *piMapper) mapEvent(evt RpcEvent) *ChatEvent {
	switch evt.Type {
	case "agent_start":
		return &ChatEvent{Type: ThreadStart}
	case "turn_start":
		m.turnID = str(evt.Raw["turnId"])
		return &ChatEvent{Type: TurnStart, TurnID: m.turnID}
	case "message_start":
		return m.mapMessageStart(evt)
	case "message_update":
		return m.mapMessageUpdate(evt)
	case "tool_execution_start":
		return &ChatEvent{
			Type: ToolCallStart, TurnID: m.turnID,
			ToolName: str(evt.Raw["toolName"]), ToolStatus: "running",
			Detail: previewArgs(evt.Raw["args"]),
		}
	case "tool_execution_update":
		return &ChatEvent{
			Type: ToolCallUpdate, TurnID: m.turnID,
			ToolName: str(evt.Raw["toolName"]), ToolStatus: "running",
			Detail: previewAny(evt.Raw["partialResult"]),
		}
	case "tool_execution_end":
		status := "completed"
		if isTrue(evt.Raw["isError"]) {
			status = "failed"
		}
		return &ChatEvent{
			Type: ToolCallEnd, TurnID: m.turnID,
			ToolName: str(evt.Raw["toolName"]), ToolStatus: status,
			Detail: previewAny(evt.Raw["result"]),
		}
	case "compaction_start", "compaction_end":
		return &ChatEvent{Type: SystemNotice, TurnID: m.turnID, Notice: "context compaction"}
	case "agent_end":
		m.consumeFinalMessages(evt.Raw["messages"])
		if m.session != nil {
			m.session.turnFinished()
		}
		return &ChatEvent{Type: TurnEnd, TurnID: m.turnID, Usage: m.usage}
	case "extension_ui_request":
		// Extension UI (i-am-cooking setStatus/setWidget, ask_user confirmations…)
		// is out of scope for M1; tolerate silently.
		return nil
	case "command_output":
		if txt := str(evt.Raw["text"]); txt != "" {
			return &ChatEvent{Type: SystemNotice, TurnID: m.turnID, Notice: txt}
		}
		return nil
	default:
		return nil // tolerate unknown events (protocol evolution)
	}
}

func (m *piMapper) mapMessageStart(evt RpcEvent) *ChatEvent {
	msg, ok := evt.Raw["message"].(map[string]any)
	if !ok {
		return nil
	}
	role, _ := msg["role"].(string)
	if role == "assistant" {
		// extract usage carried on the message if present
		m.consumeUsage(msg)
		return nil // assistant start is implicit via deltas; no bubble yet
	}
	if role == "user" || role == "custom" {
		text := contentText(msg["content"])
		if text != "" {
			return &ChatEvent{Type: MessageStart, Role: "user", Text: text, TurnID: m.turnID}
		}
	}
	return nil
}

func (m *piMapper) mapMessageUpdate(evt RpcEvent) *ChatEvent {
	assistantEvt, ok := evt.Raw["assistantMessageEvent"].(map[string]any)
	if !ok {
		// 0.84+ may carry the cumulative message on message_update; capture usage.
		if msg, ok := evt.Raw["message"].(map[string]any); ok {
			m.consumeUsage(msg)
		}
		return nil
	}
	switch asmType, _ := assistantEvt["type"].(string); asmType {
	case "text_delta":
		return &ChatEvent{Type: AssistantDelta, Text: str(assistantEvt["delta"]), TurnID: m.turnID}
	case "thinking_delta":
		return &ChatEvent{Type: ThinkingDelta, Text: str(assistantEvt["delta"]), TurnID: m.turnID}
	default:
		return nil
	}
}

func (m *piMapper) consumeUsage(msg map[string]any) {
	usage, ok := msg["usage"].(map[string]any)
	if !ok {
		return
	}
	u := &ChatUsage{
		InputTokens:      intNum(usage["input"]),
		OutputTokens:     intNum(usage["output"]),
		CacheReadTokens:  intNum(usage["cacheRead"]),
		CacheWriteTokens: intNum(usage["cacheWrite"]),
	}
	if cost, ok := usage["cost"].(map[string]any); ok {
		u.TotalCostUsd = fnum(cost["total"])
	}
	m.usage = u
}

func (m *piMapper) consumeFinalMessages(v any) {
	arr, ok := v.([]any)
	if !ok {
		return
	}
	// usage lives on the last assistant message
	for i := len(arr) - 1; i >= 0; i-- {
		msg, ok := arr[i].(map[string]any)
		if !ok {
			continue
		}
		if role, _ := msg["role"].(string); role == "assistant" {
			m.consumeUsage(msg)
			return
		}
	}
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func str(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func isTrue(v any) bool {
	b, _ := v.(bool)
	return b
}

func intNum(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	}
	return 0
}

func fnum(v any) float64 {
	if f, ok := v.(float64); ok {
		return f
	}
	return 0
}

// contentText extracts the readable text from a pi content payload, which may
// be a plain string or an array of {type,text} blocks.
func contentText(v any) string {
	switch c := v.(type) {
	case string:
		return c
	case []any:
		var parts []string
		for _, item := range c {
			if m, ok := item.(map[string]any); ok {
				if t, _ := m["type"].(string); t == "text" {
					parts = append(parts, str(m["text"]))
				}
			}
		}
		return strings.Join(parts, "\n")
	}
	return ""
}

// previewAny renders arbitrary tool args/results as a bounded string.
func previewAny(v any) string {
	if v == nil {
		return ""
	}
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	s := string(b)
	if len(s) > 2000 {
		s = s[:2000] + "…"
	}
	return s
}

func previewArgs(v any) string {
	s := previewAny(v)
	if s == "" {
		return ""
	}
	return fmt.Sprintf("args %s", s)
}
