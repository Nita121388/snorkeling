// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview 看板卡跨 Tab 拖拽回归（11-23 拍板：拖到目标 Tab 组松手 = 移动块）。
//
// 两段锁：
//   纯函数层（overview-drag-intent.ts）—— payload 编解码 / 落点判定 / 阈值 / 内部控件排除；
//   DOM 层（OverviewBoard）—— 拖拽态才渲染 data-drop-target（含 0 卡 Tab）、静态 0 个、
//   drop 到别的 Tab 调一次 onMoveCard、drop 回原 Tab 或空白 0 次。
//
// 落点口径（主代理 2026-11-23 拍板，记录在 notes-20261123.md）：
// 看板没有列表视图的 chevron 折叠组头，等价物 = 拖拽态的列/空列占位；空 Tab 必须可落
// （把卡放进新建空 Tab 是本需求的主用例），静态时看板视觉 0 变化。

// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/config";
import {
    DragStartThresholdPx,
    decodeDragPayload,
    encodeDragPayload,
    isDragBlockedOrigin,
    isDragDisplacementBeyondThreshold,
    resolveDropIntent,
} from "./overview-drag-intent";
import { OverviewBoard } from "./overview-board";
import type { OverviewBoardCard } from "./overview-board-model";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(async () => {
    await initI18n("en");
    // jsdom 没有 Web Animations API：拖拽态变化会重渲染，动效层（FLIP）在 layout effect
    // 里读 getAnimations。给个空实现——本测试只锁拖拽契约，不锁动效。
    if (typeof (Element.prototype as { getAnimations?: unknown }).getAnimations !== "function") {
        (Element.prototype as unknown as { getAnimations: () => [] }).getAnimations = () => [];
    }
});

function makeCard(overrides: Partial<OverviewBoardCard> = {}): OverviewBoardCard {
    return {
        blockId: "block-a",
        tabId: "tab-a",
        sessionId: "session-a",
        tabName: "Tab A",
        isAgentLike: true,
        title: "pi agent",
        avatar: { kind: "emoji", emoji: "🤖" },
        providerLabel: "pi",
        provider: "pi",
        projectName: "",
        tags: [],
        propRows: { visible: [], hiddenCount: 0 },
        kindLabel: "",
        preview: "",
        note: "",
        updatedAt: 0,
        ...overrides,
    };
}

type Mounted = { container: HTMLDivElement; root: Root };
const mounted: Mounted[] = [];

afterEach(() => {
    for (const { container, root } of mounted.splice(0)) {
        act(() => root.unmount());
        container.remove();
    }
    vi.restoreAllMocks();
});

type DataTransferStub = {
    data: Record<string, string>;
    effectAllowed: string;
    dropEffect: string;
    setData: (type: string, value: string) => void;
    getData: (type: string) => string;
};

function makeDataTransfer(initial?: { type: string; value: string }): DataTransferStub {
    const data: Record<string, string> = {};
    if (initial) data[initial.type] = initial.value;
    return {
        data,
        effectAllowed: "uninitialized",
        dropEffect: "none",
        setData(type: string, value: string) {
            data[type] = String(value);
        },
        getData(type: string) {
            return data[type] ?? "";
        },
    };
}

/** jsdom 没有真正的 DragEvent 构造参数支持，手动把 dataTransfer 挂到事件上。 */
function dispatchDrag(
    element: Element,
    type: "dragstart" | "dragover" | "dragenter" | "drop" | "dragend",
    dataTransfer: DataTransferStub
): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer, configurable: true });
    act(() => {
        element.dispatchEvent(event);
    });
    return event;
}

type MountOpts = {
    cards?: OverviewBoardCard[];
    tabTargets?: readonly { tabId: string; tabName: string }[];
    onMoveCard?: (blockId: string, toTabId: string) => void;
};

function mountBoard(opts: MountOpts = {}): HTMLDivElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    const cards = opts.cards ?? [makeCard()];
    act(() => {
        root.render(
            <OverviewBoard
                cards={cards}
                presentedStatuses={{}}
                agentStatuses={{}}
                group="tab"
                now={1_700_000_000_000}
                onOpenCard={() => {}}
                tabTargets={opts.tabTargets ?? []}
                onMoveCard={opts.onMoveCard ?? (() => {})}
            />
        );
    });
    return container;
}

function cardElement(container: HTMLDivElement, blockId: string): HTMLElement {
    const element = container.querySelector<HTMLElement>(`[data-board-block-id="${blockId}"]`);
    expect(element).not.toBeNull();
    return element as HTMLElement;
}

// ---------------- 纯函数层 ----------------

describe("overview-drag-intent: payload", () => {
    it("round-trips blockId and fromTabId", () => {
        const payload = { blockId: "block-a", fromTabId: "tab-a" };
        const decoded = decodeDragPayload(encodeDragPayload(payload));
        expect(decoded).toEqual(payload);
    });

    it("rejects empty and malformed payloads instead of half-parsing", () => {
        expect(decodeDragPayload("")).toBeNull();
        expect(decodeDragPayload(null)).toBeNull();
        expect(decodeDragPayload(undefined)).toBeNull();
        expect(decodeDragPayload("no-separator")).toBeNull();
        expect(decodeDragPayload("\u0000tab-a")).toBeNull();
        expect(decodeDragPayload("block-a\u0000")).toBeNull();
    });
});

