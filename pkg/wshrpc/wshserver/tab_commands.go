// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// TabListCommand lists tabs of the current workspace (or a given one).
func (ws *WshServer) TabListCommand(ctx context.Context, data wshrpc.TabListRequest) (*wshrpc.TabListResult, error) {
	wsId, err := resolveWorkspaceId(ctx, data.WorkspaceId)
	if err != nil {
		return nil, err
	}
	wsObj, err := wcore.GetWorkspace(ctx, wsId)
	if err != nil {
		return nil, err
	}
	rtn := &wshrpc.TabListResult{
		Version:     wshrpc.AgentControlVersion,
		GeneratedAt: time.Now().UnixMilli(),
		WorkspaceId: wsId,
		ActiveTabId: wsObj.ActiveTabId,
	}
	for _, tabID := range wsObj.TabIds {
		tabObj, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabID)
		if err != nil {
			continue
		}
		rtn.Tabs = append(rtn.Tabs, wshrpc.UIStateTab{
			TabId:       tabID,
			Name:        tabObj.Name,
			Active:      tabID == wsObj.ActiveTabId,
			WorkspaceId: wsId,
		})
	}
	return rtn, nil
}

// TabCreateCommand creates a tab via wcore.CreateTab (same path the UI uses).
func (ws *WshServer) TabCreateCommand(ctx context.Context, data wshrpc.TabCreateRequest) (*wshrpc.TabCreateResult, error) {
	wsId, err := resolveWorkspaceId(ctx, data.WorkspaceId)
	if err != nil {
		return nil, err
	}
	start := time.Now()
	newTabId, err := wcore.CreateTab(ctx, wsId, data.Name, data.Activate, false)
	if err != nil {
		return nil, err
	}
	rtn := &wshrpc.TabCreateResult{
		Version:   wshrpc.AgentControlVersion,
		Ok:        true,
		TabId:     newTabId,
		WaitedMs:  int(time.Since(start).Milliseconds()),
	}
	if tabObj, err := wstore.DBMustGet[*waveobj.Tab](ctx, newTabId); err == nil {
		rtn.TabName = tabObj.Name
	}
	if data.Wait && data.Activate {
		rtn.WaitedMs = pollActiveTab(ctx, wsId, newTabId, data.WaitMs)
	}
	return rtn, nil
}

// TabActivateCommand activates a tab and verifies against backend truth.
func (ws *WshServer) TabActivateCommand(ctx context.Context, data wshrpc.TabActivateRequest) (*wshrpc.TabActivateResult, error) {
	wsId, err := wstore.DBFindWorkspaceForTabId(ctx, data.TabId)
	if err != nil {
		return nil, fmt.Errorf("E_NOT_FOUND: tab %q not found", data.TabId)
	}
	if err := wcore.SetActiveTab(ctx, wsId, data.TabId); err != nil {
		return nil, err
	}
	rtn := &wshrpc.TabActivateResult{
		Version: wshrpc.AgentControlVersion,
		Ok:      true,
		TabId:   data.TabId,
	}
	if data.Wait {
		rtn.WaitedMs = pollActiveTab(ctx, wsId, data.TabId, data.WaitMs)
	}
	return rtn, nil
}

func resolveWorkspaceId(ctx context.Context, workspaceId string) (string, error) {
	if workspaceId != "" {
		return workspaceId, nil
	}
	client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil || len(client.WindowIds) == 0 {
		return "", fmt.Errorf("E_NO_ROUTE: no active window")
	}
	win, err := wcore.GetWindow(ctx, client.WindowIds[0])
	if err != nil {
		return "", err
	}
	return win.WorkspaceId, nil
}

// pollActiveTab waits until Workspace.ActiveTabId == tabId. Backend truth only.
func pollActiveTab(ctx context.Context, wsId, tabId string, waitMs int) int {
	if waitMs <= 0 {
		waitMs = 1500
	}
	start := time.Now()
	deadline := start.Add(time.Duration(waitMs) * time.Millisecond)
	for time.Now().Before(deadline) {
		wsObj, err := wcore.GetWorkspace(ctx, wsId)
		if err == nil && wsObj.ActiveTabId == tabId {
			return int(time.Since(start).Milliseconds())
		}
		time.Sleep(100 * time.Millisecond)
	}
	// timeout: caller still gets the result; the active tab write is already done
	return int(time.Since(start).Milliseconds())
}
