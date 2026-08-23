// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessionsservice

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/wavetermdev/waveterm/pkg/aisessions/chat"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

// chatManager is the app-wide registry of live GUI chat sessions. It lives at
// package scope so both the SSE handler and the service control methods
// (ChatAbort / ChatClose) share one manager.
var chatManager = chat.NewManager()

// ChatImage is one base64-encoded image attachment (pi ImageContent shape).
type ChatImage struct {
	Data     string `json:"data"`     // base64-encoded bytes
	MimeType string `json:"mimeType"` // e.g. image/png
}

// ChatCommand is one allowlisted agent control call (model/thinking/compaction/
// command discovery). Executed instead of a prompt when set.
type ChatCommand struct {
	Name string         `json:"name"`           // e.g. get_commands, set_model, compact
	Args map[string]any `json:"args,omitempty"` // e.g. {"provider":"anthropic","modelId":"..."}
}

// AISessionsChatRequest is the POST body for the streaming chat endpoint.
// SessionID is optional: omit it to create a new chat session; pi will assign
// a session UUID accessible via the session_state snapshot event.
type AISessionsChatRequest struct {
	Source       string       `json:"source"`                 // "pi" (others TBD)
	SessionID    string       `json:"sessionId,omitempty"`    // existing session uuid to resume; omit for new
	ProjectPath  string       `json:"projectPath,omitempty"`  // cwd
	Provider     string       `json:"provider,omitempty"`     // model provider
	Model        string       `json:"model,omitempty"`        // model id
	SessionDir   string       `json:"sessionDir,omitempty"`   // override (tests/isolated)
	Message      string       `json:"message,omitempty"`      // user text; empty = attach/command only
	Images       []ChatImage  `json:"images,omitempty"`       // inline image attachments for Message
	StreamingBehavior string  `json:"streamingBehavior,omitempty"` // steer/followUp when a turn is running
	NoExtensions bool         `json:"noExtensions,omitempty"` // suppress agent extensions
	Command      *ChatCommand `json:"command,omitempty"`      // control call (no prompt)
}

// chatProviderForSource maps a session source to its chat provider. Only local
// sources can be driven from the GUI today.
func chatProviderForSource(source string) (chat.Provider, error) {
	switch source {
	case chat.SourcePi:
		return chat.NewPiAdapter(), nil
	default:
		return nil, fmt.Errorf("chat not supported for source %q (only pi today)", source)
	}
}

// AISessionsChatStreamHandler implements POST /api/aisessions-chat (SSE).
//
// One POST = attach to (or spawn) one chat session and optionally start one
// turn. The response streams ChatEvents as SSE `data:` lines until the turn
// ends, the process exits, or the client disconnects. The session itself stays
// alive in chatManager between requests, so follow-up prompts are cheap.
//
// On client disconnect mid-turn the running turn is aborted so the agent is
// never left doing orphaned work after the GUI view closed.
func AISessionsChatStreamHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req AISessionsChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
		return
	}
	if req.Source == "" {
		http.Error(w, "source is required", http.StatusBadRequest)
		return
	}
	provider, err := chatProviderForSource(req.Source)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	sseHandler := sse.MakeSSEHandlerCh(w, r.Context())
	defer sseHandler.Close()
	if err := sseHandler.SetupSSE(); err != nil {
		return
	}

	opts := chat.StartOptions{
		SessionID:    req.SessionID,
		ProjectPath:  req.ProjectPath,
		Provider:     req.Provider,
		Model:        req.Model,
		SessionDir:   req.SessionDir,
		NoExtensions: req.NoExtensions,
	}
	session, isNew, err := chatManager.Ensure(r.Context(), provider, opts)
	if err != nil {
		_ = sseHandler.WriteError(fmt.Sprintf("chat session start failed: %v", err))
		return
	}
	if isNew {
		svrDebugf("chat session spawned: source=%q session=%q", req.Source, req.SessionID)
	}

	// Emit a session snapshot so the frontend can prime the header without
	// waiting for the first turn.
	if st, err := session.GetState(r.Context()); err == nil {
		_ = sseHandler.WriteJsonData(map[string]any{"type": "session_state", "state": st})
	}

	if req.Command != nil {
		data, err := session.Control(r.Context(), req.Command.Name, req.Command.Args)
		result := map[string]any{"type": "command_result", "command": req.Command.Name}
		if err != nil {
			result["error"] = err.Error()
		} else {
			result["data"] = data
			// Model/thinking changes are reflected in a fresh state snapshot.
			if req.Command.Name == "set_model" || req.Command.Name == "set_thinking_level" {
				if st, err := session.GetState(r.Context()); err == nil {
					_ = sseHandler.WriteJsonData(map[string]any{"type": "session_state", "state": st})
				}
			}
		}
		_ = sseHandler.WriteJsonData(result)
		return
	}

	if req.Message == "" {
		// Attach-only: snapshot emitted, stream ends. The GUI keeps the session
		// alive for a later prompt via another POST.
		return
	}

	// Wire mapped ChatEvents to the SSE stream.
	turnDone := make(chan struct{})
	unsub := session.OnEvent(func(evt chat.ChatEvent) {
		if evt.Type == chat.TurnEnd || evt.Type == chat.TurnFailed {
			select {
			case <-turnDone:
			default:
				close(turnDone)
			}
		}
		_ = sseHandler.WriteJsonData(evt)
	})
	defer unsub()

	promptOpts := chat.PromptOptions{Message: req.Message, StreamingBehavior: req.StreamingBehavior}
	for _, img := range req.Images {
		promptOpts.Images = append(promptOpts.Images, chat.ImageContent{Type: "image", Data: img.Data, MimeType: img.MimeType})
	}
	if err := session.PromptWithOptions(r.Context(), promptOpts); err != nil {
		_ = sseHandler.WriteError(fmt.Sprintf("prompt rejected: %v", err))
		return
	}

	select {
	case <-turnDone:
	case <-r.Context().Done():
		// Client vanished mid-turn; stop the agent so it doesn't keep working.
		_ = session.Abort(r.Context())
	}
}

// svrDebugf mirrors aiSessionsDebugf (kept local to the chat file to avoid
// touching the browsing service file in this experimental branch).
func svrDebugf(format string, args ...any) {
	log.Printf("[aisessions-chat] "+format, args...)
}
