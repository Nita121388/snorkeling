// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentmcp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// Server speaks MCP over a byte stream (stdio in production, a pipe in tests).
type Server struct {
	Backend Backend
	// Scopes is what the presented token was granted. Empty means app-level
	// (in-app agent), which allows every tool.
	Scopes []string
	// Out receives responses; one JSON object per line.
	Out io.Writer
}

// Serve reads newline-delimited JSON-RPC requests until EOF.
func (s *Server) Serve(ctx context.Context, in io.Reader) error {
	reader := bufio.NewReaderSize(in, 1<<20)
	for {
		line, err := reader.ReadBytes('\n')
		if len(line) > 0 {
			if perr := s.handleLine(ctx, line); perr != nil {
				return perr
			}
		}
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
	}
}

func (s *Server) handleLine(ctx context.Context, line []byte) error {
	trimmed := strings.TrimSpace(string(line))
	if trimmed == "" {
		return nil
	}
	var req Request
	if err := json.Unmarshal([]byte(trimmed), &req); err != nil {
		s.write(errorResponse(nil, ErrCodeParse, "invalid JSON: "+err.Error()))
		return nil
	}
	resp := s.Handle(ctx, &req)
	if resp != nil {
		s.write(resp)
	}
	return nil
}

func (s *Server) write(resp *Response) {
	if s.Out == nil {
		return
	}
	data, err := json.Marshal(resp)
	if err != nil {
		return
	}
	fmt.Fprintf(s.Out, "%s\n", data)
}

// Handle dispatches one request. Notifications (no id) return nil.
func (s *Server) Handle(ctx context.Context, req *Request) *Response {
	if req.JSONRPC != "" && req.JSONRPC != "2.0" {
		if req.IsNotification() {
			return nil
		}
		return errorResponse(req.ID, ErrCodeInvalidRequest, `jsonrpc must be "2.0"`)
	}
	switch req.Method {
	case "initialize":
		return okResponse(req.ID, InitializeResult{
			ProtocolVersion: ProtocolVersion,
			ServerInfo:      ServerInfo{Name: ServerName, Version: ServerVersion},
			Capabilities: ServerCapability{
				Tools:     map[string]any{"listChanged": false},
				Resources: map[string]any{"subscribe": false, "listChanged": false},
			},
		})
	case "notifications/initialized", "initialized":
		return nil // notification, no response
	case "ping":
		return okResponse(req.ID, map[string]any{})
	case "tools/list":
		return okResponse(req.ID, map[string]any{"tools": Tools()})
	case "tools/call":
		return s.handleToolCall(ctx, req)
	case "resources/list":
		return okResponse(req.ID, map[string]any{"resources": resources()})
	case "resources/read":
		return s.handleResourceRead(ctx, req)
	default:
		if req.IsNotification() {
			return nil
		}
		return errorResponse(req.ID, ErrCodeMethodNotFound, "unknown method: "+req.Method)
	}
}

type toolCallParams struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

func (s *Server) handleToolCall(ctx context.Context, req *Request) *Response {
	var params toolCallParams
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return errorResponse(req.ID, ErrCodeInvalidParams, "invalid params: "+err.Error())
		}
	}
	spec, ok := findSpec(params.Name)
	if !ok {
		return errorResponse(req.ID, ErrCodeInvalidParams, "unknown tool: "+params.Name)
	}
	if !scopeAllows(s.Scopes, spec.Scope) {
		// Tool-level scope check mirrors the server-side RPC check so an agent
		// gets a clear message instead of a transport-level failure.
		return okResponse(req.ID, ToolCallResult{
			Content: textContent(fmt.Sprintf("E_FORBIDDEN: tool %q requires scope %q (granted: %s)",
				spec.Name, spec.Scope, describeScopes(s.Scopes))),
			IsError: true,
		})
	}
	result, err := spec.Invoke(ctx, s.Backend, params.Arguments)
	if err != nil {
		return okResponse(req.ID, ToolCallResult{
			Content: textContent(err.Error()),
			IsError: true,
		})
	}
	payload, merr := json.Marshal(result)
	if merr != nil {
		return okResponse(req.ID, ToolCallResult{
			Content: textContent("failed to encode result: " + merr.Error()),
			IsError: true,
		})
	}
	return okResponse(req.ID, ToolCallResult{Content: textContent(string(payload))})
}

func describeScopes(scopes []string) string {
	if len(scopes) == 0 {
		return "app-level"
	}
	return strings.Join(scopes, ",")
}

func findSpec(name string) (toolSpec, bool) {
	for _, s := range toolSpecs() {
		if s.Name == name {
			return s, true
		}
	}
	return toolSpec{}, false
}

// ---- resources ----

func resources() []Resource {
	return []Resource{
		{
			URI:         "snorkeling://state",
			Name:        "UI state snapshot",
			Description: "Backend snapshot of windows/tabs/blocks; read-only, no content bodies.",
			MimeType:    "application/json",
		},
		{
			URI:         "snorkeling://sessions/live",
			Name:        "Live agent sessions",
			Description: "Every running agent session, merged from hooks, the chat registry and the session index.",
			MimeType:    "application/json",
		},
	}
}

type resourceReadParams struct {
	URI string `json:"uri"`
}

func (s *Server) handleResourceRead(ctx context.Context, req *Request) *Response {
	var params resourceReadParams
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return errorResponse(req.ID, ErrCodeInvalidParams, "invalid params: "+err.Error())
		}
	}
	if !scopeAllows(s.Scopes, ScopeObserve) {
		return errorResponse(req.ID, ErrCodeInternal, "E_FORBIDDEN: resources require scope observe")
	}
	var payload any
	var err error
	switch params.URI {
	case "snorkeling://state":
		payload, err = s.Backend.UIState(ctx, uiStateRequest())
	case "snorkeling://sessions/live":
		payload, err = s.Backend.SessionLive(ctx, sessionLiveRequest())
	default:
		return errorResponse(req.ID, ErrCodeInvalidParams, "unknown resource: "+params.URI)
	}
	if err != nil {
		return errorResponse(req.ID, ErrCodeInternal, err.Error())
	}
	data, merr := json.Marshal(payload)
	if merr != nil {
		return errorResponse(req.ID, ErrCodeInternal, merr.Error())
	}
	return okResponse(req.ID, map[string]any{
		"contents": []ResourceContent{{
			URI:      params.URI,
			MimeType: "application/json",
			Text:     string(data),
		}},
	})
}

// small constructors keep the resource handler readable
func uiStateRequest() wshrpc.UIStateRequest { return wshrpc.UIStateRequest{} }

func sessionLiveRequest() wshrpc.SessionLiveRequest {
	return wshrpc.SessionLiveRequest{MaxRows: 200}
}
