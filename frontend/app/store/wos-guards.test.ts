// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// WOS 读路径自愈锁（task 11-23-overview-refresh-1123）。
//
// Run: npx vitest run frontend/app/store/wos-guards.test.ts
//
// 锁定的回归点（都是「这个 renderer 从此永久显示旧数据」的实锤路径）：
//  1. createWaveValueObject：迟到的 GetObject 返回 null 不得抹掉已有值
//     （否则该 renderer 里这一块永久「不存在」，悬浮卡长期 0 个 agent）。
//  2. createWaveValueObject：GetObject 失败不得永久 loading:true（空态/骨架收不掉，
//     且后续 reload/prime 拿不到重试机会）。
//  3. reloadWaveObject：迟到的旧快照不得把 atom 回退到旧版本（与 create 同一条 version guard）。
//  4. primeWaveObjects：`{ force: true }` 时已解析的 oref 也要重拉（悬浮卡打开时的对账语义）。
//
// GetObject 走 callBackendService → fetch，所以本文件 mock fetchutil，用可手控的
// deferred 队列精确决定「回包何时到、回什么」。primeWaveObjects 走 ObjectService.GetObjects，
// 与 wos-prime.test.ts 同样 mock ./services。

import { beforeEach, describe, expect, it, vi } from "vitest";

// GetObject 的 fetch 队列（vi.hoisted 才能在 vi.mock 工厂里引用）。
const h = vi.hoisted(() => ({
    queue: [] as { resolve: (v: any) => void; reject: (e: any) => void }[],
}));

vi.mock("@/util/endpoints", () => ({
    getWebServerEndpoint: () => "http://test",
}));
vi.mock("@/util/fetchutil", () => ({
    // callBackendService: fetch(url) → resp.ok / resp.json() → { data, updates, error }
    fetch: vi.fn(
        () =>
            new Promise((resolve, reject) => {
                h.queue.push({ resolve, reject });
            })
    ),
}));

const primeState = vi.hoisted(() => ({
    calls: [] as string[][],
    result: {} as Record<string, any>,
}));
vi.mock("./services", () => {
    const ObjectService = {
        GetObjects: vi.fn(async (orefs: string[]) => {
            primeState.calls.push(orefs);
            return orefs.map((oref) => primeState.result[oref] ?? null);
        }),
    };
    return { ObjectService };
});

import { globalStore } from "./jotaiStore";
import { WOS } from "./wos";

/** 让一条 WebReturnType 回包（GetObject 的返回值）。 */
function resolveGetObject(value: any) {
    const head = h.queue.shift();
    expect(head, "GetObject 应该先发出").toBeTruthy();
    head.resolve({ ok: true, json: async () => ({ data: value, updates: null, error: null }) });
}

function rejectGetObject(error: any) {
    const head = h.queue.shift();
    expect(head, "GetObject 应该先发出").toBeTruthy();
    head.reject(error);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const block = (oid: string, version: number, meta: Record<string, unknown> = {}) => ({
    otype: "block",
    oid,
    version,
    meta,
});

// WOS 缓存是模块级 Map：每个用例用独立 oid，避免跨用例串缓存。
let seq = 0;
const nextOid = () => `heal-${String(++seq).padStart(3, "0")}`;

beforeEach(() => {
    h.queue.length = 0;
    primeState.calls = [];
    primeState.result = {};
});

describe("WOS 读路径自愈", () => {
    it("迟到的 GetObject 返回 null 不得抹掉已有值", async () => {
        const oid = nextOid();
        const oref = `block:${oid}`;
        const good = block(oid, 5, { "agent:provider": "pi" });
        // waveobj:update 先到（创建 WOV 的同时 GetObject 发出，悬着）
        WOS.updateWaveObject({ updatetype: "update", otype: "block", oid, obj: good });
        expect(WOS.getObjectValue(oref)).toEqual(good);

        // 迟到的 GetObject 回包 null（读己之写竞态 / delete 事件未到）
        resolveGetObject(null);
        await flush();

        expect(WOS.getObjectValue(oref)).toEqual(good);
    });

    it("GetObject 失败不得永久 loading，后续 reload 可自愈", async () => {
        const oid = nextOid();
        const oref = `block:${oid}`;
        // 首读触发 GetObject → 拒绝
        expect(WOS.getObjectValue(oref)).toBeNull();
        rejectGetObject(new Error("boom"));
        await flush();

        const loadingAtom = WOS.getWaveObjectLoadingAtom(oref);
        expect(globalStore.get(loadingAtom)).toBe(false);

        // reload 重试成功 → 值就位（不再有永久 null 的死角）
        const good = block(oid, 3, { view: "term" });
        const reloaded = WOS.reloadWaveObject(oref);
        resolveGetObject(good);
        await reloaded;
        expect(WOS.getObjectValue(oref)).toEqual(good);
    });

    it("reloadWaveObject 的迟到旧快照不得回退版本", async () => {
        const oid = nextOid();
        const oref = `block:${oid}`;
        const good = block(oid, 5, { "agent:provider": "pi" });
        WOS.updateWaveObject({ updatetype: "update", otype: "block", oid, obj: good });
        // 吃掉创建时悬着的 GetObject（同版本，无害）
        resolveGetObject(good);
        await flush();

        const p = WOS.reloadWaveObject(oref);
        resolveGetObject(block(oid, 3, {})); // 旧快照
        await p;

        expect((WOS.getObjectValue(oref) as any).version).toBe(5);
    });

    it("reloadWaveObject 失败保留已有值并解除 loading", async () => {
        const oid = nextOid();
        const oref = `block:${oid}`;
        const good = block(oid, 4);
        WOS.updateWaveObject({ updatetype: "update", otype: "block", oid, obj: good });
        resolveGetObject(good);
        await flush();

        const p = WOS.reloadWaveObject(oref);
        rejectGetObject(new Error("offline"));
        await p.catch(() => null);

        expect(WOS.getObjectValue(oref)).toEqual(good);
        expect(globalStore.get(WOS.getWaveObjectLoadingAtom(oref))).toBe(false);
    });

    it("primeWaveObjects 默认幂等（已解析跳过），force 时已解析也重拉", async () => {
        const oid = nextOid();
        const oref = `block:${oid}`;
        const good = block(oid, 2);
        primeState.result[oref] = good;

        await WOS.primeWaveObjects([oref]);
        await WOS.primeWaveObjects([oref]);
        expect(primeState.calls.length).toBe(1);

        await WOS.primeWaveObjects([oref], { force: true });
        expect(primeState.calls.length).toBe(2);
    });
});
