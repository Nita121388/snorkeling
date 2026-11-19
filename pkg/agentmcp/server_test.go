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
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// fakeBackend records calls and returns canned values so the protocol can be
// tested without a running app.
type fakeBackend struct {
	uiStateCalls    int
	cardSetCalls    int
	annotateCalls   int
	blockOpenErr    error
	lastCardReq     wshrpc.AgentCardSetRequest
	lastAnnotateReq wshrpc.SessionAnnotateRequest

	launchCalls   int
	lastLaunchReq wshrpc.AgentLaunchRequest
	sendCalls     int
	lastSendReq   wshrpc.AgentSendRequest

	schedListCalls   int
	schedCreateCalls int
	schedRunCalls    int
	lastSchedReq     wconfig.ScheduledTaskType
	lastSchedRunID   string
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
func (f *fakeBackend) SessionInfo(ctx context.Context, req wshrpc.SessionInfoRequest) (*wshrpc.SessionInfoResult, error) {
	return &wshrpc.SessionInfoResult{SessionKey: req.Identifier, Verdict: "small"}, nil
}
func (f *fakeBackend) SessionUsers(ctx context.Context, req wshrpc.SessionUsersRequest) (*wshrpc.SessionUsersResult, error) {
	return &wshrpc.SessionUsersResult{Rows: []wshrpc.SessionUserEntry{{Seq: req.BeforeSeq, Text: "user"}}}, nil
}
func (f *fakeBackend) SessionTurns(ctx context.Context, req wshrpc.SessionTurnsRequest) (*wshrpc.SessionTurnsResult, error) {
	return &wshrpc.SessionTurnsResult{Rows: []wshrpc.SessionTurnEntry{{Turn: 1, Seq: 1, Text: "turn"}}}, nil
}
func (f *fakeBackend) SessionTurn(ctx context.Context, req wshrpc.SessionTurnRequest) (*wshrpc.SessionTurnResult, error) {
	return &wshrpc.SessionTurnResult{Turn: req.Turn, TotalChars: req.Chars}, nil
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
func (f *fakeBackend) SessionAnnotate(ctx context.Context, req wshrpc.SessionAnnotateRequest) (*wshrpc.SessionAnnotateResult, error) {
	f.annotateCalls++
	f.lastAnnotateReq = req
	return &wshrpc.SessionAnnotateResult{DryRun: !req.Yes, Written: req.Yes}, nil
}

func (f *fakeBackend) SessionEmojiGet(ctx context.Context, req wshrpc.SessionEmojiGetRequest) (*wshrpc.SessionEmojiGetResult, error) {
	return &wshrpc.SessionEmojiGetResult{SessionKey: "fake-key"}, nil
}

func (f *fakeBackend) SessionEmojiSet(ctx context.Context, req wshrpc.SessionEmojiSetRequest) (*wshrpc.SessionEmojiSetResult, error) {
	return &wshrpc.SessionEmojiSetResult{DryRun: !req.Yes}, nil
}

func (f *fakeBackend) SessionEmojiInject(ctx context.Context, req wshrpc.SessionEmojiInjectRequest) (*wshrpc.SessionEmojiInjectResult, error) {
	return &wshrpc.SessionEmojiInjectResult{SessionKey: "fake-key", Candidates: len(req.Candidates)}, nil
}

func (f *fakeBackend) SessionEmojiRecommendations(ctx context.Context, req wshrpc.SessionEmojiRecommendationsRequest) (*wshrpc.SessionEmojiRecommendationsResult, error) {
	return &wshrpc.SessionEmojiRecommendationsResult{SessionKey: "fake-key"}, nil
}

func (f *fakeBackend) SessionEmojiPrefs(ctx context.Context, req wshrpc.SessionEmojiPrefsRequest) (*wshrpc.SessionEmojiPrefsResult, error) {
	return &wshrpc.SessionEmojiPrefsResult{SessionKey: "fake-key"}, nil
}

func (f *fakeBackend) RecordEmojiPick(ctx context.Context, req wshrpc.SessionEmojiRecordPickRequest) (*wshrpc.SessionEmojiRecordPickResult, error) {
	return &wshrpc.SessionEmojiRecordPickResult{SessionKey: "fake-key", Emoji: req.Emoji}, nil
}

func (f *fakeBackend) AgentLaunch(ctx context.Context, req wshrpc.AgentLaunchRequest) (*wshrpc.AgentLaunchResult, error) {
	f.launchCalls++
	f.lastLaunchReq = req
	return &wshrpc.AgentLaunchResult{Version: 1, Ok: true, BlockId: "blk-test", Profile: req.Profile}, nil
}

func (f *fakeBackend) AgentSend(ctx context.Context, req wshrpc.AgentSendRequest) (*wshrpc.AgentSendResult, error) {
	f.sendCalls++
	f.lastSendReq = req
	return &wshrpc.AgentSendResult{Version: 1, Ok: true, BlockId: req.BlockId, Injected: true, Submitted: true}, nil
}

func (f *fakeBackend) ScheduledTaskList(ctx context.Context) ([]wconfig.ScheduledTaskType, error) {
	f.schedListCalls++
	return []wconfig.ScheduledTaskType{{Id: "t1", Name: "digest", Mode: "headless", CreatedBy: "agent"}}, nil
}

func (f *fakeBackend) ScheduledTaskCreate(ctx context.Context, task wconfig.ScheduledTaskType) (wconfig.ScheduledTaskType, error) {
	f.schedCreateCalls++
	f.lastSchedReq = task
	return task, nil
}

func (f *fakeBackend) ScheduledTaskRun(ctx context.Context, taskID string) (*wshrpc.ScheduledTaskRunResult, error) {
	f.schedRunCalls++
	f.lastSchedRunID = taskID
	return &wshrpc.ScheduledTaskRunResult{TaskId: taskID, Status: "success", ExitCode: 0, DurationMs: 12}, nil
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
	if len(tools) != 28 {
		t.Fatalf("expected 28 tools, got %d", len(tools))
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
		{nil, ScopeData, true}, // app-level
		{[]string{ScopeObserve}, ScopeObserve, true},
		{[]string{ScopeObserve}, ScopeNavigate, false},
		{[]string{ScopeObserve, ScopeNavigate}, ScopeData, false},
		{[]string{ScopeData}, ScopeNavigate, true}, // higher grants lower
		{[]string{ScopeObserve}, "bogus", false},
	}
	for _, tc := range tests {
		if got := scopeAllows(tc.granted, tc.required); got != tc.want {
			t.Fatalf("scopeAllows(%v,%q) = %v, want %v", tc.granted, tc.required, got, tc.want)
		}
	}
}

// AC7：4 个渐进读取工具与 CLI 参数一一对应（required 字段、readOnly、observe scope）。
func TestSessionReadToolsSchema(t *testing.T) {
	specs := map[string]toolSpec{}
	for _, spec := range toolSpecs() {
		specs[spec.Name] = spec
	}
	requiredOf := func(name string) map[string]bool {
		spec, ok := specs[name]
		if !ok {
			t.Fatalf("tool %q missing", name)
		}
		if spec.Scope != ScopeObserve {
			t.Fatalf("tool %q scope = %q, want observe", name, spec.Scope)
		}
		if spec.Annotations == nil || !spec.Annotations.ReadOnlyHint {
			t.Fatalf("tool %q must be readOnly", name)
		}
		raw, _ := spec.Schema["required"].([]string)
		if len(raw) == 0 {
			t.Fatalf("tool %q must declare required args", name)
		}
		out := map[string]bool{}
		for _, field := range raw {
			out[field] = true
		}
		return out
	}
	info := requiredOf("snorkeling_session_info")
	if !info["identifier"] {
		t.Fatal("session_info must require identifier")
	}
	users := requiredOf("snorkeling_session_users")
	if !users["identifier"] {
		t.Fatal("session_users must require identifier")
	}
	turns := requiredOf("snorkeling_session_turns")
	if !turns["identifier"] || !turns["limit"] {
		t.Fatalf("session_turns must require identifier+limit: %v", turns)
	}
	turn := requiredOf("snorkeling_session_turn")
	if !turn["identifier"] || !turn["turn"] || !turn["chars"] {
		t.Fatalf("session_turn must require identifier+turn+chars: %v", turn)
	}
}

func TestSessionReadToolCalls(t *testing.T) {
	s, _ := newServer([]string{ScopeObserve})
	res := resultMap(t, mustHandle(t, s, `{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"snorkeling_session_info","arguments":{"identifier":"pi:abc"}}}`))
	content, _ := res["content"].([]any)
	first, _ := content[0].(map[string]any)
	if !strings.Contains(first["text"].(string), `"verdict":"small"`) {
		t.Fatalf("unexpected info content: %v", first)
	}
	res = resultMap(t, mustHandle(t, s, `{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"snorkeling_session_turns","arguments":{"identifier":"pi:abc","limit":5}}}`))
	content, _ = res["content"].([]any)
	first, _ = content[0].(map[string]any)
	if !strings.Contains(first["text"].(string), `"turn":1`) {
		t.Fatalf("unexpected turns content: %v", first)
	}
}

func TestAgentCreateToolLaunchScopeGated(t *testing.T) {
	// data alone must NOT launch an agent: launch creates a real process
	s, _ := newServer([]string{ScopeData})
	be := s.Backend.(*fakeBackend)
	res := resultMap(t, mustHandle(t, s, `{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"snorkeling_agent_create","arguments":{"profile":"pi"}}}`))
	if res["isError"] != true {
		t.Fatalf("data scope must not launch agents, got %v", res)
	}
	if be.launchCalls != 0 {
		t.Fatal("backend must not be called when the launch scope is missing")
	}

	// launch scope passes and reaches the backend
	s2, _ := newServer([]string{ScopeLaunch})
	be2 := s2.Backend.(*fakeBackend)
	res2 := resultMap(t, mustHandle(t, s2, `{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"snorkeling_agent_create","arguments":{"profile":"pi","message":"hi there"}}}`))
	content, _ := res2["content"].([]any)
	if len(content) == 0 || !strings.Contains(content[0].(map[string]any)["text"].(string), `"profile":"pi"`) {
		t.Fatalf("expected a successful launch result, got %v", res2)
	}
	if be2.launchCalls != 1 {
		t.Fatal("backend must be called once")
	}
	if be2.lastLaunchReq.Send == nil || be2.lastLaunchReq.Send.Text64 == "" {
		t.Fatal("message must be expanded into the embedded send request")
	}
}

func TestAgentSendToolLaunchScopeGated(t *testing.T) {
	s, _ := newServer([]string{ScopeData})
	be := s.Backend.(*fakeBackend)
	res := resultMap(t, mustHandle(t, s, `{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"snorkeling_agent_send","arguments":{"blockid":"blk1","text":"x"}}}`))
	if res["isError"] != true {
		t.Fatalf("data scope must not send text, got %v", res)
	}
	if be.sendCalls != 0 {
		t.Fatal("backend must not be called when the launch scope is missing")
	}
}

// AC5: the annotate tool is a data-scope write with CLI-equivalent parameters,
// dry-run by default, and `confirm` maps to the CLI's --yes.
func TestSessionAnnotateToolSchemaAndConfirm(t *testing.T) {
	var spec *toolSpec
	specs := toolSpecs()
	for i := range specs {
		if specs[i].Name == "snorkeling_session_annotate" {
			spec = &specs[i]
			break
		}
	}
	if spec == nil {
		t.Fatal("snorkeling_session_annotate tool is missing")
	}
	if spec.Scope != ScopeData {
		t.Fatalf("annotate must be data scope, got %q", spec.Scope)
	}
	if spec.Annotations == nil || !spec.Annotations.DestructiveHint || spec.Annotations.ReadOnlyHint {
		t.Fatalf("annotate must be destructive and not readOnly: %+v", spec.Annotations)
	}
	required, _ := spec.Schema["required"].([]string)
	have := map[string]bool{}
	for _, field := range required {
		have[field] = true
	}
	if !have["identifier"] || !have["anchor"] {
		t.Fatalf("annotate must require identifier+anchor, got %v", required)
	}
	props, _ := spec.Schema["properties"].(map[string]any)
	for _, field := range []string{"identifier", "anchor", "kind", "title", "body", "tags", "status", "force", "expectedhash", "confirm", "dryrun"} {
		if _, ok := props[field]; !ok {
			t.Fatalf("annotate schema is missing %q", field)
		}
	}

	// default: no confirm => dry-run
	s, _ := newServer([]string{ScopeObserve, ScopeData})
	be := s.Backend.(*fakeBackend)
	res := resultMap(t, mustHandle(t, s, `{"jsonrpc":"2.0","id":20,"method":"tools/call","params":{"name":"snorkeling_session_annotate","arguments":{"identifier":"pi:abc","anchor":"tail","body":"x"}}}`))
	if res["isError"] == true {
		t.Fatalf("unexpected error: %v", res)
	}
	if be.annotateCalls != 1 || be.lastAnnotateReq.Yes {
		t.Fatalf("default call must be a dry-run: %+v", be.lastAnnotateReq)
	}
	mustHandle(t, s, `{"jsonrpc":"2.0","id":21,"method":"tools/call","params":{"name":"snorkeling_session_annotate","arguments":{"identifier":"pi:abc","anchor":"tail","body":"x","confirm":true,"expectedhash":"h"}}}`)
	if !be.lastAnnotateReq.Yes || be.lastAnnotateReq.ExpectedHash != "h" {
		t.Fatalf("confirm/expectedhash must map to the request: %+v", be.lastAnnotateReq)
	}
}

func TestSessionAnnotateToolScopeGated(t *testing.T) {
	s, _ := newServer([]string{ScopeObserve})
	be := s.Backend.(*fakeBackend)
	res := resultMap(t, mustHandle(t, s, `{"jsonrpc":"2.0","id":22,"method":"tools/call","params":{"name":"snorkeling_session_annotate","arguments":{"identifier":"pi:abc","anchor":"tail"}}}`))
	if res["isError"] != true {
		t.Fatalf("observe scope must not annotate, got %v", res)
	}
	if be.annotateCalls != 0 {
		t.Fatal("backend must not be called when the data scope is missing")
	}
}

func TestScheduledTaskToolsListAndRun(t *testing.T) {
	s, _ := newServer([]string{ScopeObserve, ScopeData, ScopeLaunch})
	be := s.Backend.(*fakeBackend)

	res := resultMap(t, mustHandle(t, s, `{"jsonrpc":"2.0","id":30,"method":"tools/call","params":{"name":"snorkeling_scheduledtask_list","arguments":{"createdby":"agent"}}}`))
	if res["isError"] == true {
		t.Fatalf("list should not error: %v", res)
	}
	if be.schedListCalls != 1 {
		t.Fatalf("list calls = %d, want 1", be.schedListCalls)
	}

	res = resultMap(t, mustHandle(t, s, `{"jsonrpc":"2.0","id":31,"method":"tools/call","params":{"name":"snorkeling_scheduledtask_run","arguments":{"taskid":"t1"}}}`))
	if res["isError"] == true {
		t.Fatalf("run should not error: %v", res)
	}
	if be.schedRunCalls != 1 || be.lastSchedRunID != "t1" {
		t.Fatalf("run target = %q calls=%d, want t1/1", be.lastSchedRunID, be.schedRunCalls)
	}
}

func TestScheduledTaskCreateToolDryRunByDefault(t *testing.T) {
	s, _ := newServer([]string{ScopeObserve, ScopeData})
	be := s.Backend.(*fakeBackend)
	// No yes flag -> dry-run: backend must NOT be called.
	mustHandle(t, s, `{"jsonrpc":"2.0","id":40,"method":"tools/call","params":{"name":"snorkeling_scheduledtask_create","arguments":{"name":"n","prompt":"p","schedule":"every:10m"}}}`)
	if be.schedCreateCalls != 0 {
		t.Fatalf("default create must be dry-run, backend called %d times", be.schedCreateCalls)
	}
	// yes=true -> real create reaches the backend with a parsed schedule.
	res := mustHandle(t, s, `{"jsonrpc":"2.0","id":41,"method":"tools/call","params":{"name":"snorkeling_scheduledtask_create","arguments":{"name":"n","prompt":"p","schedule":"every:10m","yes":true}}}`)
	if resultMap(t, res)["isError"] == true {
		t.Fatalf("create with yes should not error: %v", res)
	}
	if be.schedCreateCalls != 1 {
		t.Fatalf("create calls = %d, want 1", be.schedCreateCalls)
	}
	if be.lastSchedReq.Id == "" || be.lastSchedReq.Schedule.Type != "interval" || be.lastSchedReq.Schedule.IntervalMs == nil {
		t.Fatalf("create payload malformed: %+v", be.lastSchedReq)
	}
}

func TestScheduledTaskCreateToolScopeGated(t *testing.T) {
	s, _ := newServer([]string{ScopeObserve})
	be := s.Backend.(*fakeBackend)
	res := resultMap(t, mustHandle(t, s, `{"jsonrpc":"2.0","id":50,"method":"tools/call","params":{"name":"snorkeling_scheduledtask_create","arguments":{"name":"n","prompt":"p","schedule":"daily@09:00","yes":true}}}`))
	if res["isError"] != true {
		t.Fatalf("observe scope must not create, got %v", res)
	}
	if be.schedCreateCalls != 0 {
		t.Fatal("backend must not be called when data scope is missing")
	}
}
