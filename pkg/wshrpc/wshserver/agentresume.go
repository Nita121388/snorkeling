// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/agentcontrol"
	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// AgentResumeCommand recreates an agent block for one existing session — the
// backend twin of the GUI restore flow (RestoreContext RPC -> frontend
// restoreMetaForSession -> createBlock), exposed to the CLI
// (`wsh agent resume`) and MCP (snorkeling_agent_resume). The block is built
// through the same write path agent launch uses (resolveTabTarget +
// CreateBlockCommand + waitForLayoutApplied), so the frontend sees an ordinary
// block, and the shellcontroller consumes the agent:autoresume meta to build
// the provider's real resume args. Nothing here re-implements the restore
// context or the meta: both come from pkg/agentcontrol/restore.go.
func (ws *WshServer) AgentResumeCommand(ctx context.Context, data wshrpc.AgentResumeRequest) (*wshrpc.AgentResumeResult, error) {
	if err := validateLaunchConnection(data.Connection); err != nil {
		return nil, err
	}
	// `--tab new` must name a workspace: unlike launch, resume targets a session
	// that belongs to a specific project, so recreating it in "whatever workspace
	// is active right now" is never what the caller meant. Checked before the
	// session lookup so the E_USAGE is deterministic.
	if strings.TrimSpace(data.Tab) == "new" && strings.TrimSpace(data.WorkspaceId) == "" {
		return nil, fmt.Errorf("E_USAGE: --tab new requires --workspace (resume must target the workspace the session belongs in)")
	}

	identifier, err := agentcontrol.ResolveSessionIdentifier(ctx, data.Identifier, data.BlockId)
	if err != nil {
		return nil, err
	}
	manager := aisessions.NewManager("", nil)
	summary, err := manager.Summary(ctx, identifier, false)
	if err != nil {
		return nil, fmt.Errorf("E_NOT_FOUND: session %q not found", identifier)
	}

	// One source of restore semantics for CLI and MCP: unknown source (gemini)
	// is refused here (E_USAGE), claude vendor failure is E_VENDOR_UNAVAILABLE.
	restoreCtx, err := agentcontrol.ResolveRestoreContext(ctx, &summary)
	if err != nil {
		return nil, err
	}
	meta := agentcontrol.BuildResumeBlockMeta(*restoreCtx, data.Cwd)

	tabId, err := resolveTabTarget(ctx, data.Tab, data.WorkspaceId)
	if err != nil {
		return nil, err
	}
	oref, err := ws.CreateBlockCommand(ctx, wshrpc.CommandCreateBlockData{
		TabId:    tabId,
		BlockDef: &waveobj.BlockDef{Meta: meta},
		Focused:  !data.NoFocus,
	})
	if err != nil {
		return nil, fmt.Errorf("create block: %w", err)
	}

	rtn := &wshrpc.AgentResumeResult{
		Version:     wshrpc.AgentControlVersion,
		Ok:          true,
		BlockId:     oref.OID,
		SessionId:   restoreCtx.SessionId,
		Source:      restoreCtx.Source,
		ProjectPath: restoreCtx.ProjectPath,
		SyncState:   BlockSyncStateDbOnly,
		Warnings:    nil,
	}

	// A send needs the block to exist on the frontend first; without a layout
	// wait the delivery races the mount. The plain --wait flag shares the same
	// budget.
	waitForLayout := data.Wait || data.Send != nil || strings.TrimSpace(data.SendText64) != ""
	if waitForLayout {
		rtn.SyncState, _, rtn.Warnings = waitForLayoutApplied(ctx, tabId, oref.OID, data.WaitMs, rtn.Warnings)
	}

	if data.Send != nil || strings.TrimSpace(data.SendText64) != "" {
		sendReq := wshrpc.AgentSendRequest{
			BlockId:       oref.OID,
			Text:          "",
			Text64:        data.SendText64,
			Submit:        data.Submit,
			Wait:          data.SendWait,
			WaitMs:        data.SendWaitMs,
			QuietMs:       data.QuietMs,
			SubmitDelayMs: data.SubmitDelayMs,
		}
		if data.Send != nil {
			sendReq.Text = *data.Send
		}
		// Reuse the one delivery pipeline (quiet gate + bracketed paste + submit
		// confirm). A delivery failure never rolls the block back (same
		// atomicity as agent launch): the partial result carries BlockId.
		sendRtn, sendErr := ws.AgentSendCommand(ctx, sendReq)
		rtn.Send = sendRtn
		if sendErr != nil {
			return rtn, sendErr
		}
	}
	return rtn, nil
}
