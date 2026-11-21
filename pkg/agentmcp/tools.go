// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentmcp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/agentscope"
	"github.com/wavetermdev/waveterm/pkg/scheduler"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// Scope names come from pkg/agentscope so the MCP tool table, the RPC gate and
// the CLI all agree on what a token may do.
const (
	ScopeObserve  = agentscope.Observe
	ScopeNavigate = agentscope.Navigate
	ScopeData     = agentscope.Data
	ScopeLaunch   = agentscope.Launch
)

// Backend is the narrow surface the MCP tools need. It is an interface so the
// protocol can be tested without a running app, and so the CLI and MCP server
// share exactly one implementation.
type Backend interface {
	SessionLive(ctx context.Context, req wshrpc.SessionLiveRequest) (*wshrpc.SessionLiveResult, error)
	SessionGet(ctx context.Context, req wshrpc.SessionGetRequest) (*wshrpc.SessionLiveRecord, error)
	SessionList(ctx context.Context, req wshrpc.SessionListRequest) (*wshrpc.SessionListResult, error)
	SessionInfo(ctx context.Context, req wshrpc.SessionInfoRequest) (*wshrpc.SessionInfoResult, error)
	SessionUsers(ctx context.Context, req wshrpc.SessionUsersRequest) (*wshrpc.SessionUsersResult, error)
	SessionTurns(ctx context.Context, req wshrpc.SessionTurnsRequest) (*wshrpc.SessionTurnsResult, error)
	SessionTurn(ctx context.Context, req wshrpc.SessionTurnRequest) (*wshrpc.SessionTurnResult, error)
	SessionWait(ctx context.Context, req wshrpc.SessionWaitRequest) (*wshrpc.SessionWaitResult, error)
	UIActive(ctx context.Context, req wshrpc.UIActiveRequest) (*wshrpc.UIActiveSnapshot, error)
	UIState(ctx context.Context, req wshrpc.UIStateRequest) (*wshrpc.UIStateSnapshot, error)
	BlockRead(ctx context.Context, req wshrpc.BlockReadRequest) (*wshrpc.BlockReadResult, error)
	BlockOpen(ctx context.Context, req wshrpc.BlockOpenRequest) (*wshrpc.BlockOpenResult, error)
	TabList(ctx context.Context, req wshrpc.TabListRequest) (*wshrpc.TabListResult, error)
	TabCreate(ctx context.Context, req wshrpc.TabCreateRequest) (*wshrpc.TabCreateResult, error)
	TabActivate(ctx context.Context, req wshrpc.TabActivateRequest) (*wshrpc.TabActivateResult, error)
	AgentCardGet(ctx context.Context, req wshrpc.AgentCardGetRequest) (*wshrpc.AgentCardResult, error)
	AgentLaunch(ctx context.Context, req wshrpc.AgentLaunchRequest) (*wshrpc.AgentLaunchResult, error)
	AgentSend(ctx context.Context, req wshrpc.AgentSendRequest) (*wshrpc.AgentSendResult, error)
	AgentResume(ctx context.Context, req wshrpc.AgentResumeRequest) (*wshrpc.AgentResumeResult, error)
	SessionMark(ctx context.Context, req wshrpc.SessionMarkRequest) (*wshrpc.SessionMarkResult, error)
	AgentCardSet(ctx context.Context, req wshrpc.AgentCardSetRequest) (*wshrpc.AgentCardSetResult, error)
	SessionAnnotate(ctx context.Context, req wshrpc.SessionAnnotateRequest) (*wshrpc.SessionAnnotateResult, error)
	SessionEmojiGet(ctx context.Context, req wshrpc.SessionEmojiGetRequest) (*wshrpc.SessionEmojiGetResult, error)
	SessionEmojiSet(ctx context.Context, req wshrpc.SessionEmojiSetRequest) (*wshrpc.SessionEmojiSetResult, error)
	SessionEmojiInject(ctx context.Context, req wshrpc.SessionEmojiInjectRequest) (*wshrpc.SessionEmojiInjectResult, error)
	SessionEmojiRecommendations(ctx context.Context, req wshrpc.SessionEmojiRecommendationsRequest) (*wshrpc.SessionEmojiRecommendationsResult, error)
	SessionEmojiPrefs(ctx context.Context, req wshrpc.SessionEmojiPrefsRequest) (*wshrpc.SessionEmojiPrefsResult, error)
	RecordEmojiPick(ctx context.Context, req wshrpc.SessionEmojiRecordPickRequest) (*wshrpc.SessionEmojiRecordPickResult, error)
	ScheduledTaskList(ctx context.Context) ([]wconfig.ScheduledTaskType, error)
	ScheduledTaskCreate(ctx context.Context, task wconfig.ScheduledTaskType) (wconfig.ScheduledTaskType, error)
	ScheduledTaskRun(ctx context.Context, taskID string) (*wshrpc.ScheduledTaskRunResult, error)
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
				"blockid":  str("block id ('this' resolves to the calling block)"),
				"tail":     num("lines to return for terminal blocks (default 80, max 2000)"),
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
			Name:        "snorkeling_session_info",
			Description: "Layer 0 of reading a session: counts/bytes/verdict (small|medium|large) and a stale flag, with NO content. Call this before users/turns to size the session.",
			Scope:       ScopeObserve,
			Annotations: readOnly("Sessions: size probe"),
			Schema: obj(map[string]any{
				"identifier": str("session key / session id"),
				"refresh":    boolean("re-parse this session's messages first (single file, no full scan)"),
			}, "identifier"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				req, err := decode[wshrpc.SessionInfoRequest](args)
				if err != nil {
					return nil, err
				}
				return be.SessionInfo(ctx, req)
			},
		},
		{
			Name:        "snorkeling_session_users",
			Description: "Layer 1: one page of user prompts (120 chars each, ~2KB). Page backwards with beforeSeq from nextBeforeSeq.",
			Scope:       ScopeObserve,
			Annotations: readOnly("Sessions: user prompts"),
			Schema: obj(map[string]any{
				"identifier": str("session key / session id"),
				"limit":      num("rows per page (default 20, max 100)"),
				"beforeseq":  num("cursor: rows with seq < this (from nextBeforeSeq)"),
				"refresh":    boolean("re-parse this session's messages first (single file, no full scan)"),
			}, "identifier"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				req, err := decode[wshrpc.SessionUsersRequest](args)
				if err != nil {
					return nil, err
				}
				return be.SessionUsers(ctx, req)
			},
		},
		{
			Name:        "snorkeling_session_turns",
			Description: "Layer 2: one page of turn summaries (turn/seq/at/user text/tools/chars/ms, ~3KB). A turn = one user segment plus its replies. 'limit' is REQUIRED (1-10).",
			Scope:       ScopeObserve,
			Annotations: readOnly("Sessions: turns"),
			Schema: obj(map[string]any{
				"identifier": str("session key / session id"),
				"limit":      num("rows per page: REQUIRED, 1-10"),
				"beforeturn": num("cursor: turns with number < this (from nextBeforeTurn)"),
				"refresh":    boolean("re-parse this session's messages first (single file, no full scan)"),
			}, "identifier", "limit"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				req, err := decode[wshrpc.SessionTurnsRequest](args)
				if err != nil {
					return nil, err
				}
				return be.SessionTurns(ctx, req)
			},
		},
		{
			Name:        "snorkeling_session_turn",
			Description: "Layer 3: one turn's original messages under a chars budget (<=8KB), with truncated/totalChars. 'turn' and 'chars' are REQUIRED.",
			Scope:       ScopeObserve,
			Annotations: readOnly("Sessions: one turn"),
			Schema: obj(map[string]any{
				"identifier": str("session key / session id"),
				"turn":       num("turn number (1-based, from session_turns)"),
				"chars":      num("chars budget: REQUIRED, 1-8000"),
				"refresh":    boolean("re-parse this session's messages first (single file, no full scan)"),
			}, "identifier", "turn", "chars"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				req, err := decode[wshrpc.SessionTurnRequest](args)
				if err != nil {
					return nil, err
				}
				return be.SessionTurn(ctx, req)
			},
		},
		{
			Name:        "snorkeling_session_wait",
			Description: "Block until one live session reaches a state (idle|blocked|done|working). Polls the same live merge as session_live. A timeout is matched=false (not an error); an unknown session is E_NOT_FOUND.",
			Scope:       ScopeObserve,
			Annotations: readOnly("Sessions: wait for state"),
			Schema: obj(map[string]any{
				"identifier": str("session key / session id / block id / 'this'"),
				"blockid":    str("block id for 'this' resolution"),
				"until":      str("target state: idle | blocked | done | working (REQUIRED; done = idle)"),
				"timeoutms":  num("wait budget (default 60000, max 300000)"),
				"pollms":     num("poll interval (default 250, range 100-2000)"),
			}, "identifier", "until"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				req, err := decode[wshrpc.SessionWaitRequest](args)
				if err != nil {
					return nil, err
				}
				return be.SessionWait(ctx, req)
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
				"identifier":   str("session key / session id / 'this'"),
				"note":         str("note text"),
				"title":        str("title (refused when user-authored unless force)"),
				"tags":         map[string]any{"type": "object", "description": "{add:[], remove:[], set:[]}"},
				"props":        map[string]any{"type": "object", "description": "key -> {type, value, name, scope: session|agent|all}"},
				"force":        boolean("overwrite user-authored title/props"),
				"expectedhash": str("hash from a fresh agent_card_get (required for a real write)"),
				"dryrun":       boolean("preview without writing (default true)"),
				"yes":          boolean("confirm the write"),
			}, "identifier"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				req, err := decode[wshrpc.AgentCardSetRequest](args)
				if err != nil {
					return nil, err
				}
				return be.AgentCardSet(ctx, req)
			},
		},
		{
			Name:        "snorkeling_session_annotate",
			Description: "Write one AI annotation draft onto a session timeline node. Dry-run unless confirm is true, and a real write requires expectedhash from a fresh session_get. Status defaults to draft; accepted needs force. A repeat write at the same (session, kind, anchor) replaces the previous machine annotation; human-authored or human-edited annotations are never overwritten.",
			Scope:       ScopeData,
			Annotations: &Annotations{Title: "Sessions: annotate", DestructiveHint: true},
			Schema: obj(map[string]any{
				"identifier":   str("session key / session id / 'this'"),
				"anchor":       str("'tail' (last anchorable message) or a message itemKey"),
				"kind":         str("note|milestone|decision|question (default note)"),
				"title":        str("short title"),
				"body":         str("body text (truncated at the storage limit)"),
				"tags":         map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				"status":       str("draft (default) | accepted (needs force)"),
				"force":        boolean("allow status=accepted"),
				"expectedhash": str("card hash from a fresh session_get (required for a real write)"),
				"confirm":      boolean("confirm the write (same as CLI --yes); default false = dry-run"),
				"dryrun":       boolean("force a preview, even with confirm"),
				"aimodel":      str("model that produced this annotation"),
			}, "identifier", "anchor"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				raw, err := decode[sessionAnnotateArgs](args)
				if err != nil {
					return nil, err
				}
				return be.SessionAnnotate(ctx, wshrpc.SessionAnnotateRequest{
					Identifier:   raw.Identifier,
					Anchor:       raw.Anchor,
					Kind:         raw.Kind,
					Title:        raw.Title,
					Body:         raw.Body,
					Tags:         raw.Tags,
					Status:       raw.Status,
					Force:        raw.Force,
					ExpectedHash: raw.ExpectedHash,
					AIModel:      raw.AIModel,
					DryRun:       raw.DryRun,
					Yes:          raw.Confirm,
				})
			},
		},

		{
			Name:        "snorkeling_session_emoji_get",
			Description: "Read one session's backend emoji (ai_session_props prop_key='emoji') plus its source (user|ai) and updatedAt. Empty emoji means the slot was never set.",
			Scope:       ScopeObserve,
			Annotations: &Annotations{Title: "Sessions: emoji get"},
			Schema: obj(map[string]any{
				"identifier": str("session key / session id / 'this'"),
			}, "identifier"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				raw, err := decode[sessionEmojiGetArgs](args)
				if err != nil {
					return nil, err
				}
				return be.SessionEmojiGet(ctx, wshrpc.SessionEmojiGetRequest{Identifier: raw.Identifier})
			},
		},
		{
			Name:        "snorkeling_session_emoji_set",
			Description: "Write one session's emoji through the agent channel (source=ai always). A user-authored value is skipped unless force. if_absent makes an existing slot an idempotent no-op and doubles as the write precondition (no expectedhash needed with it); without if_absent a real write requires expectedhash. Dry-run unless confirm.",
			Scope:       ScopeData,
			Annotations: &Annotations{Title: "Sessions: emoji set", DestructiveHint: true},
			Schema: obj(map[string]any{
				"identifier":   str("session key / session id / 'this'"),
				"emoji":        str("the single emoji grapheme to write"),
				"if_absent":    boolean("skip when the slot already holds a value; doubles as the precondition for confirm"),
				"force":        boolean("overwrite even a user-authored emoji (humans only)"),
				"expectedhash": str("card hash from snorkeling_session_emoji_get / session_get (required for confirm without if_absent)"),
				"confirm":      boolean("confirm the write (default false = dry-run)"),
				"dryrun":       boolean("force a preview, even with confirm"),
			}, "identifier", "emoji"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				raw, err := decode[sessionEmojiSetArgs](args)
				if err != nil {
					return nil, err
				}
				return be.SessionEmojiSet(ctx, wshrpc.SessionEmojiSetRequest{
					Identifier:   raw.Identifier,
					Emoji:        raw.Emoji,
					IfAbsent:     raw.IfAbsent,
					Force:        raw.Force,
					ExpectedHash: raw.ExpectedHash,
					DryRun:       raw.DryRun,
					Yes:          raw.Confirm,
				})
			},
		},
		{
			Name:        "snorkeling_session_emoji_inject",
			Description: "Push live emoji recommendations for one session from the calling agent, replacing any previous injection wholesale (design: all recommendation sources are external; Snorkeling only displays). Each candidate is validated (one invalid rejects the whole injection; capped at 8). Empty candidates clears the recommendation section. ttl_seconds expires the payload (0 = no expiry).",
			Scope:       ScopeData,
			Annotations: &Annotations{Title: "Sessions: emoji inject (external recommendations)", DestructiveHint: true},
			Schema: obj(map[string]any{
				"identifier":  str("session key / session id / 'this'"),
				"injected_by": str("identify the recommending agent (required, e.g. hero:watchdog)"),
				"candidates": map[string]any{
					"type":  "array",
					"items": map[string]any{"type": "object", "properties": map[string]any{"emoji": map[string]any{"type": "string"}, "reason": map[string]any{"type": "string"}}},
				},
				"ttl_seconds": num("expire after N seconds (0 = no expiry)"),
			}, "identifier", "injected_by"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				raw, err := decode[sessionEmojiInjectArgs](args)
				if err != nil {
					return nil, err
				}
				req := wshrpc.SessionEmojiInjectRequest{Identifier: raw.Identifier, InjectedBy: raw.InjectedBy, TTLSeconds: raw.TTLSeconds}
				for _, c := range raw.Candidates {
					req.Candidates = append(req.Candidates, wshrpc.SessionEmojiRecommendation{Emoji: c.Emoji, Reason: c.Reason})
				}
				return be.SessionEmojiInject(ctx, req)
			},
		},
		{
			Name:        "snorkeling_session_emoji_recommendations",
			Description: "Read the current injected recommendation payload for one session. found=false when nothing was injected or the payload expired (the picker then hides the recommendation section). Candidate list is capped at 8.",
			Scope:       ScopeObserve,
			Annotations: &Annotations{Title: "Sessions: emoji recommendations"},
			Schema: obj(map[string]any{
				"identifier": str("session key / session id / 'this'"),
			}, "identifier"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				raw, err := decode[sessionEmojiGetArgs](args)
				if err != nil {
					return nil, err
				}
				return be.SessionEmojiRecommendations(ctx, wshrpc.SessionEmojiRecommendationsRequest{Identifier: raw.Identifier})
			},
		},
		{
			Name:        "snorkeling_session_emoji_prefs",
			Description: "Read the emoji preference buckets (project / persona / global pick counts plus the global pref version) so an external recommender can consult the user's history before injecting.",
			Scope:       ScopeObserve,
			Annotations: &Annotations{Title: "Sessions: emoji prefs"},
			Schema: obj(map[string]any{
				"identifier": str("session key / session id / 'this'"),
			}, "identifier"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				raw, err := decode[sessionEmojiGetArgs](args)
				if err != nil {
					return nil, err
				}
				return be.SessionEmojiPrefs(ctx, wshrpc.SessionEmojiPrefsRequest{Identifier: raw.Identifier})
			},
		},

		{
			Name:        "snorkeling_session_emoji_record_pick",
			Description: "Record one user hand-pick: writes the session emoji prop as source=user and bumps the three preference counters in one transaction (empty emoji = clear, which decrements the counters). Use this for UI-channel picks; for agent-channel writes use snorkeling_session_emoji_set (source=ai, no preference recorded).",
			Scope:       ScopeData,
			Annotations: &Annotations{Title: "Sessions: record emoji pick", DestructiveHint: true},
			Schema: obj(map[string]any{
				"identifier": str("session key / session id / 'this'"),
				"emoji":      str("the picked emoji; empty string = clear"),
			}, "identifier"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				raw, err := decode[sessionEmojiRecordPickArgs](args)
				if err != nil {
					return nil, err
				}
				return be.RecordEmojiPick(ctx, wshrpc.SessionEmojiRecordPickRequest{Identifier: raw.Identifier, Emoji: raw.Emoji})
			},
		},
		{
			Name:        "snorkeling_agent_create",
			Description: "Launch a TUI agent block from the agent catalog (profile + optional model). The block is a normal, visible block in the target tab. Optional message delivers text to the new TUI after it goes quiet.",
			Scope:       ScopeLaunch,
			Annotations: &Annotations{Title: "Agent: create block", DestructiveHint: true},
			Schema: obj(map[string]any{
				"profile":     str("agent profile from the catalog (required)"),
				"model":       str("model id or provider/id (default: profile default)"),
				"tab":         str("active|new|<tabid>"),
				"workspaceid": str("workspace id (only with tab=new)"),
				"split":       str("right|down|left|up"),
				"cwd":         str("block working directory"),
				"magnified":   boolean("open the block magnified"),
				"nofocus":     boolean("do not focus the new block"),
				"wait":        boolean("wait until the frontend applied the layout"),
				"waitms":      num("layout wait budget (default 5000)"),
				"message":     str("text to deliver to the new TUI (bracketed paste + enter)"),
			}, "profile"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				req, err := decode[agentCreateArgs](args)
				if err != nil {
					return nil, err
				}
				launchReq := wshrpc.AgentLaunchRequest{
					Profile:     req.Profile,
					Model:       req.Model,
					Tab:         req.Tab,
					WorkspaceId: req.WorkspaceId,
					Split:       req.Split,
					Cwd:         req.Cwd,
					Magnified:   req.Magnified,
					NoFocus:     req.NoFocus,
					Wait:        req.Wait,
					WaitMs:      req.WaitMs,
				}
				if strings.TrimSpace(req.Message) != "" {
					launchReq.Send = &wshrpc.AgentSendRequest{
						Text64: base64.StdEncoding.EncodeToString([]byte(req.Message)),
					}
				}
				return be.AgentLaunch(ctx, launchReq)
			},
		},
		{
			Name:        "snorkeling_agent_send",
			Description: "Send text to an existing term/agent block: one bracketed paste (multi-line safe) plus a real Enter, after the TUI goes quiet. Check injected/submitted in the result. With waitreply the call blocks until the agent's turn completes and returns replytext/turn (a timeout is replied=false + warnings, not an error).",
			Scope:       ScopeLaunch,
			Annotations: &Annotations{Title: "Agent: send text", DestructiveHint: true},
			Schema: obj(map[string]any{
				"blockid":       str("block id, or 'this' for the calling block"),
				"text":          str("plain text to send (newlines preserved)"),
				"text64":        str("base64 of the text (wins over text)"),
				"submit":        boolean("press Enter after the paste (default true)"),
				"wait":          boolean("wait for the TUI to be quiet first (default true)"),
				"waitms":        num("readiness deadline (default 30000, max 120000)"),
				"quietms":       num("TUI silence window (default 400, range 100-5000)"),
				"submitdelayms": num("paste to enter delay (default 150)"),
				"waitreply":     boolean("wait for the agent's turn to finish and return the reply (mutually exclusive with async/nowait)"),
				"replywaitms":   num("reply wait budget (default 60000, max 300000)"),
				"replychars":    num("reply text budget in characters (default 2000, max 8000)"),
				"replypollms":   num("reply poll interval (default 250, range 100-2000)"),
				"nowait":        boolean("return immediately with replycursor instead of waiting for the reply"),
			}, "blockid"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				req, err := decode[wshrpc.AgentSendRequest](args)
				if err != nil {
					return nil, err
				}
				return be.AgentSend(ctx, req)
			},
		},

		{
			Name:        "snorkeling_agent_resume",
			Description: "Recreate an agent block for an existing session and resume its conversation. The block is a normal visible block whose agent TUI starts with the provider's real resume argument, so history comes back. Only claude/codex/opencode/pi sessions are resumable. Optional send delivers one message after the block exists; a delivery failure never rolls the block back.",
			Scope:       ScopeLaunch,
			Annotations: &Annotations{Title: "Agent: resume session", DestructiveHint: true},
			Schema: obj(map[string]any{
				"identifier":    str("session key / session id / 'this' (from snorkeling_session_live or snorkeling_session_list)"),
				"blockid":       str("block id for 'this' resolution"),
				"tab":           str("active|new|<tabid>"),
				"workspaceid":   str("workspace id (required with tab=new)"),
				"cwd":           str("block working directory (overrides the session project path)"),
				"nofocus":       boolean("do not focus the new block"),
				"wait":          boolean("wait until the frontend applied the layout"),
				"waitms":        num("layout wait budget (default 5000)"),
				"send":          str("text to deliver to the resumed TUI (bracketed paste + enter)"),
				"sendtext64":    str("base64 of the send text (wins over send)"),
				"submit":        boolean("press Enter after the paste (default true)"),
				"sendwait":      boolean("wait for the TUI to be quiet before injecting (default true)"),
				"sendwaitms":    num("delivery readiness deadline (default 30000, max 120000)"),
				"quietms":       num("TUI silence window (default 400, range 100-5000)"),
				"submitdelayms": num("paste to enter delay (default 150)"),
			}, "identifier"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				req, err := decode[wshrpc.AgentResumeRequest](args)
				if err != nil {
					return nil, err
				}
				return be.AgentResume(ctx, req)
			},
		},
		{
			Name:        "snorkeling_session_mark",
			Description: "Star (mark) or unstar one session — the GUI's star, as a boolean view state. Idempotent, last-write-wins, no dry-run or precondition. Verify with snorkeling_session_list (marked filter).",
			Scope:       ScopeData,
			Annotations: &Annotations{Title: "Sessions: mark", IdempotentHint: true},
			Schema: obj(map[string]any{
				"identifier": str("session key / session id / 'this'"),
				"blockid":    str("block id for 'this' resolution"),
				"marked":     boolean("true = star, false = unstar"),
			}, "identifier", "marked"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				req, err := decode[wshrpc.SessionMarkRequest](args)
				if err != nil {
					return nil, err
				}
				return be.SessionMark(ctx, req)
			},
		},

		{
			Name:        "snorkeling_scheduledtask_list",
			Description: "List scheduled tasks, each with id/name/schedule/mode/enabled/createdBy/lastRunStatus. Same data as the Scheduled Tasks settings panel.",
			Scope:       ScopeObserve,
			Annotations: readOnly("Scheduled tasks: list"),
			Schema: obj(map[string]any{
				"createdby": str("filter rows by creator: agent | user"),
			}),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				var filter struct {
					CreatedBy string `json:"createdby"`
				}
				if len(args) > 0 {
					if err := json.Unmarshal(args, &filter); err != nil {
						return nil, fmt.Errorf("invalid arguments: %w", err)
					}
				}
				items, err := be.ScheduledTaskList(ctx)
				if err != nil {
					return nil, err
				}
				if filter.CreatedBy != "" {
					filtered := items[:0]
					for _, t := range items {
						if t.CreatedBy == filter.CreatedBy {
							filtered = append(filtered, t)
						}
					}
					items = filtered
				}
				return items, nil
			},
		},
		{
			Name:        "snorkeling_scheduledtask_create",
			Description: "Create a scheduled task that fires an agent on a schedule. Dry-run unless yes=true. External agents are limited to 10 tasks (E_QUOTA). schedule supports cron:<expr> / every:<n>s|m|h / once@<RFC3339> / daily@HH:MM / weekly@<0-6>@HH:MM. mode=headless runs the agent CLI once into a log; mode=block creates a visible agent block in tab (current|new|<tabid>) and delivers the prompt to its TUI.",
			Scope:       ScopeData,
			Annotations: &Annotations{Title: "Scheduled tasks: create", DestructiveHint: true},
			Schema: obj(map[string]any{
				"name":     str("task name (required)"),
				"prompt":   str("prompt delivered to the agent (required)"),
				"schedule": str("cron:<expr> | every:<n>s|m|h | once@<ISO> | daily@HH:MM | weekly@<0-6>@HH:MM (required)"),
				"mode":     str("headless (default) | block"),
				"agent":    str("agent profile from the catalog (default pi)"),
				"model":    str("model id or provider/id (default: profile default)"),
				"workdir":  str("working directory for the run / block"),
				"tab":      str("current | new | <tabid> (block mode only)"),
				"dryrun":   boolean("force a preview even with yes (default true)"),
				"yes":      boolean("commit the write; default false = dry-run"),
			}, "name", "prompt", "schedule"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				raw, err := decode[scheduledTaskCreateArgs](args)
				if err != nil {
					return nil, err
				}
				if !raw.Yes || raw.DryRun {
					return map[string]any{"dryrun": true, "task": raw.summary()}, nil
				}
				sc, err := scheduler.ParseScheduleSpec(raw.Schedule)
				if err != nil {
					return nil, err
				}
				now := time.Now().UTC().Format(time.RFC3339)
				task := wconfig.ScheduledTaskType{
					Id:           uuid.NewString(),
					Name:         raw.Name,
					Enabled:      true,
					AgentProfile: raw.Agent,
					Model:        raw.Model,
					Prompt:       raw.Prompt,
					Workdir:      raw.Workdir,
					Mode:         raw.Mode,
					Tab:          raw.Tab,
					Schedule:     sc,
					CreatedAt:    now,
					UpdatedAt:    now,
				}
				return be.ScheduledTaskCreate(ctx, task)
			},
		},
		{
			Name:        "snorkeling_scheduledtask_run",
			Description: "Run a scheduled task now and wait for it to finish, returning status/exitCode/durationMs/outputPath (headless log under ~/.snorkeling/scheduledtask-runs/). Use it to verify a task before it goes live; block-mode runs create the agent block and deliver the prompt.",
			Scope:       ScopeLaunch,
			Annotations: &Annotations{Title: "Scheduled tasks: run now", DestructiveHint: true},
			Schema: obj(map[string]any{
				"taskid": str("task id from snorkeling_scheduledtask_list"),
			}, "taskid"),
			Invoke: func(ctx context.Context, be Backend, args json.RawMessage) (any, error) {
				var raw struct {
					TaskID string `json:"taskid"`
				}
				if len(args) > 0 {
					if err := json.Unmarshal(args, &raw); err != nil {
						return nil, fmt.Errorf("invalid arguments: %w", err)
					}
				}
				if strings.TrimSpace(raw.TaskID) == "" {
					return nil, fmt.Errorf("E_USAGE: taskid is required")
				}
				res, err := be.ScheduledTaskRun(ctx, raw.TaskID)
				if err != nil {
					return nil, err
				}
				if res != nil && len(res.Output) > 8192 {
					res.Output = res.Output[:8192] + "...(truncated)"
				}
				return res, nil
			},
		},
	}
}

