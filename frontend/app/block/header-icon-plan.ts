// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Files Block header 的 icon 宽度预算求解器。
//
// 现状问题：header 是 display:flex 且没有收缩预算协商，`.block-frame-end-icons`
// 是 flex-shrink:0，悬浮时一次性把全部 reveal icon 变成 display:flex，
// 放不下的部分被 header 的 overflow:hidden **硬切** —— 被切的 icon 既不在
// 溢出菜单也不在浮层，功能真的丢了（实测 240px 下 6 个全被切）。
//
// 这个纯函数把「哪些 icon 留在 header、哪些进溢出菜单、哪些进浮层」算清楚，
// 并保证不变量：
//
//     shown.length + hidden.length === total        （任何宽度、任何方向）
//     mode === "flyout"  ⟹  shown.length === 0
//
// 分区（左组 / 右组 / pinned）由调用方传进来的 scene 描述，本文件不硬编码
// 任何具体视图的 icon 清单。

import type { HoverZone } from "./header-hover-latch";

/** header 里单个 icon 的占位宽度（block.scss 的 `.wave-iconbutton { width:24px }` + 2px gap）。 */
export const HeaderIconSlotPx = 26;
/** header 左右 padding 合计（`padding: 4px 5px 4px 7px` → 7 + 5）。 */
export const HeaderPaddingPx = 12;
/** 类型图标（folder-open / iconForFile）的占位宽度。 */
export const HeaderTypeIconPx = 16;
/** tier 2 及以上判定「不到一半」用的最少 slot 数。 */
const NarrowSlotFloor = 6;
/** tier 1 起点。 */
const Tier1MinPx = 240;
/** tier 2 起点。 */
const Tier2MinPx = 192;
/** tier 3 起点。 */
const Tier3MinPx = 88;

export type HeaderIconPlanMode = "idle" | "left" | "overflow" | "flyout";

export type HeaderIconEntry = {
    /** 稳定标识，用于在真实 IconButtonDecl 上回查。 */
    key: string;
    /** 越大越先被收进溢出。0 = 不参与削尾。 */
    priority?: number;
    /** 永不被削尾（… / vcs / close 这类逃生通道与主入口）。 */
    neverOverflow?: boolean;
    /** 落在哪个组。 */
    group: "left" | "right" | "pinned";
};

export type HeaderIconScene = {
    entries: HeaderIconEntry[];
};

export type HeaderIconPlan = {
    tier: 0 | 1 | 2 | 3 | 4;
    /** 右锁时左侧（chevron + 路径）是否收起让位。 */
    yieldLeft: boolean;
    /** 留在 header 里的 icon key（按 scene 原始顺序）。 */
    shown: string[];
    /** 进溢出菜单 / 浮层的 icon key（按 scene 原始顺序）。 */
    hidden: string[];
    mode: HeaderIconPlanMode;
};

export function sceneTotal(scene: HeaderIconScene): number {
    return scene.entries.length;
}

/**
 * 档位判定。`total` 是该视图的 icon 总数（左组 + 右组 + pinned）。
 *
 *   tier 0: 全部放得下
 *   tier 1: 需要削尾
 *   tier 2: 连一半都放不下 → … 升为主入口
 *   tier 3: 只留类型图标 + …
 *   tier 4: 只留类型图标 → 浮层接管
 */
export function tierFor(width: number, total: number): 0 | 1 | 2 | 3 | 4 {
    const needFull = total * HeaderIconSlotPx + HeaderPaddingPx + HeaderTypeIconPx;
    if (width >= needFull) return 0;
    const halfSlots = Math.max(NarrowSlotFloor, Math.ceil(total / 2));
    const needHalf = halfSlots * HeaderIconSlotPx + HeaderPaddingPx + HeaderTypeIconPx;
    if (width >= Math.max(needHalf, Tier1MinPx)) return 1;
    if (width >= Tier2MinPx) return 2;
    if (width >= Tier3MinPx) return 3;
    return 4;
}

/** header 里除类型图标与 padding 之外，能塞下多少个 26px 槽位。 */
export function slotBudget(width: number): number {
    return Math.max(0, Math.floor((width - HeaderPaddingPx - HeaderTypeIconPx) / HeaderIconSlotPx));
}

