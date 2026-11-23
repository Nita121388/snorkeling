// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 提交确认退避预算的锁：预算必须按「时间」推导，不按「次数」硬编码。
//
// 为什么值得锁（2026-11-23 真机事故）：confirmSubmit 原来的上限是 MaxSubmitRetries=64 次
// × DefaultSubmitVerifyMs=700ms ≈ 45s 硬上限，与 SubmitWaitMs（180s/600s）完全脱钩 ——
// 真机实测 retries=65 confirmed=false elapsedms=45526，TUI 冷启动 >45s（pi npm view 40s+、
// codex 自更新 45s+）必然丢提交。PRD 写"真正的截止时间是 SubmitWaitMs"，实现没兑现。
//
// 派发回执同锁：未确认的投递绝不能落 StateConfirmed（Transition 会在 confirmed 分支清空
// Error，等于谎报成功，UI/CLI/MCP 都拿不到失败信号）。

package wshserver

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentdispatch"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestSubmitRetryBudgetScalesWithWaitMs(t *testing.T) {
	cases := []struct {
		name        string
		waitMs      int
		verifyMs    int
		wantAtLeast int
		wantAtMost  int
	}{
		// 180s/700ms ≈ 257 次：64 次的旧上限只有它的四分之一
		{"default budget", 180000, 700, 250, 300},
		// 600s（异步派发）必须给到 850+ 次
		{"async budget", 600000, 700, 850, 950},
		// 小预算也要给到时间用尽的次数
		{"small budget", 30000, 700, 40, 60},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := submitRetryBudget(tc.waitMs, tc.verifyMs)
			if got < tc.wantAtLeast {
				t.Errorf("submitRetryBudget(%d,%d) = %d, want >= %d (时间预算必须兑现)", tc.waitMs, tc.verifyMs, got, tc.wantAtLeast)
			}
			if got > tc.wantAtMost {
				t.Errorf("submitRetryBudget(%d,%d) = %d, want <= %d (不能无限放大)", tc.waitMs, tc.verifyMs, got, tc.wantAtMost)
			}
		})
	}
	t.Run("verifyms extreme is capped by safety ceiling", func(t *testing.T) {
		got := submitRetryBudget(600000, 1)
		if got > SubmitRetrySafetyCap {
			t.Errorf("budget %d exceeds safety cap %d", got, SubmitRetrySafetyCap)
		}
	})
	t.Run("budget is monotonic in waitMs", func(t *testing.T) {
		prev := -1
		for _, w := range []int{0, 30000, 120000, 180000, 600000} {
			got := submitRetryBudget(w, 700)
			if got < prev {
				t.Errorf("budget not monotonic: %d -> %d at waitMs=%d", prev, got, w)
			}
			prev = got
		}
	})
}

func TestDispatchFinalStateHonest(t *testing.T) {
	t.Run("confirmed", func(t *testing.T) {
		state, msg := dispatchFinalState(&wshrpc.AgentSendResult{SubmitConfirmed: true})
		if state != agentdispatch.StateConfirmed || msg != "" {
			t.Errorf("confirmed result -> (%v,%q), want (confirmed,\"\")", state, msg)
		}
	})
	t.Run("unconfirmed must fail with E_SUBMIT_UNCONFIRMED", func(t *testing.T) {
		state, msg := dispatchFinalState(&wshrpc.AgentSendResult{SubmitConfirmed: false, SubmitRetries: 65})
		if state != agentdispatch.StateFailed {
			t.Errorf("unconfirmed result -> state %v, want failed", state)
		}
		if !strings.Contains(msg, "E_SUBMIT_UNCONFIRMED") {
			t.Errorf("unconfirmed result -> msg %q, want contains E_SUBMIT_UNCONFIRMED", msg)
		}
	})
}
