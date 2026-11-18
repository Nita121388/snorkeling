// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Progressive single-session reading for the Agent Control Surface
// (`wsh session info|users|turns|turn`, MCP snorkeling_session_info/users/turns/turn).
//
// The four layers mirror the aisessions Manager read methods 1:1; this file only
// validates/shapes them for the wire and maps errors to stable ACS codes. The
// capability itself lives in pkg/aisessions (single source of truth shared with
// the web service methods), so the CLI and the MCP server cannot drift.
package agentcontrol

import (
	"context"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// sessionReadError maps an aisessions read error to a stable ACS error code.
// The gate errors carry the "run session info first" hint in their message, so
// agents can recover without guessing.
func sessionReadError(err error) error {
	if err == nil {
		return nil
	}
	message := err.Error()
	switch {
	case strings.HasPrefix(message, "E_USAGE:"):
		return newError(CodeUsage, "%s", strings.TrimSpace(strings.TrimPrefix(message, "E_USAGE:")))
	case strings.HasPrefix(message, "E_NOT_FOUND:"):
		return newError(CodeNotFound, "%s", strings.TrimSpace(strings.TrimPrefix(message, "E_NOT_FOUND:")))
	}
	if strings.Contains(message, "session id is required") {
		return newError(CodeUsage, "%s", message)
	}
	if strings.Contains(message, "session not found") {
		return newError(CodeNotFound, "%s", message).
			WithHint("pass a session key from `wsh session list --json`")
	}
	return newError(CodeInternal, "%s", message)
}

func sessionReadManager() *aisessions.Manager {
	return aisessions.NewManager("", nil)
}

// GetSessionInfo is layer 0: counts/bytes/verdict, no content.
func GetSessionInfo(ctx context.Context, req wshrpc.SessionInfoRequest) (*wshrpc.SessionInfoResult, error) {
	info, err := sessionReadManager().ReadInfo(ctx, req.Identifier, req.Refresh)
	if err != nil {
		return nil, sessionReadError(err)
	}
	return &wshrpc.SessionInfoResult{
		SessionKey:       info.SessionKey,
		MessageCount:     info.MessageCount,
		UserMessageCount: info.UserMessageCount,
		Bytes:            info.Bytes,
		LastMessageAt:    info.LastMessageAt,
		Verdict:          info.Verdict,
		Stale:            info.Stale,
	}, nil
}

// GetSessionUsers is layer 1: one page of user prompts (120 runes each).
func GetSessionUsers(ctx context.Context, req wshrpc.SessionUsersRequest) (*wshrpc.SessionUsersResult, error) {
	page, err := sessionReadManager().ReadUsers(ctx, req.Identifier, req.BeforeSeq, req.Limit, req.Refresh)
	if err != nil {
		return nil, sessionReadError(err)
	}
	result := &wshrpc.SessionUsersResult{
		NextBeforeSeq: page.NextBeforeSeq,
		HasMore:       page.HasMore,
		Stale:         page.Stale,
		Rows:          make([]wshrpc.SessionUserEntry, 0, len(page.Rows)),
	}
	for _, row := range page.Rows {
		result.Rows = append(result.Rows, wshrpc.SessionUserEntry{
			Seq:       row.Seq,
			At:        row.At,
			Text:      row.Text,
			Truncated: row.Truncated,
		})
	}
	return result, nil
}

// GetSessionTurns is layer 2: one page of turn summaries. Limit is mandatory
// (1-10) — the stateless gate from the design.
func GetSessionTurns(ctx context.Context, req wshrpc.SessionTurnsRequest) (*wshrpc.SessionTurnsResult, error) {
	page, err := sessionReadManager().ReadTurns(ctx, req.Identifier, req.BeforeTurn, req.Limit, req.Refresh)
	if err != nil {
		return nil, sessionReadError(err)
	}
	result := &wshrpc.SessionTurnsResult{
		NextBeforeTurn: page.NextBeforeTurn,
		HasMore:        page.HasMore,
		Stale:          page.Stale,
		Rows:           make([]wshrpc.SessionTurnEntry, 0, len(page.Rows)),
	}
	for _, row := range page.Rows {
		result.Rows = append(result.Rows, wshrpc.SessionTurnEntry{
			Turn:      row.Turn,
			Seq:       row.Seq,
			At:        row.At,
			Text:      row.Text,
			Truncated: row.Truncated,
			ToolCount: row.ToolCount,
			Chars:     row.Chars,
			Ms:        row.Ms,
		})
	}
	return result, nil
}

// GetSessionTurn is layer 3: one turn's original messages under a chars budget
// (mandatory, <=8000).
func GetSessionTurn(ctx context.Context, req wshrpc.SessionTurnRequest) (*wshrpc.SessionTurnResult, error) {
	messages, err := sessionReadManager().ReadTurn(ctx, req.Identifier, req.Turn, req.Chars, req.Refresh)
	if err != nil {
		return nil, sessionReadError(err)
	}
	result := &wshrpc.SessionTurnResult{
		Turn:       messages.Turn,
		Truncated:  messages.Truncated,
		TotalChars: messages.TotalChars,
		Stale:      messages.Stale,
		Rows:       make([]wshrpc.SessionTurnMessageEntry, 0, len(messages.Rows)),
	}
	for _, row := range messages.Rows {
		result.Rows = append(result.Rows, wshrpc.SessionTurnMessageEntry{
			Seq:       row.Seq,
			Role:      row.Role,
			At:        row.At,
			Text:      row.Text,
			Truncated: row.Truncated,
		})
	}
	return result, nil
}
