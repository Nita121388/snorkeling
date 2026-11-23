// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentdispatch"
	"github.com/wavetermdev/waveterm/pkg/agentstatus"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	// DefaultSendQuietMs is how long the TUI output must be silent before text is
	// injected. Matches the frontend pending-input quiet window.
	DefaultSendQuietMs = 400
	// DefaultSendWaitMs is the readiness deadline: a TUI that never goes quiet
	// (spinner, animation) must fail loudly instead of swallowing the text.
	DefaultSendWaitMs = 30000
	// MaxSendWaitMs bounds the readiness wait so an RPC cannot hang for minutes.
	MaxSendWaitMs = 120000
	// DefaultSubmitDelayMs mirrors the frontend SubmitAfterPasteDelayMs: the TUI
	// must consume the bracketed paste before a bare CR counts as "submit".
	DefaultSubmitDelayMs = 150
	MaxSubmitDelayMs     = 2000
	MinSendQuietMs       = 100
	MaxSendQuietMs       = 5000
	// MaxSendTextBytes caps one injection. A PTY paste of unbounded size would
	// either be truncated by the TUI or take minutes to render.
	MaxSendTextBytes = 64 * 1024
	sendPollInterval = 100 * time.Millisecond
	// 提交确认：agent TUI（实测 pi）在启动期会在输出里留 >quiet 的间歇，
	// 就绪判定就会误以为可以发 —— paste 成功但 CR 被吞（文字睡在输入框里不提交）。
	// 对策：提交后看 term 输出是否继续增长；没动就补发 CR（文字已在输入框，重复 CR 安全）。
	DefaultSubmitVerifyMs = 700
	MinSubmitVerifyMs     = 200
	MaxSubmitVerifyMs     = 5000
	// 单次观察窗口的退避上限（700ms × 尝试次数，最多 3s）。
	MaxSubmitVerifyWindowMs = 3000
	// 补回车次数预算的绝对安全上限：只为防止 verifyms 被设成极小值时循环空转，
	// 真正的预算由 SubmitWaitMs / SubmitVerifyMs 时间推导（见 submitRetryBudget）。
	SubmitRetrySafetyCap = 2000
	// 提交确认的总窗口：pi 启动期会跑 `npm view` 查扩展更新，真机可达 40s+，
	// 静默判定的 waitms（默认 30s）不够打，提交确认单独给宽窗口。
	DefaultSubmitWaitMs = 180000
	MaxSubmitWaitMs     = 600000
	// 未就绪标记：某些 agent TUI（实测 pi）在启动期会持续显示这句话，期间对 Enter 完全无响应
	// （启动会跑 `npm view` 查扩展更新，慢网络下可达 40s+）。静默判定会把它误当“就绪”。
	// 命中这些标记时不当就绪，继续等（宁可报 E_AGENT_NOT_READY，也不静默把消息塞进输入框当成功）。
	termStartupMarkers = "startup is still in progress|starting up|initializing"
	// 读 term 输出尾部判定标记时的长度上限。
	termTailReadBytes = 4096
	// 等「启动结束」时的轮询间隔：期间只等不打回车。
	submitStartupPollMs = 500
)

// AgentSendCommand writes text into a term block's PTY. It is the backend twin of
// the frontend CommonText injection chain (pending-input.ts + commontext-insert.ts),
// but it does not go through the frontend at all: it waits for the TUI to be quiet
// by watching the block's term output file, then writes one bracketed paste and one
// CR through blockcontroller.SendInput — the single PTY write path.
func (ws *WshServer) AgentSendCommand(ctx context.Context, data wshrpc.AgentSendRequest) (*wshrpc.AgentSendResult, error) {
	text, err := resolveSendText(data)
	if err != nil {
		return nil, err
	}
	params, err := normalizeSendParams(data)
	if err != nil {
		return nil, err
	}

	blockId, err := resolveSendTargetBlock(ctx, data.BlockId)
	if err != nil {
		return nil, err
	}
	blockObj, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return nil, fmt.Errorf("E_NOT_FOUND: block %q not found", blockId)
	}
	view := blockObj.Meta.GetString(waveobj.MetaKey_View, "")
	if view != "term" {
		return nil, fmt.Errorf("E_BLOCK_NOT_READY: block %q is view %q, not a term block", blockId, view)
	}
	if conn := strings.TrimSpace(blockObj.Meta.GetString(waveobj.MetaKey_Connection, "")); conn != "" && conn != "local" {
		return nil, fmt.Errorf("E_UNSUPPORTED: block %q runs on connection %q (local only for now)", blockId, conn)
	}

	// async：写入派发队列后立即返回。投递在后台做（就绪门可以等几分钟），
	// 任何端（桌面 UI / CLI / MCP / 手机端）都只做「提交 + 读回执」。
	if data.Async {
		requester := strings.TrimSpace(data.Requester)
		if requester == "" {
			requester = "desktop"
		}
		tabId, _ := findTabIdForBlock(ctx, blockId)
		rec := agentdispatch.DefaultStore.Create(blockId, tabId, data.Text64, requester)
		go runAgentDispatch(*rec, text, params)
		return &wshrpc.AgentSendResult{
			Version:    wshrpc.AgentControlVersion,
			Ok:         true,
			BlockId:    blockId,
			View:       view,
			Queued:     true,
			DispatchId: rec.DispatchId,
			QuietMs:    params.QuietMs,
		}, nil
	}

	return deliverAgentSend(ctx, blockId, blockObj, text, params, nil)
}

