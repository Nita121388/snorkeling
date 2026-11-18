// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Bounded, cursor-driven read queries over ai_session_messages.
//
// Every query here is a single-session point read: it filters on session_key
// and either LIMITs the result or restricts it to a seq window. Nothing in this
// file materialises a whole session's message list, so the progressive read
// entry points stay inside the "never load everything" budget
// (aisessions-scan-contract.md).
package aisessions

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
)

// userTextNotEmptySQL matches `strings.TrimSpace(text) != ""` exactly: the
// character set is every rune Go's unicode.IsSpace accepts (Latin-1 fast path
// plus the Unicode Z/MN-ish spaces), so the SQL path and the legacy Go filter
// cannot disagree on a whitespace-only user message.
const userTextNotEmptySQL = `text != '' AND TRIM(text, ' ' || char(9) || char(10) || char(11) || char(12) || char(13) || char(133) || char(160) || char(5760) || char(8192) || char(8193) || char(8194) || char(8195) || char(8196) || char(8197) || char(8198) || char(8199) || char(8200) || char(8201) || char(8202) || char(8232) || char(8233) || char(8239) || char(8287) || char(12288)) != ''`

// sessionTextCapRunes is the per-row text budget for the paged layers (design
// §2: user/turn rows carry 120 runes). The SQL asks for one extra rune so a
// row being cut can be reported as truncated.
const sessionTextCapRunes = 120

// MessagesIndexedCurrent reports whether the message cache for summary is
// current: the ai_files record must exist, its mtime/size must equal the
// summary's, and messages must have been indexed for that file version.
//
// This is the same triple check GetMessages uses. It is the only staleness
// signal the progressive read layers trust — a false here means "do not serve
// these rows as if they were current".
func (idx *SQLiteIndex) MessagesIndexedCurrent(ctx context.Context, summary SessionSummary) (bool, error) {
	var fileRecord struct {
		MTime          int64 `db:"mtime"`
		Size           int64 `db:"size"`
		MessageIndexed int   `db:"message_indexed"`
	}
	err := idx.db.GetContext(ctx, &fileRecord, `SELECT mtime, size, message_indexed FROM ai_files WHERE file_path = ?`, summary.FilePath)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if fileRecord.MessageIndexed == 0 || fileRecord.MTime != summary.MTime || fileRecord.Size != summary.Size {
		return false, nil
	}
	return true, nil
}

// CountUserMessages counts the non-blank user messages of one session.
func (idx *SQLiteIndex) CountUserMessages(ctx context.Context, key string) (int, error) {
	var count int
	err := idx.db.GetContext(ctx, &count, `SELECT COUNT(*) FROM ai_session_messages WHERE session_key = ? AND role = 'user' AND `+userTextNotEmptySQL, key)
	return count, err
}

// CountMessages counts the indexed messages of one session (index-only walk of
// idx_ai_session_messages_session, no text materialisation).
func (idx *SQLiteIndex) CountMessages(ctx context.Context, key string) (int, error) {
	var count int
	err := idx.db.GetContext(ctx, &count, `SELECT COUNT(*) FROM ai_session_messages WHERE session_key = ?`, key)
	return count, err
}

// LastMessageAt returns the newest timestamp of one session (0 when empty).
func (idx *SQLiteIndex) LastMessageAt(ctx context.Context, key string) (int64, error) {
	var lastAt sql.NullInt64
	if err := idx.db.GetContext(ctx, &lastAt, `SELECT MAX(timestamp) FROM ai_session_messages WHERE session_key = ?`, key); err != nil {
		return 0, err
	}
	return lastAt.Int64, nil
}

// UserRowsPage returns up to limit user messages with seq < beforeSeq
// (beforeSeq <= 0 means "from the newest"), ascending by seq, with each text
// capped to sessionTextCapRunes+1 runes so the caller can detect truncation.
func (idx *SQLiteIndex) UserRowsPage(ctx context.Context, key string, beforeSeq int, limit int) ([]Message, bool, error) {
	if limit <= 0 {
		return nil, false, nil
	}
	query := `SELECT seq, role, substr(text, 1, ?) AS text, timestamp, tool_name, char_count
		FROM ai_session_messages WHERE session_key = ? AND role = 'user' AND ` + userTextNotEmptySQL
	args := []any{sessionTextCapRunes + 1, key}
	if beforeSeq > 0 {
		query += ` AND seq < ?`
		args = append(args, beforeSeq)
	}
	// One extra row answers hasMore without a second count query.
	query += ` ORDER BY seq DESC LIMIT ?`
	args = append(args, limit+1)
	rows, err := idx.selectMessageRows(ctx, query, args...)
	if err != nil {
		return nil, false, err
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].Seq < rows[j].Seq })
	return rows, hasMore, nil
}

