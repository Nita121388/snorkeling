// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 草稿输入风暴治理（Wave 2-2 / N-1126-perf-w2-2-overview-poll-storm）。
//
// 实测根因：`useCardSendState` 把 `draftByBlock` 放在 React state 里，随
// `CardSendContext.Provider` 的 value 换引用 —— 而每张卡的常驻 `SendStatusChip`
// 都消费这个 context（BoardCard 的 memo 被 context 击穿）。在任一张卡的 composer
// 里每敲一个字 = 全板所有卡的 chip 整体重渲。
//
// 目标结构：草稿态搬进 per-instance jotai atom（provider value 不随草稿变化），
// composer 通过订阅 atom 拿响应式草稿；`stateRef.draftByBlock` 继续可同步读。
//
// 本文件锁定：**在 card A 输入草稿时，card A / card B 的 chip 都不重渲；
// 行程态更新（markDispatching）仍然让 chip 重渲（功能不回退）**。

// @vitest-environment jsdom

import { Profiler, act, memo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/config";
import { CardSendContext, useCardSendState, type CardSendState } from "./overview-card-send-panel";
import { SendStatusChip } from "./send-status-chip";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let stateRef: CardSendState;
const reload = vi.fn();

const chipCommits: Record<string, number> = { "block-a": 0, "block-b": 0 };

/**
 * 与生产同构：chip 挂在 `BoardCard`（memo）里，父级重渲不会带着卡片重跑。
 * 因此这里也用 memo 包一层 —— 这样「输入草稿」时 chip 是否 commit 就只剩
 * context 传播这一条路径可走（正是本包要收口的路径）。
 */
const ChipProbe = memo(function ChipProbe({ blockId }: { blockId: string }) {
    return (
        <Profiler id={blockId} onRender={() => (chipCommits[blockId] += 1)}>
            <SendStatusChip blockId={blockId} surface="board" />
        </Profiler>
    );
});

function Harness() {
    const state = useCardSendState(reload);
    stateRef = state;
    return (
        <CardSendContext.Provider value={state}>
            <ChipProbe blockId="block-a" />
            <ChipProbe blockId="block-b" />
        </CardSendContext.Provider>
    );
}

type Mounted = { container: HTMLDivElement; root: Root };
const mounted: Mounted[] = [];

afterEach(() => {
    for (const { container, root } of mounted.splice(0)) {
        act(() => root.unmount());
        container.remove();
    }
    window.localStorage.clear();
    chipCommits["block-a"] = 0;
    chipCommits["block-b"] = 0;
});

beforeAll(async () => {
    await initI18n("en");
});

describe("草稿输入不重渲其他卡片的 SendStatusChip（Wave 2-2）", () => {
    it("在 block-a 输入草稿：block-a / block-b 的 chip commit 数都不增加", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        mounted.push({ container, root });
        act(() => {
            root.render(<Harness />);
        });

        const commitsBeforeA = chipCommits["block-a"];
        const commitsBeforeB = chipCommits["block-b"];
        expect(commitsBeforeA).toBeGreaterThan(0);

        act(() => {
            stateRef.setDraft("block-a", "typing in card a");
        });
        expect(stateRef.draftByBlock["block-a"]).toBe("typing in card a");

        // 草稿只属于 composer：两张卡的 chip 都不该因这次输入而 commit。
        expect(chipCommits["block-a"]).toBe(commitsBeforeA);
        expect(chipCommits["block-b"]).toBe(commitsBeforeB);

        // 行程态更新仍然必须让 chip 重渲（功能不回退）。
        act(() => {
            stateRef.markDispatching("block-a");
        });
        expect(chipCommits["block-a"]).toBeGreaterThan(commitsBeforeA);
    });
});