describe("overview-drag-intent: drop resolution", () => {
    const payload = { blockId: "block-a", fromTabId: "tab-a" };

    it("moves when the target tab differs from the source tab", () => {
        const intent = resolveDropIntent(payload, "tab-b");
        expect(intent).toEqual({ kind: "move", blockId: "block-a", fromTabId: "tab-a", toTabId: "tab-b" });
    });

    it("does nothing when dropped back on the source tab (same-tab)", () => {
        expect(resolveDropIntent(payload, "tab-a")).toEqual({ kind: "none", reason: "same-tab" });
    });

    it("does nothing without a target tab or without a payload", () => {
        expect(resolveDropIntent(payload, null)).toEqual({ kind: "none", reason: "no-target" });
        expect(resolveDropIntent(payload, "  ")).toEqual({ kind: "none", reason: "no-target" });
        expect(resolveDropIntent(null, "tab-b")).toEqual({ kind: "none", reason: "no-payload" });
    });
});

describe("overview-drag-intent: threshold and blocked origins", () => {
    it("treats sub-threshold movement as a click and past-threshold as a drag", () => {
        expect(isDragDisplacementBeyondThreshold(0, 0)).toBe(false);
        expect(isDragDisplacementBeyondThreshold(DragStartThresholdPx - 1, 0)).toBe(false);
        expect(isDragDisplacementBeyondThreshold(DragStartThresholdPx, 0)).toBe(true);
        expect(isDragDisplacementBeyondThreshold(3, 4)).toBe(false); // hypot 5
        expect(isDragDisplacementBeyondThreshold(5, 5)).toBe(true); // hypot ~7.07
        expect(isDragDisplacementBeyondThreshold(Number.NaN, 1)).toBe(false);
    });

    it("blocks drag from interactive controls and card hotzones", () => {
        for (const tagName of ["BUTTON", "A", "INPUT", "TEXTAREA", "SELECT", "button"]) {
            expect(isDragBlockedOrigin({ tagName })).toBe(true);
        }
        expect(isDragBlockedOrigin({ tagName: "SPAN", isContentEditable: true })).toBe(true);
        expect(isDragBlockedOrigin({ tagName: "SPAN", dataCardInteractive: true })).toBe(true);
        expect(isDragBlockedOrigin({ tagName: "DIV" })).toBe(false);
        expect(isDragBlockedOrigin(null)).toBe(false);
    });
});

// ---------------- DOM 层（OverviewBoard） ----------------

describe("OverviewBoard cross-tab drag (DOM)", () => {
    it("renders no drop targets while idle", () => {
        const container = mountBoard({ tabTargets: [{ tabId: "tab-a", tabName: "Tab A" }] });
        expect(container.querySelectorAll("[data-drop-target]")).toHaveLength(0);
    });

    it("renders a drop target for every tab (including empty ones) while dragging", () => {
        const tabTargets = [
            { tabId: "tab-a", tabName: "Tab A" },
            { tabId: "tab-b", tabName: "Tab B" },
        ];
        const container = mountBoard({ tabTargets });
        dispatchDrag(cardElement(container, "block-a"), "dragstart", makeDataTransfer());
        const targets = container.querySelectorAll("[data-drop-target]");
        expect(targets).toHaveLength(tabTargets.length);
        // 0 卡 Tab 也必须有落点（拖进新建空 Tab 是本需求主用例）。
        expect(container.querySelector('[data-drop-target="tab-b"]')).not.toBeNull();
    });

    it("calls onMoveCard once with the target tab when dropped on another tab", () => {
        const onMoveCard = vi.fn();
        const container = mountBoard({
            tabTargets: [
                { tabId: "tab-a", tabName: "Tab A" },
                { tabId: "tab-b", tabName: "Tab B" },
            ],
            onMoveCard,
        });
        const transfer = makeDataTransfer();
        dispatchDrag(cardElement(container, "block-a"), "dragstart", transfer);
        const target = container.querySelector('[data-drop-target="tab-b"]') as HTMLElement;
        expect(target).not.toBeNull();
        dispatchDrag(target, "drop", transfer);
        expect(onMoveCard).toHaveBeenCalledTimes(1);
        expect(onMoveCard).toHaveBeenCalledWith("block-a", "tab-b");
    });

    it("never calls onMoveCard for same-tab drops, blank space, or a stale payload", () => {
        const onMoveCard = vi.fn();
        const container = mountBoard({
            tabTargets: [
                { tabId: "tab-a", tabName: "Tab A" },
                { tabId: "tab-b", tabName: "Tab B" },
            ],
            onMoveCard,
        });
        // 1) drop back on the source column
        const transfer = makeDataTransfer();
        dispatchDrag(cardElement(container, "block-a"), "dragstart", transfer);
        const ownTarget = container.querySelector('[data-drop-target="tab-a"]') as HTMLElement;
        dispatchDrag(ownTarget, "drop", transfer);
        // 2) blank space (board root)
        const board = container.querySelector(".session-overview-board") as HTMLElement;
        dispatchDrag(board, "drop", transfer);
        // 3) stale/empty payload
        dispatchDrag(board, "drop", makeDataTransfer());
        expect(onMoveCard).not.toHaveBeenCalled();
    });
});
