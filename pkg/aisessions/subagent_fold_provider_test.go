// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func writeTempJSONL(t *testing.T, knownHosts ...string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "session.jsonl")
	content := ""
	for _, line := range knownHosts {
		content += line + "\n"
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	return path
}

func TestIsSubagentToolName(t *testing.T) {
	for _, name := range []string{"subagent", "Task", "task", "spawn_agent", "SubagentStart"} {
		if !isSubagentToolName(name) {
			t.Fatalf("%q should be recognized as a subagent tool", name)
		}
	}
	for _, name := range []string{"bash", "read", "grep", ""} {
		if isSubagentToolName(name) {
			t.Fatalf("%q must not be recognized as a subagent tool", name)
		}
	}
}

func TestSubagentArgsNormalization(t *testing.T) {
	args := map[string]any{"agent": "worker", "task": "fix bug"}
	if got := subagentAgentFromArgs(args); got != "worker" {
		t.Fatalf("agent = %q, want worker", got)
	}
	if got := subagentTaskFromArgs(args); got != "fix bug" {
		t.Fatalf("task = %q, want fix bug", got)
	}

	// Claude / OpenCode naming conventions.
	claudeArgs := map[string]any{"subagent_type": "Explore", "prompt": "find callers"}
	if got := subagentAgentFromArgs(claudeArgs); got != "Explore" {
		t.Fatalf("claude agent = %q, want Explore", got)
	}
	if got := subagentTaskFromArgs(claudeArgs); got != "find callers" {
		t.Fatalf("claude task = %q, want find callers", got)
	}

	// Serialized JSON string (codex arguments).
	raw := `{"agent_type":"worker","description":"do work"}`
	if got := subagentAgentFromArgs(subagentArgsMap(raw)); got != "worker" {
		t.Fatalf("codex agent = %q, want worker", got)
	}
	if got := subagentTaskFromArgs(subagentArgsMap(raw)); got != "do work" {
		t.Fatalf("codex task = %q, want do work", got)
	}
}

func TestExtractClaudeSubagentCalls(t *testing.T) {
	path := writeTempJSONL(
		t,
		`{"type":"assistant","uuid":"u1","timestamp":"2026-03-06T10:00:00Z","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"Task","input":{"subagent_type":"Explore","prompt":"find callers"}}]}}`,
		`{"type":"assistant","uuid":"u2","timestamp":"2026-03-06T10:00:05Z","message":{"content":[{"type":"tool_use","id":"toolu_2","name":"Bash","input":{"command":"ls"}}]}}`,
	)
	calls, err := extractClaudeSubagentCalls(context.Background(), path)
	if err != nil {
		t.Fatalf("extract: %v", err)
	}
	if len(calls) != 1 {
		t.Fatalf("calls = %d, want 1", len(calls))
	}
	if calls[0].Agent != "Explore" || calls[0].Task != "find callers" {
		t.Fatalf("call = %#v", calls[0])
	}
	if calls[0].ItemKey != "toolu_1" {
		t.Fatalf("itemKey = %q, want toolu_1", calls[0].ItemKey)
	}
}

func TestExtractCodexSubagentCalls(t *testing.T) {
	path := writeTempJSONL(
		t,
		`{"type":"response_item","timestamp":"2026-03-06T10:00:00Z","payload":{"type":"function_call","name":"spawn_agent","call_id":"call_1","arguments":"{\"agent_type\":\"worker\",\"prompt\":\"do work\"}"}}`,
		`{"type":"response_item","timestamp":"2026-03-06T10:00:05Z","payload":{"type":"function_call","name":"shell","call_id":"call_2","arguments":"{\"cmd\":[\"ls\"]}"}}`,
	)
	calls, err := extractCodexSubagentCalls(context.Background(), path)
	if err != nil {
		t.Fatalf("extract: %v", err)
	}
	if len(calls) != 1 {
		t.Fatalf("calls = %d, want 1", len(calls))
	}
	if calls[0].Agent != "worker" || calls[0].Task != "do work" {
		t.Fatalf("call = %#v", calls[0])
	}
	if calls[0].ItemKey != "call_1" {
		t.Fatalf("itemKey = %q, want call_1", calls[0].ItemKey)
	}
}

func TestMatchSubagentCallsCarriesUpdatedAt(t *testing.T) {
	calls := []SubagentCall{{Agent: "worker", ItemKey: "toolu_1", Timestamp: 1000}}
	candidates := []SubagentCandidate{{
		SessionKey: "child",
		CreatedAt:  1200,
		UpdatedAt:  9000,
		ParentKey:  "parent",
		Kind:       SessionKindSubagent,
	}}
	matches := MatchSubagentSessions(calls, candidates)
	if len(matches) != 1 || matches[0].Status != SubagentMatchMatched {
		t.Fatalf("matches = %#v", matches)
	}
	if matches[0].UpdatedAt != 9000 {
		t.Fatalf("updatedAt = %d, want 9000", matches[0].UpdatedAt)
	}
}
