// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentcontrol"
	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// SessionLiveCommand is the read-only live-session merge. It never writes.
func (ws *WshServer) SessionLiveCommand(ctx context.Context, data wshrpc.SessionLiveRequest) (*wshrpc.SessionLiveResult, error) {
	return agentcontrol.BuildLiveSessions(ctx, data)
}

// SessionGetCommand returns one live/indexed session record.
func (ws *WshServer) SessionGetCommand(ctx context.Context, data wshrpc.SessionGetRequest) (*wshrpc.SessionLiveRecord, error) {
	return agentcontrol.GetSessionRecord(ctx, data.Identifier, data.BlockId)
}

// SessionListCommand returns indexed sessions (not necessarily live).
func (ws *WshServer) SessionListCommand(ctx context.Context, data wshrpc.SessionListRequest) (*wshrpc.SessionListResult, error) {
	// The CLI advertises `--marked true|false` but the index filter only
	// speaks "starred"/"unstarred" (the GUI's vocabulary). Normalize once
	// here so both surfaces (CLI flag and MCP `marked` param) filter instead
	// of silently passing everything through (verify-run 20261121T17220).
	data.Marked = normalizeMarkedFilter(data.Marked)
	return agentcontrol.BuildSessionList(ctx, data)
}

// SessionMarkCommand stars/unstars one session (`wsh session mark`,
// MCP snorkeling_session_mark). It is a thin wrapper around the same
// Manager.Mark the GUI's toggleMark calls: marked is a boolean view state, not
// card content, so it deliberately does NOT go through the agentdata patch
// pipeline (design D5). Toggling is idempotent and last-write-wins, so no
// dry-run/hash precondition is needed.
func (ws *WshServer) SessionMarkCommand(ctx context.Context, data wshrpc.SessionMarkRequest) (*wshrpc.SessionMarkResult, error) {
	identifier, err := agentcontrol.ResolveSessionIdentifier(ctx, data.Identifier, data.BlockId)
	if err != nil {
		return nil, err
	}
	manager := aisessions.NewManager("", nil)
	summary, err := manager.Mark(ctx, identifier, data.Marked)
	if err != nil {
		return nil, fmt.Errorf("E_NOT_FOUND: session %q not found", identifier)
	}
	return &wshrpc.SessionMarkResult{
		Version:     wshrpc.AgentControlVersion,
		SessionKey:  summary.Key,
		SessionId:   summary.ID,
		Source:      summary.Source,
		Title:       summary.Title,
		TitleSource: summary.TitleSource,
		ProjectPath: summary.ProjectPath,
		Marked:      summary.Marked,
		UpdatedAt:   summary.UpdatedAt,
	}, nil
}

// SessionInfoCommand is layer 0 of the progressive session read: a size probe
// (counts/bytes/verdict) with no content. Read-only.
func (ws *WshServer) SessionInfoCommand(ctx context.Context, data wshrpc.SessionInfoRequest) (*wshrpc.SessionInfoResult, error) {
	return agentcontrol.GetSessionInfo(ctx, data)
}

// SessionUsersCommand is layer 1: one bounded page of user prompts. Read-only.
func (ws *WshServer) SessionUsersCommand(ctx context.Context, data wshrpc.SessionUsersRequest) (*wshrpc.SessionUsersResult, error) {
	return agentcontrol.GetSessionUsers(ctx, data)
}

// SessionTurnsCommand is layer 2: one bounded page of turn summaries.
// Read-only. Limit is mandatory (1-10).
func (ws *WshServer) SessionTurnsCommand(ctx context.Context, data wshrpc.SessionTurnsRequest) (*wshrpc.SessionTurnsResult, error) {
	return agentcontrol.GetSessionTurns(ctx, data)
}

// SessionTurnCommand is layer 3: one turn's original messages under a chars
// budget. Read-only. Chars is mandatory (1-8000).
func (ws *WshServer) SessionTurnCommand(ctx context.Context, data wshrpc.SessionTurnRequest) (*wshrpc.SessionTurnResult, error) {
	return agentcontrol.GetSessionTurn(ctx, data)
}

const (
	sessionWaitDefaultTimeoutMs = 60000
	sessionWaitMaxTimeoutMs     = 300000
	sessionWaitDefaultPollMs    = 250
	sessionWaitMinPollMs        = 100
	sessionWaitMaxPollMs        = 2000
)

