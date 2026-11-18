// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Progressive single-session read entry points (design:
// .trellis/tasks/11-18-aisessions-turn-reading/design.md §3/§4).
//
// Layer 1: ReadUsers — paged user prompts (~2KB per page).
// Layer 2: ReadTurns — paged turn summaries (~3KB per page).
// Layer 3: ReadTurn — one turn's original messages (<=8KB).
// Layer 0: ReadInfo — size probe without any content.
//
// All of them are single-session point reads on the SQLite message index with
// seq/turn cursors and hard upper bounds. None of them loads a whole session
// (the List-path budget red lines do not apply here, and must not).
package aisessions

import (
	"context"
	"fmt"
	"strings"
)

// Verdict values for SessionReadInfo.
const (
	SessionVerdictSmall  = "small"
	SessionVerdictMedium = "medium"
	SessionVerdictLarge  = "large"
)

const (
	sessionVerdictSmallMaxMessages = 150
	sessionVerdictSmallMaxBytes    = int64(2 * 1024 * 1024)
	sessionVerdictLargeMinMessages = 1200
	sessionVerdictLargeMinBytes    = int64(20 * 1024 * 1024)

	// Layer budgets (design §3).
	sessionUsersDefaultLimit = 20
	sessionUsersMaxLimit     = 100
	sessionTurnsMaxLimit     = 10
	sessionTurnMaxChars      = 8000
	sessionRowTextMaxRunes   = 120

	// userOutline limits keep the legacy UserOutline RPC contract.
	userOutlineDefaultLimit = 20
	userOutlineMaxLimit     = 200
)

// SessionReadInfo is the size probe for one session: enough metadata to pick a
// read strategy, no content (design §3.1).
type SessionReadInfo struct {
	SessionKey       string `json:"sessionKey"`
	MessageCount     int    `json:"messageCount"`
	UserMessageCount int    `json:"userMessageCount"`
	Bytes            int64  `json:"bytes"`
	LastMessageAt    int64  `json:"lastMessageAt,omitempty"`
	Verdict          string `json:"verdict"`
	// Stale means the message index is behind the session file: counts may
	// miss recent messages. Callers should refresh (Detail / refresh=true)
	// before trusting the numbers; this is reported, never hidden.
	Stale bool `json:"stale,omitempty"`
}

// SessionUserRow is one user prompt on a SessionUserPage.
type SessionUserRow struct {
	Seq       int    `json:"seq"`
	At        int64  `json:"at,omitempty"`
	Text      string `json:"text"`
	Truncated bool   `json:"truncated,omitempty"`
}

// SessionUserPage is layer 1: a bounded page of user prompts.
type SessionUserPage struct {
	Rows []SessionUserRow `json:"rows"`
	// NextBeforeSeq is the cursor for the next older page (seq < this).
	NextBeforeSeq int  `json:"nextBeforeSeq,omitempty"`
	HasMore       bool `json:"hasMore"`
	Stale         bool `json:"stale,omitempty"`
}

// SessionTurnRow is one turn summary on a SessionTurnPage.
type SessionTurnRow struct {
	Turn      int    `json:"turn"`
	Seq       int    `json:"seq"`
	At        int64  `json:"at,omitempty"`
	Text      string `json:"text"`
	Truncated bool   `json:"truncated,omitempty"`
	ToolCount int    `json:"toolCount"`
	Chars     int    `json:"chars"`
	// Ms is the span from the turn's first to last message timestamp.
	Ms int64 `json:"ms"`
}

// SessionTurnPage is layer 2: a bounded page of turn summaries. Turn numbers
// start at 1; the preface (rows before the first user message) never occupies
// a turn number.
type SessionTurnPage struct {
	Rows []SessionTurnRow `json:"rows"`
	// NextBeforeTurn is the cursor for the next older page (turn < this).
	NextBeforeTurn int  `json:"nextBeforeTurn,omitempty"`
	HasMore        bool `json:"hasMore"`
	Stale          bool `json:"stale,omitempty"`
}

// SessionTurnMessageRow is one original message of a SessionTurnMessages.
type SessionTurnMessageRow struct {
	Seq       int    `json:"seq"`
	Role      string `json:"role"`
	At        int64  `json:"at,omitempty"`
	Text      string `json:"text"`
	Truncated bool   `json:"truncated,omitempty"`
}

