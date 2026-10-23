// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/agentcatalog"
)

// AgentProfileListCommand returns the merged agent catalog (built-in profiles +
// user `agent:profiles` settings). It is the single source of truth shared by the
// scheduled-task editor, `wsh agent list`, and future agent-block creation.
func (ws *WshServer) AgentProfileListCommand(ctx context.Context) ([]agentcatalog.ProfileInfo, error) {
	return agentcatalog.List(), nil
}
