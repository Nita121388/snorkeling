// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentmcp

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/agentscope"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// Scope names come from pkg/agentscope so the MCP tool table, the RPC gate and
// the CLI all agree on what a token may do.
const (
	ScopeObserve  = agentscope.Observe
	ScopeNavigate = agentscope.Navigate
	ScopeData     = agentscope.Data
)

// Backend is the narrow surface the MCP tools need. It is an interface so the
// protocol can be tested without a running app, and so the CLI and MCP server
// share exactly one implementation.
type Backend interface {
	SessionLive(ctx context.Context, req wshrpc.SessionLiveRequest) (*wshrpc.SessionLiveResult, error)
	SessionGet(ctx context.Context, req wshrpc.SessionGetRequest) (*wshrpc.SessionLiveRecord, error)
	SessionList(ctx context.Context, req wshrpc.SessionListRequest) (*wshrpc.SessionListResult, error)
	UIActive(ctx context.Context, req wshrpc.UIActiveRequest) (*wshrpc.UIActiveSnapshot, error)
	UIState(ctx context.Context, req wshrpc.UIStateRequest) (*wshrpc.UIStateSnapshot, error)
	BlockRead(ctx context.Context, req wshrpc.BlockReadRequest) (*wshrpc.BlockReadResult, error)
	BlockOpen(ctx context.Context, req wshrpc.BlockOpenRequest) (*wshrpc.BlockOpenResult, error)
	TabList(ctx context.Context, req wshrpc.TabListRequest) (*wshrpc.TabListResult, error)
	TabCreate(ctx context.Context, req wshrpc.TabCreateRequest) (*wshrpc.TabCreateResult, error)
	TabActivate(ctx context.Context, req wshrpc.TabActivateRequest) (*wshrpc.TabActivateResult, error)
	AgentCardGet(ctx context.Context, req wshrpc.AgentCardGetRequest) (*wshrpc.AgentCardResult, error)
	AgentCardSet(ctx context.Context, req wshrpc.AgentCardSetRequest) (*wshrpc.AgentCardSetResult, error)
}

// toolSpec binds one MCP tool to one Backend call.
type toolSpec struct {
	Name        string
	Description string
	Scope       string
	Annotations *Annotations
	Schema      map[string]any
	// Invoke decodes the raw arguments and calls the backend.
	Invoke func(ctx context.Context, be Backend, args json.RawMessage) (any, error)
}

func decode[T any](args json.RawMessage) (T, error) {
	var v T
	if len(args) == 0 {
		return v, nil
	}
	if err := json.Unmarshal(args, &v); err != nil {
		return v, fmt.Errorf("invalid arguments: %w", err)
	}
	return v, nil
}

