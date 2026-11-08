// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentmcp

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentscope"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// fakeBackend records calls and returns canned values so the protocol can be
// tested without a running app.
type fakeBackend struct {
	uiStateCalls int
	cardSetCalls int
	blockOpenErr error
	lastCardReq  wshrpc.AgentCardSetRequest
}

func (f *fakeBackend) SessionLive(ctx context.Context, req wshrpc.SessionLiveRequest) (*wshrpc.SessionLiveResult, error) {
	return &wshrpc.SessionLiveResult{Version: 1, Records: nil}, nil
}
func (f *fakeBackend) SessionGet(ctx context.Context, req wshrpc.SessionGetRequest) (*wshrpc.SessionLiveRecord, error) {
	return &wshrpc.SessionLiveRecord{SessionKey: req.Identifier}, nil
}
func (f *fakeBackend) SessionList(ctx context.Context, req wshrpc.SessionListRequest) (*wshrpc.SessionListResult, error) {
	return &wshrpc.SessionListResult{Version: 1}, nil
}
func (f *fakeBackend) UIActive(ctx context.Context, req wshrpc.UIActiveRequest) (*wshrpc.UIActiveSnapshot, error) {
	return &wshrpc.UIActiveSnapshot{Version: 1, Self: wshrpc.UIActiveSelf{TabId: req.TabId}}, nil
}
func (f *fakeBackend) UIState(ctx context.Context, req wshrpc.UIStateRequest) (*wshrpc.UIStateSnapshot, error) {
	f.uiStateCalls++
	return &wshrpc.UIStateSnapshot{Version: 1, Sources: map[string]string{"backend": "ok"}}, nil
}
func (f *fakeBackend) BlockRead(ctx context.Context, req wshrpc.BlockReadRequest) (*wshrpc.BlockReadResult, error) {
	return &wshrpc.BlockReadResult{Version: 1, BlockId: req.BlockId, Payload: map[string]any{}}, nil
}
func (f *fakeBackend) BlockOpen(ctx context.Context, req wshrpc.BlockOpenRequest) (*wshrpc.BlockOpenResult, error) {
	if f.blockOpenErr != nil {
		return nil, f.blockOpenErr
	}
	return &wshrpc.BlockOpenResult{Version: 1, Ok: true, View: req.View, SyncState: "db-only"}, nil
}
func (f *fakeBackend) TabList(ctx context.Context, req wshrpc.TabListRequest) (*wshrpc.TabListResult, error) {
	return &wshrpc.TabListResult{Version: 1}, nil
}
func (f *fakeBackend) TabCreate(ctx context.Context, req wshrpc.TabCreateRequest) (*wshrpc.TabCreateResult, error) {
	return &wshrpc.TabCreateResult{Version: 1, Ok: true, TabId: "t1"}, nil
}
func (f *fakeBackend) TabActivate(ctx context.Context, req wshrpc.TabActivateRequest) (*wshrpc.TabActivateResult, error) {
	return &wshrpc.TabActivateResult{Version: 1, Ok: true, TabId: req.TabId}, nil
}
func (f *fakeBackend) AgentCardGet(ctx context.Context, req wshrpc.AgentCardGetRequest) (*wshrpc.AgentCardResult, error) {
	return &wshrpc.AgentCardResult{Version: 1, SessionKey: req.Identifier}, nil
}
func (f *fakeBackend) AgentCardSet(ctx context.Context, req wshrpc.AgentCardSetRequest) (*wshrpc.AgentCardSetResult, error) {
	f.cardSetCalls++
	f.lastCardReq = req
	return &wshrpc.AgentCardSetResult{DryRun: true, Changed: false}, nil
}

func newServer(scopes []string) (*Server, *bytes.Buffer) {
	out := &bytes.Buffer{}
	return &Server{Backend: &fakeBackend{}, Scopes: scopes, Out: out}, out
}

func mustHandle(t *testing.T, s *Server, raw string) *Response {
	t.Helper()
	var req Request
	if err := json.Unmarshal([]byte(raw), &req); err != nil {
		t.Fatalf("bad test request %q: %v", raw, err)
	}
	return s.Handle(context.Background(), &req)
}

