// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AgentStatusChip 的 hook 顺序稳定性回归。
//
// 背景（2026-11-09 真机现场）：`0.0.124` 上整个窗口突然白屏、切 tab 无效、只能重启。CDP 抓到
//   Uncaught Error: Minified React error #310
//     at updateWorkInProgressHook
//     at Object.updateReducer [as useReducer]        ← jotai useAtomValue 内部
// 原因是 chip 把 `useAtomValueSafe(agentStatusSecondTickAtom)` 写成了
// `tickEnabled ? useAtomValueSafe(...) : 0`。chip 挂载期间 status 从 idle 翻到 working 时
// hook 数 +1 → React 命中 `updateWorkInProgressHook` 的 "more hooks than previous render" 分支
// → App 根没有 ErrorBoundary → 整棵树卸载 → 整窗白屏（light 主题下就是一片米白）。
//
// 判据注意：React 19 的 dev 构建在这条路径上不向外抛异常，而是通过 console.error 打印
//   "Internal React error: Expected static flag was missing."
// （生产构建里同一个分支才是 `Minified React error #310`）。
// 所以本用例断言的是「翻转期间 React 没报 hook 顺序问题 + 翻转后 DOM 仍然正确」。
//
// 跑法：npx vitest run frontend/app/session-overview/agent-status-chip-hooks.test.tsx

// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AgentStatusChipVariant } from "@/app/agent-status/agent-status-chip-view";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { AgentStatusChip } from "./agent-status-chip";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// React 命中 hook 顺序不一致时的三种口吻：dev 警告 / dev 内部错误 / prod #310。
const HOOK_ORDER_SIGNAL = /(change in the order of Hooks|static flag was missing|Rendered more hooks|Minified React error #310)/i;

function makeStatus(state: AgentStatus["state"], phase: AgentStatus["phase"] = "none"): AgentStatus {
    const now = 1_700_000_000_000;
    return {
        blockId: "block-hook-stability",
        provider: "claude",
        sessionId: "session-hook-stability",
        state,
        phase,
        source: "hook",
        confidence: "high",
        updatedAt: now,
        activeSince: state === "working" ? now : undefined,
        phaseSince: state === "working" ? now : undefined,
    };
}

type Variant = AgentStatusChipVariant;

function mountChip(initial: AgentStatus, variant: Variant = "list") {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const render = (status: AgentStatus) =>
        act(() => {
            root.render(<AgentStatusChip variant={variant} status={status} now={Date.now()} unread={false} />);
        });
    render(initial);
    return {
        container,
        render,
        unmount: () => {
            act(() => root.unmount());
            container.remove();
        },
    };
}

/** 收集一次操作期间 React 报出的 hook 顺序问题。 */
function hookOrderSignals(action: () => void): string[] {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const signals: string[] = [];
    try {
        action();
        for (const call of spy.mock.calls) {
            const text = call.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
            if (HOOK_ORDER_SIGNAL.test(text)) signals.push(text);
        }
    } finally {
        spy.mockRestore();
    }
    return signals;
}

describe("AgentStatusChip hook 顺序稳定性", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    test("idle → working：不改变 hook 数量（白屏根因）", () => {
        const h = mountChip(makeStatus("idle"));
        try {
            const signals = hookOrderSignals(() => h.render(makeStatus("working", "tool")));
            expect(signals).toEqual([]);
            expect(h.container.innerHTML).toContain("is-working");
        } finally {
            h.unmount();
        }
    });

    test("working → done → idle：来回翻转都不改变 hook 数量", () => {
        const h = mountChip(makeStatus("working", "tool"));
        try {
            const signals = hookOrderSignals(() => {
                h.render(makeStatus("done"));
                h.render(makeStatus("idle"));
                h.render(makeStatus("working", "thinking"));
            });
            expect(signals).toEqual([]);
            expect(h.container.innerHTML).toContain("is-working");
        } finally {
            h.unmount();
        }
    });

    test("card / aggregate 变体同样不受 status 翻转影响", () => {
        const card = mountChip(makeStatus("idle"), "card");
        try {
            expect(hookOrderSignals(() => card.render(makeStatus("working", "shell-command")))).toEqual([]);
        } finally {
            card.unmount();
        }
        // aggregate 变体的 tick 恒为关，翻转不涉及 hook 变化，但要保证不回归
        const agg = mountChip(makeStatus("idle"), "aggregate");
        try {
            expect(hookOrderSignals(() => agg.render(makeStatus("blocked")))).toEqual([]);
        } finally {
            agg.unmount();
        }
    });
});
