// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Reply-completion signals for the agent roundtrip (F-1121-agent-roundtrip).
//
// "The turn is finished" has no single reliable signal in this codebase:
//   - the agentstatus hook reports working/idle, but the report can land late,
//     be dropped, or decay to stale;
//   - the session JSONL file grows while streaming, so file growth alone also
//     fires in the middle of a turn;
//   - the turn counter only moves when a new user turn starts, so it alone
//     cannot tell a finished reply from one that never started.
//
// The predicate therefore requires ALL THREE signals (design D1). Missing a
// completion costs one extra poll; a false completion costs a wrong, half-read
// reply, which is worse (prd "数据不全").
//
// 2026-11-21 真机修正（verify-runs/20261121T19573-agent-roundtrip，FAIL
// timeout-not-an-error）：上面三个信号**全部是「回合开始」信号** —— 注入后
// pi 立刻 agent_start→working（seq 涨）、立刻落盘 user 消息（文件涨）、立刻
// 建 turn（计数涨），于是慢回合在窗口末尾必然「三信号齐」而被提前判成已回复
// （实测返回时快照里块还在 `sleep 60`）。所以判定器加第四个条件：agentstatus
// 必须已经收口（idle/done）。blocked/working/unknown 都不算收口。
package wshserver

import (
	"context"
	"os"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentcontrol"
	"github.com/wavetermdev/waveterm/pkg/agentstatus"
	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	// DefaultReplyWaitMs bounds one wait-reply window.
	DefaultReplyWaitMs = 60000
	// MaxReplyWaitMs is the hard cap (the RPC timeout must stay above it).
	MaxReplyWaitMs = 300000
	// DefaultReplyPollMs is the sampling interval.
	DefaultReplyPollMs = 250
	MinReplyPollMs     = 100
	MaxReplyPollMs     = 2000
	// DefaultReplyChars is the reply text budget.
	DefaultReplyChars = 2000
	// MaxReplyChars matches the session turn read budget (aisessions).
	MaxReplyChars = 8000
	// 会话读取瞬时失败的容忍次数（真机 P1：目标会话可能正被别的进程写）。
	replyReadAttempts = 3
	replyReadBackoff  = 120 * time.Millisecond
)

// replyBaseline is one sample of the completion signals (three "the turn
// started moving" signals plus the settling state). The same struct is used for
// the pre-injection baseline and for every poll, so a comparison is
// field-for-field.
type replyBaseline struct {
	agentSeq  int64  // agentstatus seq (0/-1 = no status hook)
	state     string // agentstatus state ("" = no status hook / unknown)
	fileMtime int64  // session JSONL mtime (unix millis)
	fileSize  int64  // session JSONL size in bytes
	turnCount int    // number of turns in the session index (-1 = unknown)
	sessionId string // the target agent session
	filePath  string // the session JSONL path ("" = not known yet)
}

// replyStateDone is the agents' own spelling of "the turn finished".
// agentstatus.NormalizeState folds it into StateIdle before it is stored, so it
// only shows up here for a raw state string; keeping the literal means a future
// unnormalized path still counts as settled instead of silently timing out.
const replyStateDone = "done"

// replySettled reports whether an agentstatus state means "no turn is running".
// Only idle/done qualify: working is the turn itself, blocked is a paused turn
// that may resume on its own, and unknown/stale/release/error give no evidence
// at all. Being strict here is the whole point of the fourth signal (see the
// file header): a false "settled" re-introduces the early-completion bug.
func replySettled(state string) bool {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case agentstatus.StateIdle, replyStateDone:
		return true
	}
	return false
}

// replyComplete is the completion predicate: all four signals must line up.
// A shrinking file does not count as growth (rewrites/compaction), and an
// unsettled agent means the turn is still running no matter how far the file
// and the turn counter have moved.
func replyComplete(base replyBaseline, now replyBaseline) bool {
	return now.agentSeq > base.agentSeq &&
		now.fileSize > base.fileSize &&
		now.turnCount > base.turnCount &&
		replySettled(now.state)
}

