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

func TestTTLExpiryDecaysWorkingToStale(t *testing.T) {
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

	// Watchdog: an expired working report decays to stale instead of vanishing,
	// so a re-pull still shows "stuck" until the agent recovers.
	setTestNow(1_700_000_001_001)
	status = Get("block-1")
	if status == nil || status.State != StateStale {
		t.Fatalf("expected working TTL expiry to decay to stale, got %+v", status)
	}
	if status.Phase != PhaseNone || status.Reason != "ttl-expired" {
		t.Fatalf("unexpected decayed fields: %+v", status)
	}
	if status.ExpiresAt != 1_700_000_001_001+staleTtlMs {
		t.Fatalf("unexpected stale expiry: %+v", status)
	}
	if LastSequenceForTesting("block-1", SourceHook) != 20 {
		t.Fatalf("expected sequence guard to remain after TTL decay")
	}

	// The stale status itself eventually gets cleaned up.
	setTestNow(1_700_000_001_001 + staleTtlMs + 1)
	status = Get("block-1")
	if status != nil {
		t.Fatalf("expected decayed stale status to expire, got %+v", status)
	}
}

func TestWorkingReportAfterDecayRestoresWorking(t *testing.T) {
	ResetForTesting()
	setTestNow(1_700_000_000_000)

	_, _, err := Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateWorking,
		Seq:     20,
		TtlMs:   1000,
	}, "")
	if err != nil {
		t.Fatalf("Report returned error: %v", err)
	}

	setTestNow(1_700_000_001_001)
	if status := Get("block-1"); status == nil || status.State != StateStale {
		t.Fatalf("expected stale before recovery, got %+v", status)
	}

	// A fresh (higher-seq) working report replaces the decayed stale status.
	status, changed, err := Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateWorking,
		Seq:     21,
	}, "")
	if err != nil {
		t.Fatalf("Report after decay returned error: %v", err)
	}
	if !changed || status == nil || status.State != StateWorking {
		t.Fatalf("working report after decay was lost, status=%+v changed=%v", status, changed)
	}
}

func TestProviderErrorReportCoexistsWithHookWorking(t *testing.T) {
	ResetForTesting()
	setTestNow(1_700_000_000_000)

	_, _, err := Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateWorking,
		Seq:     10,
	}, "")
	if err != nil {
		t.Fatalf("Report working returned error: %v", err)
	}

	// Model error lands on its own source with a short TTL; it outranks working
	// while alive but must not clobber the working report slot.
	errStatus, changed, err := Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceProvider,
		State:   StateRateLimited,
		Reason:  "model-http-429",
		Seq:     11,
		TtlMs:   1000,
	}, "")
	if err != nil {
		t.Fatalf("Report error returned error: %v", err)
	}
	if !changed || errStatus == nil || errStatus.State != StateRateLimited {
		t.Fatalf("expected rate-limited canonical, got %+v changed=%v", errStatus, changed)
	}
	if errStatus.Reason != "model-http-429" || errStatus.Confidence != "high" {
		t.Fatalf("unexpected error fields: %+v", errStatus)
	}

	// Error TTL expires -> working resurfaces from the hook slot.
	setTestNow(1_700_000_001_001)
	status := Get("block-1")
	if status == nil || status.State != StateWorking {
		t.Fatalf("expected working to resurface after error expiry, got %+v", status)
	}
}

func TestProviderSourceReleaseClearsErrorOnly(t *testing.T) {
	ResetForTesting()
	setTestNow(1_700_000_000_000)

	_, _, err := Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateWorking,
		Seq:     10,
	}, "")
	if err != nil {
		t.Fatalf("Report working returned error: %v", err)
	}
	_, _, err = Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceProvider,
		State:   StateError,
		Seq:     11,
	}, "")
	if err != nil {
		t.Fatalf("Report error returned error: %v", err)
	}

	// pi clears its model-error report after a successful response; the hook
	// working status is untouched.
	released, changed, err := Release("block-1", SourceProvider, 12)
	if err != nil {
		t.Fatalf("Release returned error: %v", err)
	}
	if !changed || released == nil || released.State != StateWorking {
		t.Fatalf("expected working after provider release, got %+v changed=%v", released, changed)
	}
}

func TestReasonPassthroughAndDefault(t *testing.T) {
	ResetForTesting()
	setTestNow(1_700_000_000_000)

	status, _, err := Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateError,
		Reason:  "model-http-500",
		Seq:     1,
	}, "")
	if err != nil {
		t.Fatalf("Report returned error: %v", err)
	}
	if status == nil || status.State != StateError || status.Reason != "model-http-500" {
		t.Fatalf("expected reason passthrough, got %+v", status)
	}

	status, _, err = Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateWorking,
		Seq:     2,
	}, "")
	if err != nil {
		t.Fatalf("Report returned error: %v", err)
	}
	if status == nil || status.Reason != "explicit-report" {
		t.Fatalf("expected default reason, got %+v", status)
	}
}

