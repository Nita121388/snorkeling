// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// MessageCard 在虚拟化时间线里被复用：父级（SessionDetail）会因滚动事件、流式 delta、
// 大纲 active 变化而高频重渲染。它的自定义 memo 比较器会把 onOpenAnnotations 按**引用**
// 比较，因此父级必须传稳定函数，否则每行都会重跑 WaveStreamdown 解析 markdown。
// 这两个用例锁住契约：① 父级重渲染不引起 MessageCard 重渲染；② 批注入口回调带 seq/anchorKey。

// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageCard } from "./session-message";

// WaveStreamdown 依赖 app theme store，无法在 jsdom 里裸渲染；这里用纯文本替身。
vi.mock("@/app/element/streamdown", () => ({
    WaveStreamdown: ({ text }: { text: string }) => <span data-testid="md">{text}</span>,
}));

const Probe = ({ onRender }: { onRender: () => void }) => {
    onRender();
    return <span data-testid="probe" />;
};

function makeMessage(overrides: Partial<Message> = {}): Message {
    return {
        seq: 7,
        itemKey: "e7:t0",
        role: "assistant",
        text: "hello world",
        charCount: 11,
        ...overrides,
    };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    // React 19 需要显式声明 act 环境，否则每次 act 都会打一条 stderr 告警。
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe("MessageCard memo contract", () => {
    it("does not re-render when the parent re-renders with stable props", () => {
        const message = makeMessage();
        const stableOpen = vi.fn();
        const stableRegisterRef = vi.fn();
        const probeRenders = vi.fn();
        const children = <Probe onRender={probeRenders} />;

        act(() => {
            root.render(
                <MessageCard
                    message={message}
                    registerRef={stableRegisterRef}
                    onOpenAnnotations={stableOpen}
                    contextText="ctx"
                    annotationCount={1}
                >
                    {children}
                </MessageCard>
            );
        });
        expect(probeRenders).toHaveBeenCalledTimes(1);

        // 父级重渲染：props 引用不变（模拟滚动事件里的重渲染）。
        act(() => {
            root.render(
                <MessageCard
                    message={message}
                    registerRef={stableRegisterRef}
                    onOpenAnnotations={stableOpen}
                    contextText="ctx"
                    annotationCount={1}
                >
                    {children}
                </MessageCard>
            );
        });
        expect(probeRenders).toHaveBeenCalledTimes(1);
    });
});

describe("MessageCard annotation entry", () => {
    it("passes its own seq and anchor key to the stable callback", () => {
        const onOpenAnnotations = vi.fn();
        act(() => {
            root.render(
                <MessageCard
                    message={makeMessage({ seq: 42, itemKey: "entry:42" })}
                    registerRef={() => {}}
                    onOpenAnnotations={onOpenAnnotations}
                />
            );
        });
        const button = container.querySelector<HTMLButtonElement>('button[aria-label="Annotations"]');
        expect(button).not.toBeNull();
        act(() => button!.click());
        expect(onOpenAnnotations).toHaveBeenCalledWith(42, "entry:42");
    });

    it("still offers the entry when the cache lost the ItemKey (synthetic anchor)", () => {
        // 回归：会话消息从 SQLite 缓存读出时 ItemKey 为空，之前这里把入口整块隐藏，
        // 用户根本无法手动添加批注。
        const onOpenAnnotations = vi.fn();
        act(() => {
            root.render(
                <MessageCard
                    message={makeMessage({ itemKey: undefined })}
                    registerRef={() => {}}
                    onOpenAnnotations={onOpenAnnotations}
                />
            );
        });
        const button = container.querySelector('button[aria-label="Annotations"]') as HTMLButtonElement;
        expect(button).toBeTruthy();
        act(() => {
            button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(onOpenAnnotations).toHaveBeenCalledTimes(1);
        expect(onOpenAnnotations.mock.calls[0][1]).toBe("seq:7");
    });
});
