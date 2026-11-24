// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 悬浮卡重对账的判定层（task 11-23-overview-refresh-1123，S3 变体）。
//
// Run: npx vitest run frontend/app/tab/tab-card-reconcile.test.ts
//
// 锁定的行为（都是可字面断言的数字/参数）：
//  1. tab 对象必重拉（blockids 陈旧 = 卡片缺 agent 行），workspace 一并重拉；
//  2. prime 的 oref 集合 = 重拉后的 tab.blockids + subblockids（顶层在前，去重）；
//  3. prime 必须带 `{ force: true }` —— 陈旧但「已解析」的块不会被默认幂等语义跳过；
//  4. 同一 tab 在节流窗口内只对账一次（hover 连续滑过多个 tab 不打 RPC 风暴）；
//  5. reload 失败不抛错（读路径旁路），退回用现有缓存继续。

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    __resetTabCardReconcileForTests,
    reconcileTabCardWith,
    TabCardReconcileThrottleMs,
    type TabCardReconcileExec,
} from "./tab-card-reconcile";

const makeORef = (otype: string, oid: string) => `${otype}:${oid}`;

function makeExec(opts: {
    tab?: any;
    objects?: Record<string, any>;
    reloadFails?: boolean;
}): { exec: TabCardReconcileExec; reloaded: string[]; primed: { orefs: string[]; force: boolean }[] } {
    const objects = opts.objects ?? {};
    const reloaded: string[] = [];
    const primed: { orefs: string[]; force: boolean }[] = [];
    const exec: TabCardReconcileExec = {
        makeORef,
        reloadWaveObject: vi.fn(async (oref: string) => {
            reloaded.push(oref);
            if (opts.reloadFails) {
                throw new Error("offline");
            }
            return oref.startsWith("tab:") ? opts.tab ?? null : null;
        }),
        getObjectValue: (oref: string) => objects[oref] ?? null,
        primeWaveObjects: vi.fn(async (orefs: string[], primeOpts?: { force?: boolean }) => {
            primed.push({ orefs: [...orefs], force: primeOpts?.force === true });
        }),
    };
    return { exec, reloaded, primed };
}

beforeEach(() => {
    __resetTabCardReconcileForTests();
});

describe("reconcileTabCardWith", () => {
    it("重拉 tab + workspace，并按最新 blockids（含 subblockids）force prime 全部块", async () => {
        const tab = { otype: "tab", oid: "t1", version: 7, blockids: ["g1", "b9"] };
        const { exec, reloaded, primed } = makeExec({
            tab,
            objects: { "block:g1": { otype: "block", oid: "g1", subblockids: ["b1", "b2"] } },
        });

        const didRun = await reconcileTabCardWith(exec, "t1", "w1");

        expect(didRun).toBe(true);
        expect(reloaded).toContain("tab:t1");
        expect(reloaded).toContain("workspace:w1");
        expect(primed.length).toBe(1);
        expect(primed[0].force).toBe(true);
        expect(primed[0].orefs).toEqual(["block:g1", "block:b1", "block:b2", "block:b9"]);
    });

    it("reload 返回 null 时退回现有缓存的 tab，仍按缓存 blockids 对账", async () => {
        const { exec, primed } = makeExec({
            tab: null,
            objects: {
                "tab:t1": { otype: "tab", oid: "t1", version: 3, blockids: ["b1"] },
                "block:b1": { otype: "block", oid: "b1" },
            },
        });

        await reconcileTabCardWith(exec, "t1", undefined);

        expect(primed.length).toBe(1);
        expect(primed[0].orefs).toEqual(["block:b1"]);
    });

    it("节流窗口内同一 tab 只对账一次；窗口过后可再次对账", async () => {
        const tab = { otype: "tab", oid: "t1", version: 1, blockids: ["b1"] };
        const { exec, reloaded } = makeExec({ tab });

        const nowMs = 100_000;
        expect(await reconcileTabCardWith(exec, "t1", undefined, { nowMs })).toBe(true);
        expect(
            await reconcileTabCardWith(exec, "t1", undefined, { nowMs: nowMs + TabCardReconcileThrottleMs - 1 })
        ).toBe(false);
        expect(reloaded.filter((o) => o === "tab:t1").length).toBe(1);

        expect(
            await reconcileTabCardWith(exec, "t1", undefined, { nowMs: nowMs + TabCardReconcileThrottleMs })
        ).toBe(true);
        expect(reloaded.filter((o) => o === "tab:t1").length).toBe(2);
    });

    it("reload 抛错时吞掉（读路径旁路），卡片继续用现有缓存渲染", async () => {
        const { exec } = makeExec({ reloadFails: true, objects: {} });
        await expect(reconcileTabCardWith(exec, "t1", "w1")).resolves.toBe(true);
    });

    it("空 tab（没有 blockids）不发 prime RPC", async () => {
        const { exec, primed } = makeExec({ tab: { otype: "tab", oid: "t1", version: 2, blockids: [] } });
        await reconcileTabCardWith(exec, "t1", undefined);
        expect(primed.length).toBe(0);
    });

    it("同一 workspace 在节流窗口内只重拉一次（扫过多个 tab 不重复打 workspace RPC）", async () => {
        const { exec, reloaded } = makeExec({ tab: { otype: "tab", oid: "tx", version: 1, blockids: [] } });
        const nowMs = 500_000;
        await reconcileTabCardWith(exec, "t1", "w1", { nowMs });
        await reconcileTabCardWith(exec, "t2", "w1", { nowMs: nowMs + 100 });
        expect(reloaded.filter((o) => o === "workspace:w1").length).toBe(1);
        // 两个 tab 各自的 tab 对象还是要重拉
        expect(reloaded).toContain("tab:t1");
        expect(reloaded).toContain("tab:t2");
    });
});