// UserOutlineRows returns the newest limit non-blank user messages, ascending
// by seq. It replaces "load the whole session, then filter in memory" for the
// UserOutline RPC; the caller must have verified MessagesIndexedCurrent first.
func (idx *SQLiteIndex) UserOutlineRows(ctx context.Context, key string, limit int) ([]Message, error) {
	if limit <= 0 {
		return nil, nil
	}
	rows, err := idx.selectMessageRows(ctx, `SELECT seq, role, text, timestamp, tool_name, thinking, char_count
		FROM ai_session_messages WHERE session_key = ? AND role = 'user' AND `+userTextNotEmptySQL+`
		ORDER BY seq DESC LIMIT ?`, key, limit)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].Seq < rows[j].Seq })
	return rows, nil
}

// turnStartsSQL is the single definition of "where does a turn start".
//
// A turn opens at the first message of a user segment: the very first message
// of the session, or a user message directly after a non-user message. This is
// the SQL twin of ComputeTurns (guarded by TestSQLTurnStartsMatchComputeTurns).
const turnStartsSQL = `SELECT seq FROM (
		SELECT seq, role, LAG(role) OVER (ORDER BY seq) AS prev_role
		FROM ai_session_messages WHERE session_key = ?
	)
	WHERE role = 'user' AND (prev_role IS NULL OR prev_role != 'user')`

// TurnStarts returns the seq of every turn-opening message, ascending. Used by
// tests and by callers that genuinely need the whole list; paging uses
// TurnStartsRange so a page never materialises more than its own rows.
func (idx *SQLiteIndex) TurnStarts(ctx context.Context, key string) ([]int, error) {
	var starts []int
	if err := idx.db.SelectContext(ctx, &starts, turnStartsSQL+` ORDER BY seq`, key); err != nil {
		return nil, err
	}
	return starts, nil
}

// TurnStartCount returns how many numbered turns the session has (the preface
// is not a turn).
func (idx *SQLiteIndex) TurnStartCount(ctx context.Context, key string) (int, error) {
	var count int
	err := idx.db.GetContext(ctx, &count, `SELECT COUNT(*) FROM (`+turnStartsSQL+`)`, key)
	return count, err
}

// TurnStartsRange returns the turn-start seqs of turns offset+1 .. offset+limit
// (1-based turn numbers), ascending. It is the paging primitive: only `limit`
// rows ever reach Go, regardless of how many turns the session has.
func (idx *SQLiteIndex) TurnStartsRange(ctx context.Context, key string, offset int, limit int) ([]int, error) {
	if limit <= 0 || offset < 0 {
		return nil, nil
	}
	var starts []int
	if err := idx.db.SelectContext(ctx, &starts, turnStartsSQL+` ORDER BY seq LIMIT ? OFFSET ?`, key, limit, offset); err != nil {
		return nil, err
	}
	return starts, nil
}

// TurnSpan is the aggregate of one turn's messages. Everything is computed in
// SQL so a turn page never materialises message text.
type TurnSpan struct {
	MessageCount int
	ToolCount    int
	Chars        int
	MinAt        int64
	MaxAt        int64
}

