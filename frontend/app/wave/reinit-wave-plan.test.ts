// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// reinitWave 减负契约测试 (task 11-19-reinitwave-relief).
//
// 锁定四件事：
// 1. 开关 on：reload 按依赖分 2 批（3 + 2），顺序满足 window→workspace / tab→layout。
// 2. 开关 off：5 次逐项串行，与改造前逐项一致（回归锁）。
// 3. 两条路径的副作用清单同集同序，共 7 项，一项不少。
// 4. workspace tabs reload 只在 tabids 变化时发生；off 路径永远 reload（现状语义）。
//
// Run: npx vitest run frontend/app/wave/reinit-wave-plan.test.ts

import { describe, expect, it, vi } from "vitest";
import {
    forEachTabToReload,
    planReinitWave,
    planWorkspaceTabReload,
    REINITWAVE_RELIEF_ENABLED,
    SIDE_EFFECT_ORDER,
    type Deps,
} from "./reinit-wave-plan";

const DEPS: Deps = { clientId: "client-1", windowId: "window-1", tabId: "tab-1" };

const LEGACY_BATCHES = [["client"], ["window"], ["workspace"], ["tab"], ["layout"]];

describe("planReinitWave", () => {
    it("on：分批为 3 + 2，且同批内无依赖边", () => {
        const plan = planReinitWave(DEPS, true);
        expect(plan.batches).toEqual([
            ["client", "window", "tab"],
            ["workspace", "layout"],
        ]);
    });

    it("off：5 次逐项串行，与现状逐项一致（回归锁）", () => {
        const plan = planReinitWave(DEPS, false);
        expect(plan.batches).toEqual(LEGACY_BATCHES);
    });

    it("依赖边成立：workspace 在 window 之后，layout 在 tab 之后", () => {
        const plan = planReinitWave(DEPS, true);
        const flat = plan.batches.flat();
        expect(flat.indexOf("workspace")).toBeGreaterThan(flat.indexOf("window"));
        expect(flat.indexOf("layout")).toBeGreaterThan(flat.indexOf("tab"));
    });

    it("两条路径副作用同集同序，且 7 项齐全", () => {
        const on = planReinitWave(DEPS, true).sideEffects;
        const off = planReinitWave(DEPS, false).sideEffects;
        expect(on).toEqual(off);
        expect([...on].sort()).toEqual([...SIDE_EFFECT_ORDER].sort());
        expect(on).toHaveLength(7);
        expect(on).toEqual(SIDE_EFFECT_ORDER);
    });

    it("默认参数跟随模块开关（wave.ts 不传 enabled）", () => {
        const defaultPlan = planReinitWave(DEPS);
        expect(defaultPlan).toEqual(planReinitWave(DEPS, REINITWAVE_RELIEF_ENABLED));
        expect(defaultPlan.relief).toBe(REINITWAVE_RELIEF_ENABLED);
    });
});

describe("planWorkspaceTabReload", () => {
    const ids = ["tab-a", "tab-b"];

    it("on：tabids 未变 → null（跳过 N 个 RPC）", () => {
        expect(planWorkspaceTabReload(ids, [...ids], true)).toBeNull();
    });

    it("on：tabids 变化 → 返回新 id 列表（逐个 reload）", () => {
        expect(planWorkspaceTabReload(ids, ["tab-a", "tab-c"], true)).toEqual(["tab-a", "tab-c"]);
    });

    it("on：首帧 prev 为 undefined → 返回当前 id（保持现状语义）", () => {
        expect(planWorkspaceTabReload(undefined, ids, true)).toEqual(ids);
    });

    it("off：即使 tabids 未变也返回当前 id（现状语义）", () => {
        expect(planWorkspaceTabReload(ids, [...ids], false)).toEqual(ids);
    });

    it("on：tabids 未变 → reload 调用次数为 0（A3 字面判据）", () => {
        const reload = vi.fn();
        const decision = planWorkspaceTabReload(ids, [...ids], true);
        forEachTabToReload(decision, reload);
        expect(reload).toHaveBeenCalledTimes(0);
    });

    it("on：tabids 变化 → 逐个 reload", () => {
        const reload = vi.fn();
        const decision = planWorkspaceTabReload(ids, ["tab-a", "tab-c"], true);
        forEachTabToReload(decision, reload);
        expect(reload).toHaveBeenCalledTimes(2);
        expect(reload).toHaveBeenNthCalledWith(1, "tab-a");
        expect(reload).toHaveBeenNthCalledWith(2, "tab-c");
    });

    it("on：空 tabids 与空 prev 相等 → null", () => {
        expect(planWorkspaceTabReload([], [], true)).toBeNull();
    });

    it("默认参数跟随模块开关（wave.ts 不传 enabled）", () => {
        expect(planWorkspaceTabReload(ids, [...ids])).toEqual(
            planWorkspaceTabReload(ids, [...ids], REINITWAVE_RELIEF_ENABLED)
        );
    });
});
