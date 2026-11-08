// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// icon 宽度预算求解器的单测。
//
// 守住的核心不变量（PRD A1）：
//   for w in [40..900] step 2, for zone in [left, right]:
//       shown.length + hidden.length === total
//       shown ∩ hidden === ∅
//       mode === "flyout" ⟹ shown.length === 0
//   neverOverflow 的 icon（… / vcs / close）不得「既不在 shown 也不在 hidden」。
//
// Run: npx vitest run frontend/app/block/header-icon-plan.test.ts

import { describe, expect, it } from "vitest";
import {
    HeaderIconSlotPx,
    HeaderPaddingPx,
    HeaderTypeIconPx,
    planHeaderIcons,
    sceneTotal,
    slotBudget,
    tierFor,
    type HeaderIconScene,
} from "./header-icon-plan";
import type { HoverZone } from "./header-hover-latch";

/** 对齐真实 Markdown 视图：左 3 + 右 6 + pinned 3 = 12。 */
const MarkdownScene: HeaderIconScene = {
    entries: [
        { key: "goto", group: "left", priority: 2 },
        { key: "html", group: "left", priority: 3 },
        { key: "target", group: "left", priority: 2 },
        { key: "vcs", group: "right", neverOverflow: true },
        { key: "book", group: "right", priority: 4 },
        { key: "booko", group: "right", priority: 4 },
        { key: "eye", group: "right", priority: 3 },
        { key: "dots", group: "right", neverOverflow: true },
        { key: "box", group: "right", priority: 6 },
        { key: "refresh", group: "pinned", priority: 1 },
        { key: "pen", group: "pinned", priority: 1 },
        { key: "close", group: "pinned", neverOverflow: true },
    ],
};

/** 目录视图：左 3 + 右 5 + pinned 3 = 11。 */
const DirScene: HeaderIconScene = {
    entries: [
        { key: "goto", group: "left", priority: 2 },
        { key: "tree", group: "left", priority: 2 },
        { key: "target", group: "left", priority: 2 },
        { key: "vcs", group: "right", neverOverflow: true },
        { key: "eye", group: "right", priority: 3 },
        { key: "dots", group: "right", neverOverflow: true },
        { key: "box", group: "right", priority: 6 },
        { key: "refresh", group: "pinned", priority: 1 },
        { key: "pen", group: "pinned", priority: 1 },
        { key: "close", group: "pinned", neverOverflow: true },
    ],
};

const Scenes = { markdown: MarkdownScene, dir: DirScene };
const Zones: HoverZone[] = ["left", "right"];

describe("tierFor — 边界", () => {
    it("Markdown 12 个 icon 的档位边界", () => {
        // 12*26 + 12 + 16 = 340 → tier 0 起点
        expect(tierFor(340, 12)).toBe(0);
        expect(tierFor(339, 12)).toBe(1);
        expect(tierFor(240, 12)).toBe(1);
        expect(tierFor(239, 12)).toBe(2);
        expect(tierFor(192, 12)).toBe(2);
        expect(tierFor(191, 12)).toBe(3);
        expect(tierFor(88, 12)).toBe(3);
        expect(tierFor(87, 12)).toBe(4);
        expect(tierFor(40, 12)).toBe(4);
    });

    it("tier 单调：宽度越大档位不升", () => {
        let prev = 5;
        for (let w = 40; w <= 900; w += 2) {
            const t = tierFor(w, 12);
            expect(t).toBeLessThanOrEqual(prev);
            prev = t;
        }
    });

    it("slotBudget 与常量自洽", () => {
        expect(slotBudget(HeaderPaddingPx + HeaderTypeIconPx + 12 * HeaderIconSlotPx)).toBe(12);
        expect(slotBudget(40)).toBe(0);
        expect(slotBudget(0)).toBe(0);
    });
});

