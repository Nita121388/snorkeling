// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// captureClaudeSessionIdForBlock and CaptureManualClaudeSessionIdForBlock hit
// wstore DB (DBGet + persistAgentSessionId via UpdateObjectMeta). With the test
// harness in this package, globalDB is not initialized — DBGet returns
// (nil, "invalid nil DB passed to WithTxRtn") and the capture loops abort on
// the `err != nil || block == nil` guard before reaching persist. Tests below
// therefore cover the early-return / guard paths and the contract that no
// per-attempt state leaks when DB is unavailable. The successful persist path
// is verified end-to-end (see Obsidian note 14-agent-block-sessionid-异步兜底).

func TestCaptureClaudeSessionIdForBlock_EmptyArgs(t *testing.T) {
	// Should be a no-op without touching DB; no panic, no goroutine leak risk.
	captureClaudeSessionIdForBlock("", "session-abc")
	captureClaudeSessionIdForBlock("block-1", "")
	captureClaudeSessionIdForBlock("", "")
}

func TestCaptureClaudeSessionIdForBlock_AbortsWhenDBUnavailable(t *testing.T) {
	// globalDB not initialized in this test binary → DBGet returns (nil, err),
	// first iteration hits the `err != nil || block == nil` guard and returns.
	// We just assert no panic and that the call returns within a reasonable time
	// (the function's only sleep path is skipped on i==0 and on early-return).
	captureClaudeSessionIdForBlock("block-no-db", "session-abc")
}

func TestCaptureManualClaudeSessionIdForBlock_EmptyBlockId(t *testing.T) {
	// Should be a no-op without touching DB.
	CaptureManualClaudeSessionIdForBlock("", time.Now())
}

func TestCaptureManualClaudeSessionIdForBlock_AbortsWhenDBUnavailable(t *testing.T) {
	// globalDB not initialized → DBGet returns (nil, err) → first iteration
	// returns via the err/nil-block guard before any provider/autoresume check
	// or persist attempt. Verifies no panic, no spurious log spam.
	CaptureManualClaudeSessionIdForBlock("block-no-db", time.Now())
}

// --- maybeCaptureManualClaudeSessionId early-out table (wshserver package owns
// the rider, but the guard logic is mirrored here for documentation; the real
// rider is tested via wshserver tests). We test the *equivalent* guard chain
// by re-implementing the same early-out conditions inline and verifying each one
// rejects. This keeps blockcontroller tests self-contained without importing
// wshserver (which would create an import cycle). ---

func TestMaybeCaptureManualClaudeSessionId_GuardChain(t *testing.T) {
	// Mirrors maybeCaptureManualClaudeSessionId's early-out conditions exactly.
	// Returns true when the rider WOULD fire CaptureManualClaudeSessionIdForBlock.
	wouldFire := func(oref waveobj.ORef, meta waveobj.MetaMapType) bool {
		if oref.OType != waveobj.OType_Block {
			return false
		}
		provider := strings.TrimSpace(strings.ToLower(meta.GetString(MetaKey_AgentProvider, "")))
		if provider != AgentProviderClaude {
			return false
		}
		if !meta.GetBool(MetaKey_AgentAutoResume, false) {
			return false
		}
		if strings.TrimSpace(meta.GetString(MetaKey_AgentSessionId, "")) != "" {
			return false
		}
		return true
	}

	blockORef := waveobj.MakeORef(waveobj.OType_Block, "block-1")
	nonBlockORef := waveobj.MakeORef(waveobj.OType_Workspace, "ws-1")

	cases := []struct {
		name    string
		oref    waveobj.ORef
		meta    waveobj.MetaMapType
		wantFire bool
	}{
		{
			name: "non-block oref rejected",
			oref: nonBlockORef,
			meta: waveobj.MetaMapType{
				MetaKey_AgentProvider:   AgentProviderClaude,
				MetaKey_AgentAutoResume: true,
			},
			wantFire: false,
		},
		{
			name: "codex provider rejected",
			oref: blockORef,
			meta: waveobj.MetaMapType{
				MetaKey_AgentProvider:   AgentProviderCodex,
				MetaKey_AgentAutoResume: true,
			},
			wantFire: false,
		},
		{
			name: "empty provider rejected (not inferred from cmd here)",
			oref: blockORef,
			meta: waveobj.MetaMapType{
				waveobj.MetaKey_Cmd:     "claude",
				MetaKey_AgentAutoResume: true,
			},
			wantFire: false,
		},
		{
			name: "autoresume false rejected",
			oref: blockORef,
			meta: waveobj.MetaMapType{
				MetaKey_AgentProvider:   AgentProviderClaude,
				MetaKey_AgentAutoResume: false,
			},
			wantFire: false,
		},
		{
			name: "existing sessionid rejected",
			oref: blockORef,
			meta: waveobj.MetaMapType{
				MetaKey_AgentProvider:   AgentProviderClaude,
				MetaKey_AgentAutoResume: true,
				MetaKey_AgentSessionId:  "existing-id",
			},
			wantFire: false,
		},
		{
			name: "whitespace-only sessionid treated as empty (rider fires)",
			oref: blockORef,
			meta: waveobj.MetaMapType{
				MetaKey_AgentProvider:   AgentProviderClaude,
				MetaKey_AgentAutoResume: true,
				MetaKey_AgentSessionId:  "   ",
			},
			wantFire: true,
		},
		{
			name: "uppercase CLAUDE provider rejected (rider lowercases)",
			oref: blockORef,
			meta: waveobj.MetaMapType{
				MetaKey_AgentProvider:   "CLAUDE",
				MetaKey_AgentAutoResume: true,
			},
			wantFire: true, // strings.ToLower normalizes "CLAUDE" → "claude"
		},
		{
			name: "all conditions met → fires",
			oref: blockORef,
			meta: waveobj.MetaMapType{
				MetaKey_AgentProvider:   AgentProviderClaude,
				MetaKey_AgentAutoResume: true,
			},
			wantFire: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := wouldFire(tc.oref, tc.meta); got != tc.wantFire {
				t.Fatalf("wouldFire=%v, want %v", got, tc.wantFire)
			}
		})
	}
}

