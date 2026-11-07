// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcontrol

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentstatus"
	"github.com/wavetermdev/waveterm/pkg/aisessions/chat"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func workingIssue(updatedAt int64) *wshrpc.SessionLiveIssue {
	return &wshrpc.SessionLiveIssue{State: agentstatus.StateWorking, UpdatedAt: updatedAt, Freshness: freshnessFresh}
}

func idleIssue(updatedAt int64) *wshrpc.SessionLiveIssue {
	return &wshrpc.SessionLiveIssue{State: agentstatus.StateIdle, UpdatedAt: updatedAt, Freshness: freshnessFresh}
}

func runningChat(lastUsed int64) *wshrpc.SessionLiveChat {
	return &wshrpc.SessionLiveChat{State: string(chat.StateRunning), IsStreaming: true, LastUsedAt: lastUsed}
}

func idleChat(lastUsed int64) *wshrpc.SessionLiveChat {
	return &wshrpc.SessionLiveChat{State: string(chat.StateIdle), LastUsedAt: lastUsed}
}

func TestIssueFreshness(t *testing.T) {
	now := int64(1_000_000)
	tests := []struct {
		name      string
		expiresAt int64
		want      string
	}{
		{"no expiry is always fresh", 0, freshnessFresh},
		{"not yet expired", now + 1, freshnessFresh},
		{"exactly expired", now, freshnessStale},
		{"long expired", now - 60_000, freshnessStale},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			issue := issueFromStatus(&agentstatus.AgentStatus{State: agentstatus.StateWorking, ExpiresAt: tt.expiresAt}, now)
			if issue == nil {
				t.Fatal("expected an issue for a non-nil status")
			}
			if issue.Freshness != tt.want {
				t.Fatalf("freshness = %q, want %q", issue.Freshness, tt.want)
			}
		})
	}
}

func TestIssueFromNilStatus(t *testing.T) {
	if issue := issueFromStatus(nil, 1); issue != nil {
		t.Fatalf("nil status must map to nil issue, got %#v", issue)
	}
}