func TestNormalizeStateAcceptsErrorStates(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{"error", StateError},
		{"ERROR", StateError},
		{" rate-limited ", StateRateLimited},
		{"stale", StateStale},
		{"nonsense", ""},
	}
	for _, tc := range cases {
		if got := NormalizeState(tc.input); got != tc.want {
			t.Fatalf("NormalizeState(%q) = %q, want %q", tc.input, got, tc.want)
		}
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

func TestGetRetainsCompletedTransitionForLateReader(t *testing.T) {
	ResetForTesting()
	setTestNow(1_700_000_000_000)

	_, _, err := Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateWorking,
		Seq:     20,
	}, "")
	if err != nil {
		t.Fatalf("Report working returned error: %v", err)
	}

	setTestNow(1_700_000_001_000)
	_, _, err = Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateIdle,
		Seq:     21,
	}, "")
	if err != nil {
		t.Fatalf("Report idle returned error: %v", err)
	}

	status := Get("block-1")
	if status == nil {
		t.Fatalf("expected canonical status")
	}
	if status.State != StateIdle || status.PrevState != StateWorking || status.CompletedAt != 1_700_000_001_000 {
		t.Fatalf("late reader should recover completion transition, got %+v", status)
	}
}

func TestCompletedTransitionFollowsCanonicalStateCycle(t *testing.T) {
	ResetForTesting()
	setTestNow(1_700_000_000_000)

	_, _, err := Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateIdle,
		Seq:     10,
	}, "")
	if err != nil {
		t.Fatalf("Report initial idle returned error: %v", err)
	}
	if status := Get("block-1"); status == nil || status.PrevState != "" || status.CompletedAt != 0 {
		t.Fatalf("initial idle should not create a completion transition, got %+v", status)
	}

	setTestNow(1_700_000_001_000)
	_, _, err = Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateWorking,
		Seq:     11,
	}, "")
	if err != nil {
		t.Fatalf("Report working returned error: %v", err)
	}

	setTestNow(1_700_000_002_000)
	_, _, err = Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateIdle,
		Seq:     12,
	}, "")
	if err != nil {
		t.Fatalf("Report first completion returned error: %v", err)
	}
	status := Get("block-1")
	if status == nil || status.PrevState != StateWorking || status.CompletedAt != 1_700_000_002_000 {
		t.Fatalf("expected first recoverable completion, got %+v", status)
	}

	setTestNow(1_700_000_003_000)
	_, _, err = Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateIdle,
		Seq:     13,
	}, "")
	if err != nil {
		t.Fatalf("Report repeated idle returned error: %v", err)
	}
	status = Get("block-1")
	if status == nil || status.PrevState != StateWorking || status.CompletedAt != 1_700_000_002_000 || status.UpdatedAt != 1_700_000_003_000 {
		t.Fatalf("repeated idle should preserve the original completion, got %+v", status)
	}

	setTestNow(1_700_000_004_000)
	_, _, err = Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateWorking,
		Seq:     14,
	}, "")
	if err != nil {
		t.Fatalf("Report second working returned error: %v", err)
	}
	if status = Get("block-1"); status == nil || status.PrevState != "" || status.CompletedAt != 0 {
		t.Fatalf("working should clear the completed transition, got %+v", status)
	}

	setTestNow(1_700_000_005_000)
	_, _, err = Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateIdle,
		Seq:     15,
	}, "")
	if err != nil {
		t.Fatalf("Report second completion returned error: %v", err)
	}
	status = Get("block-1")
	if status == nil || status.PrevState != StateWorking || status.CompletedAt != 1_700_000_005_000 {
		t.Fatalf("expected a new recoverable completion, got %+v", status)
	}
}

func TestTTLReadDoesNotInventCompletedTransition(t *testing.T) {
	ResetForTesting()
	setTestNow(1_700_000_000_000)

	_, _, err := Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceShellIntegration,
		State:   StateIdle,
		Seq:     10,
	}, "")
	if err != nil {
		t.Fatalf("Report idle fallback returned error: %v", err)
	}
	_, _, err = Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateWorking,
		Seq:     10,
		TtlMs:   1000,
	}, "")
	if err != nil {
		t.Fatalf("Report expiring working returned error: %v", err)
	}

	setTestNow(1_700_000_001_001)
	status := Get("block-1")
	if status == nil || status.State != StateIdle {
		t.Fatalf("expected idle fallback after TTL, got %+v", status)
	}
	if status.PrevState != "" || status.CompletedAt != 0 {
		t.Fatalf("a read-time TTL cleanup must not invent completion, got %+v", status)
	}
}

