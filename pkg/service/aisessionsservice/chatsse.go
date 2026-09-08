// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessionsservice

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/aisessions/chat"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

// chatManager is the app-wide registry of live GUI chat sessions. It lives at
// package scope so both the SSE handler and the service control methods
// (ChatAbort / ChatClose) share one manager.
var chatManager = chat.NewManager()

// modelsCacheTTL bounds the process-level cache of get_available_models
// results. The model registry is near-static (pi config/auth), so re-spawning
// a pi subprocess (seconds of startup) just to list models is wasted latency.
const modelsCacheTTL = 10 * time.Minute

type modelsCacheEntry struct {
	data      any
	fetchedAt time.Time
}

var modelsCache = struct {
	sync.Mutex
	bySource map[string]modelsCacheEntry
}{bySource: map[string]modelsCacheEntry{}}

func getCachedModels(source string) (any, bool) {
	modelsCache.Lock()
	defer modelsCache.Unlock()
	entry, ok := modelsCache.bySource[source]
	if !ok || time.Since(entry.fetchedAt) > modelsCacheTTL {
		return nil, false
	}
	return entry.data, true
}

func putCachedModels(source string, data any) {
	modelsCache.Lock()
	defer modelsCache.Unlock()
	modelsCache.bySource[source] = modelsCacheEntry{data: data, fetchedAt: time.Now()}
}

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
	Source            string       `json:"source"`                      // "pi" (others TBD)
	SessionID         string       `json:"sessionId,omitempty"`         // existing session uuid to resume; omit for new
	ProjectPath       string       `json:"projectPath,omitempty"`       // cwd
	Provider          string       `json:"provider,omitempty"`          // model provider
	Model             string       `json:"model,omitempty"`             // model id
	SessionDir        string       `json:"sessionDir,omitempty"`        // override (tests/isolated)
	Message           string       `json:"message,omitempty"`           // user text; empty = attach/command only
	Images            []ChatImage  `json:"images,omitempty"`            // inline image attachments for Message
	StreamingBehavior string       `json:"streamingBehavior,omitempty"` // steer/followUp when a turn is running
	NoExtensions      bool         `json:"noExtensions,omitempty"`      // suppress agent extensions
	Command           *ChatCommand `json:"command,omitempty"`           // control call (no prompt)
}

