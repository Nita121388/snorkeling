// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 派发队列的 RPC 面 + 后台 worker。
//
// 契约：提交（AgentSendCommand async:true）立即返回 dispatchid；投递在后台按
// 「就绪门 → 一次粘贴 → 回车 → hook 确认」执行；回执三段可查询（accepted/submitted/confirmed），
// failed 可按 dispatchid 重试（不新建记录）。桌面 / CLI / MCP / 将来手机端共用这套状态。

package wshserver

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentdispatch"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// async 投递的窗口：没有 UI 在等，可以把就绪门放宽到分钟级（pi 慢网络启动实测 40s+）。
const (
	asyncQuietWaitMs  = 120_000
	asyncSubmitWaitMs = 600_000
	asyncJobTimeout   = 30 * time.Minute
)

func asyncSendParams(params sendParams) sendParams {
	if params.WaitMs < asyncQuietWaitMs {
		params.WaitMs = asyncQuietWaitMs
	}
	if params.SubmitWaitMs < asyncSubmitWaitMs {
		params.SubmitWaitMs = asyncSubmitWaitMs
	}
	return params
}

// runAgentDispatch 是 worker 入口：由 async 分支或 retry 启动。
func runAgentDispatch(rec agentdispatch.Record, text string, params sendParams) {
	params = asyncSendParams(params)
	store := agentdispatch.DefaultStore
	if err := store.Transition(rec.DispatchId, agentdispatch.StateDelivering, ""); err != nil {
		log.Printf("[agentdispatch] %s transition failed: %v", rec.DispatchId, err)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), asyncJobTimeout)
	defer cancel()

	fail := func(format string, args ...any) {
		msg := fmt.Sprintf(format, args...)
		log.Printf("[agentdispatch] %s failed: %s", rec.DispatchId, msg)
		_ = store.Transition(rec.DispatchId, agentdispatch.StateFailed, msg)
	}

	blockObj, err := wstore.DBMustGet[*waveobj.Block](ctx, rec.BlockId)
	if err != nil {
		fail("E_NOT_FOUND: block %q not found", rec.BlockId)
		return
	}
	if view := blockObj.Meta.GetString(waveobj.MetaKey_View, ""); view != "term" {
		fail("E_BLOCK_NOT_READY: block %q is view %q, not a term block", rec.BlockId, view)
		return
	}
	if conn := strings.TrimSpace(blockObj.Meta.GetString(waveobj.MetaKey_Connection, "")); conn != "" && conn != "local" {
		fail("E_UNSUPPORTED: block %q runs on connection %q (local only)", rec.BlockId, conn)
		return
	}

	progress := &deliveryProgress{
		OnAccepted: func() {
			store.Update(rec.DispatchId, func(r *agentdispatch.Record) { r.AcceptedAt = time.Now().UnixMilli() })
		},
		OnSubmitted: func(retries int, confirmed bool) {
			store.Update(rec.DispatchId, func(r *agentdispatch.Record) {
				r.SubmitRetries = retries
				r.SubmittedAt = time.Now().UnixMilli()
				if !confirmed && r.Error == "" {
					r.Error = "submit-unconfirmed"
				}
			})
		},
	}
	store.Update(rec.DispatchId, func(r *agentdispatch.Record) { r.Attempts++ })

	result, err := deliverAgentSend(ctx, rec.BlockId, blockObj, text, params, progress)
	if err != nil {
		fail("%v", err)
		return
	}
	state, msg := dispatchFinalState(result)
	log.Printf(
		"[agentdispatch] %s delivered confirmed=%v retries=%d -> state=%s err=%q",
		rec.DispatchId, result.SubmitConfirmed, result.SubmitRetries, state, msg,
	)
	_ = store.Transition(rec.DispatchId, state, msg)
}

// dispatchFinalState 把投递结果映射成回执终态。未确认必须落 failed（可 AgentDispatchRetry 重试），
// 绝不能用 StateConfirmed —— Store.Transition 在 confirmed 分支会把 Error 清空，等于谎报成功，
// UI / CLI / MCP 再也拿不到失败信号（2026-11-23 真机事故）。
func dispatchFinalState(result *wshrpc.AgentSendResult) (agentdispatch.State, string) {
	if result != nil && result.SubmitConfirmed {
		return agentdispatch.StateConfirmed, ""
	}
	retries := 0
	if result != nil {
		retries = result.SubmitRetries
	}
	return agentdispatch.StateFailed, fmt.Sprintf(
		"E_SUBMIT_UNCONFIRMED: the TUI never confirmed the submit after %d retries; retry once the agent TUI is ready (AgentDispatchRetry)",
		retries,
	)
}

// ---- RPC 面 ----

func (ws *WshServer) AgentDispatchListCommand(ctx context.Context, data wshrpc.AgentDispatchListRequest) ([]agentdispatch.Record, error) {
	return agentdispatch.DefaultStore.List(strings.TrimSpace(data.BlockId), data.Limit), nil
}

func (ws *WshServer) AgentDispatchGetCommand(ctx context.Context, data wshrpc.AgentDispatchGetRequest) (*agentdispatch.Record, error) {
	id := strings.TrimSpace(data.DispatchId)
	if id == "" {
		return nil, fmt.Errorf("E_USAGE: dispatchid is required")
	}
	rec, ok := agentdispatch.DefaultStore.Get(id)
	if !ok {
		return nil, fmt.Errorf("E_NOT_FOUND: dispatch %q not found", id)
	}
	return &rec, nil
}

func (ws *WshServer) AgentDispatchRetryCommand(ctx context.Context, data wshrpc.AgentDispatchRetryRequest) (*agentdispatch.Record, error) {
	id := strings.TrimSpace(data.DispatchId)
	if id == "" {
		return nil, fmt.Errorf("E_USAGE: dispatchid is required")
	}
	rec, err := agentdispatch.DefaultStore.Retry(id)
	if err != nil {
		return nil, err
	}
	text, decErr := base64.StdEncoding.DecodeString(rec.Text64)
	if decErr != nil {
		_ = agentdispatch.DefaultStore.Transition(id, agentdispatch.StateFailed, "E_USAGE: stored text is not base64")
		return nil, fmt.Errorf("E_USAGE: stored text is not base64: %w", decErr)
	}
	params, normErr := normalizeSendParams(wshrpc.AgentSendRequest{Submit: boolPtr(true)})
	if normErr != nil {
		return nil, normErr
	}
	go runAgentDispatch(rec, string(text), params)
	return &rec, nil
}

func boolPtr(v bool) *bool { return &v }
