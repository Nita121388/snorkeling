// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcontrol

import (
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentstatus"
	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/aisessions/chat"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var updateGolden = flag.Bool("update-golden", false, "rewrite agentcontrol golden files")

// goldenResult builds a representative SessionLiveResult through the same
// helpers the RPC uses, so the snapshot covers the real field wiring (not a
// hand-written literal that could drift from the code).
func goldenResult() *wshrpc.SessionLiveResult {
	working := issueFromStatus(&agentstatus.AgentStatus{
		State:       agentstatus.StateWorking,
		PrevState:   agentstatus.StateIdle,
		Phase:       "tool",
		ToolName:    "shell",
		Message:     "running tests token=super-secret-value",
		Source:      "hook",
		Confidence:  "high",
		ActiveSince: 1761979900000,
		UpdatedAt:   1761980000000,
		ExpiresAt:   1761980060000,
		Seq:         12,
	}, 1761980000000)

	stale := issueFromStatus(&agentstatus.AgentStatus{
		State:     agentstatus.StateWorking,
		UpdatedAt: 1761979000000,
		ExpiresAt: 1761979100000,
	}, 1761980000000)

	guiChat := liveChatFromInfo(chat.LiveChatInfo{
		Source:    "pi",
		SessionID: "pi-session-1",
		State:     chat.StateRunning,
		LastUsed:  1761980000000,
	})
	guiChat.ModelProvider = "openai"
	guiChat.ModelId = "gpt-5-codex"
	guiChat.ThinkingLevel = "high"
	usage := 0.42
	guiChat.ContextUsagePct = &usage
	guiChat.MessageCount = 12
	guiChat.IsStreaming = true

	tuiRecord := wshrpc.SessionLiveRecord{
		BlockId:   "blk7",
		TabId:     "tabIdA",
		WindowId:  "win1",
		View:      "term",
		Provider:  "codex",
		SessionId: "codex-session-019a",
		Issue:     working,
	}
	applySummary(&tuiRecord, aisessions.SessionSummary{
		Key:         "codex:codex-session-019a:/repo/session.jsonl",
		ID:          "codex-session-019a",
		Source:      "codex",
		Title:       "整理 ACS 设计",
		TitleSource: "ai",
		ProjectPath: "/repo",
		Note:        "已整理",
		Tags:        []string{"设计", "已整理"},
		Marked:      true,
		Props: map[string]aisessions.PropertyCell{
			"优先级": {Type: "select", Value: "P1", Source: "user", UpdatedAt: 1761980000000},
		},
	})

	guiRecord := wshrpc.SessionLiveRecord{
		BlockId:   "blk8",
		TabId:     "tabIdA",
		WindowId:  "win1",
		View:      "agent",
		Provider:  "pi",
		SessionId: "pi-session-1",
		Chat:      guiChat,
	}
	applySummary(&guiRecord, aisessions.SessionSummary{
		Key:     "pi:pi-session-1:/repo/pi.jsonl",
		ID:      "pi-session-1",
		Source:  "pi",
		Title:   "pi 会话",
		Live:    true,
		Missing: false,
	})

	// Remote block: agentstatus comes back over wsh but the summary cannot be
	// parsed on the app host, so the row degrades instead of failing.
	remoteRecord := wshrpc.SessionLiveRecord{
		BlockId:   "blkRemote",
		View:      "term",
		Conn:      "user@host",
		Provider:  "claude",
		SessionId: "claude-remote-1",
		Issue:     stale,
		Warnings:  []string{"summary-unavailable", "remote-summary-unavailable"},
	}

	// A GUI chat whose block is already gone must still show up.
	orphanRecord := wshrpc.SessionLiveRecord{
		View:      "chat",
		Provider:  "pi",
		SessionId: "pi-orphan-1",
		Chat:      liveChatFromInfo(chat.LiveChatInfo{Source: "pi", SessionID: "pi-orphan-1", State: chat.StateIdle, LastUsed: 1761979000000}),
		Warnings:  []string{"orphan-chat"},
	}

	return &wshrpc.SessionLiveResult{
		Version:     wshrpc.AgentControlVersion,
		GeneratedAt: 1761980000123,
		Records:     []wshrpc.SessionLiveRecord{tuiRecord, guiRecord, remoteRecord, orphanRecord},
	}
}

// TestSessionLiveJSONGolden locks the wire shape of session live --json: field
// names, null-vs-omitted semantics and the redaction of free-form strings.
func TestSessionLiveJSONGolden(t *testing.T) {
	barr, err := json.MarshalIndent(goldenResult(), "", "  ")
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := append(barr, '\n')

	goldenPath := filepath.Join("testdata", "session_live.golden.json")
	if *updateGolden {
		if err := os.MkdirAll("testdata", 0o755); err != nil {
			t.Fatalf("mkdir testdata: %v", err)
		}
		if err := os.WriteFile(goldenPath, got, 0o644); err != nil {
			t.Fatalf("write golden: %v", err)
		}
		return
	}

	want, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatalf("read golden (run: go test ./pkg/agentcontrol/ -update-golden): %v", err)
	}
	if string(got) != string(want) {
		t.Fatalf("session live JSON drifted from %s.\nIf the change is intentional run:\n  go test ./pkg/agentcontrol/ -update-golden\n\n--- got ---\n%s", goldenPath, got)
	}
}

// TestSessionLiveJSONNullSemantics guards the prd rule that a missing source is
// an explicit null rather than an omitted key, so an agent can tell "unknown"
// apart from "not applicable".
func TestSessionLiveJSONNullSemantics(t *testing.T) {
	barr, err := json.Marshal(goldenResult())
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded struct {
		Records []map[string]any `json:"records"`
	}
	if err := json.Unmarshal(barr, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(decoded.Records) == 0 {
		t.Fatal("golden result has no records")
	}
	for idx, rec := range decoded.Records {
		for _, field := range []string{"issue", "chat", "card"} {
			if _, ok := rec[field]; !ok {
				t.Fatalf("record %d is missing the %q key entirely; it must be present as null when absent", idx, field)
			}
		}
	}
	// The remote record has no card at all and must serialize as null.
	remote := decoded.Records[2]
	if remote["card"] != nil {
		t.Fatalf("remote record card should be null, got %#v", remote["card"])
	}
	// The orphan chat record has no issue.
	if decoded.Records[3]["issue"] != nil {
		t.Fatalf("orphan chat record issue should be null, got %#v", decoded.Records[3]["issue"])
	}
}

// TestSessionLiveJSONRedactsCredentials keeps the redaction contract visible in
// the same snapshot the agent reads.
func TestSessionLiveJSONRedactsCredentials(t *testing.T) {
	result := goldenResult()
	msg := result.Records[0].Issue.Message
	if msg == "" {
		t.Fatal("fixture lost its message")
	}
	if containsSubstring(msg, "super-secret-value") {
		t.Fatalf("credential leaked into the live record: %q", msg)
	}
	if !containsSubstring(msg, redactedValue) {
		t.Fatalf("expected the credential to be masked with %q, got %q", redactedValue, msg)
	}
}

func containsSubstring(haystack, needle string) bool {
	if len(needle) == 0 {
		return true
	}
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
