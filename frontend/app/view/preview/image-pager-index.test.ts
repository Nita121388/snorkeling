// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 索引层（image-pager-index）单测 —— 用 mock listDir 驱动真实 buildIndex。
//
// 为什么必须有这层测试：截断死锁（审核 B1，10 目录 × 600 张时 buildIndex 的
// Promise 永不 resolve）用 20 行 mock 就能当场抓住，纯逻辑单测覆盖不到。

import { afterEach, describe, expect, it, vi } from "vitest";
import {
    _resetPagerCacheForTest,
    getPagerIndex,
    invalidatePagerIndex,
    pagerCacheKey,
    subscribePagerIndex,
    type PagerIndexState,
    type EnsureParams,
} from "./image-pager-index";
import { PAGER_LIMITS } from "./image-pager-model";

function pngEntries(dir: string, names: string[]): { path: string; name: string; isdir: boolean }[] {
    return names.map((n) => ({ path: `${dir}/${n}`, name: n, isdir: false }));
}

function dirEntry(dir: string, name: string): { path: string; name: string; isdir: boolean } {
    return { path: dir ? `${dir}/${name}` : name, name, isdir: true };
}

type Tree = Record<string, { files: string[]; dirs: string[] }>;

function makeListDir(tree: Tree, opts: { delay?: number } = {}) {
    return async (path: string) => {
        if (opts.delay) {
            await new Promise((r) => setTimeout(r, opts.delay));
        }
        const node = tree[path];
        if (node == null) {
            throw new Error(`ENOENT: ${path}`);
        }
        return [...dirEntry(path, "__none__") ? node.dirs.map((d) => dirEntry(path, d)) : [], ...pngEntries(path, node.files)].flat();
    };
}

function onceSettled(get: () => PagerIndexState, timeoutMs = 5000): Promise<PagerIndexState> {
    return new Promise((resolve, reject) => {
        const t0 = Date.now();
        const tick = () => {
            const st = get();
            if (!st.building) return resolve(st);
            if (Date.now() - t0 > timeoutMs) return reject(new Error(`索引未在 ${timeoutMs}ms 内完成（疑似死锁）`));
            setTimeout(tick, 10);
        };
        tick();
    });
}

function paramsFor(key: string, anchor: string, listDir: EnsureParams["listDir"]): EnsureParams {
    return { key, anchor, sort: "name", listDir };
}

afterEach(() => {
    _resetPagerCacheForTest();
    vi.restoreAllMocks();
});

