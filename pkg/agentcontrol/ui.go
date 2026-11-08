// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// UI observe surface for the Agent Control Surface: `wsh ui active`,
// `wsh ui state` and `wsh block read`. Kept separate from live.go/session.go
// so the "what is the UI doing" read path stays one file.
//
// Design rule: everything here is read-only and bounded. Meta is always
// passed through RedactMeta; content payloads are always truncated.
package agentcontrol

import (
	"context"
	"os"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentstatus"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	defaultReadTail    = 80
	maxReadTail        = 2000
	defaultReadMaxbyte = 65536
)

// FE-route seams. Variables so unit tests can substitute without spinning up
// the WshRouter (GetBareRpcClient panics when the router is uninitialized).
var (
	focusedBlockDataFn = func(tabId string) (*wshrpc.FocusedBlockData, error) {
		return wshclient.GetFocusedBlockDataCommand(
			wshclient.GetBareRpcClient(),
			&wshrpc.RpcOpts{Route: wshutil.MakeTabRouteId(tabId)},
		)
	}
	termScrollbackFn = func(tabId string, data wshrpc.CommandTermGetScrollbackLinesData) (*wshrpc.CommandTermGetScrollbackLinesRtnData, error) {
		return wshclient.TermGetScrollbackLinesCommand(
			wshclient.GetBareRpcClient(),
			data,
			&wshrpc.RpcOpts{Route: wshutil.MakeTabRouteId(tabId)},
		)
	}
)

// BuildUIActive answers "where am I" (self) vs "where is the user" (active).
// The two are deliberately separate: an agent most often needs to know the
// user is looking at a different tab/block.
func BuildUIActive(ctx context.Context, req wshrpc.UIActiveRequest) (*wshrpc.UIActiveSnapshot, error) {
	rtn := &wshrpc.UIActiveSnapshot{
		Version:     wshrpc.AgentControlVersion,
		GeneratedAt: nowMs(),
		Self: wshrpc.UIActiveSelf{
			TabId:   req.TabId,
			BlockId: req.BlockId,
		},
	}
	// self blockNum: position in the tab's block list (1-based), best effort.
	if rtn.Self.TabId != "" && rtn.Self.BlockId != "" {
		rtn.Self.BlockNum = blockNumInTab(ctx, rtn.Self.TabId, rtn.Self.BlockId)
	}
	active, err := currentActiveTarget(ctx)
	if err != nil {
		// No window/workspace: degrade, don't fail the whole call.
		rtn.Warnings = append(rtn.Warnings, "active-unavailable")
		return rtn, nil
	}
	rtn.Active = active
	return rtn, nil
}

// BuildUIState is a backend-only snapshot of window/workspace/tab/block plus
// per-block runtime and agent state. No content, no --live (that's P0.3).
func BuildUIState(ctx context.Context, req wshrpc.UIStateRequest) (*wshrpc.UIStateSnapshot, error) {
	entries, err := wcore.ListBlocksScoped(ctx, wcore.BlocksScope{
		WindowId:    req.WindowId,
		WorkspaceId: req.WorkspaceId,
	})
	if err != nil {
		return nil, err
	}

	// Group by tab for the tab list and the active-tab marking.
	type tabInfo struct {
		workspaceId string
		name        string
		blockNums   map[string]int
	}
	tabsById := map[string]*tabInfo{}
	var tabs []wshrpc.UIStateTab
	rtn := &wshrpc.UIStateSnapshot{
		Version:     wshrpc.AgentControlVersion,
		GeneratedAt: nowMs(),
		Sources:     map[string]string{"backend": "ok", "live": "not-requested"},
	}

	for _, e := range entries {
		ti, ok := tabsById[e.TabId]
		if !ok {
			ti = &tabInfo{workspaceId: e.WorkspaceId, blockNums: map[string]int{}}
			tabsById[e.TabId] = ti
			tabs = append(tabs, wshrpc.UIStateTab{
				TabId:       e.TabId,
				WorkspaceId: e.WorkspaceId,
			})
		}
		if _, seen := ti.blockNums[e.BlockId]; !seen {
			ti.blockNums[e.BlockId] = len(ti.blockNums) + 1
		}
	}

	// Fill tab names + active flags from the workspace(s) we walked.
	wsById := map[string]*waveobj.Workspace{}
	for _, e := range entries {
		if _, ok := wsById[e.WorkspaceId]; ok {
			continue
		}
		ws, err := wcore.GetWorkspace(ctx, e.WorkspaceId)
		if err == nil {
			wsById[e.WorkspaceId] = ws
		}
	}
	for i := range tabs {
		ws := wsById[tabs[i].WorkspaceId]
		if ws == nil {
			continue
		}
		if ws.ActiveTabId == tabs[i].TabId {
			tabs[i].Active = true
		}
		if tabObj, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabs[i].TabId); err == nil {
			tabs[i].Name = tabObj.Name
		}
	}
	rtn.Tabs = tabs

	blockNums := map[string]int{}
	for _, ti := range tabsById {
		for blk, num := range ti.blockNums {
			blockNums[blk] = num
		}
	}

	seenWindow := map[string]bool{}
	for _, e := range entries {
		redacted := RedactMeta(e.Meta)
		view := redacted.GetString(waveobj.MetaKey_View, "")
		bs := wshrpc.UIBlockState{
			BlockId:     e.BlockId,
			TabId:       e.TabId,
			WorkspaceId: e.WorkspaceId,
			View:        view,
			Title:       redacted.GetString(waveobj.MetaKey_FrameTitle, ""),
			Controller:  redacted.GetString(waveobj.MetaKey_Controller, ""),
			Meta:        redacted,
		}
		if rt := blockcontroller.GetBlockControllerRuntimeStatus(e.BlockId); rt != nil {
			bs.Runtime = &wshrpc.UIBlockRuntime{
				ShellProcStatus: rt.ShellProcStatus,
				TsunamiPort:     rt.TsunamiPort,
			}
		}
		if st := agentstatus.Get(e.BlockId); st != nil {
			bs.Agent = issueFromStatus(st, nowMs())
		}
		_ = blockNums[e.BlockId]
		rtn.Blocks = append(rtn.Blocks, bs)
		if !seenWindow[e.WindowId] && e.WindowId != "" {
			seenWindow[e.WindowId] = true
			rtn.Windows = append(rtn.Windows, e.WindowId)
		}
	}
	return rtn, nil
}

