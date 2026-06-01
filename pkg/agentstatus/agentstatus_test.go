// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentstatus

import (
	"testing"
	"time"
)

func setTestNow(ms int64) {
	SetNowForTesting(func() time.Time {
		return time.UnixMilli(ms)
	})
}

func TestReportStoresCanonicalStatus(t *testing.T) {
	ResetForTesting()
	setTestNow(1_700_000_000_000)

	status, changed, err := Report(AgentStatusReport{
		BlockId:   "block-1",
		Provider:  " Codex ",
		SessionId: "session-1",
		Source:    SourceHook,
		State:     StateWorking,
		Phase:     PhaseThinking,
		Seq:       10,
	}, "")
	if err != nil {
		t.Fatalf("Report returned error: %v", err)
	}
	if !changed {
		t.Fatalf("expected first report to change canonical status")
	}
	if status == nil {
		t.Fatalf("expected status")
	}
	if status.BlockId != "block-1" || status.Provider != "codex" || status.SessionId != "session-1" {
		t.Fatalf("unexpected identity fields: %+v", status)
	}
	if status.State != StateWorking || status.Phase != PhaseThinking || status.Source != SourceHook {
		t.Fatalf("unexpected status fields: %+v", status)
	}
	if status.Confidence != "high" || status.Reason != "explicit-report" {
		t.Fatalf("unexpected confidence/reason: %+v", status)
	}
	if status.UpdatedAt != 1_700_000_000_000 || status.ActiveSince != 1_700_000_000_000 {
		t.Fatalf("unexpected timestamps: %+v", status)
	}
}

func TestStatePriorityChoosesCanonicalStatus(t *testing.T) {
	ResetForTesting()
	setTestNow(1_700_000_000_000)

	_, _, err := Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateWorking,
		Phase:   PhaseThinking,
		Seq:     10,
	}, "")
	if err != nil {
		t.Fatalf("Report working returned error: %v", err)
	}
	_, _, err = Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceManual,
		State:   StateBlocked,
		Phase:   PhaseApproval,
		Seq:     10,
	}, "")
	if err != nil {
		t.Fatalf("Report blocked returned error: %v", err)
	}

	status := Get("block-1")
	if status == nil {
		t.Fatalf("expected canonical status")
	}
	if status.State != StateBlocked || status.Source != SourceManual {
		t.Fatalf("blocked status should win over working status, got %+v", status)
	}
}

func TestSourcePriorityBreaksStateTies(t *testing.T) {
	ResetForTesting()
	setTestNow(1_700_000_000_000)

	_, _, err := Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceShellIntegration,
		State:   StateWorking,
		Phase:   PhaseShellCommand,
		Seq:     10,
	}, "")
	if err != nil {
		t.Fatalf("Report shell integration returned error: %v", err)
	}
	_, _, err = Report(AgentStatusReport{
		BlockId:  "block-1",
		Source:   SourceHook,
		State:    StateWorking,
		Phase:    PhaseTool,
		ToolName: "read",
		Seq:      10,
	}, "")
	if err != nil {
		t.Fatalf("Report hook returned error: %v", err)
	}

	status := Get("block-1")
	if status == nil {
		t.Fatalf("expected canonical status")
	}
	if status.Source != SourceHook || status.Phase != PhaseTool || status.ToolName != "read" {
		t.Fatalf("hook status should win same-state tie, got %+v", status)
	}
}

func TestRejectsStaleAndUnsequencedReportsAfterSequence(t *testing.T) {
	ResetForTesting()
	setTestNow(1_700_000_000_000)

	_, _, err := Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateWorking,
		Seq:     20,
	}, "")
	if err != nil {
		t.Fatalf("Report initial returned error: %v", err)
	}
	status, changed, err := Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateIdle,
		Seq:     19,
	}, "")
	if err != nil {
		t.Fatalf("Report stale returned error: %v", err)
	}
	if changed {
		t.Fatalf("stale report should not change status")
	}
	if status == nil || status.State != StateWorking || status.Seq != 20 {
		t.Fatalf("stale report changed canonical status: %+v", status)
	}

	status, changed, err = Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateIdle,
	}, "")
	if err != nil {
		t.Fatalf("Report unsequenced returned error: %v", err)
	}
	if changed {
		t.Fatalf("unsequenced report should not change status after source used seq")
	}
	if status == nil || status.State != StateWorking || status.Seq != 20 {
		t.Fatalf("unsequenced report changed canonical status: %+v", status)
	}
}