describe("image-pager-index — buildIndex", () => {
    it("小树：本层就绪 + 站点按 DFS 先序补齐", async () => {
        const tree: Tree = {
            "/p": { files: ["1.png", "2.png"], dirs: ["sub", "zz"] },
            "/p/sub": { files: ["a.png"], dirs: [] },
            "/p/zz": { files: ["z.png"], dirs: [] },
        };
        const key = pagerCacheKey("local", "/p", "name");
        getPagerIndex(key, paramsFor(key, "/p", makeListDir(tree)));
        const st = await onceSettled(() => getPagerIndex(key, paramsFor(key, "/p", makeListDir(tree))));
        expect(st.layer).toEqual(["/p/1.png", "/p/2.png"]);
        expect(st.stations.map((s) => s.dir)).toEqual(["/p", "/p/sub", "/p/zz"]);
        expect(st.stations[1].images).toEqual(["/p/sub/a.png"]);
        expect(st.error).toBeNull();
        expect(st.truncated).toBe(false);
    });

    it("B1 回归：多站点触发图片上限时必须能结束（不得死锁），且 truncated 可见", async () => {
        // 10 个子目录 × 600 张 = 6000 > 5000：越过上限的那一刻必须截断并收尾
        const tree: Tree = { "/p": { files: [], dirs: [] } };
        const subDirs: string[] = [];
        for (let i = 0; i < 10; i++) {
            const d = `d${String(i).padStart(2, "0")}`;
            subDirs.push(d);
            tree["/p"].dirs.push(d);
            tree[`/p/${d}`] = { files: Array.from({ length: 600 }, (_, j) => `${String(j).padStart(4, "0")}.png`), dirs: [] };
        }
        void subDirs;
        const key = pagerCacheKey("local", "/p", "name");
        getPagerIndex(key, paramsFor(key, "/p", makeListDir(tree)));
        const st = await onceSettled(() => getPagerIndex(key, paramsFor(key, "/p", makeListDir(tree))), 8000);
        expect(st.truncated).toBe(true);
        expect(st.building).toBe(false);
        // 累计图片 ≤ 上限 + 单目录一整批的余量（capLayer 逐层截断）
        const total = st.stations.reduce((n, s) => n + s.count, 0);
        expect(total).toBeLessThanOrEqual(PAGER_LIMITS.maxImages + 600);
        expect(st.stations.length).toBeGreaterThan(0);
    });

    it("B2 回归：锚点本层单目录超上限也要截断", async () => {
        const tree: Tree = {
            "/p": { files: Array.from({ length: PAGER_LIMITS.maxImages + 500 }, (_, i) => `${i}.png`), dirs: [] },
        };
        const key = pagerCacheKey("local", "/p", "name");
        getPagerIndex(key, paramsFor(key, "/p", makeListDir(tree)));
        const st = await onceSettled(() => getPagerIndex(key, paramsFor(key, "/p", makeListDir(tree))), 8000);
        expect(st.layer.length).toBe(PAGER_LIMITS.maxImages);
        expect(st.truncated).toBe(true);
        expect(st.building).toBe(false);
    });

    it("目录数上限：图片稀疏的深树不会无限 DFS", async () => {
        // 600 个目录、每个 0 张图：超过 maxDirs(500) 必须停
        const tree: Tree = { "/p": { files: [], dirs: [] } };
        const dirs = Array.from({ length: 600 }, (_, i) => `d${String(i).padStart(4, "0")}`);
        tree["/p"].dirs = dirs;
        for (const d of dirs) {
            tree[`/p/${d}`] = { files: [], dirs: [] };
        }
        const key = pagerCacheKey("local", "/p", "name");
        getPagerIndex(key, paramsFor(key, "/p", makeListDir(tree)));
        const st = await onceSettled(() => getPagerIndex(key, paramsFor(key, "/p", makeListDir(tree))), 10000);
        expect(st.scannedDirs).toBeLessThanOrEqual(PAGER_LIMITS.maxDirs + 3);
        expect(st.building).toBe(false);
    });

    it("根目录列不动 → error 可见、不抛", async () => {
        const key = pagerCacheKey("local", "/gone", "name");
        const listDir = async () => {
            throw new Error("boom");
        };
        getPagerIndex(key, paramsFor(key, "/gone", listDir));
        const st = await onceSettled(() => getPagerIndex(key, paramsFor(key, "/gone", listDir)));
        expect(st.error).toContain("boom");
        expect(st.building).toBe(false);
    });

    it("单目录失败被跳过，不拖垮整树", async () => {
        const tree: Tree = {
            "/p": { files: ["1.png"], dirs: ["ok", "bad"] },
            "/p/ok": { files: ["a.png"], dirs: [] },
            "/p/bad": { files: ["x.png"], dirs: [] },
        };
        const base = makeListDir(tree);
        const key = pagerCacheKey("local", "/p", "name");
        const listDir = async (path: string) => {
            if (path === "/p/bad") throw new Error("permission denied");
            return base(path);
        };
        getPagerIndex(key, paramsFor(key, "/p", listDir));
        const st = await onceSettled(() => getPagerIndex(key, paramsFor(key, "/p", listDir)));
        expect(st.error).toBeNull();
        expect(st.stations.map((s) => s.dir)).toEqual(["/p", "/p/ok"]);
    });
});

describe("image-pager-index — 缓存与失效", () => {
    it("同 key 同步复用；invalidate 后重建（代际令牌）", async () => {
        let calls = 0;
        const tree: Tree = { "/p": { files: ["1.png"], dirs: [] } };
        const base = makeListDir(tree);
        const listDir = async (p: string) => {
            calls++;
            return base(p);
        };
        const key = pagerCacheKey("local", "/p", "name");
        getPagerIndex(key, paramsFor(key, "/p", listDir));
        await onceSettled(() => getPagerIndex(key, paramsFor(key, "/p", listDir)));
        const callsAfterFirst = calls;
        getPagerIndex(key, paramsFor(key, "/p", listDir));
        expect(calls).toBe(callsAfterFirst); // 缓存命中，无新 RPC
        invalidatePagerIndex(key);
        getPagerIndex(key, paramsFor(key, "/p", listDir));
        const st = await onceSettled(() => getPagerIndex(key, paramsFor(key, "/p", listDir)));
        expect(st.layer).toEqual(["/p/1.png"]);
        expect(calls).toBeGreaterThan(callsAfterFirst);
    });

    it("订阅被通知且可退订", async () => {
        const tree: Tree = { "/p": { files: ["1.png", "2.png"], dirs: [] } };
        const key = pagerCacheKey("local", "/p", "name");
        const p = paramsFor(key, "/p", makeListDir(tree));
        let hits = 0;
        const unsub = subscribePagerIndex(key, p, () => hits++);
        getPagerIndex(key, p);
        await onceSettled(() => getPagerIndex(key, p));
        expect(hits).toBeGreaterThan(0);
        unsub();
    });
});