// deliveryProgress 把投递里程碑回调给派发队列（落三段回执）。nil = 不需要。
type deliveryProgress struct {
	OnAccepted  func()
	OnSubmitted func(retries int, confirmed bool)
}

// deliverAgentSend 是同步与异步共用的投递内核：确保 controller → 就绪门 → 一次
// bracketed paste → 回车 → 提交确认（agentstatus hook 优先）。

// submitRetryBudget 由时间预算推导允许的补回车次数：SubmitWaitMs / SubmitVerifyMs + 固定余量。
// 2026-11-23 真机事故：旧实现硬编码 64 次 × 700ms ≈ 45s，与 SubmitWaitMs（180s/600s）脱钩，
// TUI 冷启动超过 45s（pi npm view 40s+）提交必然被次数上限掐断。真截止仍是 confirmSubmit 里的 deadline。
// submitWaitMs <= 0 时按最小预算处理（不做默认值替换，保持对 waitMs 单调不降；调用方已先把 0 解析成默认值）。
func submitRetryBudget(submitWaitMs, verifyMs int) int {
	if verifyMs <= 0 {
		verifyMs = DefaultSubmitVerifyMs
	}
	if submitWaitMs < 0 {
		submitWaitMs = 0
	}
	n := submitWaitMs/verifyMs + 4
	if n < 8 {
		n = 8
	}
	if n > SubmitRetrySafetyCap {
		n = SubmitRetrySafetyCap
	}
	return n
}

// confirmSubmit 确认这次提交真的被 TUI 接住：以 term 输出文件是否继续增长为信号。
// 没长就补发 CR（有界：params.SubmitWaitMs 时间截止 + submitRetryBudget 次数预算，间隔退避），
// 返回补发次数与是否确认。
//
// 为什么“补发”是安全的：文字已经在 TUI 的输入缓冲区里（paste 已成功），此时多按几次回车
// 最多是空提交（agent TUI 忽略空输入 / 命令行多一个空提示符），比默默丢消息好得多。
//
// 为什么需要宽窗口：真机实测（2026-11-21）pi 启动期会跑 `npm view` 查扩展更新，启动可达 40s+，
// 期间 term 输出完全不动。只等 waitms（默认 30s）会打空重试，消息仍睡在输入框。
// 该窗口与“等静默”分开：静默判定仍需快，提交确认可以慢。
func confirmSubmit(ctx context.Context, blockId string, params sendParams, isAgentBlock bool) (int, bool) {
	submitWaitMs := params.SubmitWaitMs
	if submitWaitMs <= 0 {
		submitWaitMs = DefaultSubmitWaitMs
	}
	deadline := time.Now().Add(time.Duration(submitWaitMs) * time.Millisecond)
	ackWindowMs := params.SubmitVerifyMs
	baselineSeq := agentStatusSeq(blockId)
	budget := submitRetryBudget(submitWaitMs, ackWindowMs)
	retries := 0
	// 规则（2026-11-21 真机两次误判后定稿）：
	//   1. 屏上还有「还在启动」标记时只等，不打回车（启动期回车必被吞）。
	//   2. agent 块的提交确认**只认 hook**（agent_start → working）。
	//      绝不用「输出增长」：pi 启动期自己在渲染 banner，输出动 ≠ 提交成功。
	//   3. 普通 term 块（shell/REPL，没有 agent status）才允许用输出增长当 ack。
	for retries <= budget {
		if ctx.Err() != nil {
			return retries, false
		}
		if isAgentBlock && agentStatusConfirmsSubmit(blockId, baselineSeq) {
			return retries, true
		}
		if termTailShowsStartup(blockId) {
			if time.Now().After(deadline) {
				return retries, false
			}
			select {
			case <-ctx.Done():
				return retries, false
			case <-time.After(submitStartupPollMs):
			}
			continue
		}
		// 就绪：投一次回车
		if err := sendInputReady(ctx, blockId, []byte("")); err != nil {
			return retries, false
		}
		retries++
		// 等 ack
		ackDeadline := time.Now().Add(time.Duration(ackWindowMs) * time.Millisecond)
		for time.Now().Before(ackDeadline) {
			if isAgentBlock {
				if agentStatusConfirmsSubmit(blockId, baselineSeq) {
					return retries, true
				}
			} else if termOutputMoved(ctx, blockId, submitStartupPollMs) {
				// 非 agent 块（shell）：输出增长就是执行证据
				return retries, true
			}
			if ctx.Err() != nil {
				return retries, false
			}
		}
		if time.Now().After(deadline) {
			return retries, false
		}
	}
	return retries, false
}

