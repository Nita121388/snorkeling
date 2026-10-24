// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// CopyButton 的反馈契约（jsdom）。
//
// 回归背景：旧实现点击瞬间就置 isCopied=true，所以即便复制失败（剪贴板被拒、
// 远端无权限）也会显示一个绿勾——"复制了但没反馈"和"假报成功"是同一个 bug 的
// 两面。现在 onClick 返回 Promise 时，只有 resolve 才给成功反馈，reject 走 onError。
//
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "./copybutton";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function render(node: React.ReactNode): void {
    act(() => {
        root.render(node);
    });
}

function button(): HTMLButtonElement {
    const el = container.querySelector("button");
    if (el == null) {
        throw new Error("copy button not rendered");
    }
    return el as HTMLButtonElement;
}

/** 成功后按钮应带 copied 类（CSS 据此把图标换成绿勾）。 */
function isCopied(): boolean {
    return button().classList.contains("copied");
}

async function click(): Promise<void> {
    await act(async () => {
        button().click();
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    vi.useRealTimers();
});

describe("CopyButton feedback", () => {
    it("shows copied only after the async copy resolves", async () => {
        let resolveCopy: (value: unknown) => void = () => {};
        const copy = vi.fn(
            () =>
                new Promise((resolve) => {
                    resolveCopy = resolve;
                })
        );

        render(<CopyButton title="Copy" onClick={copy} />);
        expect(isCopied()).toBe(false);

        await click();
        // 还在飞：不能提前报成功
        expect(isCopied()).toBe(false);

        await act(async () => {
            resolveCopy(true);
        });
        expect(isCopied()).toBe(true);
    });

    it("reports failure instead of a false success", async () => {
        const onError = vi.fn();
        const copy = vi.fn(() => Promise.reject(new Error("clipboard denied")));

        render(<CopyButton title="Copy" onClick={copy} onError={onError} />);
        await click();

        expect(onError).toHaveBeenCalledTimes(1);
        expect(isCopied()).toBe(false);
    });

    it("reports failure when the handler throws synchronously", async () => {
        const onError = vi.fn();
        const copy = vi.fn(() => {
            throw new Error("no clipboard api");
        });

        render(<CopyButton title="Copy" onClick={copy} onError={onError} />);
        await click();

        expect(onError).toHaveBeenCalledTimes(1);
        expect(isCopied()).toBe(false);
    });

    it("keeps synchronous handlers on the immediate-feedback path", async () => {
        const copy = vi.fn();

        render(<CopyButton title="Copy" onClick={copy} />);
        await click();

        expect(copy).toHaveBeenCalledTimes(1);
        expect(isCopied()).toBe(true);
    });

    it("resets the success state after the 2s window", async () => {
        render(<CopyButton title="Copy" onClick={vi.fn(() => Promise.resolve())} />);
        await click();
        expect(isCopied()).toBe(true);

        await act(async () => {
            vi.advanceTimersByTime(2000);
        });
        expect(isCopied()).toBe(false);
    });

    it("ignores clicks while the success state is showing", async () => {
        const copy = vi.fn(() => Promise.resolve());

        render(<CopyButton title="Copy" onClick={copy} />);
        await click();
        await click();

        expect(copy).toHaveBeenCalledTimes(1);
    });
});
