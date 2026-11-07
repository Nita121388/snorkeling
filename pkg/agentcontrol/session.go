// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Session lookup, resolution and list for the Agent Control Surface. Kept
// separate from live.go (which owns the merge of the live sources) so the
// "given an identifier, find the session" path stays readable on its own.
package agentcontrol

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentstatus"
	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

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
