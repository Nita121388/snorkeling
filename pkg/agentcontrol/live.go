// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agentcontrol implements the read side of the Agent Control Surface:
// a merge of the three live-session sources (agentstatus, GUI chat manager and
// the AI session index) into one flat, agent-readable record list.
package agentcontrol

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentstatus"
	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/aisessions/chat"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	defaultMaxRows       = 200
	chatStateConcurrency = 4
	chatStateTimeout     = 1500 * time.Millisecond
	summaryConcurrency   = 4
	summaryTimeout       = 2 * time.Second

	freshnessFresh = "fresh"
	freshnessStale = "stale"
)

// blockContext caches the tab/workspace/window chain per tab.
type blockContext struct {
	tabId       string
	workspaceId string
	windowId    string
}

// BuildLiveSessions merges the live sources and returns the record list.
func BuildLiveSessions(ctx context.Context, req wshrpc.SessionLiveRequest) (*wshrpc.SessionLiveResult, error) {
	now := time.Now().UnixMilli()
	result := &wshrpc.SessionLiveResult{
		Version:     wshrpc.AgentControlVersion,
		GeneratedAt: now,
		Records:     []wshrpc.SessionLiveRecord{},
	}

	blocks, err := wstore.DBGetAllObjsByType[*waveobj.Block](ctx, waveobj.OType_Block)
	if err != nil {
		return nil, newError(CodeInternal, "listing blocks: %v", err)
	}
	blockFilter := make(map[string]bool, len(req.BlockIds))
	for _, id := range req.BlockIds {
		blockFilter[strings.TrimSpace(id)] = true
	}

	ctxCache := map[string]blockContext{}
	records := make([]wshrpc.SessionLiveRecord, 0, len(blocks))

	for _, block := range blocks {
		if block == nil {
			continue
		}
		if len(blockFilter) > 0 && !blockFilter[block.OID] {
			continue
		}
		rec, ok := recordForBlock(ctx, block, ctxCache, now)
		if !ok {
			continue
		}
		records = append(records, rec)
	}

	// Attach live GUI chat state and surface orphans (chat session without a block).
	infos := chat.DefaultManager().ActiveSessions()
	chatByKey := make(map[string]chat.LiveChatInfo, len(infos))
	for _, info := range infos {
		chatByKey[chatKey(info.Source, info.SessionID)] = info
	}
	for idx := range records {
		key := chatKey(records[idx].Provider, records[idx].SessionId)
		info, ok := chatByKey[key]
		if !ok {
			continue
		}
		records[idx].Chat = liveChatFromInfo(info)
		delete(chatByKey, key)
	}
	fillChatState(ctx, records)

	// Remaining chat entries have no block (closed block / not yet materialized).
	for _, info := range chatByKey {
		rec := wshrpc.SessionLiveRecord{
			Provider:  info.Source,
			SessionId: info.SessionID,
			View:      "chat",
			Chat:      liveChatFromInfo(info),
			Warnings:  []string{"orphan-chat"},
		}
		records = append(records, rec)
	}

	fillSummaries(ctx, records)
	records = dedupeRecords(records)
	records = filterRecords(records, req.IncludeIdle)
	records = sortRecords(records)

	maxRows := req.MaxRows
	if maxRows <= 0 || maxRows > defaultMaxRows {
		maxRows = defaultMaxRows
	}
	if len(records) > maxRows {
		records = records[:maxRows]
		result.Partial = true
	}
	result.Records = records
	return result, nil
}

