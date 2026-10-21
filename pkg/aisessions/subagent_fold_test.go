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

// 阶段 E：目录结构判定出的 subagent 没有 session_info.name（Name 为空），
// 老的名称匹配对它必然 missing。现在它应仅凭「同父 + 时间窗」就匹配上。
func TestMatchSubagentCalls_StructuralCandidateWithoutName(t *testing.T) {
	calls := []SubagentCall{
		{Agent: "general", Task: "explore the repo", Timestamp: 1_000_000},
	}
	candidates := []SubagentCandidate{
		{
			SessionKey: "child-1",
			SessionID:  "child-1",
			CreatedAt:  1_030_000,
			ParentKey:  "parent-1",
			Kind:       SessionKindSubagent,
		},
	}
	matches := matchSubagentCalls(calls, candidates)
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}
	if matches[0].Status != SubagentMatchMatched {
		t.Fatalf("expected matched, got %s", matches[0].Status)
	}
	if matches[0].SessionKey != "child-1" {
		t.Fatalf("expected session key child-1, got %q", matches[0].SessionKey)
	}
}

// fork 挂在同一个父目录下，但它是用户主动分叉，不是任何一次派发的目标。
func TestMatchSubagentCalls_ForkNeverMatches(t *testing.T) {
	calls := []SubagentCall{
		{Agent: "general", Task: "explore the repo", Timestamp: 1_000_000},
	}
	candidates := []SubagentCandidate{
		{
			SessionKey: "fork-1",
			SessionID:  "fork-1",
			CreatedAt:  1_030_000,
			ParentKey:  "parent-1",
			Kind:       SessionKindFork,
		},
	}
	matches := matchSubagentCalls(calls, candidates)
	if matches[0].Status != SubagentMatchMissing {
		t.Fatalf("expected missing for a fork, got %s", matches[0].Status)
	}
}

// 时间窗之外的子会话不参与匹配（否则一次派发会认领数小时前创建的会话）。
func TestMatchSubagentCalls_StructuralCandidateOutsideWindow(t *testing.T) {
	// Realistic epoch-ms values: a timestamp of 0 or below is treated as "unknown"
	// and matches leniently, which would defeat the point of this test.
	callAt := int64(1_760_000_000_000)
	calls := []SubagentCall{
		{Agent: "general", Task: "explore the repo", Timestamp: callAt},
	}
	candidates := []SubagentCandidate{
		{
			SessionKey: "child-old",
			SessionID:  "child-old",
			CreatedAt:  callAt - (8 * 60 * 60 * 1000),
			ParentKey:  "parent-1",
			Kind:       SessionKindSubagent,
		},
	}
	matches := matchSubagentCalls(calls, candidates)
	if matches[0].Status != SubagentMatchMissing {
		t.Fatalf("expected missing outside the time window, got %s", matches[0].Status)
	}
}

// 结构候选与名称候选混在一起时仍不猜测：多个命中 → ambiguous。
func TestMatchSubagentCalls_MixedCandidatesAmbiguous(t *testing.T) {
	calls := []SubagentCall{
		{Agent: "reviewer", Task: "check diff", Timestamp: 1_000_000},
	}
	candidates := []SubagentCandidate{
		{SessionKey: "named", SessionID: "named", Name: "reviewer: check diff", CreatedAt: 1_030_000},
		{SessionKey: "struct", SessionID: "struct", CreatedAt: 1_020_000, ParentKey: "p", Kind: SessionKindSubagent},
	}
	matches := matchSubagentCalls(calls, candidates)
	if matches[0].Status != SubagentMatchAmbiguous {
		t.Fatalf("expected ambiguous, got %s", matches[0].Status)
	}
	if len(matches[0].Candidates) != 2 {
		t.Fatalf("expected 2 candidates, got %d", len(matches[0].Candidates))
	}
}

// 一次派发只能认领一个子会话；第二个候选留给下一次派发，否则两次调用会抢同一个会话。
func TestMatchSubagentCalls_StructuralCandidateNotReused(t *testing.T) {
	calls := []SubagentCall{
		{Agent: "general", Task: "one", Timestamp: 1_000_000},
		{Agent: "general", Task: "two", Timestamp: 1_000_100},
	}
	candidates := []SubagentCandidate{
		{SessionKey: "child", SessionID: "child", CreatedAt: 1_030_000, ParentKey: "p", Kind: SessionKindSubagent},
	}
	matches := matchSubagentCalls(calls, candidates)
	if matches[0].Status != SubagentMatchMatched {
		t.Fatalf("expected first call matched, got %s", matches[0].Status)
	}
	if matches[1].Status != SubagentMatchMissing {
		t.Fatalf("expected second call missing (candidate already used), got %s", matches[1].Status)
	}
}
