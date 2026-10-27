// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AI Audit 列表：布局铺满、失败/停滞行可辨、键盘可开详情、分页按钮按 total 出现。

// @vitest-environment jsdom

import * as jotai from "jotai";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wps", () => ({
    waveEventSubscribeSingle: () => () => {},
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { AiAuditViewModel } from "./aiaudit-model";
import { AiAuditView } from "./aiaudit-view";

function makeEntry(overrides: Partial<AuditView> = {}): AuditView {
    return {
        id: 1,
        feature: "title",
        scope: "agent-card",
        sessionKey: "pi:db0b044e-0642-41d4-8f43-c012a8861234",
        sessionTitle: "",
        connection: "",
        trigger: "manual",
        state: "done",
        aiModel: "gpt-5",
        jobId: "j1",
        anchorTotal: 0,
        anchorKept: 0,
        resultCount: 1,
        durationMs: 1200,
        error: "",
        rawTruncated: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...overrides,
    };
}

function makeModel(entries: AuditView[], total: number): AiAuditViewModel {
    const stats: AuditStatsResult = {
        total24h: 20,
        failed24h: 2,
        done24h: 18,
        avgDurationMs: 7200,
        byFeature: [{ feature: "title", count: 12 }],
        hourly: Array.from({ length: 24 }, (_, index) => ({ hour: index, count: index % 3, failed: 0 })),
        sweptStale: 0,
    };
    return {
        entriesAtom: jotai.atom(entries),
        totalAtom: jotai.atom(total),
        loadingAtom: jotai.atom(false),
        loadingMoreAtom: jotai.atom(false),
        errorAtom: jotai.atom(""),
        statsAtom: jotai.atom<AuditStatsResult | null>(stats),
        featureFilterAtom: jotai.atom(""),
        stateFilterAtom: jotai.atom(""),
        queryAtom: jotai.atom(""),
        detailAtom: jotai.atom<AuditView | null>(null),
        detailLoadingAtom: jotai.atom(false),
        commentAtom: jotai.atom(""),
        clearArmedAtom: jotai.atom(false),
        pendingRefreshAtom: jotai.atom(false),
        load: vi.fn(async () => {}),
        loadStats: vi.fn(async () => {}),
        loadMore: vi.fn(async () => {}),
        setFilter: vi.fn(),
        openDetail: vi.fn(async () => {}),
        closeDetail: vi.fn(),
        clear: vi.fn(async () => {}),
        retry: vi.fn(async () => {}),
    } as unknown as AiAuditViewModel;
}

describe("AiAuditView", () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        const main = document.createElement("div");
        main.id = "main";
        document.body.appendChild(main);
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        document.body.innerHTML = "";
    });

    it("renders the root as a full-width flex column", () => {
        act(() => {
            root.render(<AiAuditView model={makeModel([makeEntry()], 1)} />);
        });
        const rootEl = container.querySelector(".aiaudit-root");
        expect(rootEl).not.toBeNull();
        expect(rootEl.className).toContain("w-full");
    });

    it("marks failed and stalled rows and falls back to a readable session title", () => {
        const now = Date.now();
        act(() => {
            root.render(
                <AiAuditView
                    model={makeModel(
                        [
                            makeEntry({ id: 1, state: "failed", error: "boom" }),
                            makeEntry({ id: 2, state: "queued", createdAt: now - 30 * 60 * 1000 }),
                        ],
                        2
                    )}
                />
            );
        });
        expect(container.querySelector("tr.is-failed")).not.toBeNull();
        expect(container.querySelector("tr.is-stalled")).not.toBeNull();
        expect(container.textContent).toContain("stalled");
        expect(container.textContent).toContain("Untitled session");
    });

    it("opens the detail drawer with Enter", async () => {
        const model = makeModel([makeEntry()], 1);
        act(() => {
            root.render(<AiAuditView model={model} />);
        });
        const row = container.querySelector("tr.aiaudit-row") as HTMLTableRowElement;
        await act(async () => {
            row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        });
        expect(model.openDetail).toHaveBeenCalledWith(1);
    });

    it("renders the detail drawer and closes it on Escape", async () => {
        const model = makeModel([makeEntry()], 1);
        (model as unknown as { detailAtom: unknown }).detailAtom = jotai.atom<AuditView | null>(makeEntry());
        act(() => {
            root.render(<AiAuditView model={model} />);
        });
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
        expect(document.body.textContent).toContain("Copy summary");
        await act(async () => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        });
        expect(model.closeDetail).toHaveBeenCalled();
    });

    it("hides Load more when everything is loaded and shows it otherwise", () => {
        act(() => {
            root.render(<AiAuditView model={makeModel([makeEntry()], 1)} />);
        });
        expect(container.textContent).not.toContain("Load 100 more");

        act(() => {
            root.render(<AiAuditView model={makeModel([makeEntry()], 250)} />);
        });
        expect(container.textContent).toContain("Load 100 more");
    });
});