func recordForBlock(ctx context.Context, block *waveobj.Block, cache map[string]blockContext, now int64) (wshrpc.SessionLiveRecord, bool) {
	meta := block.Meta
	view := meta.GetString(waveobj.MetaKey_View, "")
	provider := strings.TrimSpace(meta.GetString("agent:provider", ""))
	sessionId := strings.TrimSpace(meta.GetString("agent:sessionid", ""))
	status := agentstatus.Get(block.OID)
	controllerStatus := blockcontroller.GetBlockControllerRuntimeStatus(block.OID)
	running := controllerStatus != nil && controllerStatus.ShellProcStatus == blockcontroller.Status_Running

	candidate := view == "agent" || provider != "" || sessionId != "" || status != nil
	if !candidate {
		return wshrpc.SessionLiveRecord{}, false
	}
	// A stale agent block (process gone, no status, no session id) is not live.
	if status == nil && sessionId == "" && !running && view != "agent" {
		return wshrpc.SessionLiveRecord{}, false
	}

	rec := wshrpc.SessionLiveRecord{
		BlockId:     block.OID,
		View:        view,
		Conn:        meta.GetString(waveobj.MetaKey_Connection, ""),
		Provider:    provider,
		SessionId:   sessionId,
		ProjectPath: meta.GetString(waveobj.MetaKey_CmdCwd, ""),
	}
	if status != nil {
		rec.Issue = issueFromStatus(status, now)
		if rec.Provider == "" {
			rec.Provider = status.Provider
		}
		if rec.SessionId == "" {
			rec.SessionId = status.SessionId
		}
	}
	if rec.Provider == "" {
		rec.Provider = strings.TrimSpace(meta.GetString("agent:provider", ""))
	}

	// Resolve the tab/workspace/window chain once per tab.
	bc := blockContext{}
	if oref, err := waveobj.ParseORef(block.ParentORef); err == nil && oref.OType == waveobj.OType_Tab {
		bc.tabId = oref.OID
		if cached, ok := cache[bc.tabId]; ok {
			bc = cached
		} else {
			if wsId, err := wstore.DBFindWorkspaceForTabId(ctx, bc.tabId); err == nil {
				bc.workspaceId = wsId
				if winId, err := wstore.DBFindWindowForWorkspaceId(ctx, wsId); err == nil {
					bc.windowId = winId
				}
			}
			cache[bc.tabId] = bc
		}
	}
	rec.TabId = bc.tabId
	rec.WindowId = bc.windowId
	return rec, true
}

func issueFromStatus(status *agentstatus.AgentStatus, now int64) *wshrpc.SessionLiveIssue {
	if status == nil {
		return nil
	}
	freshness := freshnessFresh
	if status.ExpiresAt > 0 && now >= status.ExpiresAt {
		freshness = freshnessStale
	}
	return &wshrpc.SessionLiveIssue{
		State:       status.State,
		PrevState:   status.PrevState,
		Phase:       status.Phase,
		ToolName:    status.ToolName,
		Message:     RedactString(status.Message),
		Reason:      RedactString(status.Reason),
		Source:      status.Source,
		Confidence:  status.Confidence,
		ActiveSince: status.ActiveSince,
		UpdatedAt:   status.UpdatedAt,
		ExpiresAt:   status.ExpiresAt,
		Seq:         status.Seq,
		Freshness:   freshness,
	}
}

func chatKey(source, sessionId string) string {
	return strings.TrimSpace(source) + "\x00" + strings.TrimSpace(sessionId)
}

func liveChatFromInfo(info chat.LiveChatInfo) *wshrpc.SessionLiveChat {
	return &wshrpc.SessionLiveChat{
		State:       string(info.State),
		Provisional: info.Provisional,
		LastUsedAt:  info.LastUsed,
	}
}