func TestIsIdleRecord(t *testing.T) {
	tests := []struct {
		name string
		rec  wshrpc.SessionLiveRecord
		want bool
	}{
		{
			name: "no issue and no chat is idle",
			rec:  wshrpc.SessionLiveRecord{BlockId: "b1"},
			want: true,
		},
		{
			name: "idle issue without chat is idle",
			rec:  wshrpc.SessionLiveRecord{BlockId: "b1", Issue: idleIssue(10)},
			want: true,
		},
		{
			name: "working issue is never idle",
			rec:  wshrpc.SessionLiveRecord{BlockId: "b1", Issue: workingIssue(10)},
			want: false,
		},
		{
			name: "idle issue with streaming chat is not idle",
			rec:  wshrpc.SessionLiveRecord{BlockId: "b1", Issue: idleIssue(10), Chat: runningChat(20)},
			want: false,
		},
		{
			name: "idle issue with idle chat is idle",
			rec:  wshrpc.SessionLiveRecord{BlockId: "b1", Issue: idleIssue(10), Chat: idleChat(20)},
			want: true,
		},
		{
			name: "no issue but running chat is not idle",
			rec:  wshrpc.SessionLiveRecord{BlockId: "b1", Chat: runningChat(20)},
			want: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isIdleRecord(tt.rec); got != tt.want {
				t.Fatalf("isIdleRecord = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestFilterRecordsDropsOnlyIdle(t *testing.T) {
	records := []wshrpc.SessionLiveRecord{
		{BlockId: "working", Issue: workingIssue(10)},
		{BlockId: "idle", Issue: idleIssue(20)},
		{BlockId: "streaming", Chat: runningChat(30)},
	}
	got := filterRecords(append([]wshrpc.SessionLiveRecord(nil), records...), false)
	if len(got) != 2 {
		t.Fatalf("expected 2 live rows, got %#v", got)
	}
	for _, rec := range got {
		if rec.BlockId == "idle" {
			t.Fatalf("idle row must be filtered out by default: %#v", got)
		}
	}
	all := filterRecords(append([]wshrpc.SessionLiveRecord(nil), records...), true)
	if len(all) != 3 {
		t.Fatalf("includeIdle must keep every row, got %#v", all)
	}
}

func TestSortRecordsOrder(t *testing.T) {
	records := []wshrpc.SessionLiveRecord{
		{BlockId: "c-idle-new", Issue: idleIssue(900)},
		{BlockId: "a-working-old", Issue: workingIssue(100)},
		{BlockId: "b-working-new", Issue: workingIssue(500)},
		{BlockId: "d-unknown"},
		{BlockId: "e-streaming", Chat: runningChat(50)},
	}
	sortRecords(records)
	got := make([]string, len(records))
	for i, rec := range records {
		got[i] = rec.BlockId
	}
	want := []string{"e-streaming", "b-working-new", "a-working-old", "c-idle-new", "d-unknown"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("order = %v, want %v", got, want)
		}
	}
}

func TestSortRecordsTieBreaksOnBlockId(t *testing.T) {
	records := []wshrpc.SessionLiveRecord{
		{BlockId: "z", Issue: workingIssue(100)},
		{BlockId: "a", Issue: workingIssue(100)},
	}
	sortRecords(records)
	if records[0].BlockId != "a" || records[1].BlockId != "z" {
		t.Fatalf("equal priority/activity must tie-break on blockId, got %q,%q", records[0].BlockId, records[1].BlockId)
	}
}

func TestDedupeRecordsKeepsMostActive(t *testing.T) {
	records := []wshrpc.SessionLiveRecord{
		{BlockId: "old-block", SessionKey: "codex:abc", Issue: workingIssue(100)},
		{BlockId: "new-block", SessionKey: "codex:abc", Issue: workingIssue(900)},
	}
	got := dedupeRecords(records)
	if len(got) != 1 {
		t.Fatalf("expected one row per session key, got %#v", got)
	}
	if got[0].BlockId != "new-block" {
		t.Fatalf("expected the most recently active block to win, got %q", got[0].BlockId)
	}
}

func TestDedupeRecordsPrefersChatActivity(t *testing.T) {
	records := []wshrpc.SessionLiveRecord{
		{BlockId: "issue-block", SessionKey: "pi:abc", Issue: workingIssue(100)},
		{BlockId: "chat-block", SessionKey: "pi:abc", Chat: runningChat(900)},
	}
	got := dedupeRecords(records)
	if len(got) != 1 || got[0].BlockId != "chat-block" {
		t.Fatalf("chat lastUsedAt must count as activity, got %#v", got)
	}
}

func TestDedupeRecordsFallsBackToBlockId(t *testing.T) {
	records := []wshrpc.SessionLiveRecord{
		{BlockId: "b1", Issue: workingIssue(10)},
		{BlockId: "b2", Issue: workingIssue(20)},
		{BlockId: "b1", Issue: workingIssue(30)},
	}
	got := dedupeRecords(records)
	if len(got) != 2 {
		t.Fatalf("rows without a session key dedupe by blockId, got %#v", got)
	}
	if got[0].BlockId != "b1" || got[0].Issue.UpdatedAt != 30 {
		t.Fatalf("expected the freshest b1 row to survive, got %#v", got[0])
	}
}

func TestDedupeRecordsPreservesFirstSeenOrder(t *testing.T) {
	records := []wshrpc.SessionLiveRecord{
		{BlockId: "b1", SessionKey: "k1", Issue: workingIssue(100)},
		{BlockId: "b2", SessionKey: "k2", Issue: workingIssue(900)},
		{BlockId: "b3", SessionKey: "k1", Issue: workingIssue(500)},
	}
	got := dedupeRecords(records)
	if len(got) != 2 {
		t.Fatalf("expected 2 rows, got %#v", got)
	}
	if got[0].SessionKey != "k1" || got[1].SessionKey != "k2" {
		t.Fatalf("dedupe must keep first-seen order, got %q,%q", got[0].SessionKey, got[1].SessionKey)
	}
	if got[0].Issue.UpdatedAt != 500 {
		t.Fatalf("expected the freshest k1 row, got %#v", got[0])
	}
}

func TestChatKeyNormalizesWhitespace(t *testing.T) {
	if chatKey(" pi ", " abc ") != chatKey("pi", "abc") {
		t.Fatal("chatKey must trim both halves")
	}
	if chatKey("pi", "abc") == chatKey("codex", "abc") {
		t.Fatal("different sources must not collide")
	}
}

func TestLiveChatFromInfoMapsFields(t *testing.T) {
	got := liveChatFromInfo(chat.LiveChatInfo{
		Source:      "pi",
		SessionID:   "abc",
		State:       chat.StateRunning,
		LastUsed:    1234,
		Provisional: true,
	})
	if got.State != string(chat.StateRunning) {
		t.Fatalf("state not mapped: %#v", got)
	}
	if got.LastUsedAt != 1234 {
		t.Fatalf("lastUsedAt not mapped: %#v", got)
	}
	if !got.Provisional {
		t.Fatalf("provisional flag not mapped: %#v", got)
	}
}