func resultMap(t *testing.T, resp *Response) map[string]any {
	t.Helper()
	if resp == nil {
		t.Fatal("nil response")
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %+v", resp.Error)
	}
	data, err := json.Marshal(resp.Result)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestInitializeAdvertisesToolsAndResources(t *testing.T) {
	s, _ := newServer(nil)
	res := resultMap(t, mustHandle(t, s, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`))
	if res["protocolVersion"] != ProtocolVersion {
		t.Fatalf("protocolVersion = %v", res["protocolVersion"])
	}
	info, _ := res["serverInfo"].(map[string]any)
	if info["name"] != ServerName {
		t.Fatalf("serverInfo.name = %v", info["name"])
	}
	caps, _ := res["capabilities"].(map[string]any)
	if _, ok := caps["tools"]; !ok {
		t.Fatal("capabilities must advertise tools")
	}
}

func TestToolsListShapeAndScopes(t *testing.T) {
	s, _ := newServer(nil)
	res := resultMap(t, mustHandle(t, s, `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`))
	tools, _ := res["tools"].([]any)
	if len(tools) != 12 {
		t.Fatalf("expected 12 tools, got %d", len(tools))
	}
	seen := map[string]bool{}
	for _, raw := range tools {
		tool, _ := raw.(map[string]any)
		name, _ := tool["name"].(string)
		if name == "" {
			t.Fatal("tool without name")
		}
		if seen[name] {
			t.Fatalf("duplicate tool %q", name)
		}
		seen[name] = true
		schema, ok := tool["inputSchema"].(map[string]any)
		if !ok || schema["type"] != "object" {
			t.Fatalf("tool %q missing object inputSchema", name)
		}
		if _, ok := schema["properties"]; !ok {
			t.Fatalf("tool %q missing properties", name)
		}
		if _, ok := tool["annotations"].(map[string]any); !ok {
			t.Fatalf("tool %q missing annotations", name)
		}
		if _, ok := tool["description"].(string); !ok {
			t.Fatalf("tool %q missing description", name)
		}
	}
	// the read-only tools must say so, and the write tool must warn
	for _, raw := range tools {
		tool, _ := raw.(map[string]any)
		ann, _ := tool["annotations"].(map[string]any)
		switch tool["name"] {
		case "snorkeling_ui_active", "snorkeling_block_read", "snorkeling_session_live":
			if ann["readOnlyHint"] != true {
				t.Fatalf("%v must be readOnlyHint", tool["name"])
			}
		case "snorkeling_agent_card_set":
			if ann["destructiveHint"] != true || ann["readOnlyHint"] == true {
				t.Fatalf("%v must be destructive and not readOnly", tool["name"])
			}
		}
	}
}

func TestScopesReachEveryTool(t *testing.T) {
	// every spec must declare a known scope
	for _, spec := range toolSpecs() {
		if !agentscope.Known(spec.Scope) {
			t.Fatalf("tool %q has unknown scope %q", spec.Name, spec.Scope)
		}
	}
}

func TestToolCallObserveSucceeds(t *testing.T) {
	s, _ := newServer([]string{ScopeObserve})
	be := s.Backend.(*fakeBackend)
	res := resultMap(t, mustHandle(t, s, `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"snorkeling_ui_state","arguments":{}}}`))
	content, _ := res["content"].([]any)
	if len(content) == 0 {
		t.Fatal("expected content")
	}
	first, _ := content[0].(map[string]any)
	if first["type"] != "text" || !strings.Contains(first["text"].(string), `"backend":"ok"`) {
		t.Fatalf("unexpected content: %v", first)
	}
	if be.uiStateCalls != 1 {
		t.Fatalf("backend not called")
	}
}

func TestToolCallScopeForbidden(t *testing.T) {
	s, _ := newServer([]string{ScopeObserve})
	be := s.Backend.(*fakeBackend)
	res := resultMap(t, mustHandle(t, s, `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"snorkeling_agent_card_set","arguments":{"identifier":"x","yes":true}}}`))
	if res["isError"] != true {
		t.Fatalf("expected isError, got %v", res)
	}
	content, _ := res["content"].([]any)
	first, _ := content[0].(map[string]any)
	if !strings.Contains(first["text"].(string), "E_FORBIDDEN") {
		t.Fatalf("expected E_FORBIDDEN, got %v", first["text"])
	}
	if be.cardSetCalls != 0 {
		t.Fatal("backend must not be called when scope check fails")
	}
}

func TestToolCallDataScopeAllowed(t *testing.T) {
	s, _ := newServer([]string{ScopeObserve, ScopeData})
	be := s.Backend.(*fakeBackend)
	res := resultMap(t, mustHandle(t, s, `{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"snorkeling_agent_card_set","arguments":{"identifier":"x","note":"hi"}}}`))
	if res["isError"] == true {
		t.Fatalf("unexpected error: %v", res)
	}
	if be.cardSetCalls != 1 || be.lastCardReq.Note == nil || *be.lastCardReq.Note != "hi" {
		t.Fatalf("arguments not decoded into the request: %+v", be.lastCardReq)
	}
}

func TestUnknownToolAndMethod(t *testing.T) {
	s, _ := newServer(nil)
	resp := mustHandle(t, s, `{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"nope"}}`)
	if resp.Error == nil || resp.Error.Code != ErrCodeInvalidParams {
		t.Fatalf("expected invalid params error, got %+v", resp.Error)
	}
	resp = mustHandle(t, s, `{"jsonrpc":"2.0","id":7,"method":"does/not/exist"}`)
	if resp.Error == nil || resp.Error.Code != ErrCodeMethodNotFound {
		t.Fatalf("expected method not found, got %+v", resp.Error)
	}
}

func TestResourceRead(t *testing.T) {
	s, _ := newServer([]string{ScopeObserve})
	be := s.Backend.(*fakeBackend)
	res := resultMap(t, mustHandle(t, s, `{"jsonrpc":"2.0","id":8,"method":"resources/read","params":{"uri":"snorkeling://state"}}`))
	contents, _ := res["contents"].([]any)
	if len(contents) != 1 {
		t.Fatalf("expected 1 content, got %d", len(contents))
	}
	if be.uiStateCalls != 1 {
		t.Fatal("resource read must hit the backend")
	}
	resp := mustHandle(t, s, `{"jsonrpc":"2.0","id":9,"method":"resources/read","params":{"uri":"snorkeling://nope"}}`)
	if resp.Error == nil {
		t.Fatal("unknown resource must error")
	}
}

func TestServeReadsNewlineDelimitedRequests(t *testing.T) {
	s, out := newServer(nil)
	in := strings.NewReader(
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}` + "\n" +
			"\n" +
			`{"jsonrpc":"2.0","method":"notifications/initialized"}` + "\n" +
			`{"jsonrpc":"2.0","id":2,"method":"ping"}` + "\n")
	if err := s.Serve(context.Background(), in); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 responses (notification gets none), got %d: %q", len(lines), out.String())
	}
	for _, line := range lines {
		var probe map[string]any
		if err := json.Unmarshal([]byte(line), &probe); err != nil {
			t.Fatalf("response is not JSON: %q", line)
		}
		if probe["jsonrpc"] != "2.0" {
			t.Fatalf("missing jsonrpc: %q", line)
		}
	}
}

func TestScopeAllows(t *testing.T) {
	tests := []struct {
		granted  []string
		required string
		want     bool
	}{
		{nil, ScopeData, true},                              // app-level
		{[]string{ScopeObserve}, ScopeObserve, true},
		{[]string{ScopeObserve}, ScopeNavigate, false},
		{[]string{ScopeObserve, ScopeNavigate}, ScopeData, false},
		{[]string{ScopeData}, ScopeNavigate, true},          // higher grants lower
		{[]string{ScopeObserve}, "bogus", false},
	}
	for _, tc := range tests {
		if got := scopeAllows(tc.granted, tc.required); got != tc.want {
			t.Fatalf("scopeAllows(%v,%q) = %v, want %v", tc.granted, tc.required, got, tc.want)
		}
	}
}