// termOutputMoved 在 windowMs 内轮询 term 输出文件，只要出现 size/modts 变化就返回 true。
// 文件不存在（刚启动的块）也算“未动”，交给上层补发/超时。
func termOutputMoved(ctx context.Context, blockId string, windowMs int) bool {
	start := time.Now()
	deadline := start.Add(time.Duration(windowMs) * time.Millisecond)
	var lastSize int64 = -1
	var lastMod int64 = -1
	haveBaseline := false
	for {
		wfile, statErr := filestore.WFS.Stat(ctx, blockId, wavebase.BlockFile_Term)
		if statErr == nil && wfile != nil {
			if !haveBaseline {
				lastSize = wfile.Size
				lastMod = wfile.ModTs
				haveBaseline = true
			} else if wfile.Size != lastSize || wfile.ModTs != lastMod {
				return true
			}
		}
		if time.Now().After(deadline) {
			return false
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(sendPollInterval):
		}
	}
}

// sendInputReady writes bytes through the single PTY path, tolerating the narrow
// window where the controller reports "running" but its input channel has not
// been created yet (ShellController sets ProcStatus=running before
// manageRunningShellProcess installs ShellInputCh). Without this retry a freshly
// launched block fails the very first write with "no shell input chan".
func sendInputReady(ctx context.Context, blockId string, data []byte) error {
	const readyTimeout = 3 * time.Second
	const readyPoll = 50 * time.Millisecond
	deadline := time.Now().Add(readyTimeout)
	for {
		err := blockcontroller.SendInput(blockId, &blockcontroller.BlockInputUnion{InputData: data})
		if err == nil {
			return nil
		}
		// Only the "input channel not ready yet" case is worth retrying; a missing
		// controller is a real failure.
		if !strings.Contains(err.Error(), "no shell input chan") || time.Now().After(deadline) {
			return err
		}
		select {
		case <-ctx.Done():
			return err
		case <-time.After(readyPoll):
		}
	}
}

// resolveSendText accepts either plain text or base64 and enforces the size cap.
// Text64 wins when both are present: it is the channel that survives control
// characters and shell quoting untouched.
func resolveSendText(data wshrpc.AgentSendRequest) (string, error) {
	raw := data.Text
	if strings.TrimSpace(data.Text64) != "" {
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(data.Text64))
		if err != nil {
			return "", fmt.Errorf("E_USAGE: text64 is not valid base64: %w", err)
		}
		raw = string(decoded)
	}
	if raw == "" {
		return "", fmt.Errorf("E_USAGE: text or text64 is required")
	}
	if len(raw) > MaxSendTextBytes {
		return "", fmt.Errorf("E_USAGE: text is %d bytes, over the %d byte cap", len(raw), MaxSendTextBytes)
	}
	return SanitizeSendText(raw), nil
}

