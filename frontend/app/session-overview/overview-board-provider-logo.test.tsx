// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 看板卡片 meta 行 provider 簇：有品牌 logo 时只留 logo，不再重复写名称文字。
//
// 背景（2026-11-24 nita 报）：Overview 看板上 agent 卡的 provider 簇是「logo + 名称」
// 两份信息同排；卡片本身已有 avatar + 状态 chip，名称文字纯属复述。要求 logo 足够。
//
// 但 `getAgentLogoByProvider()` 只认 codex/claude/gemini/opencode/pi 五家 —— 其余
// provider（cursor/aider/qwen…）没有品牌图标，直接砍文字会让这些卡丢掉类型信息。
// 所以回退规则必须锁死：无 logo → 保留名称文字。

// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { BoardCard } from "./overview-board";
import type { OverviewBoardCard } from "./overview-board-model";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NowMs = 1_700_000_000_000;

function makeCard(overrides: Partial<OverviewBoardCard> = {}): OverviewBoardCard {
    return {
        blockId: "block-provider-logo",
        tabId: "tab-1",
        sessionId: "session-1",
        tabName: "Tab 1",
        isAgentLike: true,
        title: "agent session",
        avatar: { kind: "emoji", emoji: "🤖" },
        providerLabel: "Claude",
        provider: "claude",
        propRows: { visible: [], hiddenCount: 0 },
        projectName: "",
        tags: [],
        kindLabel: "",
        preview: "",
        note: "",
        updatedAt: 0,
        recentMessages: [],
        messagesOverflow: 0,
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
});

function mountCard(card: OverviewBoardCard): HTMLDivElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    act(() => {
        root.render(
            <BoardCard card={card} status={null} columnKey="status:idle" now={NowMs} onOpenCard={() => {}} />
        );
    });
    return container;
}

function providerGroup(container: HTMLElement): HTMLElement | null {
    return container.querySelector('[data-board-meta="provider"]');
}

describe("BoardCard provider cluster", () => {
    it("shows only the brand logo for a provider that has one", () => {
        const container = mountCard(makeCard());
        const group = providerGroup(container);
        expect(group).not.toBeNull();
        expect(group.querySelector(".session-overview-board-card-meta-logo")).not.toBeNull();
        // 名称文字节点完全消失（不是隐藏，是不渲染）
        expect(group.querySelector(".session-overview-board-card-meta-agent")).toBeNull();
        // 信息不丢：名称转到 tooltip / 无障碍名
        expect((group.getAttribute("title") ?? "").trim()).toBe("Claude");
        expect((group.getAttribute("aria-label") ?? "").trim()).toBe("Claude");
    });

    it("falls back to the provider name for a provider without a brand logo", () => {
        const container = mountCard(makeCard({ provider: "cursor", providerLabel: "Cursor" }));
        const group = providerGroup(container);
        expect(group).not.toBeNull();
        expect(group.querySelector(".session-overview-board-card-meta-logo")).toBeNull();
        const label = group.querySelector(".session-overview-board-card-meta-agent");
        expect(label).not.toBeNull();
        expect((label.textContent ?? "").trim()).toBe("Cursor");
    });

    it("renders no provider cluster when the card has no provider", () => {
        const container = mountCard(
            makeCard({ provider: "", providerLabel: "", isAgentLike: false, kindLabel: "Terminal" })
        );
        expect(providerGroup(container)).toBeNull();
    });
});