describe("planHeaderIcons — 不变量（A1）", () => {
    for (const [sceneName, scene] of Object.entries(Scenes)) {
        it(`${sceneName}: w∈[40..900] step 2 × zone∈{left,right} 全部满足 shown+hidden===total`, () => {
            const total = sceneTotal(scene);
            const failures: string[] = [];
            for (let w = 40; w <= 900; w += 2) {
                for (const zone of Zones) {
                    const p = planHeaderIcons(w, zone, scene);
                    if (p.shown.length + p.hidden.length !== total) {
                        failures.push(`${w}px/${zone}: ${p.shown.length}+${p.hidden.length}≠${total}`);
                    }
                    const dup = p.shown.filter((k) => p.hidden.includes(k));
                    if (dup.length > 0) {
                        failures.push(`${w}px/${zone}: 同时出现在 shown 与 hidden: ${dup.join(",")}`);
                    }
                    // 窄块必须至少留一个逃生通道（neverOverflow 入口），否则功能就断了。
                    if (p.tier >= 3 && p.shown.length === 0) {
                        failures.push(`${w}px/${zone}: tier ${p.tier} 但 shown 为空（无逃生入口）`);
                    }
                }
            }
            expect(failures).toEqual([]);
        });
    }

    it("neverOverflow 的 key 在任何宽度/方向下都可达（shown 或 hidden 二选一，不漏）", () => {
        const scene = MarkdownScene;
        const neverKeys = scene.entries.filter((e) => e.neverOverflow).map((e) => e.key);
        for (let w = 40; w <= 900; w += 2) {
            for (const zone of Zones) {
                const p = planHeaderIcons(w, zone, scene);
                for (const k of neverKeys) {
                    const inShown = p.shown.includes(k);
                    const inHidden = p.hidden.includes(k);
                    expect(inShown || inHidden).toBe(true);
                }
            }
        }
    });

    it("中性（zone=null）→ 全部 shown、无 hidden", () => {
        for (let w = 40; w <= 900; w += 2) {
            const p = planHeaderIcons(w, null, MarkdownScene);
            expect(p.shown.length).toBe(12);
            expect(p.hidden).toEqual([]);
            expect(p.mode).toBe("idle");
            expect(p.yieldLeft).toBe(false);
        }
    });
});

describe("planHeaderIcons — 削尾优先级", () => {
    it("低优先级（box=6）先于高优先级（book=4）被收进溢出", () => {
        const p = planHeaderIcons(240, "right", MarkdownScene);
        expect(p.mode).toBe("overflow");
        // box 是最先被削的
        expect(p.hidden).toContain("box");
        // neverOverflow（vcs / dots / close）永不进溢出
        expect(p.shown).toContain("vcs");
        expect(p.shown).toContain("dots");
        expect(p.shown).toContain("close");
    });

    it("宽度越大可见越多（右锁，tier 1 区间内）", () => {
        const at240 = planHeaderIcons(240, "right", MarkdownScene).shown.length;
        const at300 = planHeaderIcons(300, "right", MarkdownScene).shown.length;
        const at340 = planHeaderIcons(340, "right", MarkdownScene).shown.length;
        expect(at300).toBeGreaterThanOrEqual(at240);
        expect(at340).toBeGreaterThanOrEqual(at300);
    });

    it("tier 0 且右组放得下 → 不让位", () => {
        const p = planHeaderIcons(900, "right", MarkdownScene);
        expect(p.tier).toBe(0);
        expect(p.yieldLeft).toBe(false);
        expect(p.hidden).toEqual([]);
    });

    it("tier 1 及以下 → 让位", () => {
        for (const w of [40, 88, 120, 192, 240, 300]) {
            const p = planHeaderIcons(w, "right", MarkdownScene);
            expect(p.yieldLeft).toBe(true);
        }
    });

    it("左锁从不让位（右侧本来就没展开）", () => {
        for (let w = 40; w <= 900; w += 2) {
            expect(planHeaderIcons(w, "left", MarkdownScene).yieldLeft).toBe(false);
        }
    });
});

describe("planHeaderIcons — 窄块降级", () => {
    it("tier 3（88~191px）只留 neverOverflow 入口", () => {
        for (const w of [88, 120, 160, 191]) {
            const p = planHeaderIcons(w, "right", MarkdownScene);
            expect(p.tier).toBe(3);
            // MarkdownScene 的 neverOverflow = vcs / dots / close
            expect(p.shown).toEqual(["vcs", "dots", "close"]);
            expect(p.mode).toBe("overflow");
        }
    });

    it("tier 4（<88px）同样只留 neverOverflow 入口，其余进溢出（功能零丢失）", () => {
        for (const w of [40, 62, 87]) {
            const p = planHeaderIcons(w, "right", MarkdownScene);
            expect(p.tier).toBe(4);
            expect(p.shown).toEqual(["vcs", "dots", "close"]);
            expect(p.hidden.length).toBe(9);
            expect(p.mode).toBe("overflow");
        }
    });

    it("左锁在 tier 4 同样只留 neverOverflow 入口（不硬切）", () => {
        const p = planHeaderIcons(40, "left", MarkdownScene);
        expect(p.tier).toBe(4);
        expect(p.shown).toEqual(["vcs", "dots", "close"]);
        expect(p.mode).toBe("overflow");
    });
});

describe("planHeaderIcons — 顺序稳定", () => {
    it("shown 保持 scene 原始顺序（不因优先级排序而乱序渲染）", () => {
        const p = planHeaderIcons(300, "right", MarkdownScene);
        const sceneOrder = MarkdownScene.entries.map((e) => e.key);
        const shownInSceneOrder = sceneOrder.filter((k) => p.shown.includes(k));
        expect(p.shown).toEqual(shownInSceneOrder);
    });
});
