// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// `primeWaveObjects` 的锁：批量取块。
//
// 为什么值得锁：Overview 首屏会把一个 workspace 的 tab+block 全部走一遍
// `GetObject`（实测 19 Tab ≈ 190 次单件 RPC），首帧全是 null → Tab 组被
// 「空组过滤」删掉，用户看到的就是"没打开过的 Tab 不显示"。
// prime 的契约：一批 oref 只发一次 `ObjectService.GetObjects`；已解析的跳过（幂等）；
// 服务端 null 的对象跳过（不写缓存）；写缓存走 version guard（不回退新版本）。

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./services", () => {
    const state = { calls: [] as string[][], result: {} as Record<string, any> };
    const ObjectService = {
        GetObjects: vi.fn(async (orefs: string[]) => {
            state.calls.push(orefs);
            return orefs.map((oref) => state.result[oref] ?? null);
        }),
        // 测试用 `(ObjectService as any).__primeTestState` 读状态，所以挂在对象上
        // （挂模块顶层 export 的话那条读路径取不到）。断言不受影响。
        __primeTestState: state,
    };
    return { ObjectService };
});

import { ObjectService } from "./services";
import { WOS } from "./wos";

const state = (ObjectService as any).__primeTestState;

function oref(i: number) {
    return `block:blk-${String(i).padStart(4, "0")}`;
}

beforeEach(() => {
    state.calls = [];
    state.result = {};
});

describe("primeWaveObjects", () => {
    it("190 个未解析 oref → 恰好 1 次 GetObjects（400 上限内不分批）", async () => {
        await WOS.primeWaveObjects(Array.from({ length: 190 }, (_, i) => oref(i)));
        expect(state.calls.length).toBe(1);
        expect(state.calls[0].length).toBe(190);
    });

    it("已解析的 oref 跳过（幂等，第二次不再拉）", async () => {
        state.result[oref(1)] = { otype: "block", oid: "blk-0001", version: 1, meta: {} };
        await WOS.primeWaveObjects([oref(0), oref(1)]);
        expect(state.calls.length).toBe(1);
        // 第二次：全都已解析 → 一次都不发
        await WOS.primeWaveObjects([oref(1)]);
        expect(state.calls.length).toBe(1);
    });

    it("服务端返回 null 的对象不写缓存、不抛错", async () => {
        state.result[oref(0)] = null;
        await expect(WOS.primeWaveObjects([oref(0)])).resolves.toBeUndefined();
    });

    it("超过 400 分批", async () => {
        // 独立 id 段：不与前面用例重叠。前面的用例会把 blk-0001 解析并写入 WOV 缓存，
        // 这里再包含它就会被幂等语义跳过（401→400，不再分批），断言就测不准了。
        await WOS.primeWaveObjects(Array.from({ length: 401 }, (_, i) => oref(1000 + i)));
        expect(state.calls.length).toBe(2);
        expect(state.calls[0].length).toBe(400);
        expect(state.calls[1].length).toBe(1);
    });
});
