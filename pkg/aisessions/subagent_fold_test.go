// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestMatchSubagentCalls_UniqueMatch(t *testing.T) {
	calls := []SubagentCall{
		{Agent: "reviewer", Task: "check diff", Timestamp: 1_000_000},
	}
	candidates := []SubagentCandidate{
		{SessionKey: "k1", SessionID: "s1", Name: "reviewer: check diff", CreatedAt: 1_060_000},
	}
	matches := matchSubagentCalls(calls, candidates)
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}
	if matches[0].Status != SubagentMatchMatched {
		t.Fatalf("expected matched, got %s", matches[0].Status)
	}
	if matches[0].SessionKey != "k1" {
		t.Fatalf("expected session key k1, got %q", matches[0].SessionKey)
	}
}

func TestMatchSubagentCalls_AmbiguousKeepsCandidates(t *testing.T) {
	calls := []SubagentCall{
		{Agent: "reviewer", Task: "check diff", Timestamp: 1_000_000},
	}
	candidates := []SubagentCandidate{
		{SessionKey: "k1", Name: "reviewer: check diff", CreatedAt: 1_060_000},
		{SessionKey: "k2", Name: "reviewer: another task", CreatedAt: 1_070_000},
	}
	matches := matchSubagentCalls(calls, candidates)
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}
	if matches[0].Status != SubagentMatchAmbiguous {
		t.Fatalf("expected ambiguous, got %s", matches[0].Status)
	}
	// 不得猜测：不能指定任何一个 sessionKey，但必须把候选交给 UI。
	if matches[0].SessionKey != "" {
		t.Fatalf("ambiguous match must not pick a session, got %q", matches[0].SessionKey)
	}
	if len(matches[0].Candidates) != 2 {
		t.Fatalf("expected 2 candidates, got %d", len(matches[0].Candidates))
	}
}

func TestMatchSubagentCalls_Missing(t *testing.T) {
	calls := []SubagentCall{
		{Agent: "reviewer", Timestamp: 1_000_000},
	}
	matches := matchSubagentCalls(calls, nil)
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}
	if matches[0].Status != SubagentMatchMissing {
		t.Fatalf("expected missing, got %s", matches[0].Status)
	}
	if len(matches[0].Candidates) != 0 {
		t.Fatalf("expected no candidates, got %d", len(matches[0].Candidates))
	}
}

func TestMatchSubagentCalls_NameMustMatch(t *testing.T) {
	calls := []SubagentCall{
		{Agent: "reviewer", Timestamp: 1_000_000},
	}
	candidates := []SubagentCandidate{
		{SessionKey: "k1", Name: "planner: something else", CreatedAt: 1_060_000},
	}
	matches := matchSubagentCalls(calls, candidates)
	if matches[0].Status != SubagentMatchMissing {
		t.Fatalf("expected missing for a non-matching name, got %s", matches[0].Status)
	}
}

func TestMatchSubagentCalls_TimeWindowExcludesOldSession(t *testing.T) {
	calls := []SubagentCall{
		{Agent: "reviewer", Timestamp: 1_000_000},
	}
	// 早于调用太多（超出前向偏差）→ 不算候选。
	candidates := []SubagentCandidate{
		{SessionKey: "k1", Name: "reviewer: stale", CreatedAt: 1_000_000 - subagentMatchLeadSkewMS - 1},
	}
	matches := matchSubagentCalls(calls, candidates)
	if matches[0].Status != SubagentMatchMissing {
		t.Fatalf("expected missing for a stale session, got %s", matches[0].Status)
	}
}

func TestMatchSubagentCalls_CandidateNotReusedAcrossCalls(t *testing.T) {
	calls := []SubagentCall{
		{Agent: "reviewer", Timestamp: 1_000_000},
		{Agent: "reviewer", Timestamp: 1_100_000},
	}
	candidates := []SubagentCandidate{
		{SessionKey: "k1", Name: "reviewer: only one", CreatedAt: 1_060_000},
	}
	matches := matchSubagentCalls(calls, candidates)
	if matches[0].Status != SubagentMatchMatched || matches[0].SessionKey != "k1" {
		t.Fatalf("first call should match k1, got %s/%q", matches[0].Status, matches[0].SessionKey)
	}
	if matches[1].Status != SubagentMatchMissing {
		t.Fatalf("second call must not reuse k1, got %s", matches[1].Status)
	}
}

func TestExtractSubagentCalls(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "session.jsonl")
	content := `{"type":"message","id":"e1","timestamp":"2026-08-05T05:20:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"delegating"},{"type":"toolCall","name":"subagent","arguments":{"agent":"reviewer","task":"check diff"}}]}}` + "\n" +
		`{"type":"message","id":"e2","timestamp":"2026-08-05T05:21:00.000Z","message":{"role":"assistant","content":[{"type":"toolCall","name":"bash","arguments":{"cmd":"ls"}}]}}` + "\n" +
		`not json` + "\n"
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	calls, err := ExtractSubagentCalls(context.Background(), path)
	if err != nil {
		t.Fatalf("extract: %v", err)
	}
	if len(calls) != 1 {
		t.Fatalf("expected 1 subagent call, got %d", len(calls))
	}
	if calls[0].Agent != "reviewer" || calls[0].Task != "check diff" {
		t.Fatalf("unexpected call: %+v", calls[0])
	}
	if calls[0].EntryID != "e1" || calls[0].ItemKey != "e1:t0" {
		t.Fatalf("unexpected anchoring: %+v", calls[0])
	}
	if calls[0].Timestamp == 0 {
		t.Fatalf("expected a parsed timestamp")
	}
}

func TestExtractSubagentCalls_MissingFile(t *testing.T) {
	if _, err := ExtractSubagentCalls(context.Background(), filepath.Join(t.TempDir(), "nope.jsonl")); err == nil {
		t.Fatalf("expected an error for a missing file")
	}
}