// scheduledTaskCreateArgs is snorkeling_scheduledtask_create's wire shape.
// summary() renders the dry-run preview (the task the tool WOULD create).
type scheduledTaskCreateArgs struct {
	Name     string `json:"name"`
	Prompt   string `json:"prompt"`
	Schedule string `json:"schedule"`
	Mode     string `json:"mode"`
	Agent    string `json:"agent"`
	Model    string `json:"model"`
	Workdir  string `json:"workdir"`
	Tab      string `json:"tab"`
	DryRun   bool   `json:"dryrun"`
	Yes      bool   `json:"yes"`
}

func (a scheduledTaskCreateArgs) summary() map[string]any {
	return map[string]any{
		"name":     a.Name,
		"prompt":   a.Prompt,
		"schedule": a.Schedule,
		"mode":     a.Mode,
		"agent":    a.Agent,
		"model":    a.Model,
		"workdir":  a.Workdir,
		"tab":      a.Tab,
	}
}

// agentCreateArgs is snorkeling_agent_create's wire shape: identical to
// AgentLaunchRequest except the message parameter, which is expanded into the
// embedded send request before reaching the backend.
type agentCreateArgs struct {
	Profile     string `json:"profile"`
	Model       string `json:"model,omitempty"`
	Tab         string `json:"tab,omitempty"`
	WorkspaceId string `json:"workspaceid,omitempty"`
	Split       string `json:"split,omitempty"`
	Cwd         string `json:"cwd,omitempty"`
	Magnified   bool   `json:"magnified,omitempty"`
	NoFocus     bool   `json:"nofocus,omitempty"`
	Wait        bool   `json:"wait,omitempty"`
	WaitMs      int    `json:"waitms,omitempty"`
	Message     string `json:"message,omitempty"`
}

