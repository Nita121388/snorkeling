// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentstatus"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// Red-proof prerequisites for F-1121-agent-roundtrip: the completion
// predicate, the parameter validation and the result fields do not exist yet.

// replyComplete requires ALL FOUR signals: agentstatus advanced, the session
// file changed, the turn count grew and the agent reported settled. Any single
// signal alone must NOT count as a completed turn (prd: 半截回复 / 会话被并发
// 写入 / 审批暂停都只动一个信号).
//
// The state dimension is the 2026-11-21 真机 regression: the three original
// signals all fire at the *start* of a turn (working report / user message on
// disk / new turn index), so "three signals advanced" while still working must
// NOT be a completed reply.
func TestReplyCompleteMatrix(t *testing.T) {
	base := replyBaseline{agentSeq: 10, fileSize: 100, turnCount: 3, state: agentstatus.StateIdle}
	cases := []struct {
		name string
		now  replyBaseline
		want bool
	}{
		{"all three advanced and settled", replyBaseline{agentSeq: 11, fileSize: 150, turnCount: 4, state: agentstatus.StateIdle}, true},
		{"all three advanced but still working", replyBaseline{agentSeq: 11, fileSize: 150, turnCount: 4, state: agentstatus.StateWorking}, false},
		{"all three advanced and done", replyBaseline{agentSeq: 11, fileSize: 150, turnCount: 4, state: replyStateDone}, true},
		{"all three advanced but blocked", replyBaseline{agentSeq: 11, fileSize: 150, turnCount: 4, state: agentstatus.StateBlocked}, false},
		{"all three advanced but no state", replyBaseline{agentSeq: 11, fileSize: 150, turnCount: 4}, false},
		{"agentstatus only", replyBaseline{agentSeq: 11, fileSize: 100, turnCount: 3, state: agentstatus.StateIdle}, false},
		{"file only", replyBaseline{agentSeq: 10, fileSize: 150, turnCount: 3, state: agentstatus.StateIdle}, false},
		{"turn only", replyBaseline{agentSeq: 10, fileSize: 100, turnCount: 4, state: agentstatus.StateIdle}, false},
		{"settled only", replyBaseline{agentSeq: 10, fileSize: 100, turnCount: 3, state: agentstatus.StateIdle}, false},
		{"nothing advanced", base, false},
		{"file shrank while rest advanced", replyBaseline{agentSeq: 11, fileSize: 50, turnCount: 4, state: agentstatus.StateIdle}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := replyComplete(base, tc.now); got != tc.want {
				t.Errorf("replyComplete(base, %s) = %v, want %v", tc.name, got, tc.want)
			}
		})
	}
}

// replySettled is the fourth signal on its own: only idle/done mean "no turn is
// running". working is the turn itself, blocked may resume, and every other
// state (unknown/stale/release/error/rate-limited/empty) gives no evidence and
// must fall back to the deadline.
func TestReplySettled(t *testing.T) {
	cases := []struct {
		state string
		want  bool
	}{
		{agentstatus.StateIdle, true},
		{"IDLE", true},
		{" idle ", true},
		{replyStateDone, true},
		{"DONE", true},
		{agentstatus.StateWorking, false},
		{agentstatus.StateBlocked, false},
		{agentstatus.StateUnknown, false},
		{agentstatus.StateStale, false},
		{agentstatus.StateRelease, false},
		{agentstatus.StateError, false},
		{agentstatus.StateRateLimited, false},
		{"", false},
	}
	for _, tc := range cases {
		label := tc.state
		if label == "" {
			label = "empty"
		}
		t.Run(label, func(t *testing.T) {
			if got := replySettled(tc.state); got != tc.want {
				t.Errorf("replySettled(%q) = %v, want %v", tc.state, got, tc.want)
			}
		})
	}
}

// WaitReply is incompatible with the async dispatch queue (sync wait vs
// fire-and-forget) and with NoWait (wait vs return-cursor).
func TestWaitReplyParamValidation(t *testing.T) {
	submit := true
	cases := []struct {
		name string
		req  wshrpc.AgentSendRequest
	}{
		{"wait-reply plus async", wshrpc.AgentSendRequest{WaitReply: &submit, Async: true}},
		{"wait-reply plus no-wait", wshrpc.AgentSendRequest{WaitReply: &submit, NoWait: true}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := normalizeSendParams(tc.req); err == nil {
				t.Errorf("normalizeSendParams accepted %s, want E_USAGE", tc.name)
			}
		})
	}
}

// AC3: the reply budgets are clamped, not rejected (a caller asking for more
// than the read path can deliver gets the maximum); the wait window itself is
// capped like every other long window (E_USAGE over the cap).
func TestReplyBudgetClamp(t *testing.T) {
	wait := true
	cases := []struct {
		name      string
		req       wshrpc.AgentSendRequest
		wantChars int
		wantPoll  int
		wantWait  int
	}{
		{"defaults", wshrpc.AgentSendRequest{WaitReply: &wait}, 2000, 250, 60000},
		{"chars over cap", wshrpc.AgentSendRequest{WaitReply: &wait, ReplyChars: 99999}, 8000, 250, 60000},
		{"chars under floor", wshrpc.AgentSendRequest{WaitReply: &wait, ReplyChars: -5}, 2000, 250, 60000},
		{"poll over cap", wshrpc.AgentSendRequest{WaitReply: &wait, ReplyPollMs: 99999}, 2000, 2000, 60000},
		{"poll under floor", wshrpc.AgentSendRequest{WaitReply: &wait, ReplyPollMs: 1}, 2000, 100, 60000},
		{"wait over cap", wshrpc.AgentSendRequest{WaitReply: &wait, ReplyWaitMs: 300000}, 2000, 250, 300000},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			params, err := normalizeSendParams(tc.req)
			if err != nil {
				t.Fatalf("normalizeSendParams(%s) error: %v", tc.name, err)
			}
			if params.ReplyChars != tc.wantChars || params.ReplyPollMs != tc.wantPoll || params.ReplyWaitMs != tc.wantWait {
				t.Errorf("%s = chars %d poll %d wait %d, want %d/%d/%d",
					tc.name, params.ReplyChars, params.ReplyPollMs, params.ReplyWaitMs, tc.wantChars, tc.wantPoll, tc.wantWait)
			}
		})
	}
	if _, err := normalizeSendParams(wshrpc.AgentSendRequest{WaitReply: &wait, ReplyWaitMs: 300001}); err == nil {
		t.Error("replywaitms over the 300000 ms cap must be E_USAGE")
	}
}
