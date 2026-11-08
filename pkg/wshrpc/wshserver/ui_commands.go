// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/agentcontrol"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// UIActiveCommand returns "where am I" vs "where is the user". Read-only.
func (ws *WshServer) UIActiveCommand(ctx context.Context, data wshrpc.UIActiveRequest) (*wshrpc.UIActiveSnapshot, error) {
	return agentcontrol.BuildUIActive(ctx, data)
}

// UIStateCommand returns the backend-only structure snapshot. Read-only.
func (ws *WshServer) UIStateCommand(ctx context.Context, data wshrpc.UIStateRequest) (*wshrpc.UIStateSnapshot, error) {
	return agentcontrol.BuildUIState(ctx, data)
}

// BlockReadCommand returns bounded content for one block. Read-only.
func (ws *WshServer) BlockReadCommand(ctx context.Context, data wshrpc.BlockReadRequest) (*wshrpc.BlockReadResult, error) {
	return agentcontrol.ReadBlock(ctx, data)
}
