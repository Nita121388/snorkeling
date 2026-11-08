// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentstatus

import "testing"

// PhaseSince 锁死「徽章时长 = 当前阶段段的时长」这条不变量：
//   - 同一工具/同一相位的续报 → 不重置（pi 的 renewWorking 每 30s 一次，不能把时长切碎）；
//   - 同 state 下换工具（toolName 变）→ 重置；
//   - 同 state 下 phase 变（thinking <-> tool）→ 重置；
//   - 上述三种情况下 ActiveSince 都必须不动 —— 它要留给 Overview 时间线条当
//     「当前状态段起点」，一旦跟着 phase 重置，时间线会因为 activeSince >= endedAt
//     而塌成一段（overview-timeline-model.ts:304 的前置条件）。
func TestPhaseSinceResetsOnPhaseOrToolChange(t *testing.T) {
	ResetForTesting()
	const (
		t0 = int64(1_700_000_000_000)
		t1 = int64(1_700_000_060_000)
		t2 = int64(1_700_000_090_000)
		t3 = int64(1_700_000_120_000)
	)

	report := func(at int64, phase string, tool string, seq int64) *AgentStatus {
		setTestNow(at)
		status, _, err := Report(AgentStatusReport{
			BlockId:  "block-phase",
			Provider: "pi",
			Source:   SourceHook,
			State:    StateWorking,
			Phase:    phase,
			ToolName: tool,
			Seq:      seq,
		}, "")
		if err != nil {
			t.Fatalf("report at %d (%s/%s): %v", at, phase, tool, err)
		}
		if status == nil {
			t.Fatalf("report at %d (%s/%s) returned nil status", at, phase, tool)
		}
		return status
	}

	first := report(t0, PhaseTool, "Bash", 1)
	if first.PhaseSince != t0 {
		t.Fatalf("首条报告 PhaseSince = %d, want %d", first.PhaseSince, t0)
	}
	if first.ActiveSince != t0 {
		t.Fatalf("首条报告 ActiveSince = %d, want %d", first.ActiveSince, t0)
	}

	// 1) 同一工具续报（pi 的 renewWorking）：两个起点都不许动。
	same := report(t1, PhaseTool, "Bash", 2)
	if same.PhaseSince != t0 {
		t.Fatalf("同工具续报把 PhaseSince 提前重置了: %d, want %d", same.PhaseSince, t0)
	}
	if same.ActiveSince != t0 {
		t.Fatalf("同工具续报把 ActiveSince 改了: %d, want %d", same.ActiveSince, t0)
	}

	// 2) 换工具：PhaseSince 归零重计，ActiveSince 保持（时间线依赖它）。
	switched := report(t2, PhaseTool, "Read", 3)
	if switched.PhaseSince != t2 {
		t.Fatalf("换工具后 PhaseSince = %d, want %d（徽章应显示当前工具时长）", switched.PhaseSince, t2)
	}
	if switched.ActiveSince != t0 {
		t.Fatalf("换工具后 ActiveSince 被改了: %d, want %d（时间线两段形态依赖它）", switched.ActiveSince, t0)
	}

	// 3) 相位切换 tool -> thinking：同样归零重计。
	thinking := report(t3, PhaseThinking, "", 4)
	if thinking.PhaseSince != t3 {
		t.Fatalf("相位切换后 PhaseSince = %d, want %d", thinking.PhaseSince, t3)
	}
	if thinking.ActiveSince != t0 {
		t.Fatalf("相位切换后 ActiveSince 被改了: %d, want %d", thinking.ActiveSince, t0)
	}
}