// TurnSpanOf aggregates the messages in [fromSeq, toSeqExclusive). A
// toSeqExclusive of 0 means "to the end of the session".
//
// chars falls back to length(text) for rows indexed before char_count was
// populated, so an old cache does not report 0-char turns.
func (idx *SQLiteIndex) TurnSpanOf(ctx context.Context, key string, fromSeq int, toSeqExclusive int) (TurnSpan, error) {
	query := `SELECT COUNT(*) AS message_count,
			COALESCE(SUM(CASE WHEN role = 'tool' THEN 1 ELSE 0 END), 0) AS tool_count,
			COALESCE(SUM(CASE WHEN char_count > 0 THEN char_count ELSE length(text) END), 0) AS chars,
			COALESCE(MIN(timestamp), 0) AS min_at,
			COALESCE(MAX(timestamp), 0) AS max_at
		FROM ai_session_messages WHERE session_key = ? AND seq >= ?`
	args := []any{key, fromSeq}
	if toSeqExclusive > 0 {
		query += ` AND seq < ?`
		args = append(args, toSeqExclusive)
	}
	var row struct {
		MessageCount int   `db:"message_count"`
		ToolCount    int   `db:"tool_count"`
		Chars        int   `db:"chars"`
		MinAt        int64 `db:"min_at"`
		MaxAt        int64 `db:"max_at"`
	}
	if err := idx.db.GetContext(ctx, &row, query, args...); err != nil {
		return TurnSpan{}, err
	}
	return TurnSpan{
		MessageCount: row.MessageCount,
		ToolCount:    row.ToolCount,
		Chars:        row.Chars,
		MinAt:        row.MinAt,
		MaxAt:        row.MaxAt,
	}, nil
}

// TurnHead returns the opening message of a turn (a user message, per
// TurnStarts), with its text capped for the 120-rune page budget.
func (idx *SQLiteIndex) TurnHead(ctx context.Context, key string, seq int) (Message, error) {
	rows, err := idx.selectMessageRows(ctx, `SELECT seq, role, substr(text, 1, ?) AS text, timestamp, tool_name, char_count
		FROM ai_session_messages WHERE session_key = ? AND seq = ?`, sessionTextCapRunes+1, key, seq)
	if err != nil {
		return Message{}, err
	}
	if len(rows) == 0 {
		return Message{}, fmt.Errorf("session message seq %d not found", seq)
	}
	return rows[0], nil
}

// IterateTurnMessages streams the messages of [fromSeq, toSeqExclusive) one row
// at a time. fn returns false to stop early (the chars budget was reached).
func (idx *SQLiteIndex) IterateTurnMessages(ctx context.Context, key string, fromSeq int, toSeqExclusive int, fn func(Message) (bool, error)) error {
	query := `SELECT seq, role, text, timestamp, tool_name, char_count
		FROM ai_session_messages WHERE session_key = ? AND seq >= ?`
	args := []any{key, fromSeq}
	if toSeqExclusive > 0 {
		query += ` AND seq < ?`
		args = append(args, toSeqExclusive)
	}
	query += ` ORDER BY seq`
	rows, err := idx.db.QueryxContext(ctx, query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		var row struct {
			Seq       int    `db:"seq"`
			Role      string `db:"role"`
			Text      string `db:"text"`
			Timestamp int64  `db:"timestamp"`
			ToolName  string `db:"tool_name"`
			CharCount int    `db:"char_count"`
		}
		if err := rows.StructScan(&row); err != nil {
			return err
		}
		keepGoing, fnErr := fn(Message{
			Seq:       row.Seq,
			Role:      row.Role,
			Text:      row.Text,
			Timestamp: row.Timestamp,
			ToolName:  row.ToolName,
			CharCount: row.CharCount,
		})
		if fnErr != nil {
			return fnErr
		}
		if !keepGoing {
			return nil
		}
	}
	return rows.Err()
}

func (idx *SQLiteIndex) selectMessageRows(ctx context.Context, query string, args ...any) ([]Message, error) {
	var rows []struct {
		Seq       int    `db:"seq"`
		Role      string `db:"role"`
		Text      string `db:"text"`
		Timestamp int64  `db:"timestamp"`
		ToolName  string `db:"tool_name"`
		Thinking  string `db:"thinking"`
		CharCount int    `db:"char_count"`
	}
	if err := idx.db.SelectContext(ctx, &rows, query, args...); err != nil {
		return nil, err
	}
	messages := make([]Message, 0, len(rows))
	for _, row := range rows {
		messages = append(messages, Message{
			Seq:       row.Seq,
			Role:      row.Role,
			Text:      row.Text,
			Timestamp: row.Timestamp,
			ToolName:  row.ToolName,
			Thinking:  row.Thinking,
			CharCount: row.CharCount,
		})
	}
	return messages, nil
}
