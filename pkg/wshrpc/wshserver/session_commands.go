// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/agentcontrol"
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
	return agentcontrol.BuildSessionList(ctx, data)
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

// AgentCardGetCommand reads one session card (read-only).
func (ws *WshServer) AgentCardGetCommand(ctx context.Context, data wshrpc.AgentCardGetRequest) (*wshrpc.AgentCardResult, error) {
	return agentcontrol.GetAgentCard(ctx, data)
}

// AgentCardSetCommand writes one session card through the agentdata patch
// pipeline. It is not read-only: dry-run unless Yes is set.
func (ws *WshServer) AgentCardSetCommand(ctx context.Context, data wshrpc.AgentCardSetRequest) (*wshrpc.AgentCardSetResult, error) {
	return agentcontrol.SetAgentCard(ctx, data)
}