function byKeepOrder(scene: HeaderIconScene): HeaderIconEntry[] {
    // priority 语义：数字越大越先被收进溢出。所以「保留顺序」是升序 ——
    // priority 小的先进 keep，priority 大的最后才轮到，宽度不够时它就是被牺牲的那个。
    // 同 priority 保持 scene 顺序（稳定排序，便于快照测试）。
    return scene.entries
        .map((e, idx) => ({ e, idx }))
        .sort((a, b) => {
            const pa = a.e.priority ?? 0;
            const pb = b.e.priority ?? 0;
            if (pa !== pb) return pa - pb;
            return a.idx - b.idx;
        })
        .map((x) => x.e);
}

/**
 * 算出某个宽度 + 某个锁存方向下，header 里留哪些 icon。
 *
 * `zone === null`（中性）→ 两侧都不展开，返回全部（由 CSS 决定显隐）。
 * `zone === "left"`  → 只揭示左组，右组不参与预算。
 * `zone === "right"` → 揭示右组 + pinned；够宽就不让位，否则左侧收起让位。
 */
export function planHeaderIcons(width: number, zone: HoverZone | null, scene: HeaderIconScene): HeaderIconPlan {
    const total = sceneTotal(scene);
    const tier = tierFor(width, total);
    const allKeys = scene.entries.map((e) => e.key);

    if (zone == null) {
        return { tier, yieldLeft: false, shown: allKeys, hidden: [], mode: "idle" };
    }

    const candidates =
        zone === "left"
            ? scene.entries.filter((e) => e.group === "left" || e.group === "right" || e.group === "pinned")
            : scene.entries;

    if (zone === "left") {
        // 左锁：只有左组那一小撮参与揭示；但 tier 阶梯同样生效（窄块下 … 恒在）。
        if (tier === 3 || tier === 4) {
            // 窄块只留标了 neverOverflow 的入口（现实中就是「…」与「Close」）：
            // 其余全部经「…」进溢出菜单 —— 功能零丢失，且不需要额外的浮层组件。
            // 不能硬编码某个 key（各视图的 overflow icon key 不同，Files 是 "more"）。
            const shown = candidates.filter((e) => e.neverOverflow).map((e) => e.key);
            if (shown.length === 0) {
                // 场景里一个 neverOverflow 都没有：必须留一个逃生通道，取第一个候选。
                const fallback = candidates[0]?.key;
                if (fallback != null) shown.push(fallback);
            }
            return { tier, yieldLeft: false, shown, hidden: allKeys.filter((k) => !shown.includes(k)), mode: "overflow" };
        }
        const budget = slotBudget(width);
        const must = candidates.filter((e) => e.neverOverflow).map((e) => e.key);
        const rest = byKeepOrder({ entries: candidates.filter((e) => !e.neverOverflow) });
        const keep = new Set<string>(must);
        for (const e of rest) {
            if (keep.size >= budget) break;
            keep.add(e.key);
        }
        // neverOverflow 的入口（「…」/「vcs」/「Close」）已在 must 里，无需再硬编码某 key。
        const shown = allKeys.filter((k) => keep.has(k));
        const hidden = allKeys.filter((k) => !keep.has(k));
        return { tier, yieldLeft: false, shown, hidden, mode: "overflow" };
    }

    // 右锁
    if (tier === 3 || tier === 4) {
        // 同左锁：只留 neverOverflow 入口（「…」+「Close」），其余全部进溢出菜单。
        const shown = candidates.filter((e) => e.neverOverflow).map((e) => e.key);
        if (shown.length === 0) {
            const fallback = candidates[0]?.key;
            if (fallback != null) shown.push(fallback);
        }
        return { tier, yieldLeft: true, shown, hidden: allKeys.filter((k) => !shown.includes(k)), mode: "overflow" };
    }

    // tier 0 且右组本就放得下 → 不让位（省掉无意义的布局跳变）。
    const budgetNoYield = slotBudget(width);
    const rightSideCount = scene.entries.filter((e) => e.group === "right" || e.group === "pinned").length;
    const yieldLeft = tier > 0 || rightSideCount > budgetNoYield;

    const budget = slotBudget(width);
    const must = candidates.filter((e) => e.neverOverflow).map((e) => e.key);
    const rest = byKeepOrder({ entries: candidates.filter((e) => !e.neverOverflow) });
    const keep = new Set<string>(must);
    for (const e of rest) {
        if (keep.size >= budget) break;
        keep.add(e.key);
    }
    const shown = allKeys.filter((k) => keep.has(k));
    const hidden = allKeys.filter((k) => !keep.has(k));
    return { tier, yieldLeft, shown, hidden, mode: "overflow" };
}