// SanitizeSendText strips C0 control characters (keeping tab and newline) so the
// injected bytes cannot carry terminal escape sequences of their own. Bracketed
// paste markers are added by buildInjectBytes, never by the caller.
func SanitizeSendText(text string) string {
	var b strings.Builder
	b.Grow(len(text))
	for _, r := range text {
		switch {
		case r == '\n' || r == '\t':
			b.WriteRune(r)
		case r < 0x20 || r == 0x7f:
			// drop other C0 controls, DEL, and ESC (ESC is < 0x20)
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// buildInjectBytes wraps the text in bracketed paste markers. pi and other TUIs
// rely on these markers to accept a multi-line paste as one block (pi-tui #7321).
func buildInjectBytes(text string) []byte {
	return []byte("\x1b[200~" + text + "\x1b[201~")
}

type sendParams struct {
	Wait           bool
	WaitMs         int
	QuietMs        int
	Submit         bool
	SubmitDelayMs  int
	SubmitVerifyMs int
	SubmitWaitMs   int
	// roundtrip (F-1121): wait for the turn to finish and read the reply back.
	WaitReply   bool
	NoWait      bool
	ReplyWaitMs int
	ReplyChars  int
	ReplyPollMs int
}

func normalizeSendParams(data wshrpc.AgentSendRequest) (sendParams, error) {
	// Submit/Wait are pointers so an explicit false survives the wire; unset
	// defaults to the documented behaviour (wait + submit).
	params := sendParams{
		Wait:           data.Wait == nil || *data.Wait,
		WaitMs:         data.WaitMs,
		QuietMs:        data.QuietMs,
		Submit:         data.Submit == nil || *data.Submit,
		SubmitDelayMs:  data.SubmitDelayMs,
		SubmitVerifyMs: data.SubmitVerifyMs,
		SubmitWaitMs:   data.SubmitWaitMs,
	}
	if params.WaitMs <= 0 {
		params.WaitMs = DefaultSendWaitMs
	}
	if params.WaitMs > MaxSendWaitMs {
		return params, fmt.Errorf("E_USAGE: waitms %d over the %d ms cap", params.WaitMs, MaxSendWaitMs)
	}
	if params.QuietMs <= 0 {
		params.QuietMs = DefaultSendQuietMs
	}
	if params.QuietMs < MinSendQuietMs || params.QuietMs > MaxSendQuietMs {
		return params, fmt.Errorf("E_USAGE: quietms %d out of range [%d,%d]", params.QuietMs, MinSendQuietMs, MaxSendQuietMs)
	}
	if params.SubmitDelayMs < 0 {
		return params, fmt.Errorf("E_USAGE: submitdelayms must not be negative")
	}
	if params.SubmitDelayMs == 0 && params.Submit {
		params.SubmitDelayMs = DefaultSubmitDelayMs
	}
	if params.SubmitDelayMs > MaxSubmitDelayMs {
		return params, fmt.Errorf("E_USAGE: submitdelayms %d over the %d ms cap", params.SubmitDelayMs, MaxSubmitDelayMs)
	}
	if params.SubmitVerifyMs <= 0 {
		params.SubmitVerifyMs = DefaultSubmitVerifyMs
	}
	if params.SubmitVerifyMs < MinSubmitVerifyMs || params.SubmitVerifyMs > MaxSubmitVerifyMs {
		return params, fmt.Errorf(
			"E_USAGE: submitverifyms %d out of range [%d,%d]",
			params.SubmitVerifyMs, MinSubmitVerifyMs, MaxSubmitVerifyMs,
		)
	}
	if params.SubmitWaitMs <= 0 {
		params.SubmitWaitMs = DefaultSubmitWaitMs
	}
	if params.SubmitWaitMs > MaxSubmitWaitMs {
		return params, fmt.Errorf("E_USAGE: submitwaitms %d over the %d ms cap", params.SubmitWaitMs, MaxSubmitWaitMs)
	}
	// roundtrip (F-1121): wait-reply is a synchronous roundtrip. Async dispatch
	// is fire-and-forget (its delivery runs in the background minutes later) and
	// NoWait means "return the cursor and poll yourself", so neither can be
	// combined with a blocking wait.
	params.WaitReply = data.WaitReply != nil && *data.WaitReply
	params.NoWait = data.NoWait
	if params.WaitReply && data.Async {
		return params, fmt.Errorf("E_USAGE: waitreply and async are mutually exclusive (an async dispatch is delivered in the background and cannot be waited on)")
	}
	if params.WaitReply && params.NoWait {
		return params, fmt.Errorf("E_USAGE: waitreply and nowait are mutually exclusive (wait for the reply, or return the cursor)")
	}
	if params.WaitReply {
		params.ReplyWaitMs = data.ReplyWaitMs
		if params.ReplyWaitMs <= 0 {
			params.ReplyWaitMs = DefaultReplyWaitMs
		}
		if params.ReplyWaitMs > MaxReplyWaitMs {
			return params, fmt.Errorf("E_USAGE: replywaitms %d over the %d ms cap", params.ReplyWaitMs, MaxReplyWaitMs)
		}
		// Budgets are clamped, not rejected: a caller asking for more than the
		// read path can deliver gets the maximum instead of a failed send.
		params.ReplyChars = clampInt(data.ReplyChars, DefaultReplyChars, 1, MaxReplyChars)
		params.ReplyPollMs = clampInt(data.ReplyPollMs, DefaultReplyPollMs, MinReplyPollMs, MaxReplyPollMs)
	}
	return params, nil
}

// clampInt applies def when value is unset (<=0) and otherwise clamps into
// [lo,hi].
func clampInt(value int, def int, lo int, hi int) int {
	if value <= 0 {
		value = def
	}
	if value < lo {
		return lo
	}
	if value > hi {
		return hi
	}
	return value
}

// resolveSendTargetBlock turns "this" into the calling block id. `this` comes from
// the RPC context (WAVETERM_BLOCKID exported into the block's shell), so it means
// "the block the agent is standing in", never a guess from the UI.
func resolveSendTargetBlock(ctx context.Context, blockId string) (string, error) {
	id := strings.TrimSpace(blockId)
	if id == "" {
		return "", fmt.Errorf("E_USAGE: --block is required (use 'this' for the calling block)")
	}
	if id == "this" {
		resolved := ""
		if handler := wshutil.GetRpcResponseHandlerFromContext(ctx); handler != nil {
			resolved = strings.TrimSpace(handler.GetRpcContext().BlockId)
		}
		if resolved == "" {
			return "", fmt.Errorf("E_NOT_FOUND: 'this' requires running inside a block (WAVETERM_BLOCKID is empty)")
		}
		return resolved, nil
	}
	return id, nil
}

// ensureSendBlockController starts the block's controller when it is not running.
// Without a live controller SendInput has nowhere to write, and failing there would
// surface as a confusing "no controller found" after the text was accepted.
func ensureSendBlockController(ctx context.Context, blockId string, blockObj *waveobj.Block) error {
	status := blockcontroller.GetBlockControllerRuntimeStatus(blockId)
	if status != nil && status.ShellProcStatus == blockcontroller.Status_Running {
		return nil
	}
	tabId, err := findTabIdForBlock(ctx, blockId)
	if err != nil {
		return err
	}
	if err := blockcontroller.ResyncController(ctx, tabId, blockId, nil, false); err != nil {
		return fmt.Errorf("E_BLOCK_NOT_READY: could not start the block controller: %w", err)
	}
	status = blockcontroller.GetBlockControllerRuntimeStatus(blockId)
	if status == nil {
		return fmt.Errorf("E_BLOCK_NOT_READY: block %q has no controller (view=%q)", blockId, blockObj.Meta.GetString(waveobj.MetaKey_View, ""))
	}
	return nil
}

// waitForTermQuiet polls the block's term output file until it stops growing for
// quietMs. The signal is the same one the frontend uses (terminal output stops
// updating), but measured on the persisted term file instead of the xterm instance,
// so it works for blocks the frontend has never mounted.
func waitForTermQuiet(ctx context.Context, blockId string, waitMs int, quietMs int) (int, error) {
	start := time.Now()
	deadline := start.Add(time.Duration(waitMs) * time.Millisecond)
	var lastSize int64
	var lastMod int64
	haveBaseline := false
	lastChange := start
	for {
		wfile, statErr := filestore.WFS.Stat(ctx, blockId, wavebase.BlockFile_Term)
		if statErr == nil && wfile != nil {
			if !haveBaseline || wfile.Size != lastSize || wfile.ModTs != lastMod {
				haveBaseline = true
				lastSize = wfile.Size
				lastMod = wfile.ModTs
				lastChange = time.Now()
			}
		} else if !haveBaseline {
			// No term file yet: the controller has not produced anything. Keep
			// waiting within the deadline instead of injecting into the void.
			haveBaseline = false
		}
		if haveBaseline {
			quietFor := time.Since(lastChange)
			if quietFor >= time.Duration(quietMs)*time.Millisecond {
				if !termTailShowsStartup(blockId) {
					return int(time.Since(start).Milliseconds()), nil
				}
				// 静默了，但 TUI 仍显示启动中：继续等（不要让 CR 白打）
				lastChange = time.Now()
			}
		}
		if time.Now().After(deadline) {
			if termTailShowsStartup(blockId) {
				return int(time.Since(start).Milliseconds()), fmt.Errorf(
					"E_AGENT_NOT_READY: agent TUI in block %q is still starting after %d ms (startup marker still on screen)",
					blockId, waitMs)
			}
			return int(time.Since(start).Milliseconds()), fmt.Errorf(
				"E_AGENT_NOT_READY: no quiet window of %d ms within %d ms (block %q is still producing output)",
				quietMs, waitMs, blockId)
		}
		select {
		case <-ctx.Done():
			return int(time.Since(start).Milliseconds()), fmt.Errorf("E_AGENT_NOT_READY: cancelled while waiting for a quiet TUI")
		case <-time.After(sendPollInterval):
		}
	}
}

// agentStatusConfirmsSubmit 判断 agent 状态是否**确认了这次提交**。
// 只看 seq 变化是不够的：启动期 agent 扩展也会报状态（例如 idle / release），
// 那会把「文字还在输入框」误判成已提交（真机 2026-11-21 踩到）。
// 所以要求：出现新报告，且状态是 working（pi/codex/claude 的 agent_start → working）。
func agentStatusConfirmsSubmit(blockId string, baselineSeq int64) bool {
	st := agentstatus.Get(blockId)
	if st == nil {
		return false
	}
	if st.Seq <= baselineSeq {
		return false
	}
	return st.State == agentstatus.StateWorking
}

// agentStatusSeq 返回该块当前 agent 状态的 seq；没有 hook / 没状态时返回 -1。
// seq 是 agentstatus 管理器里每次新报告都会加的计数器，用它做“提交后是否真的有新报告”。
func agentStatusSeq(blockId string) int64 {
	status := agentstatus.Get(blockId)
	if status == nil {
		return -1
	}
	return status.Seq
}

// termTailShowsStartup 读 term 文件尾部，判断 TUI 是否还在启动阶段（见 termStartupMarkers）。
// 读不到文件 / 读失败一律算“不是启动中”（不能因为读错误把发送卡死）。
func termTailShowsStartup(blockId string) bool {
	_, data, err := filestore.WFS.ReadFile(context.Background(), blockId, wavebase.BlockFile_Term)
	if err != nil || len(data) == 0 {
		return false
	}
	if len(data) > termTailReadBytes {
		data = data[len(data)-termTailReadBytes:]
	}
	return termTailStartupRe.Match(data)
}

var termTailStartupRe = regexp.MustCompile("(?i)" + termStartupMarkers)

// findTabIdForBlock locates the tab that currently owns a block via the shared
// wstore lookup (block parents walk). ResyncController needs it, and a block
// always belongs to exactly one tab.
func findTabIdForBlock(ctx context.Context, blockId string) (string, error) {
	tabId, err := wstore.DBFindTabForBlockId(ctx, blockId)
	if err != nil || tabId == "" {
		return "", fmt.Errorf("E_NOT_FOUND: block %q is not in any tab: %v", blockId, err)
	}
	return tabId, nil
}

func deliverAgentSend(
	ctx context.Context,
	blockId string,
	blockObj *waveobj.Block,
	text string,
	params sendParams,
	progress *deliveryProgress,
) (*wshrpc.AgentSendResult, error) {
	view := blockObj.Meta.GetString(waveobj.MetaKey_View, "")
	// A term block only has a live PTY once its controller is running. A block in a
	// background tab may have never been mounted by the frontend, so start the
	// controller here instead of failing: the launch+send path depends on it, and
	// the term file keeps the output for whenever the user looks at the block.
	if err := ensureSendBlockController(ctx, blockId, blockObj); err != nil {
		return nil, err
	}
	log.Printf("[agentsend] %s controller ready", blockId)

	rtn := &wshrpc.AgentSendResult{
		Version:       wshrpc.AgentControlVersion,
		Ok:            true,
		BlockId:       blockId,
		View:          view,
		QuietMs:       params.QuietMs,
		SubmitDelayMs: params.SubmitDelayMs,
	}

	if params.Wait {
		waitedMs, err := waitForTermQuiet(ctx, blockId, params.WaitMs, params.QuietMs)
		rtn.WaitedMs = waitedMs
		log.Printf("[agentsend] %s quiet wait done waitedms=%d err=%v", blockId, waitedMs, err)
		if err != nil {
			return rtn, err
		}
	} else {
		rtn.Warnings = append(rtn.Warnings, "wait-skipped")
	}

	// Roundtrip baseline (F-1121): sample the three completion signals right
	// before the paste. Sampling before the quiet wait would let a turn that
	// finished during the wait look like "no growth at all", and sampling after
	// injection would miss a very fast reply. It is also the cursor returned to
	// a --no-wait caller.
	var replyBase replyBaseline
	if params.WaitReply || params.NoWait {
		replyBase = collectReplySignal(ctx, blockId, "")
		rtn.ReplyCursor = replyBase.turnCount
		log.Printf(
			"[agentsend] %s reply baseline seq=%d state=%q size=%d mtime=%d turns=%d session=%s",
			blockId, replyBase.agentSeq, replyBase.state, replyBase.fileSize, replyBase.fileMtime, replyBase.turnCount, replyBase.sessionId,
		)
		if params.WaitReply {
			// Only the wait path cares about the baseline's blind spots; a plain
			// --no-wait send must not grow reply warnings of its own.
			rtn.Warnings = append(rtn.Warnings, collectWarnings(replyBase)...)
		}
	}

	// One bracketed paste for the whole text: multi-line text must stay one paste,
	// otherwise the TUI would treat every line as a separate submission.
	if err := sendInputReady(ctx, blockId, buildInjectBytes(text)); err != nil {
		return rtn, fmt.Errorf("E_BLOCK_NOT_READY: write to pty failed: %w", err)
	}
	rtn.Injected = true
	log.Printf("[agentsend] %s injected %d bytes", blockId, len(text))
	if progress != nil && progress.OnAccepted != nil {
		progress.OnAccepted()
	}

	if params.Submit {
		// The TUI needs the bracketed paste consumed before CR means "submit".
		time.Sleep(time.Duration(params.SubmitDelayMs) * time.Millisecond)
		if err := sendInputReady(ctx, blockId, []byte("\r")); err != nil {
			return rtn, fmt.Errorf("E_BLOCK_NOT_READY: submit (enter) failed: %w", err)
		}
		rtn.Submitted = true
		// 提交确认（真机事故 2026-11-21）：pi 启动期（"Startup is still in progress"）会
		// 吞掉回车 —— 文字进了输入框但没提交，用户看到「文字在输入框里、没发出去」。
		// 输出继续增长 = TUI 真的接了；静默不动 = 补发回车。
		submitStart := time.Now()
		isAgentBlock := strings.TrimSpace(blockObj.Meta.GetString("agent:provider", "")) != ""
		rtn.SubmitRetries, rtn.SubmitConfirmed = confirmSubmit(ctx, blockId, params, isAgentBlock)
		if progress != nil && progress.OnSubmitted != nil {
			progress.OnSubmitted(rtn.SubmitRetries, rtn.SubmitConfirmed)
		}
		submitBudget := submitRetryBudget(params.SubmitWaitMs, params.SubmitVerifyMs)
		log.Printf(
			"[agentsend] %s submit confirm retries=%d confirmed=%v elapsedms=%d budget=%d",
			blockId, rtn.SubmitRetries, rtn.SubmitConfirmed, time.Since(submitStart).Milliseconds(), submitBudget,
		)
		if !rtn.SubmitConfirmed {
			rtn.Warnings = append(rtn.Warnings, "submit-unconfirmed")
		}
	}

	// Roundtrip window: only after a successful submit does "the agent is
	// working on it" mean anything. A wait timeout is not an error (the send
	// itself succeeded); the caller reads replied/warnings from the JSON.
	if params.WaitReply {
		waitForReply(ctx, blockId, replyBase, params, rtn)
	}
	return rtn, nil
}

// collectWarnings surfaces the baseline's own blind spots instead of hiding
// them: no agent status hook or no session means the three-signal predicate can
// only time out.
func collectWarnings(base replyBaseline) []string {
	var warnings []string
	if base.agentSeq < 0 {
		warnings = append(warnings, "reply-no-agentstatus")
	}
	if base.sessionId == "" {
		warnings = append(warnings, "reply-no-session-yet")
	} else if base.turnCount < 0 {
		warnings = append(warnings, "reply-turn-count-unavailable")
	}
	return warnings
}

// waitForReply polls until the turn completes or the window closes. It never
// returns an error: a timeout lands as replied=false plus the "reply-timeout"
// warning so a caller can distinguish "send failed" from "the agent has not
// answered yet".
//
// 两档采样（真机 2026-11-21）：廉价档每 poll 只读 agentstatus + os.Stat；只有
// 廉价档显示「已收口（idle/done）且文件长过基线」才付昂贵档（会话索引 turn
// 计数 + turn 正文）。之前每 poll 都做一次全会话读，实测 7-19s/次，既慢又让
// 250ms 的轮询间隔变成摆设。
func waitForReply(ctx context.Context, blockId string, base replyBaseline, params sendParams, rtn *wshrpc.AgentSendResult) {
	start := time.Now()
	defer func() {
		rtn.ReplyWaitedMs = int(time.Since(start).Milliseconds())
		rtn.WaitedMs += rtn.ReplyWaitedMs
	}()
	deadline := start.Add(time.Duration(params.ReplyWaitMs) * time.Millisecond)
	poll := time.Duration(params.ReplyPollMs) * time.Millisecond
	sampler := newReplySampler(blockId, base.sessionId)
	blockedWarned := false
	last := base
	// emptyTurn 记住最近一次「四信号全齐但正文读不回」的 turn。它只在 deadline
	// 时生效：答复确实存在，只是正文读不回来（索引没跟上 / 半截 JSON），所以
	// 报 replied=true + replyText="" + reply-empty，而不是谎称超时。
	emptyTurn := 0
	for {
		now := sampler.cheap(ctx)
		if replySettled(now.state) && now.fileSize > base.fileSize {
			now.turnCount = sampler.turnCount(ctx)
			if replyComplete(base, now) {
				read := readReplyText(ctx, now.sessionId, now.turnCount, params.ReplyChars)
				if read.HasText {
					rtn.Replied = true
					rtn.Turn = now.turnCount
					read.apply(rtn)
					log.Printf(
						"[agentsend] %s reply complete turn=%d chars=%d waitedms=%d",
						blockId, now.turnCount, rtn.TotalChars, rtn.ReplyWaitedMs,
					)
					return
				}
				// 回合已收口但正文还没落盘：不算完成，继续轮询（半截回复比多等一轮贵）。
				emptyTurn = now.turnCount
				log.Printf("[agentsend] %s turn %d settled but has no assistant text yet, keep polling", blockId, now.turnCount)
			}
		}
		last = now
		// A blocked agent (approval prompt) can resume on its own: warn once and
		// keep waiting instead of treating it as completion or as failure.
		if now.state == agentstatus.StateBlocked && !blockedWarned {
			blockedWarned = true
			rtn.Warnings = append(rtn.Warnings, "reply-agent-blocked")
		}
		if time.Now().After(deadline) {
			if emptyTurn > 0 {
				rtn.Replied = true
				rtn.Turn = emptyTurn
				rtn.Warnings = append(rtn.Warnings, "reply-empty")
				log.Printf(
					"[agentsend] %s reply-empty: turn %d settled but no assistant text within %d ms",
					blockId, emptyTurn, rtn.ReplyWaitedMs,
				)
				return
			}
			rtn.Replied = false
			rtn.Warnings = append(rtn.Warnings, "reply-timeout")
			rtn.Warnings = append(rtn.Warnings, incompleteSignalWarnings(base, last)...)
			log.Printf(
				"[agentsend] %s reply timeout after %d ms (seq %d->%d size %d->%d mtime %d->%d turns %d->%d state %q->%q)",
				blockId, rtn.ReplyWaitedMs, base.agentSeq, last.agentSeq, base.fileSize, last.fileSize,
				base.fileMtime, last.fileMtime, base.turnCount, last.turnCount, base.state, last.state,
			)
			return
		}
		if !sleepCtx(ctx, poll) {
			// The RPC deadline fired first: report it as a timeout, not as a
			// broken send. The CLI/MCP must keep the RPC timeout above the wait
			// window; seeing this warning means they did not.
			rtn.Warnings = append(rtn.Warnings, "reply-timeout", "reply-rpc-deadline")
			rtn.Warnings = append(rtn.Warnings, incompleteSignalWarnings(base, last)...)
			return
		}
	}
}

// incompleteSignalWarnings names which of the four signals never lined up, so
// a timeout is diagnosable without re-running the send. The state is reported
// as "base->last" on every timeout (the 真机 defect was invisible without it:
// three start-of-turn signals all looked healthy while the turn was still
// running).
func incompleteSignalWarnings(base replyBaseline, last replyBaseline) []string {
	var warnings []string
	if last.agentSeq <= base.agentSeq {
		warnings = append(warnings, "reply-signal-agentstatus-stale")
	}
	if last.fileSize <= base.fileSize {
		warnings = append(warnings, "reply-signal-file-unchanged")
	}
	if last.turnCount <= base.turnCount {
		warnings = append(warnings, "reply-signal-turn-unchanged")
	}
	if !replySettled(last.state) {
		warnings = append(warnings, "reply-signal-state-not-settled")
	}
	warnings = append(warnings, "reply-signal-state "+replyStateLabel(base.state)+"->"+replyStateLabel(last.state))
	return warnings
}

// replyStateLabel keeps the state warning readable when there was no status
// hook at all (empty state would render as "->idle").
func replyStateLabel(state string) string {
	state = strings.ToLower(strings.TrimSpace(state))
	if state == "" {
		return agentstatus.StateUnknown
	}
	return state
}