func nowMs() int64 {
	return time.Now().UnixMilli()
}

// ReadBlock returns bounded content for one block, dispatched by view.
func ReadBlock(ctx context.Context, req wshrpc.BlockReadRequest) (*wshrpc.BlockReadResult, error) {
	blockId := strings.TrimSpace(req.BlockId)
	if blockId == "" {
		return nil, newError(CodeUsage, "block id is required")
	}
	blk, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return nil, newError(CodeNotFound, "block %q not found", blockId)
	}
	redacted := RedactMeta(blk.Meta)
	view := redacted.GetString(waveobj.MetaKey_View, "")
	if view == "" {
		view = "unknown"
	}
	rtn := &wshrpc.BlockReadResult{
		Version: wshrpc.AgentControlVersion,
		BlockId: blockId,
		View:    view,
		Kind:    view,
		Payload: map[string]any{},
	}

	tail := req.Tail
	if tail <= 0 {
		tail = defaultReadTail
	}
	if tail > maxReadTail {
		tail = maxReadTail
	}
	maxBytes := req.MaxBytes
	if maxBytes <= 0 {
		maxBytes = defaultReadMaxbyte
	}

	switch view {
	case "term":
		readTermBlock(ctx, rtn, blk, tail, maxBytes, req.LastCommand)
	case "preview", "edit":
		readFileBlock(ctx, rtn, blk, maxBytes)
	case "web":
		rtn.Payload["url"] = RedactString(redacted.GetString(waveobj.MetaKey_Url, ""))
	case "agent":
		readAgentBlock(ctx, rtn)
	default:
		rtn.Payload["error"] = "unsupported view"
		rtn.Payload["meta"] = redactMetaToAny(redacted)
	}
	return rtn, nil
}

func readTermBlock(ctx context.Context, rtn *wshrpc.BlockReadResult, blk *waveobj.Block, tail, maxBytes int, lastCommand bool) {
	// Scrollback lives in the frontend tab route for this block's tab.
	tabId, err := wstore.DBFindTabForBlockId(ctx, blk.OID)
	if err != nil || tabId == "" {
		rtn.Payload["lines"] = []string{}
		rtn.Payload["warning"] = "term-route-unavailable"
		rtn.Warnings = append(rtn.Warnings, "tab-unavailable")
		return
	}
	// Need total lines first: fetch a wide window, then slice locally.
	data, err := termScrollbackFn(tabId, wshrpc.CommandTermGetScrollbackLinesData{
		LineStart:   0,
		LineEnd:     tail * 4, // overshoot; we re-slice below
		LastCommand: lastCommand,
	})
	if err != nil {
		rtn.Payload["lines"] = []string{}
		rtn.Payload["warning"] = "term-route-unavailable"
		rtn.Warnings = append(rtn.Warnings, "term-route-unavailable")
		return
	}
	lines := data.Lines
	if len(lines) > tail {
		lines = lines[len(lines)-tail:]
	}
	text, truncated, nbytes := truncateLines(lines, maxBytes)
	rtn.Payload["lines"] = text
	rtn.Payload["totallines"] = data.TotalLines
	rtn.Truncated = truncated
	rtn.Bytes = nbytes
	if rtn.Payload["warning"] == nil && truncated {
		rtn.Warnings = append(rtn.Warnings, "truncated-bytes")
	}
}