func TestRejectsStaleReleaseAfterSequence(t *testing.T) {
	ResetForTesting()
	setTestNow(1_700_000_000_000)

	_, _, err := Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateWorking,
		Seq:     20,
	}, "")
	if err != nil {
		t.Fatalf("Report initial returned error: %v", err)
	}
	status, changed, err := Release("block-1", SourceHook, 19)
	if err != nil {
		t.Fatalf("Release stale returned error: %v", err)
	}
	if changed {
		t.Fatalf("stale release should not change status")
	}
	if status == nil || status.State != StateWorking || status.Seq != 20 {
		t.Fatalf("stale release changed canonical status: %+v", status)
	}
}

func TestReleaseClearsSourceAndKeepsSequenceGuard(t *testing.T) {
	ResetForTesting()
	setTestNow(1_700_000_000_000)

	_, _, err := Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateWorking,
		Seq:     20,
	}, "")
	if err != nil {
		t.Fatalf("Report initial returned error: %v", err)
	}
	status, changed, err := Release("block-1", SourceHook, 21)
	if err != nil {
		t.Fatalf("Release returned error: %v", err)
	}
	if !changed {
		t.Fatalf("release should change canonical status")
	}
	if status != nil {
		t.Fatalf("expected canonical status to clear, got %+v", status)
	}

	status, changed, err = Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateWorking,
		Seq:     20,
	}, "")
	if err != nil {
		t.Fatalf("Report stale after release returned error: %v", err)
	}
	if changed || status != nil {
		t.Fatalf("stale report after release should stay cleared, status=%+v changed=%v", status, changed)
	}
}

func TestForceReleaseClearsSequencedSource(t *testing.T) {
	ResetForTesting()
	setTestNow(1_700_000_000_000)

	_, _, err := Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateWorking,
		Seq:     20,
	}, "")
	if err != nil {
		t.Fatalf("Report initial returned error: %v", err)
	}
	status, changed, err := ForceRelease("block-1", SourceHook)
	if err != nil {
		t.Fatalf("ForceRelease returned error: %v", err)
	}
	if !changed || status != nil {
		t.Fatalf("expected force release to clear canonical status, status=%+v changed=%v", status, changed)
	}

	status, changed, err = Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateWorking,
		Seq:     19,
	}, "")
	if err != nil {
		t.Fatalf("Report after force release returned error: %v", err)
	}
	if changed || status != nil {
		t.Fatalf("expected force release to keep sequence guard against old reports, status=%+v changed=%v", status, changed)
	}

	status, changed, err = Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateWorking,
		Seq:     21,
	}, "")
	if err != nil {
		t.Fatalf("Report new sequence after force release returned error: %v", err)
	}
	if !changed || status == nil || status.Seq != 21 {
		t.Fatalf("expected newer sequence to report after force release, status=%+v changed=%v", status, changed)
	}
}

func TestTTLExpiryRemovesCanonicalStatus(t *testing.T) {
	ResetForTesting()
	setTestNow(1_700_000_000_000)

	status, _, err := Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateWorking,
		Seq:     20,
		TtlMs:   1000,
	}, "")
	if err != nil {
		t.Fatalf("Report returned error: %v", err)
	}
	if status == nil || status.ExpiresAt != 1_700_000_001_000 {
		t.Fatalf("unexpected TTL status: %+v", status)
	}

	setTestNow(1_700_000_001_001)
	status = Get("block-1")
	if status != nil {
		t.Fatalf("expected status to expire, got %+v", status)
	}
	if LastSequenceForTesting("block-1", SourceHook) != 20 {
		t.Fatalf("expected sequence guard to remain after TTL expiry")
	}
}

func TestToolNameDefaultsPhaseToTool(t *testing.T) {
	ResetForTesting()
	setTestNow(1_700_000_000_000)

	status, _, err := Report(AgentStatusReport{
		BlockId:  "block-1",
		Source:   SourceHook,
		State:    StateWorking,
		ToolName: "grep",
		Seq:      20,
	}, "")
	if err != nil {
		t.Fatalf("Report returned error: %v", err)
	}
	if status == nil || status.Phase != PhaseTool || status.ToolName != "grep" {
		t.Fatalf("expected tool phase, got %+v", status)
	}
}
