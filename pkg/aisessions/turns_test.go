// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"fmt"
	"testing"
)

func msg(role string, seq int) Message {
	return Message{Seq: seq, Role: role, Text: fmt.Sprintf("%s-%d", role, seq), CharCount: 4}
}

// Design §4 定稿用例 1：连续 user 消息并入同一轮（排队补充/贴文件算一问）。
func TestComputeTurnsMergesConsecutiveUserMessages(t *testing.T) {
	turns := ComputeTurns([]Message{
		msg(RoleUser, 1), msg(RoleUser, 2), msg(RoleAssistant, 3), msg(RoleTool, 4),
		msg(RoleAssistant, 5),
	})
	if len(turns) != 1 || turns[0].Preface {
		t.Fatalf("expected single non-preface turn, got %#v", turns)
	}
	if turns[0].Rows[0].Seq != 1 || turns[0].Rows[len(turns[0].Rows)-1].Seq != 5 {
		t.Fatalf("unexpected turn span: %#v", turns[0].Rows)
	}
}

// Design §4 定稿用例 2：user 跟在非 user 之后才开新轮。
func TestComputeTurnsOpensNewTurnAfterReply(t *testing.T) {
	turns := ComputeTurns([]Message{
		msg(RoleUser, 1), msg(RoleAssistant, 2), msg(RoleUser, 3), msg(RoleAssistant, 4),
	})
	if len(turns) != 2 {
		t.Fatalf("expected 2 turns, got %d", len(turns))
	}
	if turns[0].Rows[0].Seq != 1 || turns[1].Rows[0].Seq != 3 {
		t.Fatalf("unexpected turn starts: %#v", turns)
	}
	if turns[0].Preface || turns[1].Preface {
		t.Fatalf("no preface expected when first row is user: %#v", turns)
	}
}

// Design §4 定稿用例 3：tool/thinking 消息算回应侧。
func TestComputeTurnsCountsToolsAsReplySide(t *testing.T) {
	turns := ComputeTurns([]Message{
		msg(RoleUser, 1), msg(RoleTool, 2), msg(RoleUser, 3), msg(RoleUser, 4),
	})
	if len(turns) != 2 {
		t.Fatalf("tool between user runs must split turns, got %d", len(turns))
	}
	if turns[1].Rows[0].Seq != 3 || len(turns[1].Rows) != 2 {
		t.Fatalf("expected user 3+4 merged into turn 2: %#v", turns[1])
	}
}

// 引导段：首个 user 之前的行自成一段，标记 Preface 且不占轮号。
func TestComputeTurnsPrefaceBeforeFirstUser(t *testing.T) {
	turns := ComputeTurns([]Message{
		msg(RoleAssistant, 1), msg(RoleTool, 2),
		msg(RoleUser, 3), msg(RoleAssistant, 4),
		msg(RoleUser, 5), msg(RoleAssistant, 6),
	})
	if len(turns) != 3 {
		t.Fatalf("expected preface + 2 turns, got %#v", turns)
	}
	if !turns[0].Preface || turns[0].Rows[0].Seq != 1 {
		t.Fatalf("expected preface at seq 1, got %#v", turns[0])
	}
	if turns[1].Preface || turns[2].Preface {
		t.Fatalf("only the first segment may be the preface: %#v", turns)
	}
	if turns[1].Rows[0].Seq != 3 || turns[2].Rows[0].Seq != 5 {
		t.Fatalf("turns must start at user messages 3 and 5: %#v", turns)
	}
}

// 输入乱序也要先按 seq 升序排（纯函数不信任调用方，与前端 computePages 一致）。
func TestComputeTurnsSortsInputBySeq(t *testing.T) {
	turns := ComputeTurns([]Message{
		msg(RoleUser, 5), msg(RoleAssistant, 6),
		msg(RoleUser, 1), msg(RoleAssistant, 2),
	})
	if len(turns) != 2 {
		t.Fatalf("expected 2 turns, got %#v", turns)
	}
	if turns[0].Rows[0].Seq != 1 || turns[1].Rows[0].Seq != 5 {
		t.Fatalf("expected seq-ordered turns, got %#v", turns)
	}
}

func TestTurnStartHelperMatchesComputeTurns(t *testing.T) {
	ordered := []Message{
		msg(RoleAssistant, 1), msg(RoleTool, 2),
		msg(RoleUser, 3), msg(RoleUser, 4), msg(RoleTool, 5),
		msg(RoleUser, 6), msg(RoleAssistant, 7),
	}
	starts := []int{}
	for i := range ordered {
		if isTurnStart(ordered, i) {
			starts = append(starts, ordered[i].Seq)
		}
	}
	// Preface(1) excluded: turn starts are the user-segment heads 3 and 6.
	if len(starts) != 2 || starts[0] != 3 || starts[1] != 6 {
		t.Fatalf("expected turn starts [3 6], got %v", starts)
	}
	turns := ComputeTurns(ordered)
	var turnStarts []int
	for _, turn := range turns {
		if turn.Preface {
			continue
		}
		turnStarts = append(turnStarts, turn.Rows[0].Seq)
	}
	if fmt.Sprint(turnStarts) != fmt.Sprint(starts) {
		t.Fatalf("isTurnStart [%v] drifted from ComputeTurns [%v]", starts, turnStarts)
	}
}
