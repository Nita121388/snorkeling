// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 一个 Tab 的 block id 全集：顶层 `tab.blockids` + 各 block 的 `subblockids`。
//
// 三处消费面的统一口径（否则会漂移，见 design/plans/tab-info-card-stale-20261120.md）：
//  - 顶部 Tab 状态点 `agent-status-tab-aggregate.ts`
//  - 「更多」菜单 `tab-more-menu.tsx#collectTabBlockIds`
//  - Tab 悬浮卡 `tab-info-card.tsx`
//
// 纯函数：`getBlock` 由调用方注入（jotai Getter 包装 / env.wos / 直接 WOS 均可）。
// inline-tab 子 block 列在父 Block.subblockids（用户从未切到的 tab 里这些子块
// 不会被 InlineTabBlock 渲染），必须一并展开，否则非激活 Tab 的 agent 信息会缺块。

/**
 * 展开 block id 全集（保序、去重；顶层在前，各块的子块紧随其后）。
 *
 * `getBlock` 返回 null（块未加载/已删除）不炸：id 仍纳入全集，子块展开跳过。
 */
export function expandBlockIdsWithSubblocks(
    blockIds: readonly string[],
    getBlock: (blockId: string) => Block | null
): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (blockId: string) => {
        if (blockId === "" || seen.has(blockId)) {
            return;
        }
        seen.add(blockId);
        out.push(blockId);
    };
    for (const topId of blockIds) {
        push(topId);
        const block = getBlock(topId);
        for (const subId of block?.subblockids ?? []) {
            push(subId);
        }
    }
    return out;
}