// collectReplySignal samples the full baseline for one block (cheap signals plus
// the session index turn count). It is the pre-injection snapshot and the
// --no-wait cursor, so it may pay for the expensive read; the poll loop must not
// (see replySampler.cheap).
//
// A missing session (pi writes nothing before its first reply) is not an error:
// the baseline is simply empty and any later file/turn growth satisfies its half
// of the predicate.
func collectReplySignal(ctx context.Context, blockId string, sessionId string) replyBaseline {
	sampler := newReplySampler(blockId, strings.TrimSpace(sessionId))
	sig := sampler.cheap(ctx)
	sig.turnCount = sampler.turnCount(ctx)
	return sig
}

// replyPathRetryInterval bounds how often an unknown session path is re-resolved.
// Resolving costs a full session-index walk on this machine (真机实测 7-19s), and
// a session that has not written its JSONL yet has no path at all, so retrying
// every poll would turn the cheap tier into the expensive one.
const replyPathRetryInterval = 2 * time.Second

// replySampler caches the parts of the sampling that are expensive to look up
// (session id, session file path) and does the per-poll work cheaply: one
// agentstatus lookup plus one os.Stat. Nothing here reads the session index; the
// turn count is only paid for on demand by turnCount.
type replySampler struct {
	blockId     string
	sessionId   string
	filePath    string
	lastResolve time.Time
}

func newReplySampler(blockId string, sessionId string) *replySampler {
	return &replySampler{blockId: blockId, sessionId: strings.TrimSpace(sessionId)}
}

// cheap samples agentstatus (state + seq) and the session file size/mtime. The
// returned baseline has turnCount=-1: the expensive tier fills it in.
func (s *replySampler) cheap(ctx context.Context) replyBaseline {
	sig := replyBaseline{agentSeq: -1, turnCount: -1}
	if status := agentstatus.Get(s.blockId); status != nil {
		sig.agentSeq = status.Seq
		sig.state = status.State
	}
	if s.sessionId == "" {
		if sid, err := agentcontrol.ResolveSessionForBlock(ctx, s.blockId); err == nil {
			s.sessionId = strings.TrimSpace(sid)
		}
	}
	sig.sessionId = s.sessionId
	if sig.sessionId == "" {
		return sig
	}
	if s.filePath == "" && time.Since(s.lastResolve) >= replyPathRetryInterval {
		s.lastResolve = time.Now()
		manager := aisessions.NewManager("", nil)
		if path, err := manager.Path(ctx, sig.sessionId, false); err == nil {
			s.filePath = strings.TrimSpace(path)
		}
	}
	sig.filePath = s.filePath
	// 文件不存在 = 该会话还没有任何落盘消息（pi 首条回复前确实没有文件）。
	if sig.filePath != "" {
		if info, err := os.Stat(sig.filePath); err == nil {
			sig.fileSize = info.Size()
			sig.fileMtime = info.ModTime().UnixMilli()
		}
	}
	return sig
}

// turnCount is the expensive tier: it re-parses the session index to get the
// current turn total. -1 = unreadable, which must never look like growth.
func (s *replySampler) turnCount(ctx context.Context) int {
	if s.sessionId == "" {
		return -1
	}
	return replyTurnCount(ctx, s.sessionId)
}

// replyTurnCount returns the newest turn number, which is also the session's
// turn total (turns are numbered 1..N). ReadTurns with limit=1 is the cheapest
// way to ask for it, and refresh=true is the `--refresh` single-file re-parse:
// without it a stale index would report the previous count forever.
//
// Returns -1 when the read fails after retries: an unknown count must never
// look like "the turn count grew".
func replyTurnCount(ctx context.Context, sessionId string) int {
	manager := aisessions.NewManager("", nil)
	for attempt := 0; attempt < replyReadAttempts; attempt++ {
		page, err := manager.ReadTurns(ctx, sessionId, 0, 1, true)
		if err == nil {
			if len(page.Rows) == 0 {
				return 0
			}
			// Rows are ordered oldest -> newest inside a page, so the last row
			// is the highest turn number (= the total).
			return page.Rows[len(page.Rows)-1].Turn
		}
		if !sleepCtx(ctx, replyReadBackoff) {
			return -1
		}
	}
	return -1
}

