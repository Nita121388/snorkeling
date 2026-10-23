// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"os"
	"path/filepath"
	"strings"
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

// run id 是唯一键：同一父会话下 84 个子会话、时间窗宽 6 小时，名称/时间窗匹配
// 会全部落到 ambiguous，而 run id 能一一对上。
func TestMatchSubagentCalls_RunIDBeatsTimeWindow(t *testing.T) {
	calls := []SubagentCall{
		{Agent: "worker", Timestamp: 1_000_000, RunID: "aaaa-1111"},
	}
	candidates := []SubagentCandidate{
		{SessionKey: "wanted", CreatedAt: 1_030_000, ParentKey: "p", Kind: SessionKindSubagent, RunID: "aaaa-1111"},
		{SessionKey: "other-1", CreatedAt: 1_040_000, ParentKey: "p", Kind: SessionKindSubagent, RunID: "bbbb-2222"},
		{SessionKey: "other-2", CreatedAt: 1_050_000, ParentKey: "p", Kind: SessionKindSubagent, RunID: "cccc-3333"},
	}
	matches := matchSubagentCalls(calls, candidates)
	if matches[0].Status != SubagentMatchMatched {
		t.Fatalf("expected matched, got %s", matches[0].Status)
	}
	if matches[0].SessionKey != "wanted" {
		t.Fatalf("expected wanted, got %q", matches[0].SessionKey)
	}
}

// pi-subagents 的 fork-context 子代理落在 forks/ 目录下（kind=fork）。run id 相等时
// 必须能认出来，否则这类子代理永远折叠不了。
func TestMatchSubagentCalls_RunIDMatchesForkKindCandidate(t *testing.T) {
	calls := []SubagentCall{
		{Agent: "worker", Timestamp: 1_000_000, RunID: "95145195-af2e-4529-839d-3d68c6531cf6"},
	}
	candidates := []SubagentCandidate{
		{
			SessionKey: "fork-child",
			CreatedAt:  1_000_500,
			ParentKey:  "p",
			Kind:       SessionKindFork,
			RunID:      "95145195-af2e-4529-839d-3d68c6531cf6",
		},
	}
	matches := matchSubagentCalls(calls, candidates)
	if matches[0].Status != SubagentMatchMatched || matches[0].SessionKey != "fork-child" {
		t.Fatalf("expected fork-kind candidate matched by run id, got %s/%q", matches[0].Status, matches[0].SessionKey)
	}
}

// run id 不相等时不得回落到时间窗：那正是"猜"的来源。
func TestMatchSubagentCalls_RunIDMismatchDoesNotFallBack(t *testing.T) {
	calls := []SubagentCall{
		{Agent: "worker", Timestamp: 1_000_000, RunID: "aaaa-1111"},
	}
	candidates := []SubagentCandidate{
		{SessionKey: "nearby", CreatedAt: 1_000_100, ParentKey: "p", Kind: SessionKindSubagent, RunID: "bbbb-2222"},
	}
	matches := matchSubagentCalls(calls, candidates)
	if matches[0].Status != SubagentMatchMissing {
		t.Fatalf("expected missing when run ids differ, got %s", matches[0].Status)
	}
}

// 用户真·分叉没有 run id 形态的名字，仍然被 kind=fork 排除。
func TestMatchSubagentCalls_PlainForkStillExcluded(t *testing.T) {
	calls := []SubagentCall{
		{Agent: "worker", Timestamp: 1_000_000},
	}
	candidates := []SubagentCandidate{
		{SessionKey: "user-fork", CreatedAt: 1_000_100, ParentKey: "p", Kind: SessionKindFork},
	}
	matches := matchSubagentCalls(calls, candidates)
	if matches[0].Status != SubagentMatchMissing {
		t.Fatalf("expected missing for a user fork, got %s", matches[0].Status)
	}
}

func TestParseSubagentRunID(t *testing.T) {
	cases := []struct {
		name string
		text string
		want string
	}{
		{
			name: "async dispatch",
			text: "Run fan-out: 1/64 used\nAsync: worker [95145195-af2e-4529-839d-3d68c6531cf6]\n",
			want: "95145195-af2e-4529-839d-3d68c6531cf6",
		},
		{
			name: "agent with dash",
			text: "Async: claude-code-writer [0f0f0f0f-1111-2222-3333-444444444444]",
			want: "0f0f0f0f-1111-2222-3333-444444444444",
		},
		{name: "no run id", text: "Executable agents: Builtin agents - claude-code", want: ""},
		{name: "empty", text: "", want: ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := parseSubagentRunID(tc.text); got != tc.want {
				t.Fatalf("parseSubagentRunID(%q) = %q, want %q", tc.text, got, tc.want)
			}
		})
	}
}