// fillChatState fetches get_state for each live GUI chat record in a bounded
// pool. Failures only drop the model/thinking/context fields, never the row.
func fillChatState(ctx context.Context, records []wshrpc.SessionLiveRecord) {
	var wg sync.WaitGroup
	sem := make(chan struct{}, chatStateConcurrency)
	for idx := range records {
		rec := &records[idx]
		if rec.Chat == nil || rec.Provider == "" || rec.SessionId == "" {
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(rec *wshrpc.SessionLiveRecord) {
			defer wg.Done()
			defer func() { <-sem }()
			session := chat.DefaultManager().Get(rec.Provider, rec.SessionId)
			if session == nil {
				return
			}
			stateCtx, cancel := context.WithTimeout(ctx, chatStateTimeout)
			defer cancel()
			info, err := session.GetState(stateCtx)
			if err != nil || info == nil {
				return
			}
			rec.Chat.IsStreaming = info.IsStreaming
			rec.Chat.ThinkingLevel = info.ThinkingLevel
			rec.Chat.MessageCount = info.MessageCount
			rec.Chat.ContextUsagePct = info.ContextUsagePct
			if info.Model != nil {
				rec.Chat.ModelProvider = info.Model.Provider
				rec.Chat.ModelId = info.Model.ID
			}
		}(rec)
	}
	wg.Wait()
}

// fillSummaries resolves the AI session summary (title/note/tags/props/hash)
// for each record that has a session id. Bounded concurrency + per-call timeout.
func fillSummaries(ctx context.Context, records []wshrpc.SessionLiveRecord) {
	manager := aisessions.NewManager("", nil)
	var wg sync.WaitGroup
	sem := make(chan struct{}, summaryConcurrency)
	for idx := range records {
		rec := &records[idx]
		if rec.SessionId == "" {
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(rec *wshrpc.SessionLiveRecord) {
			defer wg.Done()
			defer func() { <-sem }()
			sumCtx, cancel := context.WithTimeout(ctx, summaryTimeout)
			defer cancel()
			summary, err := manager.Summary(sumCtx, rec.SessionId, false)
			if err != nil {
				rec.Warnings = append(rec.Warnings, "summary-unavailable")
				if rec.Conn != "" && !strings.HasPrefix(rec.Conn, "local") {
					rec.Warnings = append(rec.Warnings, "remote-summary-unavailable")
				}
				return
			}
			applySummary(rec, summary)
		}(rec)
	}
	wg.Wait()
}

func applySummary(rec *wshrpc.SessionLiveRecord, summary aisessions.SessionSummary) {
	rec.SessionKey = summary.Key
	rec.Title = summary.Title
	rec.TitleSource = summary.TitleSource
	if rec.Provider == "" {
		rec.Provider = summary.Source
	}
	if rec.SessionId == "" {
		rec.SessionId = summary.ID
	}
	if rec.ProjectPath == "" {
		rec.ProjectPath = summary.ProjectPath
	}
	card := &wshrpc.SessionLiveCard{
		Note: summary.Note,
		Tags: append([]string(nil), summary.Tags...),
	}
	if len(summary.Props) > 0 {
		card.Props = make(map[string]wshrpc.AgentPropValue, len(summary.Props))
		for key, cell := range summary.Props {
			card.Props[key] = wshrpc.AgentPropValue{
				Type:      cell.Type,
				Value:     cell.Value,
				Source:    cell.Source,
				UpdatedAt: cell.UpdatedAt,
			}
		}
	}
	rec.Card = card
}

func dedupeRecords(records []wshrpc.SessionLiveRecord) []wshrpc.SessionLiveRecord {
	best := map[string]int{}
	order := make([]string, 0, len(records))
	for idx, rec := range records {
		key := rec.SessionKey
		if key == "" {
			key = "block:" + rec.BlockId
		}
		if prevIdx, ok := best[key]; ok {
			if recordActivity(rec) > recordActivity(records[prevIdx]) {
				best[key] = idx
			}
			continue
		}
		best[key] = idx
		order = append(order, key)
	}
	rtn := make([]wshrpc.SessionLiveRecord, 0, len(order))
	for _, key := range order {
		rtn = append(rtn, records[best[key]])
	}
	return rtn
}

func recordActivity(rec wshrpc.SessionLiveRecord) int64 {
	var ts int64
	if rec.Issue != nil {
		ts = rec.Issue.UpdatedAt
	}
	if rec.Chat != nil && rec.Chat.LastUsedAt > ts {
		ts = rec.Chat.LastUsedAt
	}
	return ts
}

func filterRecords(records []wshrpc.SessionLiveRecord, includeIdle bool) []wshrpc.SessionLiveRecord {
	if includeIdle {
		return records
	}
	rtn := records[:0]
	for _, rec := range records {
		if isIdleRecord(rec) {
			continue
		}
		rtn = append(rtn, rec)
	}
	return rtn
}

func isIdleRecord(rec wshrpc.SessionLiveRecord) bool {
	issueIdle := rec.Issue == nil || rec.Issue.State == agentstatus.StateIdle
	if !issueIdle {
		return false
	}
	if rec.Chat == nil {
		return true
	}
	return !rec.Chat.IsStreaming && rec.Chat.State != string(chat.StateRunning)
}

func sortRecords(records []wshrpc.SessionLiveRecord) []wshrpc.SessionLiveRecord {
	sort.SliceStable(records, func(i, j int) bool {
		pi, pj := statePriority(records[i]), statePriority(records[j])
		if pi != pj {
			return pi < pj
		}
		ai, aj := recordActivity(records[i]), recordActivity(records[j])
		if ai != aj {
			return ai > aj
		}
		return records[i].BlockId < records[j].BlockId
	})
	return records
}

func statePriority(rec wshrpc.SessionLiveRecord) int {
	if rec.Chat != nil && (rec.Chat.IsStreaming || rec.Chat.State == string(chat.StateRunning)) {
		return 0
	}
	if rec.Issue == nil {
		return 3
	}
	switch rec.Issue.State {
	case agentstatus.StateWorking, agentstatus.StateBlocked, agentstatus.StateRateLimited, agentstatus.StateError:
		return 1
	case agentstatus.StateIdle:
		return 2
	default:
		return 3
	}
}

// ResolveSessionForBlock returns the agent session id bound to a block.
func ResolveSessionForBlock(ctx context.Context, blockId string) (string, error) {
	blockId = strings.TrimSpace(blockId)
	if blockId == "" {
		return "", newError(CodeUsage, "block id is required")
	}
	block, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return "", newError(CodeNotFound, "block %q not found", blockId)
	}
	if sid := strings.TrimSpace(block.Meta.GetString("agent:sessionid", "")); sid != "" {
		return sid, nil
	}
	if status := agentstatus.Get(blockId); status != nil && status.SessionId != "" {
		return status.SessionId, nil
	}
	return "", newError(CodeNotFound, "block %q has no agent session", blockId).
		WithHint("pass an explicit session key or id")
}

// GetSessionRecord returns one record by session key/id, or falls back to the
// AI session index for non-live sessions.
func GetSessionRecord(ctx context.Context, identifier string, blockId string) (*wshrpc.SessionLiveRecord, error) {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		identifier = "this"
	}
	if identifier == "this" {
		if blockId == "" {
			return nil, newError(CodeUsage, "no block context for 'this'").
				WithHint("run inside a Snorkeling block or pass an explicit session key")
		}
		sid, err := ResolveSessionForBlock(ctx, blockId)
		if err != nil {
			return nil, err
		}
		identifier = sid
	}

	live, err := BuildLiveSessions(ctx, wshrpc.SessionLiveRequest{IncludeIdle: true, MaxRows: defaultMaxRows})
	if err == nil {
		for idx := range live.Records {
			rec := &live.Records[idx]
			if rec.SessionKey == identifier || rec.SessionId == identifier || rec.BlockId == identifier {
				return rec, nil
			}
		}
	}

	manager := aisessions.NewManager("", nil)
	summary, err := manager.Summary(ctx, identifier, false)
	if err != nil {
		return nil, newError(CodeNotFound, "session %q not found", identifier)
	}
	rec := &wshrpc.SessionLiveRecord{
		Provider:  summary.Source,
		SessionId: summary.ID,
		View:      "session",
		Warnings:  []string{"not-live"},
	}
	applySummary(rec, summary)
	return rec, nil
}

