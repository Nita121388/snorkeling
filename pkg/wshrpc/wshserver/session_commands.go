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

// AgentCardGetCommand reads one session card (read-only).
func (ws *WshServer) AgentCardGetCommand(ctx context.Context, data wshrpc.AgentCardGetRequest) (*wshrpc.AgentCardResult, error) {
	return agentcontrol.GetAgentCard(ctx, data)
}

// AgentCardSetCommand writes one session card through the agentdata patch
// pipeline. It is not read-only: dry-run unless Yes is set.
func (ws *WshServer) AgentCardSetCommand(ctx context.Context, data wshrpc.AgentCardSetRequest) (*wshrpc.AgentCardSetResult, error) {
	return agentcontrol.SetAgentCard(ctx, data)
}