func TestParseSubagentNameRunID(t *testing.T) {
	cases := []struct {
		name string
		want string
	}{
		{"subagent-worker-95145195-af2e-4529-839d-3d68c6531cf6-1", "95145195-af2e-4529-839d-3d68c6531cf6"},
		{"subagent-reviewer-0f0f0f0f-1111-2222-3333-444444444444-3", "0f0f0f0f-1111-2222-3333-444444444444"},
		{"worker: 检查 diff", ""},
		{"my manual fork", ""},
		{"", ""},
	}
	for _, tc := range cases {
		if got := parseSubagentNameRunID(tc.name); got != tc.want {
			t.Fatalf("parseSubagentNameRunID(%q) = %q, want %q", tc.name, got, tc.want)
		}
	}
}

// session_info 写在十几 MB 文件的末尾，标题扫描的 1MB 上限读不到；尾部读取要能找到。
func TestReadSessionNameFromTail(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "big.jsonl")
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	// 先塞 2MB 填充，把 session_info 推离文件头（超过 titleScanMaxBytes = 1MB）。
	filler := strings.Repeat(`{"type":"message","id":"f","message":{"role":"user","content":[{"type":"text","text":"x"}]}}`+"\n", 20000)
	if _, err := file.WriteString(filler); err != nil {
		t.Fatalf("write filler: %v", err)
	}
	if _, err := file.WriteString(`{"type":"session_info","name":"subagent-worker-95145195-af2e-4529-839d-3d68c6531cf6-1"}` + "\n"); err != nil {
		t.Fatalf("write session_info: %v", err)
	}
	file.Close()

	stat, _ := os.Stat(path)
	if stat.Size() <= titleScanMaxBytes() {
		t.Fatalf("fixture too small to exercise the tail path: %d bytes", stat.Size())
	}
	got := readSessionNameFromTail(path)
	const want = "subagent-worker-95145195-af2e-4529-839d-3d68c6531cf6-1"
	if got != want {
		t.Fatalf("readSessionNameFromTail = %q, want %q", got, want)
	}
	if runID := parseSubagentNameRunID(got); runID != "95145195-af2e-4529-839d-3d68c6531cf6" {
		t.Fatalf("run id = %q", runID)
	}
}

// 尾部读取要能处理"最后一条 session_info 才是最新"的情形，且无视被窗口截断的半行。
func TestReadSessionNameFromTail_TakesLatest(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "s.jsonl")
	content := `{"type":"session_info","name":"old-name"}` + "\n" +
		`{"type":"message","id":"e1","message":{"role":"user","content":[]}}` + "\n" +
		`{"type":"session_info","name":"subagent-worker-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-2"}` + "\n"
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	const want = "subagent-worker-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-2"
	if got := readSessionNameFromTail(path); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestReadSessionNameFromTail_MissingFile(t *testing.T) {
	if got := readSessionNameFromTail(filepath.Join(t.TempDir(), "nope.jsonl")); got != "" {
		t.Fatalf("expected empty name for a missing file, got %q", got)
	}
}

// 派发与它的回执在同一个文件里，按 toolCallId 关联后应带回 run id。
func TestExtractSubagentCalls_AttachesRunID(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "session.jsonl")
	content := `{"type":"message","id":"e1","timestamp":"2026-08-05T05:20:00.000Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"call_1","name":"subagent","arguments":{"agent":"worker","task":"do it"}}]}}` + "\n" +
		`{"type":"message","id":"e2","timestamp":"2026-08-05T05:20:01.000Z","message":{"role":"toolResult","toolCallId":"call_1","toolName":"subagent","content":[{"type":"text","text":"Async: worker [95145195-af2e-4529-839d-3d68c6531cf6]"}]}}` + "\n"
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	calls, err := ExtractSubagentCalls(context.Background(), path)
	if err != nil {
		t.Fatalf("extract: %v", err)
	}
	if len(calls) != 1 {
		t.Fatalf("expected 1 call, got %d", len(calls))
	}
	if calls[0].RunID != "95145195-af2e-4529-839d-3d68c6531cf6" {
		t.Fatalf("run id = %q", calls[0].RunID)
	}
}