// SessionWaitCommand blocks until one live session reaches a state
// (`wsh session wait`, MCP snorkeling_session_wait) — the generic "wait for a
// state" primitive of the control surface (Herdr `agent wait --until`).
//
// It polls the same live-record merge `session live`/`session get` use, so the
// CLI and the GUI can never disagree about what "idle" means. A timeout is NOT
// an error: matched=false comes back (CLI exit code 3) with the last observed
// state so the caller can tell "never worked" from "still working".
func (ws *WshServer) SessionWaitCommand(ctx context.Context, data wshrpc.SessionWaitRequest) (*wshrpc.SessionWaitResult, error) {
	until, err := normalizeSessionWaitUntil(data.Until)
	if err != nil {
		return nil, err
	}
	timeoutMs := data.TimeoutMs
	if timeoutMs <= 0 {
		timeoutMs = sessionWaitDefaultTimeoutMs
	}
	if timeoutMs > sessionWaitMaxTimeoutMs {
		return nil, fmt.Errorf("E_USAGE: timeoutms %d over the %d ms cap", timeoutMs, sessionWaitMaxTimeoutMs)
	}
	pollMs := data.PollMs
	if pollMs <= 0 {
		pollMs = sessionWaitDefaultPollMs
	}
	if pollMs < sessionWaitMinPollMs {
		pollMs = sessionWaitMinPollMs
	}
	if pollMs > sessionWaitMaxPollMs {
		pollMs = sessionWaitMaxPollMs
	}
	identifier := strings.TrimSpace(data.Identifier)
	if identifier == "" {
		identifier = "this"
	}

	start := time.Now()
	deadline := start.Add(time.Duration(timeoutMs) * time.Millisecond)
	result := &wshrpc.SessionWaitResult{Version: wshrpc.AgentControlVersion, Until: until}
	for {
		rec, err := agentcontrol.GetSessionRecord(ctx, identifier, data.BlockId)
		if err != nil {
			// E_NOT_FOUND (unknown session) must surface immediately: waiting on
			// a session that does not exist can never succeed.
			return nil, err
		}
		result.Polls++
		result.State = replyStateOf(rec)
		result.SessionKey = rec.SessionKey
		result.SessionId = rec.SessionId
		result.BlockId = rec.BlockId
		if sessionWaitMatches(result.State, until) {
			result.Matched = true
			result.WaitedMs = int(time.Since(start).Milliseconds())
			return result, nil
		}
		if time.Now().After(deadline) {
			result.Matched = false
			result.WaitedMs = int(time.Since(start).Milliseconds())
			result.Warnings = append(result.Warnings, "wait-timeout")
			return result, nil
		}
		if !sleepCtx(ctx, time.Duration(pollMs)*time.Millisecond) {
			// RPC deadline first (the CLI must pass timeoutms+slack).
			result.Matched = false
			result.WaitedMs = int(time.Since(start).Milliseconds())
			result.Warnings = append(result.Warnings, "wait-timeout", "wait-rpc-deadline")
			return result, nil
		}
	}
}

// normalizeSessionWaitUntil validates and lowercases the until state. "done" is
// accepted as a synonym of idle because agentstatus normalizes the agents' own
// "done" report to idle; the wait matches the normalized state.
func normalizeSessionWaitUntil(until string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(until))
	switch normalized {
	case "idle", "done", "blocked", "working":
		return normalized, nil
	case "":
		return "", fmt.Errorf("E_USAGE: --until is required (idle|blocked|done|working)")
	}
	return "", fmt.Errorf("E_USAGE: unknown --until %q (idle|blocked|done|working)", until)
}

// sessionWaitMatches compares an observed agent state with the requested one.
// idle and done are the same state (see normalizeSessionWaitUntil); every other
// state is exact, and "unknown"/"stale" never match.
func sessionWaitMatches(state string, until string) bool {
	state = strings.ToLower(strings.TrimSpace(state))
	if until == "done" || until == "idle" {
		return state == "idle" || state == "done"
	}
	return state == until
}

// AgentCardGetCommand reads one session card (read-only).
func (ws *WshServer) AgentCardGetCommand(ctx context.Context, data wshrpc.AgentCardGetRequest) (*wshrpc.AgentCardResult, error) {
	return agentcontrol.GetAgentCard(ctx, data)
}

