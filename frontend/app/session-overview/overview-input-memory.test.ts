// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 输入记忆纯逻辑的锁（11-24 R3/R4）：
//   · 草稿读写往返 / 清除；
//   · 非法 JSON / 字段缺失 → 回落空记录（不抛错）；
//   · LRU 上限（50 条，最新优先）+ 过期清理（14 天）；
//   · 单条超长截断（8KB 上限，不丢用户可见部分）；
//   · 新建 agent 弹窗 prefs（profile + message）读写往返。

import { describe, expect, it, vi } from "vitest";
import {
    clearSendDraft,
    OverviewAddAgentPrefsStorageKey,
    OverviewSendDraftStorageKey,
    pruneSendDrafts,
    readAddAgentPrefs,
    readAllSendDrafts,
    readSendDraft,
    SendDraftMaxEntries,
    writeAddAgentPrefs,
    writeSendDraft,
    type SendDraftStorageLike,
} from "./overview-input-memory";

function memoryStorage(): SendDraftStorageLike & { dump(): Record<string, string> } {
    const store = new Map<string, string>();
    return {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => void store.set(key, value),
        removeItem: (key) => void store.delete(key),
        dump: () => Object.fromEntries(store.entries()),
    };
}

const T0 = 1_700_000_000_000;
const FarFuture = T0 + 1000;

describe("send drafts（R4 composer 草稿持久化）", () => {
    it("读写往返 + 清除", () => {
        const storage = memoryStorage();
        expect(readSendDraft(storage, "b1")).toBe("");
        writeSendDraft(storage, "b1", "hello", T0);
        expect(readSendDraft(storage, "b1", FarFuture)).toBe("hello");
        clearSendDraft(storage, "b1");
        expect(readSendDraft(storage, "b1", FarFuture)).toBe("");
        // 清空后不留空键。
        expect(storage.dump()[OverviewSendDraftStorageKey]).toBeUndefined();
    });

    it("空文本写入等于清除", () => {
        const storage = memoryStorage();
        writeSendDraft(storage, "b1", "x", T0);
        writeSendDraft(storage, "b1", "", T0);
        expect(readSendDraft(storage, "b1")).toBe("");
    });

    it("损坏 JSON / 字段缺失回落空记录，不抛错", () => {
        const storage = memoryStorage();
        storage.setItem(OverviewSendDraftStorageKey, "{not json");
        expect(readAllSendDrafts(storage)).toEqual({});
        storage.setItem(OverviewSendDraftStorageKey, JSON.stringify({ b1: { nope: 1 } }));
        expect(readAllSendDrafts(storage)).toEqual({});
    });

    it("LRU 上限：超过 50 条丢最旧", () => {
        const storage = memoryStorage();
        for (let i = 0; i < SendDraftMaxEntries + 5; i++) {
            writeSendDraft(storage, `b${i}`, `text-${i}`, T0 + i * 1000);
        }
        const all = readAllSendDrafts(storage, FarFuture);
        expect(Object.keys(all)).toHaveLength(SendDraftMaxEntries);
        expect(all["b4"]).toBeUndefined(); // 最旧的 5 条被裁
        expect(all["b54"]).toBe("text-54");
    });

    it("过期清理：超过 14 天的条目读时即清", () => {
        const storage = memoryStorage();
        const stale = T0 - 15 * 24 * 60 * 60 * 1000;
        writeSendDraft(storage, "b-old", "old", stale);
        writeSendDraft(storage, "b-new", "new", T0);
        const all = readAllSendDrafts(storage, T0);
        expect(all["b-old"]).toBeUndefined();
        expect(all["b-new"]).toBe("new");
    });

    it("单条超长截断到上限（warn 一次），不丢头部", () => {
        const storage = memoryStorage();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const long = "x".repeat(9000);
        writeSendDraft(storage, "b1", long, T0);
        const readBack = readSendDraft(storage, "b1", FarFuture);
        expect(readBack.length).toBe(8000);
        expect(readBack.startsWith("xxxx")).toBe(true);
        warn.mockRestore();
    });

    it("pruneSendDrafts 是纯函数：不触碰 storage", () => {
        const record = {
            a: { text: "a", updatedAt: 2 },
            b: { text: "b", updatedAt: 1 },
        };
        const pruned = pruneSendDrafts(record, { now: 100, maxEntries: 1, maxAgeMs: 1000 });
        expect(Object.keys(pruned)).toEqual(["a"]);
        expect(record).toEqual({ a: { text: "a", updatedAt: 2 }, b: { text: "b", updatedAt: 1 } });
    });
});

describe("add agent prefs（R3 新建弹窗记忆）", () => {
    it("读写往返：profile + message", () => {
        const storage = memoryStorage();
        expect(readAddAgentPrefs(storage)).toEqual({ profile: null, message: "" });
        writeAddAgentPrefs(storage, { profile: "pi", message: "292" });
        expect(readAddAgentPrefs(storage)).toEqual({ profile: "pi", message: "292" });
    });

    it("profile 空 = 记忆失效回落 null（渲染层再回落第一项）", () => {
        const storage = memoryStorage();
        storage.setItem(OverviewAddAgentPrefsStorageKey, JSON.stringify({ profile: "", message: "" }));
        expect(readAddAgentPrefs(storage)).toEqual({ profile: null, message: "" });
    });

    it("损坏 JSON 回落默认，不抛错", () => {
        const storage = memoryStorage();
        storage.setItem(OverviewAddAgentPrefsStorageKey, "nope");
        expect(readAddAgentPrefs(storage)).toEqual({ profile: null, message: "" });
    });

    it("草稿记忆超长同样截断", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const storage = memoryStorage();
        writeAddAgentPrefs(storage, { profile: null, message: "y".repeat(9000) });
        expect(readAddAgentPrefs(storage).message.length).toBe(8000);
        warn.mockRestore();
    });
});
