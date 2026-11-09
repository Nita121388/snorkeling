// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// App 根节点兜底（RootErrorBoundary）回归。
//
// 背景：根节点没有 boundary 时，任何 render 期异常都会让 React 卸载整棵树 → 整窗白屏
// （2026-11-09 的 React #310 就是这样变成白屏的，N-1109）。本用例锁两件事：
//   1. 子组件 render 抛错时，兜底卡片出现且带 Reload 出口；
//   2. onError 上报通道被调用（主进程 fe-log 靠它）。
// 跑法：npx vitest run frontend/app/element/root-error-boundary.test.tsx

// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";
import { RootErrorBoundary } from "./errorboundary";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Boom(): never {
    throw new Error("boom-in-render");
}

describe("RootErrorBoundary", () => {
    test("render 抛错时显示兜底卡片 + Reload，而不是空树", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        const onError = vi.fn();
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            act(() => {
                root.render(
                    <RootErrorBoundary onError={onError}>
                        <Boom />
                    </RootErrorBoundary>
                );
            });
            const card = container.querySelector("[data-testid='root-error-boundary']");
            expect(card).not.toBeNull();
            expect(container.innerHTML).toContain("boom-in-render");
            const buttons = Array.from(container.querySelectorAll("button")).map((b) => b.textContent);
            expect(buttons).toContain("Reload");
            expect(onError).toHaveBeenCalledTimes(1);
        } finally {
            consoleError.mockRestore();
            act(() => root.unmount());
            container.remove();
        }
    });

    test("正常子树原样透传", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        try {
            act(() => {
                root.render(
                    <RootErrorBoundary>
                        <div data-testid="ok-child">hello</div>
                    </RootErrorBoundary>
                );
            });
            expect(container.querySelector("[data-testid='ok-child']")?.textContent).toBe("hello");
            expect(container.querySelector("[data-testid='root-error-boundary']")).toBeNull();
        } finally {
            act(() => root.unmount());
            container.remove();
        }
    });
});
