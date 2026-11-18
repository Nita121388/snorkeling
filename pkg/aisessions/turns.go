// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import "sort"

// Turn is one conversation turn produced by ComputeTurns.
//
// A turn = a run of consecutive user messages (one question, including queued
// follow-ups and pasted files) plus every non-user message after it up to the
// next user-segment start. A user message only starts a new turn when it
// follows a non-user message (the previous question has been answered); tool
// and thinking messages count as the reply side.
type Turn struct {
	Rows []Message
	// Preface marks the segment before the first user message (system
	// preamble etc.). It exists in ComputeTurns output but does NOT occupy a
	// turn number: turn 1 is the first turn whose opening message is a user
	// message.
	Preface bool
}

// ComputeTurns splits an ordered message list into turns.
//
// The semantics are byte-for-byte aligned with the frontend `computeTurnPages`
// (frontend/app/view/aisessions/annotation-model.ts): only a user message that
// follows a non-user message opens a new turn, everything else is appended to
// the current segment. The input is copied and sorted by seq; the caller's
// slice is never trusted to be ordered.
func ComputeTurns(rows []Message) []Turn {
	if len(rows) == 0 {
		return nil
	}
	ordered := make([]Message, len(rows))
	copy(ordered, rows)
	sort.SliceStable(ordered, func(i, j int) bool {
		return ordered[i].Seq < ordered[j].Seq
	})
	var turns []Turn
	cur := -1
	sawReply := false
	for _, row := range ordered {
		if cur < 0 || (row.Role == RoleUser && sawReply) {
			turns = append(turns, Turn{Rows: make([]Message, 0, 4)})
			cur = len(turns) - 1
			sawReply = false
		}
		turns[cur].Rows = append(turns[cur].Rows, row)
		if row.Role != RoleUser {
			sawReply = true
		}
	}
	if len(turns) > 0 && turns[0].Rows[0].Role != RoleUser {
		turns[0].Preface = true
	}
	return turns
}

// isTurnStart reports whether the message at index i (in a seq-ascending
// list) opens a numbered turn. The preface (rows before the first user
// message) is not a turn. It mirrors the ComputeTurns state machine and
// exists so the SQL-based turn-start discovery can be cross-checked against
// the pure function.
func isTurnStart(ordered []Message, i int) bool {
	if i < 0 || i >= len(ordered) {
		return false
	}
	if ordered[i].Role != RoleUser {
		return false
	}
	// First message of the session opens turn 1 only when it is a user
	// message; anything before the first user message is the preface.
	if i == 0 {
		return true
	}
	return ordered[i-1].Role != RoleUser
}