// SessionTurnMessages is layer 3: one turn's original messages under a total
// chars budget.
type SessionTurnMessages struct {
	Turn       int                     `json:"turn"`
	Rows       []SessionTurnMessageRow `json:"rows"`
	Truncated  bool                    `json:"truncated"`
	TotalChars int                     `json:"totalChars"`
	Stale      bool                    `json:"stale,omitempty"`
}

// UserOutlineRowsResult mirrors the legacy UserOutline RPC payload, produced
// without loading the whole session when the message index is current.
type UserOutlineRowsResult struct {
	Summary          SessionSummary `json:"summary"`
	Messages         []Message      `json:"messages"`
	UserMessageCount int            `json:"userMessageCount"`
}

// cutRunes returns at most maxChars runes without an ellipsis: the paged
// layers carry an explicit truncated flag, and a "..." suffix would break the
// hard page budget (120 runes / N chars) these rows promise.
func cutRunes(text string, maxChars int) string {
	if maxChars <= 0 {
		return ""
	}
	if runeCount(text) <= maxChars {
		return text
	}
	var b strings.Builder
	b.Grow(maxChars)
	count := 0
	for _, r := range text {
		if count >= maxChars {
			break
		}
		b.WriteRune(r)
		count++
	}
	return b.String()
}

// VerdictOf buckets a session by size: small <=150 messages and <=2MB,
// large >1200 messages or >20MB, everything else medium (design §3.1).
func VerdictOf(messageCount int, bytes int64) string {
	if messageCount > sessionVerdictLargeMinMessages || bytes > sessionVerdictLargeMinBytes {
		return SessionVerdictLarge
	}
	if messageCount <= sessionVerdictSmallMaxMessages && bytes <= sessionVerdictSmallMaxBytes {
		return SessionVerdictSmall
	}
	return SessionVerdictMedium
}

// LatestUserOutlineMessages is the legacy UserOutline filter: the newest limit
// non-blank user messages plus the total non-blank user count. Kept because
// the UserOutline RPC contract (messages, userMessageCount) is byte-identical
// to what it produced; it is now also the stale-index fallback for the SQL
// implementation (design §6).
func LatestUserOutlineMessages(messages []Message, limit int) ([]Message, int) {
	if limit <= 0 {
		limit = userOutlineDefaultLimit
	}
	if limit > userOutlineMaxLimit {
		limit = userOutlineMaxLimit
	}
	var latest []Message
	count := 0
	for _, message := range messages {
		if message.Role != RoleUser || strings.TrimSpace(message.Text) == "" {
			continue
		}
		count++
		if len(latest) < limit {
			latest = append(latest, message)
			continue
		}
		copy(latest, latest[1:])
		latest[len(latest)-1] = message
	}
	return latest, count
}

// sessionReadScope is the resolved state every progressive read starts from.
type sessionReadScope struct {
	summary SessionSummary
	fresh   bool
}

// resolveReadScope resolves the session summary and the message-index
// freshness flag. It is a point lookup (resolveSession from SQLite with
// allowStale=false, like the Detail path); it never triggers a budgeted full
// scan beyond what Detail would do.
//
// With refresh=true and a stale/absent message index, it re-parses THIS ONE
// session file (loadMessages(refresh) — no provider directory scan) and retries
// once. Callers that do not pass refresh get Stale=true instead of old rows.
func (m *Manager) resolveReadScope(ctx context.Context, identifier string, refresh bool) (sessionReadScope, error) {
	scope, err := m.readScopeOnce(ctx, identifier)
	if err != nil || scope.fresh || !refresh {
		return scope, err
	}
	if _, err := m.loadMessages(ctx, scope.summary, true); err != nil {
		debugf("Manager.resolveReadScope reindex error key=%q err=%v", scope.summary.Key, err)
		return scope, nil
	}
	debugf("Manager.resolveReadScope reindexed key=%q file=%q", scope.summary.Key, scope.summary.FilePath)
	return m.readScopeOnce(ctx, identifier)
}

// readScopeOnce resolves one session's summary and message-index freshness.
func (m *Manager) readScopeOnce(ctx context.Context, identifier string) (sessionReadScope, error) {
	summary, err := m.resolveSession(ctx, identifier, false, false)
	if err != nil {
		return sessionReadScope{}, err
	}
	scope := sessionReadScope{summary: summary}
	sqliteIdx, err := m.openSQLiteIndex()
	if err != nil {
		// No SQLite index: everything reports stale rather than guessing.
		return scope, nil
	}
	defer sqliteIdx.Close()
	fresh, err := sqliteIdx.MessagesIndexedCurrent(ctx, summary)
	if err != nil {
		debugf("Manager.resolveReadScope freshness error key=%q err=%v", summary.Key, err)
		return scope, nil
	}
	scope.fresh = fresh
	return scope, nil
}

