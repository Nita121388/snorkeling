// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// reinitWave 减负的**执行器级**证据测试 (task 11-19-reinitwave-relief).
//
// reinit-wave-plan.test.ts 只证明「计划输出」，本文件证明「执行器真的按计划发了几个 RPC」：
// 用可计数的 mock reloadWaveObject / makeORef 注入 executeReinitReloads / executeWorkspaceTabReloads，
// 断言的是调用次数、调用顺序、并行批次这些字面数字，而不是返回对象形状。
//
// 锁定的数字：
// - 开关 on + tabids 未变：reloadWaveObject 恰好 5 次（2 批 3+2），workspace tab reload 追加 0 次。
// - 开关 on + tabids 变化：workspace tab reload 追加 N 次，逐个新 id。
// - 开关 off：reloadWaveObject 恰好 5 次，顺序 client→window→workspace→tab→layout 逐项串行，
//   且 tabids 未变也照样全量重刷（改造前语义）。
//
// Run: npx vitest run frontend/app/wave/reinit-wave-executor.test.ts

import { describe, expect, it, vi } from "vitest";
import { planReinitWave, planWorkspaceTabReload, type Deps } from "./reinit-wave-plan";
import { executeReinitReloads, executeWorkspaceTabReloads } from "./reinit-wave-executor";

const DEPS: Deps = { clientId: "c1", windowId: "w1", tabId: "t1" };

/** 假的 WOS 对象表：window 带 workspaceid、tab 带 layoutstate、workspace 带 tabids。 */
const OBJECTS: Record<string, any> = {
    "client:c1": { otype: "client", oid: "c1" },
    "window:w1": { otype: "window", oid: "w1", workspaceid: "ws1" },
    "workspace:ws1": { otype: "workspace", oid: "ws1", tabids: ["t1", "t2", "t3"] },
    "tab:t1": { otype: "tab", oid: "t1", name: "Tab One", layoutstate: "ls1" },
    "tab:t2": { otype: "tab", oid: "t2", name: "Tab Two" },
    "tab:t3": { otype: "tab", oid: "t3", name: "Tab Three" },
    "layout:ls1": { otype: "layout", oid: "ls1" },
};

/** 立即完成的 mock 执行器：记录每次 reload 的 oref 顺序。 */
function makeImmediateExec() {
    const calls: string[] = [];
    const reload = vi.fn((oref: string) => {
        calls.push(oref);
        return Promise.resolve(OBJECTS[oref]);
    });
    const makeORef = vi.fn((otype: string, oid: string) => (oid == null ? null : `${otype}:${oid}`));
    return { calls, reload, makeORef, exec: { makeORef, reloadWaveObject: reload } };
}

/** 手动 resolve 的 mock 执行器：用来观察「谁已经发出、谁还在等」。 */
function makeDeferredExec() {
    const started: string[] = [];
    const pending: Array<() => void> = [];
    const reload = vi.fn((oref: string) => {
        started.push(oref);
        return new Promise<any>((resolve) => {
            pending.push(() => resolve(OBJECTS[oref]));
        });
    });
    const makeORef = (otype: string, oid: string): string => (oid == null ? null : `${otype}:${oid}`);
    const releaseAll = () => pending.splice(0, pending.length).forEach((r) => r());
    return { started, pending, reload, releaseAll, exec: { makeORef, reloadWaveObject: reload } };
}

/** 让所有挂起的微任务跑完（macrotask 边界比多级 await 稳）。 */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("executeReinitReloads：on 路径（减负生效）", () => {
    it("tabids 未变：reloadWaveObject 恰好 5 次（批 3+2），workspace tab reload 追加 0 次", async () => {
        const h = makeImmediateExec();
        const plan = planReinitWave(DEPS, true);
        const results = await executeReinitReloads(plan.batches, DEPS, h.exec);

        // 字面数字：5 次 reload，2 批。
        expect(plan.batches).toHaveLength(2);
        expect(h.reload).toHaveBeenCalledTimes(5);
        expect(h.makeORef).toHaveBeenCalledTimes(5);

        // 顺序：batch0 = client/window/tab，batch1 = workspace(依赖 window)/layout(依赖 tab)。
        expect(h.calls).toEqual(["client:c1", "window:w1", "tab:t1", "workspace:ws1", "layout:ls1"]);

        // 依赖确实来自 reload 结果：workspace 用 window.workspaceid，layout 用 tab.layoutstate。
        const ws = results.get("workspace");
        expect(ws.tabids).toEqual(["t1", "t2", "t3"]);

        // tabids 未变 → tabIdsToReload === null → 追加 0 次 RPC（A3 执行器级判据）。
        const decision = planWorkspaceTabReload(ws.tabids, [...ws.tabids], true);
        expect(decision).toBeNull();
        executeWorkspaceTabReloads(decision, h.exec);
        expect(h.reload).toHaveBeenCalledTimes(5); // 仍是 5，没有 N 次 tab reload
        expect(h.calls).toHaveLength(5);
    });

    it("batch0 的 3 个 reload 并行发出：首个 resolve 前 3 个都已在飞", async () => {
        const h = makeDeferredExec();
        const plan = planReinitWave(DEPS, true);
        const done = executeReinitReloads(plan.batches, DEPS, h.exec);

        // 关键证据：还没 resolve 任何一个，batch0 三个 reload 已全部发出。
        expect(h.started).toEqual(["client:c1", "window:w1", "tab:t1"]);
        expect(h.pending).toHaveLength(3);

        h.releaseAll();
        await flush();
        // batch0 全部完成后才发 batch1 的两个（依赖顺序不能被并行打乱）。
        expect(h.started.slice(3)).toEqual(["workspace:ws1", "layout:ls1"]);
        expect(h.pending).toHaveLength(2);

        h.releaseAll();
        await done;
        expect(h.reload).toHaveBeenCalledTimes(5);
    });

    it("tabids 变化：workspace tab reload 追加 3 次，逐个新 id", async () => {
        const h = makeImmediateExec();
        const plan = planReinitWave(DEPS, true);
        const results = await executeReinitReloads(plan.batches, DEPS, h.exec);
        expect(h.reload).toHaveBeenCalledTimes(5);

        const ws = results.get("workspace");
        const decision = planWorkspaceTabReload(["t1", "t2"], ws.tabids, true);
        expect(decision).toEqual(["t1", "t2", "t3"]);
        executeWorkspaceTabReloads(decision, h.exec);

        expect(h.reload).toHaveBeenCalledTimes(8); // 5 + 3
        expect(h.calls.slice(5)).toEqual(["tab:t1", "tab:t2", "tab:t3"]);
    });

    it("首帧 prev 为 undefined：仍全量重刷 tabs（保持现状语义）", async () => {
        const h = makeImmediateExec();
        const plan = planReinitWave(DEPS, true);
        const results = await executeReinitReloads(plan.batches, DEPS, h.exec);

        const decision = planWorkspaceTabReload(undefined, results.get("workspace").tabids, true);
        executeWorkspaceTabReloads(decision, h.exec);
        expect(h.reload).toHaveBeenCalledTimes(8);
        expect(h.calls.slice(5)).toEqual(["tab:t1", "tab:t2", "tab:t3"]);
    });
});