type sessionEmojiRecordPickArgs struct {
	Identifier string `json:"identifier"`
	Emoji      string `json:"emoji"`
}

// sessionEmojiGetArgs is the shared read-side shape for the emoji tools.
type sessionEmojiGetArgs struct {
	Identifier string `json:"identifier"`
}

type sessionEmojiSetArgs struct {
	Identifier   string `json:"identifier"`
	Emoji        string `json:"emoji"`
	IfAbsent     bool   `json:"if_absent"`
	Force        bool   `json:"force"`
	ExpectedHash string `json:"expectedhash"`
	DryRun       bool   `json:"dryrun"`
	Confirm      bool   `json:"confirm"`
}

type sessionEmojiInjectArgs struct {
	Identifier string `json:"identifier"`
	InjectedBy string `json:"injected_by"`
	TTLSeconds int64  `json:"ttl_seconds"`
	Candidates []struct {
		Emoji  string `json:"emoji"`
		Reason string `json:"reason"`
	} `json:"candidates"`
}

// sessionAnnotateArgs is the MCP-side shape. `confirm` is the tool-facing name
// for the CLI's --yes: it is the only naming difference between the surfaces.
type sessionAnnotateArgs struct {
	Identifier   string   `json:"identifier"`
	Anchor       string   `json:"anchor"`
	Kind         string   `json:"kind"`
	Title        string   `json:"title"`
	Body         string   `json:"body"`
	Tags         []string `json:"tags"`
	Status       string   `json:"status"`
	Force        bool     `json:"force"`
	ExpectedHash string   `json:"expectedhash"`
	AIModel      string   `json:"aimodel"`
	DryRun       bool     `json:"dryrun"`
	Confirm      bool     `json:"confirm"`
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
