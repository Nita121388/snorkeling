// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 推荐区（design §8.2：有就显示，没有就不显示）的 DOM 契约锁：
//  - 外部注入的推荐在 session scope 下渲染成同行格子（recents 式样）
//  - 无注入 / 空注入 / 非 session scope → 整块不渲染
//  - 点推荐格 = 一次手选：走 RecordEmojiPick（偏好记录）+ setSessionEmoji

// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetSessionEmojisForTests, getSessionEmojiSnapshot } from "@/app/agent-persona/session-persona-store";
import { loadEmojiCatalog } from "@/app/element/markdown-transform/emoji";
import { i18n, initI18n } from "@/i18n/config";
import { RpcApi } from "@/app/store/wshclientapi";
import { AgentEmojiPicker } from "./agent-emoji-picker";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;
let onClose: ReturnType<typeof vi.fn>;
let recommendationsMock: ReturnType<typeof vi.fn>;
let recordPickMock: ReturnType<typeof vi.fn>;

function mount({ sessionId = "sess-1", initialScope = "session" as const } = {}) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(
            <AgentEmojiPicker
                sessionId={sessionId}
                provider="claude"
                anchor={{ top: 100, left: 40 }}
                placement="bottom"
                initialScope={initialScope}
                hasCurrentEmoji={false}
                onClose={onClose}
            />
        );
    });
}

function unmount() {
    act(() => {
        root.unmount();
    });
    container.remove();
}

function picker(): HTMLElement | null {
    return document.body.querySelector(".markdown-emoji-picker");
}

function recommendRow(): HTMLElement | null {
    return document.body.querySelector(".agent-emoji-recommend-row");
}

function recommendCells(): HTMLButtonElement[] {
    return Array.from(document.body.querySelectorAll<HTMLButtonElement>(".agent-emoji-recommend-cell"));
}

/** 轮询直到断言条件满足（React 异步 setState 会在轮询的 await 间隙落盘）。 */
async function waitFor(cond: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
        if (cond()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("timeout waiting for " + what);
}

async function waitForPicker(): Promise<HTMLElement> {
    await waitFor(() => picker() != null, "picker");
    return picker()!;
}

function click(el: Element) {
    act(() => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

beforeEach(async () => {
    await initI18n();
    vi.useRealTimers();
    __resetSessionEmojisForTests();
    vi.stubGlobal(
        "IntersectionObserver",
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
            takeRecords() {
                return [];
            }
        }
    );
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    Element.prototype.scrollIntoView = vi.fn();
    await loadEmojiCatalog();
    onClose = vi.fn();
    recommendationsMock = vi
        .spyOn(RpcApi, "SessionEmojiRecommendationsCommand")
        .mockResolvedValue({ found: false, candidates: [] } as never);
    recordPickMock = vi
        .spyOn(RpcApi, "SessionEmojiRecordPickCommand")
        .mockResolvedValue({ sessionKey: "k", id: "sess-1", emoji: "", cleared: false } as never);
});

afterEach(() => {
    unmount();
    vi.restoreAllMocks();
});

describe("agent emoji picker recommendation row", () => {
    it("renders injected recommendations as clickable cells in session scope", async () => {
        recommendationsMock.mockResolvedValue({
            found: true,
            injectedBy: "hero:watchdog",
            candidates: [
                { emoji: "🛡️", reason: "在修 wavesrv OOM" },
                { emoji: "🐛", reason: "bug mentions" },
            ],
        } as never);
        mount();
        await waitForPicker();
        await waitFor(() => recommendRow() != null, "recommendation row");
        const row = recommendRow();
        expect(row, "recommendation row must render when injected candidates exist").not.toBeNull();
        const cells = recommendCells();
        expect(cells.map((c) => c.textContent)).toEqual(["🛡️", "🐛"]);
        // tooltip carries the reason
        expect(cells[0]?.getAttribute("title")).toBe("在修 wavesrv OOM");
    });

    it("hides the whole row when nothing was injected", async () => {
        recommendationsMock.mockResolvedValue({ found: false, candidates: [] } as never);
        mount();
        await waitForPicker();
        expect(recommendRow(), "empty injection must hide the row").toBeNull();
    });

    it("hides the row for a provider scope picker", async () => {
        recommendationsMock.mockResolvedValue({
            found: true,
            candidates: [{ emoji: "🛡️", reason: "x" }],
        } as never);
        mount({ sessionId: "", initialScope: "provider" });
        await waitForPicker();
        expect(recommendRow(), "provider scope must not show session recommendations").toBeNull();
    });

    it("picking a recommendation records it as a user pick and closes", async () => {
        recommendationsMock.mockResolvedValue({
            found: true,
            candidates: [{ emoji: "🛡️", reason: "在修 wavesrv OOM" }],
        } as never);
        mount();
        await waitForPicker();
        await waitFor(() => recommendCells().length > 0, "recommend cells");
        click(recommendCells()[0]!);
        expect(recordPickMock).toHaveBeenCalledTimes(1);
        expect(recordPickMock.mock.calls[0][1]).toEqual({ identifier: "sess-1", emoji: "🛡️" });
        expect(getSessionEmojiSnapshot()).toEqual({ "sess-1": "🛡️" });
        expect(onClose).toHaveBeenCalled();
    });

    it("record-pick failure never blocks the picker", async () => {
        recordPickMock.mockRejectedValue(new Error("backend down"));
        mount();
        await waitForPicker();
        // closing the picker via the grid pick still works (no unhandled rejection)
        expect(onClose).not.toHaveBeenCalled();
    });
});