// AgentCardSetCommand writes one session card through the agentdata patch
// pipeline. It is not read-only: dry-run unless Yes is set.
func (ws *WshServer) AgentCardSetCommand(ctx context.Context, data wshrpc.AgentCardSetRequest) (*wshrpc.AgentCardSetResult, error) {
	return agentcontrol.SetAgentCard(ctx, data)
}

// SessionAnnotateCommand writes one machine annotation draft onto a session
// timeline node. Dry-run unless Yes is set; a real write requires ExpectedHash.
func (ws *WshServer) SessionAnnotateCommand(ctx context.Context, data wshrpc.SessionAnnotateRequest) (*wshrpc.SessionAnnotateResult, error) {
	return agentcontrol.SessionAnnotate(ctx, data)
}

// SessionEmojiGetCommand reads one session's backend emoji prop (read-only).
func (ws *WshServer) SessionEmojiGetCommand(ctx context.Context, data wshrpc.SessionEmojiGetRequest) (*wshrpc.SessionEmojiGetResult, error) {
	return agentcontrol.SessionEmojiGet(ctx, data)
}

// SessionEmojiPropsListCommand returns every backend emoji prop (read-only)
// for the frontend's startup bootstrap of its backend-emoji layer.
func (ws *WshServer) SessionEmojiPropsListCommand(ctx context.Context, data wshrpc.SessionEmojiPropsListRequest) (*wshrpc.SessionEmojiPropsListResult, error) {
	return agentcontrol.SessionEmojiPropsList(ctx)
}

// SessionEmojiSetCommand writes one session's emoji with agent-channel
// semantics (source=ai, user slots skipped, --if-absent idempotent). Not
// read-only: dry-run unless Yes is set.
func (ws *WshServer) SessionEmojiSetCommand(ctx context.Context, data wshrpc.SessionEmojiSetRequest) (*wshrpc.SessionEmojiSetResult, error) {
	return agentcontrol.SessionEmojiSet(ctx, data)
}

// SessionEmojiInjectCommand stores an external agent's live recommendation
// payload for one session (replaces wholesale; empty candidates clears).
func (ws *WshServer) SessionEmojiInjectCommand(ctx context.Context, data wshrpc.SessionEmojiInjectRequest) (*wshrpc.SessionEmojiInjectResult, error) {
	return agentcontrol.SessionEmojiInject(ctx, data)
}

// SessionEmojiRecommendationsCommand reads the current injected payload
// (found=false when absent or expired — the picker hides the section).
func (ws *WshServer) SessionEmojiRecommendationsCommand(ctx context.Context, data wshrpc.SessionEmojiRecommendationsRequest) (*wshrpc.SessionEmojiRecommendationsResult, error) {
	return agentcontrol.SessionEmojiRecommendations(ctx, data)
}

// SessionEmojiPrefsCommand reads the preference buckets for the external
// recommender to consult before injecting (read-only).
func (ws *WshServer) SessionEmojiPrefsCommand(ctx context.Context, data wshrpc.SessionEmojiPrefsRequest) (*wshrpc.SessionEmojiPrefsResult, error) {
	return agentcontrol.SessionEmojiPrefs(ctx, data)
}

// SessionEmojiRecordPickCommand records one UI hand-pick (source=user) plus the
// preference counters in a single transaction. UI channel only.
func (ws *WshServer) SessionEmojiRecordPickCommand(ctx context.Context, data wshrpc.SessionEmojiRecordPickRequest) (*wshrpc.SessionEmojiRecordPickResult, error) {
	return agentcontrol.RecordEmojiPick(ctx, data)
}

// SessionEmojiMigrateCommand migrates one batch of legacy localStorage emoji
// values into the backend (source=user, if-absent, idempotent).
func (ws *WshServer) SessionEmojiMigrateCommand(ctx context.Context, data wshrpc.SessionEmojiMigrateRequest) (*wshrpc.SessionEmojiMigrateResult, error) {
	return agentcontrol.MigrateSessionEmojis(ctx, data)
}

// normalizeMarkedFilter maps the CLI's true/false spelling onto the index's
// starred/unstarred vocabulary; everything else passes through unchanged.
func normalizeMarkedFilter(marked string) string {
	switch strings.ToLower(strings.TrimSpace(marked)) {
	case "true", "yes", "1":
		return "starred"
	case "false", "no", "0":
		return "unstarred"
	}
	return marked
}