describe("executeReinitReloads：off 路径（回归锁，与改造前逐项一致）", () => {
    it("RPC 序列逐项一致：client → window → workspace → tab → layout，共 5 次", async () => {
        const h = makeImmediateExec();
        const plan = planReinitWave(DEPS, false);
        expect(plan.batches).toHaveLength(5);

        const results = await executeReinitReloads(plan.batches, DEPS, h.exec);

        expect(h.reload).toHaveBeenCalledTimes(5);
        expect(h.calls).toEqual(["client:c1", "window:w1", "workspace:ws1", "tab:t1", "layout:ls1"]);
        expect(results.get("workspace").tabids).toEqual(["t1", "t2", "t3"]);
    });

    it("逐项串行：上一个未 resolve 下一个不发出", async () => {
        const h = makeDeferredExec();
        const plan = planReinitWave(DEPS, false);
        const done = executeReinitReloads(plan.batches, DEPS, h.exec);

        expect(h.started).toEqual(["client:c1"]);
        h.releaseAll();
        await flush();
        expect(h.started).toEqual(["client:c1", "window:w1"]);
        h.releaseAll();
        await flush();
        expect(h.started).toEqual(["client:c1", "window:w1", "workspace:ws1"]);
        h.releaseAll();
        await flush();
        expect(h.started).toEqual(["client:c1", "window:w1", "workspace:ws1", "tab:t1"]);
        h.releaseAll();
        await flush();
        expect(h.started).toEqual(["client:c1", "window:w1", "workspace:ws1", "tab:t1", "layout:ls1"]);
        h.releaseAll();
        await done;
        expect(h.reload).toHaveBeenCalledTimes(5);
    });

    it("tabids 未变也全量重刷（改造前语义）：追加 N 次", async () => {
        const h = makeImmediateExec();
        const plan = planReinitWave(DEPS, false);
        const results = await executeReinitReloads(plan.batches, DEPS, h.exec);

        const ws = results.get("workspace");
        const decision = planWorkspaceTabReload([...ws.tabids], ws.tabids, false);
        executeWorkspaceTabReloads(decision, h.exec);
        expect(h.reload).toHaveBeenCalledTimes(8); // 5 + 3（虽然 tabids 没变）
        expect(h.calls.slice(5)).toEqual(["tab:t1", "tab:t2", "tab:t3"]);
    });
});

describe("executeWorkspaceTabReloads", () => {
    it("null → 0 次；空数组 → 0 次；两个 id → 2 次且顺序一致", () => {
        const h = makeImmediateExec();
        executeWorkspaceTabReloads(null, h.exec);
        executeWorkspaceTabReloads([], h.exec);
        expect(h.reload).toHaveBeenCalledTimes(0);

        executeWorkspaceTabReloads(["t2", "t3"], h.exec);
        expect(h.reload).toHaveBeenCalledTimes(2);
        expect(h.calls).toEqual(["tab:t2", "tab:t3"]);
    });

    it("依赖字段缺失时跳过 reload（workspaceid/layoutstate 为 undefined）", async () => {
        const emptyObjects: Record<string, any> = {
            "window:w1": { otype: "window", oid: "w1" }, // 无 workspaceid
            "tab:t1": { otype: "tab", oid: "t1" }, // 无 layoutstate
        };
        const exec = {
            makeORef: (otype: string, oid: string) => (oid == null ? null : `${otype}:${oid}`),
            reloadWaveObject: vi.fn((oref: string) => Promise.resolve(emptyObjects[oref])),
        };
        const plan = planReinitWave(DEPS, true);
        const results = await executeReinitReloads(plan.batches, DEPS, exec);
        // client + window + tab 发得出去；workspace / layout 因依赖缺失被跳过。
        expect(exec.reloadWaveObject).toHaveBeenCalledTimes(3);
        expect(results.has("workspace")).toBe(false);
        expect(results.has("layout")).toBe(false);
    });
});
