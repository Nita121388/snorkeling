// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// SessionRunBadgeView 的锁：三条分支的文案 / tone / 跑时 / 可点击性。
//
// 为什么值得单独锁：这个徽章把「进程存活」与「agent 状态」两套数据源合成一个标记，
// 分支一旦退化（比如无 AgentStatus 时又编造 "Working"，或 chat 态被渲染成按钮），
// 用户看到的就是新的语义混淆 —— 而这次改动本来就是为了消掉语义混淆。

import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { describe, expect, it } from "vitest";
import { buildSessionRunBadgeView } from "./session-run-badge-view";
import type { SessionRunningState } from "./use-sessions-running";

const Now = 1_700_000_000_000;

const RunningState: SessionRunningState = { status: "running", blockId: "block-1", tabId: "tab-1" };

function status(overrides: Partial<AgentStatus> = {}): AgentStatus {
    return {
        blockId: "block-1",
        provider: "codex",
        state: "working",
        phase: "thinking",
        source: "hook",
        confidence: "high",
        updatedAt: Now - 134_000,
        activeSince: Now - 134_000,
        ...overrides,
    };
}

describe("buildSessionRunBadgeView — 不渲染", () => {
    it("没有活跃块也没有 GUI 对话时不渲染", () => {
        expect(buildSessionRunBadgeView({ nowMs: Now })).toBeNull();
        expect(buildSessionRunBadgeView({ runningState: null, chatRunning: false, nowMs: Now })).toBeNull();
        expect(buildSessionRunBadgeView({ runningState: null, status: status(), nowMs: Now })).toBeNull();
    });
});

describe("buildSessionRunBadgeView — 分支 1：有 AgentStatus", () => {
    it("thinking 走 Thinking + 跑时，可点击跳转", () => {
        const view = buildSessionRunBadgeView({ runningState: RunningState, status: status(), nowMs: Now });

        expect(view).not.toBeNull();
        expect(view!.tone).toBe("agent");
        expect(view!.label).toBe("Thinking");
        expect(view!.runtime).toBe("2min14s");
        expect(view!.clickable).toBe(true);
        expect(view!.className).toContain("is-working");
        expect(view!.className).toContain("session-run-badge--button");
        expect(view!.title).toContain("click to jump to block");
        expect(view!.icon).toBe("sparkles");
    });

    it("tool phase 换成工具名图标与 Tool: <name> 文案", () => {
        const view = buildSessionRunBadgeView({
            runningState: RunningState,
            status: status({ phase: "tool", toolName: "Bash" }),
            nowMs: Now,
        });

        expect(view!.label).toBe("Tool: Bash");
        expect(view!.icon).toBe("screwdriver-wrench");
    });

    it("done 态不带跑时（完成态的秒级跳动是纯噪音）", () => {
        const view = buildSessionRunBadgeView({
            runningState: RunningState,
            status: status({ state: "done", phase: "none" }),
            nowMs: Now,
        });

        expect(view!.label).toBe("Done");
        expect(view!.runtime).toBe("");
        expect(view!.className).toContain("is-done");
    });

    it("stale 态带跑时且与 working 视觉分离", () => {
        const view = buildSessionRunBadgeView({
            runningState: RunningState,
            status: status({ state: "stale", phase: "unknown" }),
            nowMs: Now,
        });

        expect(view!.label).toBe("Stale");
        expect(view!.runtime).toBe("2min14s");
        expect(view!.className).toContain("is-stale");
    });

    it("blocked / error 走各自的 tone 类", () => {
        const blocked = buildSessionRunBadgeView({
            runningState: RunningState,
            status: status({ state: "blocked", phase: "approval" }),
            nowMs: Now,
        });
        const error = buildSessionRunBadgeView({
            runningState: RunningState,
            status: status({ state: "error", phase: "none" }),
            nowMs: Now,
        });

        expect(blocked!.className).toContain("is-blocked");
        expect(blocked!.runtime).toBe("2min14s");
        expect(error!.className).toContain("is-error");
        expect(error!.runtime).toBe("");
    });

    it("activeSince 缺失时退回 updatedAt 当起点", () => {
        const view = buildSessionRunBadgeView({
            runningState: RunningState,
            status: status({ activeSince: undefined, updatedAt: Now - 60_000 }),
            nowMs: Now,
        });

        expect(view!.runtime).toBe("1min0s");
    });

    it("起点晚于 now（时钟回退）时不显示负数时长", () => {
        const view = buildSessionRunBadgeView({
            runningState: RunningState,
            status: status({ activeSince: Now + 60_000, updatedAt: Now + 60_000 }),
            nowMs: Now,
        });

        expect(view!.runtime).toBe("");
    });
});

describe("buildSessionRunBadgeView — 分支 2：有活跃块但无 AgentStatus", () => {
    it("只说 Running，不编造 Working（那需要 phase）", () => {
        const view = buildSessionRunBadgeView({ runningState: RunningState, status: null, nowMs: Now });

        expect(view).not.toBeNull();
        expect(view!.tone).toBe("live");
        expect(view!.label).toBe("Running");
        expect(view!.runtime).toBe("");
        expect(view!.clickable).toBe(true);
        expect(view!.className).toContain("is-live");
        expect(view!.icon).toBe("");
    });
});

describe("buildSessionRunBadgeView — 分支 3：只有 GUI 对话", () => {
    it("渲染 Chat 标记且不可点击（没有 block 可跳）", () => {
        const view = buildSessionRunBadgeView({ runningState: null, chatRunning: true, nowMs: Now });

        expect(view).not.toBeNull();
        expect(view!.tone).toBe("chat");
        expect(view!.label).toBe("Chat");
        expect(view!.clickable).toBe(false);
        expect(view!.className).toContain("is-chat");
        expect(view!.className).not.toContain("session-run-badge--button");
    });

    it("有活跃块时以块状态为准，chat 不抢主标记", () => {
        const view = buildSessionRunBadgeView({
            runningState: RunningState,
            status: status(),
            chatRunning: true,
            nowMs: Now,
        });

        expect(view!.tone).toBe("agent");
        expect(view!.label).toBe("Thinking");
    });
});