// ReadInfo returns the size probe for one session (design §3.1).
func (m *Manager) ReadInfo(ctx context.Context, identifier string, refresh bool) (SessionReadInfo, error) {
	scope, err := m.resolveReadScope(ctx, identifier, refresh)
	if err != nil {
		return SessionReadInfo{}, err
	}
	info := SessionReadInfo{
		SessionKey:   scope.summary.Key,
		MessageCount: scope.summary.MessageCount,
		Bytes:        scope.summary.Size,
		Verdict:      VerdictOf(scope.summary.MessageCount, scope.summary.Size),
		Stale:        !scope.fresh,
	}
	sqliteIdx, err := m.openSQLiteIndex()
	if err != nil {
		return info, nil
	}
	defer sqliteIdx.Close()
	if userCount, err := sqliteIdx.CountUserMessages(ctx, scope.summary.Key); err == nil {
		info.UserMessageCount = userCount
	} else {
		debugf("Manager.ReadInfo user count error key=%q err=%v", scope.summary.Key, err)
	}
	if lastAt, err := sqliteIdx.LastMessageAt(ctx, scope.summary.Key); err == nil {
		info.LastMessageAt = lastAt
	} else {
		debugf("Manager.ReadInfo last message error key=%q err=%v", scope.summary.Key, err)
	}
	// Sessions whose summary count predates message indexing report 0 while
	// the index holds rows; the readable indexed count is the honest number.
	if indexedCount, err := sqliteIdx.CountMessages(ctx, scope.summary.Key); err == nil && indexedCount > info.MessageCount {
		info.MessageCount = indexedCount
		info.Verdict = VerdictOf(indexedCount, info.Bytes)
	}
	return info, nil
}

// ReadUsers returns one page of user prompts (design §3.2). beforeSeq <= 0
// starts from the newest prompt; the next page passes NextBeforeSeq.
func (m *Manager) ReadUsers(ctx context.Context, identifier string, beforeSeq int, limit int, refresh bool) (SessionUserPage, error) {
	if beforeSeq < 0 {
		return SessionUserPage{}, fmt.Errorf("E_USAGE: beforeSeq must be >= 0 (got %d)", beforeSeq)
	}
	if limit <= 0 {
		limit = sessionUsersDefaultLimit
	}
	if limit > sessionUsersMaxLimit {
		// Clamp: the upper bound is the hard guarantee (never a full pull).
		limit = sessionUsersMaxLimit
	}
	scope, err := m.resolveReadScope(ctx, identifier, refresh)
	if err != nil {
		return SessionUserPage{}, err
	}
	page := SessionUserPage{Stale: !scope.fresh}
	if !scope.fresh {
		return page, nil
	}
	sqliteIdx, err := m.openSQLiteIndex()
	if err != nil {
		return SessionUserPage{Stale: true}, nil
	}
	defer sqliteIdx.Close()
	rows, hasMore, err := sqliteIdx.UserRowsPage(ctx, scope.summary.Key, beforeSeq, limit)
	if err != nil {
		return SessionUserPage{Stale: true}, err
	}
	for _, row := range rows {
		text := cutRunes(row.Text, sessionRowTextMaxRunes)
		truncated := runeCount(row.Text) > sessionRowTextMaxRunes
		page.Rows = append(page.Rows, SessionUserRow{
			Seq:       row.Seq,
			At:        row.Timestamp,
			Text:      text,
			Truncated: truncated,
		})
	}
	page.HasMore = hasMore
	if len(rows) > 0 {
		page.NextBeforeSeq = rows[0].Seq
	}
	return page, nil
}