// replyRead is the decidable outcome of reading one turn's assistant text.
//
// HasText=false is not "the reply is unreadable": it means the turn exists but
// carries no assistant text yet (the index has not caught up, or the JSONL line
// is half-written). The caller must keep polling instead of reporting a
// completed turn — that is exactly the 真机 failure mode where a fast
// early-completion returned replyText="" for a turn pi was still writing.
type replyRead struct {
	HasText    bool
	Text       string
	TotalChars int
	Truncated  bool
	Warnings   []string
}

// apply copies a successful read onto the RPC result.
func (r replyRead) apply(rtn *wshrpc.AgentSendResult) {
	rtn.ReplyText = r.Text
	rtn.TotalChars = r.TotalChars
	rtn.Truncated = r.Truncated
}

// readReplyText reads one turn's assistant text. A failed read is reported as a
// warning with HasText=false: the caller decides whether that ends the wait (a
// timeout leaves replied=false, or the deadline may still report reply-empty).
func readReplyText(ctx context.Context, sessionId string, turn int, chars int) replyRead {
	if sessionId == "" || turn < 1 {
		return replyRead{Warnings: []string{"reply-read-failed: no session/turn to read"}}
	}
	manager := aisessions.NewManager("", nil)
	var (
		messages aisessions.SessionTurnMessages
		err      error
	)
	for attempt := 0; attempt < replyReadAttempts; attempt++ {
		messages, err = manager.ReadTurn(ctx, sessionId, turn, chars, true)
		if err == nil {
			break
		}
		if !sleepCtx(ctx, replyReadBackoff) {
			break
		}
	}
	if err != nil {
		return replyRead{Warnings: []string{"reply-read-failed: " + err.Error()}}
	}
	var builder strings.Builder
	for _, row := range messages.Rows {
		if row.Role != aisessions.RoleAssistant {
			continue
		}
		if builder.Len() > 0 {
			builder.WriteString("\n")
		}
		builder.WriteString(row.Text)
	}
	text := builder.String()
	total := runeLen(text)
	if total == 0 {
		return replyRead{Warnings: []string{"reply-read-failed: turn has no assistant text (index not caught up?)"}}
	}
	read := replyRead{HasText: true, TotalChars: total, Text: text, Truncated: messages.Truncated}
	if total > chars {
		read.Text = cutReplyRunes(text, chars)
		read.Truncated = true
	}
	return read
}

// sleepCtx sleeps for d unless the context ends first (true = slept).
func sleepCtx(ctx context.Context, d time.Duration) bool {
	select {
	case <-ctx.Done():
		return false
	case <-time.After(d):
		return true
	}
}

func runeLen(s string) int {
	count := 0
	for range s {
		count++
	}
	return count
}

// cutReplyRunes truncates to maxChars runes (never bytes, so the reply stays
// valid UTF-8 and CJK characters are not cut in half).
func cutReplyRunes(s string, maxChars int) string {
	if maxChars <= 0 {
		return ""
	}
	var b strings.Builder
	b.Grow(len(s))
	count := 0
	for _, r := range s {
		if count >= maxChars {
			break
		}
		b.WriteRune(r)
		count++
	}
	return b.String()
}

// replyStateOf maps one live record onto a wait state. A record without an
// agent issue (non-live / indexed session) reports "unknown": a wait on it can
// only time out, never match by accident.
func replyStateOf(rec *wshrpc.SessionLiveRecord) string {
	if rec == nil || rec.Issue == nil {
		return agentstatus.StateUnknown
	}
	state := strings.TrimSpace(rec.Issue.State)
	if state == "" {
		return agentstatus.StateUnknown
	}
	return state
}
