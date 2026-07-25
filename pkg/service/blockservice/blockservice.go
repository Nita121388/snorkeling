// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockservice

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/agentstatus"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/ccswitch"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/pslog"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

type BlockService struct{}

const DefaultTimeout = 2 * time.Second

var BlockServiceInstance = &BlockService{}

func (bs *BlockService) SendCommand_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "send command to block",
		ArgNames: []string{"blockid", "cmd"},
	}
}

func (bs *BlockService) GetControllerStatus(ctx context.Context, blockId string) (*blockcontroller.BlockControllerRuntimeStatus, error) {
	return blockcontroller.GetBlockControllerRuntimeStatus(blockId), nil
}

func (*BlockService) GetAgentStatus_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "get canonical agent status for a block",
		ArgNames:   []string{"ctx", "blockId"},
		ReturnDesc: "agent status",
	}
}

func (bs *BlockService) GetAgentStatus(ctx context.Context, blockId string) (*agentstatus.AgentStatus, error) {
	status := agentstatus.Get(blockId)
	if blockId != "" {
		// agent.status/get-serve: the only GetAgentStatus RPC service entry,
		// hit on every block load by FE (term-model + agent-status-store initial
		// pull). Reason carries the resulting canonical state (or "" when nil)
		// so the gap "initial pull has no PrevState vs event-emit does" is visible.
		state := ""
		sessionId := ""
		if status != nil {
			state = status.State
			sessionId = status.SessionId
		}
		pslog.AppendEvent(pslog.Event{
			Name:    "agent.status",
			Stage:   "get-serve",
			TraceId: pslog.MakeAgentTraceId(blockId, sessionId),
			BlockId: blockId,
			Reason:  state,
		})
	}
	return status, nil
}

func (*BlockService) CheckAgentStatusHooks_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "check agent status hook installation status",
		ArgNames:   []string{"ctx", "target"},
		ReturnDesc: "agent status hook installation status",
	}
}

func (bs *BlockService) CheckAgentStatusHooks(ctx context.Context, target string) (*agentstatus.HookStatusResult, error) {
	return agentstatus.CheckHooks(target)
}

func (*BlockService) InstallAgentStatusHooks_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "install agent status hooks after explicit user consent",
		ArgNames:   []string{"ctx", "target"},
		ReturnDesc: "agent status hook installation results",
	}
}

func (bs *BlockService) InstallAgentStatusHooks(ctx context.Context, target string) ([]agentstatus.HookInstallResult, error) {
	return agentstatus.InstallHooks(target)
}

func (*BlockService) GetVendorIsolationStatus_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "get a redacted diagnostic snapshot for one isolated agent vendor",
		ArgNames:   []string{"ctx", "apptype", "vendorid"},
		ReturnDesc: "redacted vendor isolation status",
	}
}

func (bs *BlockService) GetVendorIsolationStatus(ctx context.Context, appType string, vendorID string) (*ccswitch.VendorIsolationStatus, error) {
	return ccswitch.GetVendorIsolationStatus(ctx, appType, vendorID)
}

func (*BlockService) ReportAgentStatus_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "report canonical agent status for a block",
		ArgNames:   []string{"ctx", "report"},
		ReturnDesc: "agent status",
	}
}

func (bs *BlockService) ReportAgentStatus(ctx context.Context, report agentstatus.AgentStatusReport) (*agentstatus.AgentStatus, error) {
	report, err := agentstatus.SanitizeReport(report, "")
	if err != nil {
		return nil, err
	}
	status, changed, err := agentstatus.Report(report, "")
	if err != nil {
		return nil, err
	}
	if changed {
		publishAgentStatus(report.BlockId, status, "fe-report")
	}
	return status, nil
}

func (*BlockService) ReleaseAgentStatus_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "release canonical agent status source for a block",
		ArgNames:   []string{"ctx", "blockId", "source", "seq"},
		ReturnDesc: "agent status",
	}
}

func (bs *BlockService) ReleaseAgentStatus(ctx context.Context, blockId string, source string, seq int64) (*agentstatus.AgentStatus, error) {
	status, changed, err := agentstatus.Release(blockId, source, seq)
	if err != nil {
		return nil, err
	}
	if changed {
		publishAgentStatus(blockId, status, "fe-release")
	}
	return status, nil
}

func publishAgentStatus(blockId string, status *agentstatus.AgentStatus, source string) {
	if blockId == "" && status != nil {
		blockId = status.BlockId
	}
	if blockId == "" {
		return
	}
	if status != nil {
		pslog.AppendEvent(pslog.Event{
			Name:    "agent.status",
			Stage:   "publish",
			TraceId: pslog.MakeAgentTraceId(blockId, status.SessionId),
			BlockId: blockId,
			Reason:  source,
			Outcome: "ok",
		})
	}
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_AgentStatus,
		Scopes: []string{waveobj.MakeORef(waveobj.OType_Block, blockId).String()},
		Data:   status,
	})
}

func (*BlockService) SaveTerminalState_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "save the terminal state to a blockfile",
		ArgNames: []string{"ctx", "blockId", "state", "stateType", "ptyOffset", "termSize"},
	}
}

func (bs *BlockService) SaveTerminalState(ctx context.Context, blockId string, state string, stateType string, ptyOffset int64, termSize waveobj.TermSize) error {
	_, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return err
	}
	if stateType != "full" && stateType != "preview" {
		return fmt.Errorf("invalid state type: %q", stateType)
	}
	// ignore MakeFile error (already exists is ok)
	filestore.WFS.MakeFile(ctx, blockId, "cache:term:"+stateType, nil, wshrpc.FileOpts{})
	err = filestore.WFS.WriteFile(ctx, blockId, "cache:term:"+stateType, []byte(state))
	if err != nil {
		return fmt.Errorf("cannot save terminal state: %w", err)
	}
	fileMeta := wshrpc.FileMeta{
		"ptyoffset": ptyOffset,
		"termsize":  termSize,
	}
	err = filestore.WFS.WriteMeta(ctx, blockId, "cache:term:"+stateType, fileMeta, true)
	if err != nil {
		return fmt.Errorf("cannot save terminal state meta: %w", err)
	}
	return nil
}

func (*BlockService) CleanupOrphanedBlocks_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "queue a layout action to cleanup orphaned blocks in the tab",
		ArgNames: []string{"ctx", "tabId"},
	}
}

func (bs *BlockService) CleanupOrphanedBlocks(ctx context.Context, tabId string) (waveobj.UpdatesRtnType, error) {
	ctx = waveobj.ContextWithUpdates(ctx)
	layoutAction := waveobj.LayoutActionData{
		ActionType: wcore.LayoutActionDataType_CleanupOrphaned,
		ActionId:   uuid.NewString(),
	}
	err := wcore.QueueLayoutActionForTab(ctx, tabId, layoutAction)
	if err != nil {
		return nil, fmt.Errorf("error queuing cleanup layout action: %w", err)
	}
	return waveobj.ContextGetUpdatesRtn(ctx), nil
}