// ReadTurns returns one page of turn summaries (design §3.3).
//
// Gate: limit must be passed explicitly and be within 1-10 (design §5) — the
// stateless equivalent of "prove you ran session info first" and the hard
// guarantee that a page can never pull the whole session.
func (m *Manager) ReadTurns(ctx context.Context, identifier string, beforeTurn int, limit int, refresh bool) (SessionTurnPage, error) {
	if limit <= 0 || limit > sessionTurnsMaxLimit {
		return SessionTurnPage{}, fmt.Errorf("E_USAGE: turn page limit must be 1-%d and explicit (got %d); run 'session info' first to size the session", sessionTurnsMaxLimit, limit)
	}
	if beforeTurn < 0 {
		return SessionTurnPage{}, fmt.Errorf("E_USAGE: beforeTurn must be >= 0 (got %d)", beforeTurn)
	}
	scope, err := m.resolveReadScope(ctx, identifier, refresh)
	if err != nil {
		return SessionTurnPage{}, err
	}
	page := SessionTurnPage{Stale: !scope.fresh}
	if !scope.fresh {
		return page, nil
	}
	sqliteIdx, err := m.openSQLiteIndex()
	if err != nil {
		return SessionTurnPage{Stale: true}, nil
	}
	defer sqliteIdx.Close()
	key := scope.summary.Key
	total, err := sqliteIdx.TurnStartCount(ctx, key)
	if err != nil {
		return SessionTurnPage{Stale: true}, err
	}
	// hi is the newest turn number in this page (exclusive cursor below).
	hi := total
	if beforeTurn > 0 && beforeTurn-1 < hi {
		hi = beforeTurn - 1
	}
	if hi < 1 {
		return page, nil
	}
	lo := hi - limit + 1
	if lo < 1 {
		lo = 1
	}
	page.NextBeforeTurn = lo
	page.HasMore = lo > 1
	// Bounded turn-start window: one row per page turn plus the next turn's
	// start as the exclusive upper seq. Never more than limit+1 rows to Go.
	starts, err := sqliteIdx.TurnStartsRange(ctx, key, lo-1, hi-lo+2)
	if err != nil {
		return SessionTurnPage{Stale: true}, err
	}
	if len(starts) < hi-lo+1 {
		return SessionTurnPage{}, fmt.Errorf("E_INTERNAL: turn window underflow: wanted turns %d-%d, got %d starts", lo, hi, len(starts))
	}
	for idx := 0; idx < hi-lo+1; idx++ {
		turn := lo + idx
		fromSeq := starts[idx]
		toSeqExclusive := 0
		if idx+1 < len(starts) {
			toSeqExclusive = starts[idx+1]
		} else if turn < total {
			return SessionTurnPage{}, fmt.Errorf("E_INTERNAL: turn window missing the next turn start for turn %d", turn)
		}
		head, err := sqliteIdx.TurnHead(ctx, key, fromSeq)
		if err != nil {
			return SessionTurnPage{}, err
		}
		span, err := sqliteIdx.TurnSpanOf(ctx, key, fromSeq, toSeqExclusive)
		if err != nil {
			return SessionTurnPage{}, err
		}
		text := cutRunes(head.Text, sessionRowTextMaxRunes)
		truncated := runeCount(head.Text) > sessionRowTextMaxRunes
		page.Rows = append(page.Rows, SessionTurnRow{
			Turn:      turn,
			Seq:       head.Seq,
			At:        head.Timestamp,
			Text:      text,
			Truncated: truncated,
			ToolCount: span.ToolCount,
			Chars:     span.Chars,
			Ms:        span.MaxAt - span.MinAt,
		})
	}
	return page, nil
}