func TestReportReattachesBlockAfterUnsequencedTTLExpiry(t *testing.T) {
	ResetForTesting()
	setTestNow(1_700_000_000_000)

	_, _, err := Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateIdle,
		TtlMs:   1000,
	}, "")
	if err != nil {
		t.Fatalf("Report expiring idle returned error: %v", err)
	}

	setTestNow(1_700_000_001_001)
	status, changed, err := Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateWorking,
	}, "")
	if err != nil {
		t.Fatalf("Report after TTL returned error: %v", err)
	}
	if !changed || status == nil || status.State != StateWorking {
		t.Fatalf("report after unsequenced TTL expiry was lost, status=%+v changed=%v", status, changed)
	}
	if stored := Get("block-1"); stored == nil || stored.State != StateWorking {
		t.Fatalf("report after TTL expiry was not stored, got %+v", stored)
	}
}

func TestReleaseCreatesCompletionFromCanonicalTransition(t *testing.T) {
	ResetForTesting()
	setTestNow(1_700_000_000_000)

	_, _, err := Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceShellIntegration,
		State:   StateIdle,
		Seq:     10,
	}, "")
	if err != nil {
		t.Fatalf("Report idle fallback returned error: %v", err)
	}
	_, _, err = Report(AgentStatusReport{
		BlockId: "block-1",
		Source:  SourceHook,
		State:   StateBlocked,
		Seq:     10,
	}, "")
	if err != nil {
		t.Fatalf("Report blocked returned error: %v", err)
	}

	setTestNow(1_700_000_001_000)
	status, changed, err := Release("block-1", SourceHook, 11)
	if err != nil {
		t.Fatalf("Release blocked returned error: %v", err)
	}
	if !changed || status == nil || status.State != StateIdle ||
		status.PrevState != StateBlocked || status.CompletedAt != 1_700_000_001_000 {
		t.Fatalf("release should expose one recoverable completion, status=%+v changed=%v", status, changed)
	}
	if stored := Get("block-1"); stored == nil || stored.CompletedAt != 1_700_000_001_000 {
		t.Fatalf("late reader lost release completion, got %+v", stored)
	}
}

func TestCompletedTransitionDoesNotLeakIntoNewSessionIdle(t *testing.T) {
	ResetForTesting()
	setTestNow(1_700_000_000_000)

	_, _, err := Report(AgentStatusReport{
		BlockId:   "block-1",
		Provider:  "codex",
		SessionId: "session-a",
		Source:    SourceHook,
		State:     StateWorking,
		Seq:       10,
	}, "")
	if err != nil {
		t.Fatalf("Report session A working returned error: %v", err)
	}
	_, _, err = Report(AgentStatusReport{
		BlockId:   "block-1",
		Provider:  "codex",
		SessionId: "session-a",
		Source:    SourceHook,
		State:     StateIdle,
		Seq:       11,
	}, "")
	if err != nil {
		t.Fatalf("Report session A idle returned error: %v", err)
	}
	if status := Get("block-1"); status == nil || status.CompletedAt == 0 {
		t.Fatalf("expected session A completion, got %+v", status)
	}

	setTestNow(1_700_000_001_000)
	status, _, err := Report(AgentStatusReport{
		BlockId:   "block-1",
		Provider:  "codex",
		SessionId: "session-b",
		Source:    SourceHook,
		State:     StateIdle,
		Seq:       12,
	}, "")
	if err != nil {
		t.Fatalf("Report session B initial idle returned error: %v", err)
	}
	status = Get("block-1")
	if status == nil || status.SessionId != "session-b" {
		t.Fatalf("expected session B idle, got %+v", status)
	}
	if status.PrevState != "" || status.CompletedAt != 0 {
		t.Fatalf("session A completion leaked into session B, got %+v", status)
	}
}

func TestCrossSessionWorkingToIdleDoesNotCreateCompletion(t *testing.T) {
	ResetForTesting()
	setTestNow(1_700_000_000_000)

	_, _, err := Report(AgentStatusReport{
		BlockId:   "block-1",
		Provider:  "codex",
		SessionId: "session-a",
		Source:    SourceHook,
		State:     StateWorking,
		Seq:       10,
	}, "")
	if err != nil {
		t.Fatalf("Report session A working returned error: %v", err)
	}

	setTestNow(1_700_000_001_000)
	status, _, err := Report(AgentStatusReport{
		BlockId:   "block-1",
		Provider:  "codex",
		SessionId: "session-b",
		Source:    SourceHook,
		State:     StateIdle,
		Seq:       11,
	}, "")
	if err != nil {
		t.Fatalf("Report session B idle returned error: %v", err)
	}
	if status == nil || status.PrevState != "" || status.CompletedAt != 0 {
		t.Fatalf("live session B event inherited session A completion, got %+v", status)
	}

	status = Get("block-1")
	if status == nil || status.SessionId != "session-b" {
		t.Fatalf("expected session B idle, got %+v", status)
	}
	if status.PrevState != "" || status.CompletedAt != 0 {
		t.Fatalf("session A working leaked as a session B completion, got %+v", status)
	}
}