// BuildSessionList returns indexed sessions (not necessarily live).
func BuildSessionList(ctx context.Context, req wshrpc.SessionListRequest) (*wshrpc.SessionListResult, error) {
	limit := req.Limit
	if limit <= 0 || limit > 500 {
		limit = 20
	}
	manager := aisessions.NewManager("", nil)
	listOpts := aisessions.ListOptions{
		Source:  req.Source,
		Project: req.Project,
		Marked:  req.Marked,
		Limit:   limit,
	}
	if req.Tag != "" {
		listOpts.TagFilters = []string{req.Tag}
	}

	var summaries []aisessions.SessionSummary
	var err error
	if strings.TrimSpace(req.Query) != "" {
		summaries, err = manager.Search(ctx, aisessions.SearchOptions{
			Query:      req.Query,
			Source:     req.Source,
			Project:    req.Project,
			Limit:      limit,
			TagFilters: listOpts.TagFilters,
		})
	} else {
		summaries, err = manager.List(ctx, listOpts)
	}
	if err != nil {
		return nil, newError(CodeInternal, "listing sessions: %v", err)
	}

	result := &wshrpc.SessionListResult{
		Version:     wshrpc.AgentControlVersion,
		GeneratedAt: time.Now().UnixMilli(),
		Records:     make([]wshrpc.SessionLiveRecord, 0, len(summaries)),
	}
	for _, summary := range summaries {
		rec := wshrpc.SessionLiveRecord{
			Provider:  summary.Source,
			SessionId: summary.ID,
			View:      "session",
		}
		applySummary(&rec, summary)
		result.Records = append(result.Records, rec)
	}
	return result, nil
}

// FormatFreshnessWarnings is a helper for callers that want a single summary
// string; kept small so the CLI can stay dumb.
func FormatFreshnessWarnings(records []wshrpc.SessionLiveRecord) []string {
	var rtn []string
	for _, rec := range records {
		if rec.Issue != nil && rec.Issue.Freshness == freshnessStale {
			rtn = append(rtn, fmt.Sprintf("%s: stale agent status", rec.BlockId))
		}
	}
	return rtn
}