// ReadTurn returns one turn's original messages under a total chars budget
// (design §3.4). Gate: chars must be passed explicitly and be within 1-8000.
func (m *Manager) ReadTurn(ctx context.Context, identifier string, turn int, chars int, refresh bool) (SessionTurnMessages, error) {
	if chars <= 0 || chars > sessionTurnMaxChars {
		return SessionTurnMessages{}, fmt.Errorf("E_USAGE: turn chars budget must be 1-%d and explicit (got %d); run 'session info' first to size the session", sessionTurnMaxChars, chars)
	}
	if turn < 1 {
		return SessionTurnMessages{}, fmt.Errorf("E_USAGE: turn number must be >= 1 (got %d)", turn)
	}
	scope, err := m.resolveReadScope(ctx, identifier, refresh)
	if err != nil {
		return SessionTurnMessages{}, err
	}
	result := SessionTurnMessages{Turn: turn, Stale: !scope.fresh}
	if !scope.fresh {
		return result, nil
	}
	sqliteIdx, err := m.openSQLiteIndex()
	if err != nil {
		return SessionTurnMessages{Turn: turn, Stale: true}, nil
	}
	defer sqliteIdx.Close()
	key := scope.summary.Key
	total, err := sqliteIdx.TurnStartCount(ctx, key)
	if err != nil {
		return SessionTurnMessages{Stale: true}, err
	}
	if turn > total {
		return SessionTurnMessages{}, fmt.Errorf("E_NOT_FOUND: session has %d turns (requested turn %d); run 'session turns' to list them", total, turn)
	}
	starts, err := sqliteIdx.TurnStartsRange(ctx, key, turn-1, 2)
	if err != nil {
		return SessionTurnMessages{Stale: true}, err
	}
	if len(starts) == 0 {
		return SessionTurnMessages{}, fmt.Errorf("E_INTERNAL: turn %d start missing", turn)
	}
	fromSeq := starts[0]
	toSeqExclusive := 0
	if len(starts) > 1 {
		toSeqExclusive = starts[1]
	}
	span, err := sqliteIdx.TurnSpanOf(ctx, key, fromSeq, toSeqExclusive)
	if err != nil {
		return SessionTurnMessages{}, err
	}
	result.TotalChars = span.Chars
	remaining := chars
	var truncated bool
	err = sqliteIdx.IterateTurnMessages(ctx, key, fromSeq, toSeqExclusive, func(message Message) (bool, error) {
		row := SessionTurnMessageRow{
			Seq:  message.Seq,
			Role: message.Role,
			At:   message.Timestamp,
		}
		rowChars := message.CharCount
		if rowChars <= 0 {
			// Rows indexed before char_count was populated.
			rowChars = runeCount(message.Text)
		}
		if rowChars <= remaining {
			row.Text = message.Text
			remaining -= rowChars
			result.Rows = append(result.Rows, row)
			return true, nil
		}
		// This row busts the budget: keep a truncated prefix, then stop.
		if remaining > 0 {
			row.Text = cutRunes(message.Text, remaining)
			row.Truncated = runeCount(message.Text) > remaining
			result.Rows = append(result.Rows, row)
		}
		truncated = true
		return false, nil
	})
	if err != nil {
		return SessionTurnMessages{}, err
	}
	result.Truncated = truncated
	return result, nil
}

// UserOutlineRows serves the UserOutline RPC from the SQL index (design §6).
//
// The message index must be current (ai_files mtime/size/message_indexed);
// otherwise the legacy path runs (Load + LatestUserOutlineMessages) so the RPC
// never silently answers from a stale cache. The output is byte-identical to
// the pre-SQL implementation: on a current index the old path also read these
// exact rows from the same cache, and on a stale index both take the Load
// fallback.
func (m *Manager) UserOutlineRows(ctx context.Context, identifier string, refresh bool, limit int) (UserOutlineRowsResult, error) {
	if limit <= 0 {
		limit = userOutlineDefaultLimit
	}
	if limit > userOutlineMaxLimit {
		limit = userOutlineMaxLimit
	}
	if !refresh {
		summary, err := m.resolveSession(ctx, identifier, false, false)
		if err == nil {
			if sqliteIdx, idxErr := m.openSQLiteIndex(); idxErr == nil {
				fresh, freshErr := sqliteIdx.MessagesIndexedCurrent(ctx, summary)
				if freshErr != nil {
					debugf("Manager.UserOutlineRows freshness error key=%q err=%v", summary.Key, freshErr)
				}
				if freshErr == nil && fresh {
					rows, rowsErr := sqliteIdx.UserOutlineRows(ctx, summary.Key, limit)
					count, countErr := sqliteIdx.CountUserMessages(ctx, summary.Key)
					if rowsErr == nil && countErr == nil {
						debugf("Manager.UserOutlineRows sql hit key=%q rows=%d count=%d", summary.Key, len(rows), count)
						_ = sqliteIdx.Close()
						return UserOutlineRowsResult{
							Summary:          summary,
							Messages:         rows,
							UserMessageCount: count,
						}, nil
					}
					debugf("Manager.UserOutlineRows sql miss key=%q rowsErr=%v countErr=%v", summary.Key, rowsErr, countErr)
				}
				_ = sqliteIdx.Close()
			}
		}
	}
	// Stale index (or explicit refresh): legacy full-load path, identical to
	// the pre-SQL implementation including its cache-refresh side effects.
	detail, err := m.Load(ctx, identifier, LoadOptions{Refresh: refresh})
	if err != nil {
		return UserOutlineRowsResult{}, err
	}
	messages, count := LatestUserOutlineMessages(detail.Messages, limit)
	return UserOutlineRowsResult{
		Summary:          detail.Summary,
		Messages:         messages,
		UserMessageCount: count,
	}, nil
}