type aiSessionsChatSourcesResponse struct {
	Sources []chat.ProviderDescriptor `json:"sources"`
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
	if r.Method == http.MethodGet {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(aiSessionsChatSourcesResponse{Sources: chat.AvailableProviders()})
		return
	}
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
	provider, err := chat.ProviderForSource(req.Source)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	sseHandler := sse.MakeSSEHandlerCh(w, r.Context())
	defer sseHandler.Close()
	if err := sseHandler.SetupSSE(); err != nil {
		return
	}

	// The GUI may pass shell-style abbreviated paths ("~/proj"); Go's exec
	// does not expand ~, so chdir would fail with "no such file or directory".
	projectPath := wavebase.ExpandHomeDirSafe(req.ProjectPath)
	sessionDir := wavebase.ExpandHomeDirSafe(req.SessionDir)
	// Serve the model list from the process cache when warm — a cache hit
	// skips Ensure() entirely, so no pi subprocess is spawned for this request.
	if req.Command != nil && req.Command.Name == "get_available_models" {
		if data, ok := getCachedModels(req.Source); ok {
			_ = sseHandler.WriteJsonData(map[string]any{"type": "command_result", "command": req.Command.Name, "data": data})
			return
		}
	}

	opts := chat.StartOptions{
		SessionID:    req.SessionID,
		ProjectPath:  projectPath,
		Provider:     req.Provider,
		Model:        req.Model,
		SessionDir:   sessionDir,
		NoExtensions: req.NoExtensions,
	}
	session, isNew, sessionKey, err := chatManager.Ensure(r.Context(), provider, opts)
	if err != nil {
		_ = sseHandler.WriteError(fmt.Sprintf("chat session start failed: %v", err))
		return
	}
	if isNew {
		svrDebugf("chat session spawned: source=%q session=%q key=%q", req.Source, req.SessionID, sessionKey)
	}

	// Emit a session snapshot so the frontend can prime the header without
	// waiting for the first turn.
	var state *chat.SessionStateInfo
	if st, err := session.GetState(r.Context()); err == nil {
		state = st
		_ = sseHandler.WriteJsonData(map[string]any{"type": "session_state", "state": st})
		// If pi assigned a real session ID, promote the session from its transient key
		// so subsequent requests with the real ID can find it.
		if st.SessionID != "" && req.SessionID == "" {
			chatManager.PromoteSession(req.Source, sessionKey, st.SessionID, session)
		}
	}
	registerLiveChatSession(req, state, projectPath)

	if req.Command != nil {
		data, err := session.Control(r.Context(), req.Command.Name, req.Command.Args)
		result := map[string]any{"type": "command_result", "command": req.Command.Name}
		if err != nil {
			result["error"] = err.Error()
		} else {
			result["data"] = data
			if req.Command.Name == "get_available_models" {
				putCachedModels(req.Source, data)
			}
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
	var endType chat.ChatEventType
	unsub := session.OnEvent(func(evt chat.ChatEvent) {
		if evt.Type == chat.TurnEnd || evt.Type == chat.TurnFailed {
			endType = evt.Type
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
		// Normal turn end: confirm the transcript was flushed to disk before
		// handing control back to the GUI, then emit a terminal turn_persisted
		// event so the frontend can swap the streaming view for the persisted
		// one without polling. Failures skip the wait (file state uncertain).
		if endType == chat.TurnEnd {
			persistCtx, cancel := context.WithTimeout(context.Background(), chat.DefaultPersistTimeout)
			persisted := session.WaitPersisted(persistCtx, chat.DefaultPersistTimeout)
			cancel()
			_ = sseHandler.WriteJsonData(chat.ChatEvent{Type: chat.TurnPersisted, Persisted: persisted})
			if st, err := session.GetState(context.Background()); err == nil {
				_ = sseHandler.WriteJsonData(map[string]any{"type": "session_state", "state": st})
			}
		}
	case <-r.Context().Done():
		// Client vanished mid-turn; stop the agent so it doesn't keep working.
		_ = session.Abort(r.Context())
	}
}

// registerLiveChatSession records the freshly spawned chat session in the
// aisessions live registry so Summary/Detail resolve it even before the
// agent flushes its transcript file (pi defers file creation until the first
// assistant message). The title is seeded from the first prompt line, which
// is also what the scan-based title derivation would produce later.
func registerLiveChatSession(req AISessionsChatRequest, state *chat.SessionStateInfo, projectPath string) {
	if state == nil || state.SessionID == "" || req.Source == "" {
		return
	}
	nowMS := time.Now().UnixMilli()
	filePath := strings.TrimSpace(state.SessionFile)
	if filePath != "" && !filepath.IsAbs(filePath) && projectPath != "" {
		filePath = filepath.Join(projectPath, filePath)
	}
	summary := aisessions.SessionSummary{
		Source:      req.Source,
		ID:          state.SessionID,
		Title:       provisionalChatTitle(req.Message),
		TitleSource: "live",
		ProjectPath: projectPath,
		CreatedAt:   nowMS,
		UpdatedAt:   nowMS,
		FilePath:    filePath,
	}
	summary.Key = aisessions.StableKey(summary.Source, summary.ID, summary.FilePath)
	aisessions.RegisterLiveSession(summary)
}

// provisionalChatTitle derives the provisional session title from the user's
// prompt: first non-empty line, whitespace-normalized, bounded to 60 chars
// (same shape as the scan-based first_user_message title).
func provisionalChatTitle(message string) string {
	for _, line := range strings.Split(message, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		normalized := strings.Join(strings.Fields(trimmed), " ")
		if len(normalized) > 60 {
			normalized = normalized[:60]
		}
		return normalized
	}
	return ""
}

// svrDebugf mirrors aiSessionsDebugf (kept local to the chat file to avoid
// touching the browsing service file in this experimental branch).
func svrDebugf(format string, args ...any) {
	log.Printf("[aisessions-chat] "+format, args...)
}
