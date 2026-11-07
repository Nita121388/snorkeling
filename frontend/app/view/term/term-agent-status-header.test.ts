// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// term-model 头部 agent 状态徽章的行为测试。
//
// 锁定本任务的核心不变量：**头部徽章不再自己拼文案/类名/跑时**，
// 而是消费与 React chip 同一个纯函数 `buildAgentStatusChipView()`。
// 所以这里断言的是"头部的 text/className 等于纯函数产出"，不是"文案长什么样"。
//
// 另外锁一件事：活跃态才把运行时长拼进 text（idle / Done 不拼）。

import { describe, expect, it, vi } from "vitest";
import * as jotai from "jotai";
import { buildAgentStatusChipView } from "@/app/agent-status/agent-status-chip-view";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";

const Now = Date.now();

// 头部实现是 viewText atom 的 getter，不是 React 组件；用同一个构造方式
// （Object.create + 极简字段）避免跑 TermViewModel 的完整构造函数。
vi.mock("@/app/store/wshrpcutil", () => ({
    TabRpcClient: {},
    DefaultRouter: { registerRoute: vi.fn() },
}));
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        ControllerRedrawCommand: vi.fn(),
        ControllerDestroyCommand: vi.fn(),
        ControllerResyncCommand: vi.fn(),
    },
}));

import { TermViewModel } from "./term-model";

type FakeVm = {
    blockId: string;
    agentStatusAtom: unknown;
    getAgentStatusHeaderElem: TermViewModel["getAgentStatusHeaderElem"];
};

function makeViewModel(status: AgentStatus | null): FakeVm {
    const vm = Object.create(TermViewModel.prototype) as FakeVm;
    vm.blockId = "block:test-header";
    // 头部只读这个 atom。用真 jotai atom 当身份键，getter 按 atom 返回对应值。
    (vm as unknown as { agentStatusAtom: unknown }).agentStatusAtom = jotai.atom(status);
    return vm;
}

function status(overrides: Partial<AgentStatus> = {}): AgentStatus {
    return {
        blockId: "block:test-header",
        provider: "claude",
        state: "working",
        phase: "tool",
        toolName: "Bash",
        source: "hook",
        confidence: "high",
        updatedAt: Now - 3_000,
        activeSince: Now - 65_000,
        ...overrides,
    };
}

/**
 * 只认识 agentStatusAtom 的 getter：
 *   - agentStatusAtom → 闭包里的 status（真值）
 *   - 其余一切 atom（ackedFp map / doneAckedAt map / tick atoms）→ undefined
 * `seen` 收集所有被读过的 atom，用来断言 tick 订阅行为。
 */
function makeGetter(vm: FakeVm, value: AgentStatus | null, seen: unknown[] = []) {
    return ((atom: unknown) => {
        seen.push(atom);
        if (atom === vm.agentStatusAtom) {
            return value;
        }
        return undefined;
    }) as never;
}

/**
 * 头部返回的是 HeaderElem 联合类型；本文件只断言 text 变体（agent 徽章就是它），
 * 所以在这里一次性收窄，避免每个断言都写非空判断。
 */
function renderHeader(s: AgentStatus | null, seen: unknown[] = []): HeaderText | null {
    const vm = makeViewModel(s);
    const elem = vm.getAgentStatusHeaderElem(makeGetter(vm, s, seen), null);
    if (elem == null || elem.elemtype !== "text") {
        return null;
    }
    return elem;
}

describe("TermViewModel.getAgentStatusHeaderElem", () => {
    it("无状态时不渲染徽章", () => {
        expect(renderHeader(null)).toBeNull();
    });

    it("文案包含共享纯函数的 label", () => {
        const elem = renderHeader(status());
        expect(elem).not.toBeNull();
        expect(elem.text).toContain("Tool: Bash");
    });

    it("className 直接来自共享纯函数", () => {
        const elem = renderHeader(status());
        const view = buildAgentStatusChipView({
            variant: "header",
            status: status(),
            read: "unread",
            nowMs: Date.now(),
        });
        expect(elem.className).toBe(view.className);
    });

    it("class 里保留 agent-status-header 兼容类（verify 探针依赖）", () => {
        expect(renderHeader(status()).className).toContain("agent-status-header");
    });

    it("class 里保留 phase-<phase>", () => {
        expect(renderHeader(status()).className).toContain("phase-tool");
    });

    it("活跃态把运行时长拼进 text（mm:ss）", () => {
        // 头部内部用 Date.now() 取当前时刻，所以这里必须用"距现在 65 秒"的起点，
        // 不能用固定常量时间戳（那会算出 1000+ 天，格式变成 Dd Hh）。
        const fresh = status({ updatedAt: Date.now() - 3_000, activeSince: Date.now() - 65_000 });
        const elem = renderHeader(fresh);
        expect(elem.text).toMatch(/^Tool: Bash (?:\d+s|\d+min\d+s|\d+h\d+min|\d+d\d+h)$/);
    });

    it("idle 态不显示运行时长", () => {
        const elem = renderHeader(status({ state: "idle", phase: "none" }));
        expect(elem.text).not.toMatch(/\d+(?:s|min|h|d)/);
    });

    it("未读 Done 带 is-done-unread 且不拼跑时", () => {
        // 未 ack（doneAckedAt=0）+ 刚完成 → 呈现层 read 仍是 unread，
        // 这正是头部该亮起的场景；elapsed 属分钟级（label 后缀），不进 runtime。
        const elem = renderHeader(
            status({
                state: "done",
                phase: "none",
                prevState: "working",
                completedAt: Date.now() - 10_000,
                updatedAt: Date.now() - 10_000,
            })
        );
        expect(elem.className).toContain("is-done-unread");
        expect(elem.text).not.toMatch(/\d+(?:s|min|h|d)/);
    });

    it("inferred 状态带 is-inferred", () => {
        expect(renderHeader(status({ source: "session" })).className).toContain("is-inferred");
    });

    it("点徽章 stopPropagation 且不抛错（走统一 ack 收口）", () => {
        const elem = renderHeader(status());
        const stopPropagation = vi.fn();
        expect(() => elem.onClick({ stopPropagation } as unknown as React.MouseEvent)).not.toThrow();
        expect(stopPropagation).toHaveBeenCalled();
    });
});