// obj builds a JSON Schema object. required may be nil.
func obj(props map[string]any, required ...string) map[string]any {
	schema := map[string]any{"type": "object", "properties": props}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

func str(desc string) map[string]any {
	return map[string]any{"type": "string", "description": desc}
}

func num(desc string) map[string]any {
	return map[string]any{"type": "integer", "description": desc}
}

func boolean(desc string) map[string]any {
	return map[string]any{"type": "boolean", "description": desc}
}

func readOnly(title string) *Annotations {
	return &Annotations{Title: title, ReadOnlyHint: true}
}

// toolSpecs is the single source of truth for the v1 tool set. Adding a tool
// means adding an entry here plus a Backend method — never a second
// implementation of the capability.
func toolSpecs() []toolSpec {
	return []toolSpec{
		{
			Name:        "snorkeling_ui_active",
			Description: "Where the agent stands (self) versus where the user is looking (active). Cheap (<2KB), call it before acting on 'the current block'.",
			Scope:       ScopeObserve,
			Annotations: readOnly("UI: active location"),
			Schema:      obj(map[string]any{}),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				req, err := decode[wshrpc.UIActiveRequest](args)
				if err != nil {
					return nil, err
				}
				return be.UIActive(ctx, req)
			},
		},
		{
			Name:        "snorkeling_ui_state",
			Description: "Backend snapshot of windows/tabs/blocks with per-block runtime and agent state. Block meta is allowlisted (credentials stripped).",
			Scope:       ScopeObserve,
			Annotations: readOnly("UI: state snapshot"),
			Schema: obj(map[string]any{
				"windowid":    str("limit to a window"),
				"workspaceid": str("limit to a workspace"),
			}),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				req, err := decode[wshrpc.UIStateRequest](args)
				if err != nil {
					return nil, err
				}
				return be.UIState(ctx, req)
			},
		},
		{
			Name:        "snorkeling_block_read",
			Description: "Bounded content of one block, dispatched by view (term lines / file content / url / agent session). Unreadable is a warning, not an error.",
			Scope:       ScopeObserve,
			Annotations: readOnly("Block: read"),
			Schema: obj(map[string]any{
				"blockid": str("block id ('this' resolves to the calling block)"),
				"tail":    num("lines to return for terminal blocks (default 80, max 2000)"),
				"maxbytes": num("content byte cap (default 65536)"),
			}, "blockid"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				req, err := decode[wshrpc.BlockReadRequest](args)
				if err != nil {
					return nil, err
				}
				return be.BlockRead(ctx, req)
			},
		},
		{
			Name:        "snorkeling_tab_list",
			Description: "Tabs of a workspace, marking the active one.",
			Scope:       ScopeObserve,
			Annotations: readOnly("Tabs: list"),
			Schema: obj(map[string]any{
				"workspaceid": str("workspace id (default: current)"),
			}),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				req, err := decode[wshrpc.TabListRequest](args)
				if err != nil {
					return nil, err
				}
				return be.TabList(ctx, req)
			},
		},
		{
			Name:        "snorkeling_session_live",
			Description: "Every live agent session (TUI + GUI chat) merged from agentstatus, the chat registry and the session index.",
			Scope:       ScopeObserve,
			Annotations: readOnly("Sessions: live"),
			Schema: obj(map[string]any{
				"includeidle": boolean("include idle rows"),
				"maxrows":     num("maximum rows"),
			}),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				req, err := decode[wshrpc.SessionLiveRequest](args)
				if err != nil {
					return nil, err
				}
				return be.SessionLive(ctx, req)
			},
		},
		{
			Name:        "snorkeling_session_get",
			Description: "One session record (live state + card summary). 'this' resolves from the calling block.",
			Scope:       ScopeObserve,
			Annotations: readOnly("Sessions: get"),
			Schema: obj(map[string]any{
				"identifier": str("session key / session id / 'this'"),
				"blockid":    str("block id for 'this' resolution"),
			}, "identifier"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				req, err := decode[wshrpc.SessionGetRequest](args)
				if err != nil {
					return nil, err
				}
				return be.SessionGet(ctx, req)
			},
		},
		{
			Name:        "snorkeling_session_list",
			Description: "Indexed (not necessarily live) sessions with filters.",
			Scope:       ScopeObserve,
			Annotations: readOnly("Sessions: list"),
			Schema: obj(map[string]any{
				"source":  str("pi|codex|claude|opencode|gemini"),
				"query":   str("free-text query"),
				"tag":     str("tag filter"),
				"project": str("project path prefix"),
				"limit":   num("maximum rows"),
			}),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				req, err := decode[wshrpc.SessionListRequest](args)
				if err != nil {
					return nil, err
				}
				return be.SessionList(ctx, req)
			},
		},
		{
			Name:        "snorkeling_agent_card_get",
			Description: "Session card: title, note, tags, props and the hash needed to write it back.",
			Scope:       ScopeObserve,
			Annotations: readOnly("Card: get"),
			Schema: obj(map[string]any{
				"identifier": str("session key / session id / 'this'"),
				"blockid":    str("block id for 'this' resolution"),
			}, "identifier"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				req, err := decode[wshrpc.AgentCardGetRequest](args)
				if err != nil {
					return nil, err
				}
				return be.AgentCardGet(ctx, req)
			},
		},
		{
			Name:        "snorkeling_block_open",
			Description: "Open a block through the same path as the UI. Check syncState: layout-queued means written but NOT yet on screen.",
			Scope:       ScopeNavigate,
			Annotations: &Annotations{Title: "Block: open", DestructiveHint: true},
			Schema: obj(map[string]any{
				"view":      str("term|web|preview|edit|agent"),
				"tab":       str("active|new|<tabid>"),
				"split":     str("right|down|left|up (mutually exclusive with replace)"),
				"replace":   str("block id to replace"),
				"magnified": boolean("open magnified"),
				"nofocus":   boolean("do not focus the new block"),
				"wait":      boolean("wait until the frontend applies it"),
				"waitms":    num("wait budget (default 5000)"),
				"dedupe":    boolean("return an identical open block instead of a second one"),
				"meta":      map[string]any{"type": "object", "description": "extra block meta (view/file/url/connection)"},
			}, "view"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				req, err := decode[wshrpc.BlockOpenRequest](args)
				if err != nil {
					return nil, err
				}
				return be.BlockOpen(ctx, req)
			},
		},
		{
			Name:        "snorkeling_tab_create",
			Description: "Create a tab; --wait polls backend truth (Workspace.ActiveTabId), never a frontend claim.",
			Scope:       ScopeNavigate,
			Annotations: &Annotations{Title: "Tabs: create"},
			Schema: obj(map[string]any{
				"workspaceid": str("workspace id (default: current)"),
				"name":        str("tab name"),
				"activate":    boolean("activate the new tab"),
				"wait":        boolean("wait for backend activation"),
			}),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				req, err := decode[wshrpc.TabCreateRequest](args)
				if err != nil {
					return nil, err
				}
				return be.TabCreate(ctx, req)
			},
		},
		{
			Name:        "snorkeling_tab_activate",
			Description: "Activate a tab and verify against backend truth.",
			Scope:       ScopeNavigate,
			Annotations: &Annotations{Title: "Tabs: activate", IdempotentHint: true},
			Schema: obj(map[string]any{
				"tabid":  str("tab id"),
				"wait":   boolean("wait for backend activation"),
				"waitms": num("wait budget (default 1500)"),
			}, "tabid"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				req, err := decode[wshrpc.TabActivateRequest](args)
				if err != nil {
					return nil, err
				}
				return be.TabActivate(ctx, req)
			},
		},
		{
			Name:        "snorkeling_agent_card_set",
			Description: "Write the session card. Dry-run unless confirm is true, and a real write requires expectedhash from a fresh get. User-authored titles are protected. Property scope: session (default) / agent (all sessions of this agent) / all (global template).",
			Scope:       ScopeData,
			Annotations: &Annotations{Title: "Card: write", DestructiveHint: true},
			Schema: obj(map[string]any{
				"identifier":     str("session key / session id / 'this'"),
				"note":           str("note text"),
				"title":          str("title (refused when user-authored unless force)"),
				"tags":           map[string]any{"type": "object", "description": "{add:[], remove:[], set:[]}"},
				"props":          map[string]any{"type": "object", "description": "key -> {type, value, name, scope: session|agent|all}"},
				"force":          boolean("overwrite user-authored title/props"),
				"expectedhash":   str("hash from a fresh agent_card_get (required for a real write)"),
				"dryrun":         boolean("preview without writing (default true)"),
				"yes":            boolean("confirm the write"),
			}, "identifier"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				req, err := decode[wshrpc.AgentCardSetRequest](args)
				if err != nil {
					return nil, err
				}
				return be.AgentCardSet(ctx, req)
			},
		},
	}
}

// Tools returns the tool list advertised by `tools/list`.
func Tools() []Tool {
	specs := toolSpecs()
	out := make([]Tool, 0, len(specs))
	for _, s := range specs {
		out = append(out, Tool{
			Name:        s.Name,
			Description: s.Description,
			InputSchema: s.Schema,
			Annotations: s.Annotations,
		})
	}
	return out
}

// scopeAllows delegates to the shared rule so MCP and the transport cannot
// disagree about what a scope grants.
func scopeAllows(granted []string, required string) bool {
	return agentscope.Allows(granted, required)
}