func readFileBlock(ctx context.Context, rtn *wshrpc.BlockReadResult, blk *waveobj.Block, maxBytes int) {
	redacted := RedactMeta(blk.Meta)
	filePath := redacted.GetString(waveobj.MetaKey_File, "")
	rtn.Payload["file"] = filePath
	if filePath == "" {
		rtn.Payload["warning"] = "no-file"
		return
	}
	if conn := redacted.GetString(waveobj.MetaKey_Connection, ""); !conncontroller.IsLocalConnName(conn) {
		// "local" / "local:<name>" / "" all mean this machine; only a real
		// remote conn means the file is not readable here.
		rtn.Payload["warning"] = "remote-file-unsupported"
		rtn.Warnings = append(rtn.Warnings, "remote-file-unsupported")
		return
	}
	content, info, err := readBoundedFile(filePath, maxBytes)
	if err != nil {
		rtn.Payload["warning"] = "file-unreadable"
		rtn.Warnings = append(rtn.Warnings, "file-unreadable")
		return
	}
	rtn.Payload["content"] = content
	if info != nil {
		rtn.Payload["isdir"] = info.IsDir()
	} else {
		rtn.Payload["isdir"] = false
	}
	rtn.Bytes = len(content)
	rtn.Truncated = len(content) >= maxBytes
	rtn.Bytes = len(content)
	rtn.Truncated = len(content) >= maxBytes
}

func readAgentBlock(ctx context.Context, rtn *wshrpc.BlockReadResult) {
	sid, err := ResolveSessionForBlock(ctx, rtn.BlockId)
	if err != nil {
		rtn.Payload["error"] = "no-agent-session"
		rtn.Warnings = append(rtn.Warnings, "no-agent-session")
		return
	}
	rtn.Payload["sessionid"] = sid
	// Summary fields only (no session body) — reuse the P0.0 record build.
	rec, err := GetSessionRecord(ctx, sid, rtn.BlockId)
	if err == nil && rec != nil {
		rtn.Payload["sessionkey"] = rec.SessionKey
		rtn.Payload["title"] = rec.Title
		if rec.Issue != nil {
			rtn.Payload["agentstate"] = rec.Issue.State
			rtn.Payload["agentphase"] = rec.Issue.Phase
		}
	}
}

// readBoundedFile reads at most maxBytes+1 bytes so the caller can tell
// whether truncation happened.
func readBoundedFile(path string, maxBytes int) (string, os.FileInfo, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", nil, err
	}
	if info.IsDir() {
		return "", info, nil
	}
	f, err := os.Open(path)
	if err != nil {
		return "", info, err
	}
	defer f.Close()
	buf := make([]byte, maxBytes+1)
	n, err := f.Read(buf)
	if err != nil && n == 0 {
		return "", info, err
	}
	if n > maxBytes {
		n = maxBytes
	}
	return string(buf[:n]), info, nil
}

// truncateLines joins lines and caps the result at maxBytes.
func truncateLines(lines []string, maxBytes int) (string, bool, int) {
	joined := strings.Join(lines, "\n")
	if len(joined) <= maxBytes {
		return joined, false, len(joined)
	}
	return joined[:maxBytes], true, len(joined)
}

// TruncatePayload caps a string payload at maxBytes (exported for tests/callers).
func TruncatePayload(s string, maxBytes int) (string, bool) {
	if maxBytes <= 0 || len(s) <= maxBytes {
		return s, false
	}
	return s[:maxBytes], true
}

func redactMetaToAny(meta waveobj.MetaMapType) map[string]any {
	if meta == nil {
		return nil
	}
	out := make(map[string]any, len(meta))
	for k, v := range meta {
		out[k] = v
	}
	return out
}

// currentActiveTarget resolves window → workspace → active tab → focused block.
func currentActiveTarget(ctx context.Context) (*wshrpc.UIActiveTarget, error) {
	client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil {
		return nil, err
	}
	if len(client.WindowIds) == 0 {
		return nil, newError(CodeNotFound, "no active window")
	}
	windowId := client.WindowIds[0]
	win, err := wcore.GetWindow(ctx, windowId)
	if err != nil {
		return nil, err
	}
	ws, err := wcore.GetWorkspace(ctx, win.WorkspaceId)
	if err != nil {
		return nil, err
	}
	target := &wshrpc.UIActiveTarget{
		WindowId:    windowId,
		WorkspaceId: win.WorkspaceId,
		TabId:       ws.ActiveTabId,
	}
	if tabObj, err := wstore.DBMustGet[*waveobj.Tab](ctx, ws.ActiveTabId); err == nil {
		target.TabName = tabObj.Name
	}
	// Focused block comes from the frontend tab route; degrade to null.
	focused, err := focusedBlockDataFn(ws.ActiveTabId)
	if err != nil || focused == nil {
		return target, nil // caller adds warning
	}
	target.BlockId = focused.BlockId
	target.View = focused.ViewType
	target.Title = RedactString(focused.BlockMeta.GetString(waveobj.MetaKey_FrameTitle, ""))
	return target, nil
}

// blockNumInTab returns the 1-based position of blockId in the tab's
// block list, or 0 when it cannot be determined.
func blockNumInTab(ctx context.Context, tabId, blockId string) int {
	tabObj, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		return 0
	}
	for i, id := range tabObj.BlockIds {
		if id == blockId {
			return i + 1
		}
	}
	return 0
}