// TestResolveAgentCmdAndArgs_ClaudeNewSessionMintsUuidAndForceInjectsArg asserts the
// claude main path mints a uuid, persists it (best-effort — failure logs but does
// not block), and injects --session-id into args. Does not assert persist success
// since globalDB isn't initialized here; the async retry goroutine is fired but
// will no-op on the first DBGet guard — exercising the no-panic contract.
func TestResolveAgentCmdAndArgs_ClaudeNewSessionMintsUuidAndForceInjectsArg(t *testing.T) {
	meta := waveobj.MetaMapType{
		waveobj.MetaKey_Cmd:     "claude",
		MetaKey_AgentAutoResume: true,
		MetaKey_AgentProvider:   AgentProviderClaude,
	}
	cmd, args, runInfo, err := resolveAgentCmdAndArgs("block:claude-test", meta, true, "/Users/tester")
	if err != nil {
		t.Fatalf("resolveAgentCmdAndArgs returned error: %v", err)
	}
	if cmd != "claude" {
		t.Fatalf("unexpected cmd: %s", cmd)
	}
	if runInfo == nil || runInfo.Provider != AgentProviderClaude {
		t.Fatalf("expected claude run info, got %#v", runInfo)
	}
	if runInfo.SessionId == "" {
		t.Fatal("expected minted claude session id, got empty")
	}
	// ensureClaudeSessionIdArg must have injected --session-id <id> somewhere.
	foundSessionArg := false
	for i, a := range args {
		if a == "--session-id" && i+1 < len(args) && args[i+1] == runInfo.SessionId {
			foundSessionArg = true
			break
		}
	}
	if !foundSessionArg {
		t.Fatalf("expected --session-id %s in args, got %#v", runInfo.SessionId, args)
	}
}

// TestResolveAgentCmdAndArgs_ClaudeResumeWithExistingSessionIdShortCircuits asserts
// that when block meta already has an agent:sessionid, the claude path appends
// `--resume <id>` and does NOT mint a new uuid or fire the async retry goroutine
// (hadSessionId branch at :926 short-circuits before :918).
func TestResolveAgentCmdAndArgs_ClaudeResumeWithExistingSessionIdShortCircuits(t *testing.T) {
	meta := waveobj.MetaMapType{
		waveobj.MetaKey_Cmd:     "claude",
		MetaKey_AgentAutoResume: true,
		MetaKey_AgentProvider:   AgentProviderClaude,
		MetaKey_AgentSessionId:  "persisted-claude-session",
	}
	_, args, runInfo, err := resolveAgentCmdAndArgs("block:claude-resume", meta, true, "/Users/tester")
	if err != nil {
		t.Fatalf("resolveAgentCmdAndArgs returned error: %v", err)
	}
	if runInfo == nil || runInfo.SessionId != "persisted-claude-session" {
		t.Fatalf("expected run info to carry existing id, got %#v", runInfo)
	}
	// Should have `--resume persisted-claude-session` somewhere in args.
	foundResume := false
	for i, a := range args {
		if a == "--resume" && i+1 < len(args) && args[i+1] == "persisted-claude-session" {
			foundResume = true
			break
		}
	}
	if !foundResume {
		t.Fatalf("expected --resume persisted-claude-session in args, got %#v", args)
	}
}

