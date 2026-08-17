// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package chat hosts the "GUI 对话" (live chat) layer for AI sessions.
//
// It is intentionally separate from the read-only JSONL browsing layer
// (pkg/aisessions/Provider.LoadMessages). The chat layer is the "writer-adjacent"
// side: it does NOT write session files (the agent subprocess writes them) and
// does NOT parse JSONL (the existing aisessions.Provider does). It only
// spawns/manages an agent subprocess in a machine-readable protocol mode and
// streams its output events to the GUI; the GUI then calibrates against the
// agent-written file via the existing DetailDelta API.
//
// Currently supported protocol modes:
//   - pi: `pi --mode rpc` (JSONL-RPC over stdin/stdout).
//
// Other agents are wired as Provider implementations behind the same interface.
package chat

// ChatEventType is a small, stable vocabulary shared by every adapter and
// rendered by the frontend. Adapters map their native events onto these.
type ChatEventType string

const (
	// turn + lifecycle
	TurnStart     ChatEventType = "turn_start"
	TurnEnd       ChatEventType = "turn_end"
	ThreadStart   ChatEventType = "thread_started"
	// streaming content (a single turn yields many of these)
	AssistantDelta ChatEventType = "assistant_delta" // text += Delta
	ThinkingDelta  ChatEventType = "thinking_delta"  // reasoning += Delta
	// tool lifecycle within a turn (status-driven, same ID updates a card)
	ToolCallStart   ChatEventType = "tool_call_start"
	ToolCallUpdate  ChatEventType = "tool_call_update"
	ToolCallEnd     ChatEventType = "tool_call_end"
	// session-level
	MessageStart ChatEventType = "message_start" // an agent message began (role known)
	MessageEnd   ChatEventType = "message_end"
	// control / meta
	Usage         ChatEventType = "usage"          // usage update in-flight
	TurnFailed    ChatEventType = "turn_failed"    // agent error / process died
	AskUser       ChatEventType = "ask_user"       // permission UI request
	SystemNotice  ChatEventType = "system_notice"  // e.g. model changed
)

// ChatUsage is the coarse usage shape the GUI shows in the turn footer.
type ChatUsage struct {
	InputTokens         int     `json:"it,omitempty"`
	OutputTokens        int     `json:"ot,omitempty"`
	CacheReadTokens     int     `json:"cr,omitempty"`
	CacheWriteTokens    int     `json:"cw,omitempty"`
	TotalCostUsd        float64 `json:"cost,omitempty"`
	ContextWindowMax    int     `json:"cwmax,omitempty"`
	ContextWindowUsed   int     `json:"cwused,omitempty"`
}

// ChatEvent is the wire type the SSE handler sends to the frontend. It is a flat,
// JSON-friendly union: unknown fields are dropped by the frontend but retained
// here so adapters can carry provider-specific bits if needed.
type ChatEvent struct {
	TurnID    string       `json:"turnId,omitempty"`
	Type      ChatEventType `json:"type"`
	Text      string       `json:"text,omitempty"`          // for *_delta, *message
	Role      string       `json:"role,omitempty"`         // user/assistant/system
	Usage     *ChatUsage    `json:"usage,omitempty"`
	// tool call
	ToolName   string      `json:"toolName,omitempty"`
	ToolStatus string      `json:"toolStatus,omitempty"`   // running/completed/failed
	Detail     string      `json:"detail,omitempty"`       // tool output / partial result
	// error / meta
	Error      string      `json:"error,omitempty"`
	Notice     string      `json:"notice,omitempty"`
	// ask_user permission request
	AskUserID   string                 `json:"askUserId,omitempty"`
	AskUserBody map[string]any          `json:"askUserBody,omitempty"`
}

// Capabilities advertises what the adapter can do. The GUI hides unsupported
// controls (abort button, model picker, etc.).
type Capabilities struct {
	SupportsStreaming bool   `json:"supportsStreaming"`
	SupportsAbort     bool   `json:"supportsAbort"`
	SupportsSetModel  bool   `json:"supportsSetModel"`
	SupportsSetThinking bool `json:"supportsSetThinking"`
	SupportsAskUser   bool   `json:"supportsAskUser"`
	// Stability tag surfaced to the UI ("stable" vs "experimental").
	ProtocolStability string  `json:"protocolStability"`
}
