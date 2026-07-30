// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/vanilla/utils";
import type { SyncStorage } from "jotai/vanilla/utils/atomWithStorage";

// 持久化的 "tab 打开时序" 存储. 与 openedThisLaunchTabIdsAtom (main 进程内存 Set, 重启即清空)
// 平行但独立:
//   - openedThisLaunchTabIdsAtom: 管 "本启动内" 哪些 tab 被打开过, 决定 visibleTabIds 过滤.
//     main 进程内存 Set, 不含时序, 无持久化.
//   - tabRecencyStore: 管跨重启的 "pinned 内部排序" (按 lastOpenedAt 降序, 最近点的排最前)
//     以及 "跨重启是否仍算 pinned" 的判定 (AGE 衰减窗口).
//
// 复用 agent-status-done-ack-store.ts 已验证的范式:
//   atomWithStorage + SyncStorage + 单例 + bumpAtom.
// 保证跨 Tab renderer 一致 (localStorage + storage 事件自然广播).

const TabRecencyStorageKey = "snorkeling:tab:recency-map";
export const TabRecencyAgeWindowMs = 7 * 24 * 60 * 60 * 1000; // 7 天

function parseTabRecencyMap(raw: string | null): Record<string, number> {
    try {
        const parsed = JSON.parse(raw ?? "{}");
        if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const result: Record<string, number> = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof key === "string" && typeof value === "number" && Number.isFinite(value)) {
                result[key] = value;
            }
        }
        return result;
    } catch {
        return {};
    }
}

function readTabRecencyMap(): Record<string, number> {
    if (typeof window === "undefined") return {};
    try {
        return parseTabRecencyMap(window.localStorage.getItem(TabRecencyStorageKey));
    } catch {
        return {};
    }
}

function writeTabRecencyMap(value: Record<string, number>): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(TabRecencyStorageKey, JSON.stringify(value));
}

const TabRecencyStorage: SyncStorage<Record<string, number>> = {
    getItem: () => readTabRecencyMap(),
    setItem: (_key, value) => {
        const now = Date.now();
        const pruned: Record<string, number> = {};
        for (const [tabId, ts] of Object.entries(value)) {
            if (now - ts < TabRecencyAgeWindowMs) pruned[tabId] = ts;
        }
        writeTabRecencyMap(pruned);
    },
    removeItem: () => {
        if (typeof window === "undefined") return;
        window.localStorage.removeItem(TabRecencyStorageKey);
    },
    subscribe: (_key, callback) => {
        if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => {};
        const handleStorage = (event: StorageEvent) => {
            if (event.key !== TabRecencyStorageKey) return;
            if (event.storageArea != null && event.storageArea !== window.localStorage) return;
            callback(readTabRecencyMap());
        };
        window.addEventListener("storage", handleStorage);
        return () => window.removeEventListener("storage", handleStorage);
    },
};

let singletonInstance: TabRecencyStore | null = null;

// bump signal: markTabOpened / removeTab 时 +1, 强制所有订阅 derived atom invalidate 快照.
// 绕开 jotai "无订阅者时不主动 recompute" 盲区. 切 Tab 走掉的 VTabWrapper unmount 期间,
// 它的 pinned-order derived 计算失去订阅者, jotai 仅标 dirty 但不重算; bumpAtom 兜底.
export const tabRecencyBumpAtom: PrimitiveAtom<number> = atom(0);

class TabRecencyStore {
    recencyMapAtom = atomWithStorage<Record<string, number>>(
        TabRecencyStorageKey,
        {},
        TabRecencyStorage,
        { getOnInit: true }
    ) as PrimitiveAtom<Record<string, number>>;

    private constructor() {}

    static getInstance(): TabRecencyStore {
        if (singletonInstance == null) singletonInstance = new TabRecencyStore();
        return singletonInstance;
    }

    static resetTestInstance(): void {
        singletonInstance = null;
    }

    markTabOpened(tabId: string, openedAt = Date.now(), source = "tab-click"): void {
        if (!tabId) return;
        const current = readTabRecencyMap();
        const next = { ...current, [tabId]: openedAt };
        globalStore.set(this.recencyMapAtom, next);
        globalStore.set(tabRecencyBumpAtom, globalStore.get(tabRecencyBumpAtom) + 1);
    }

    removeTab(tabId: string): void {
        if (!tabId) return;
        const current = readTabRecencyMap();
        if (!(tabId in current)) return;
        const next = { ...current };
        delete next[tabId];
        globalStore.set(this.recencyMapAtom, next);
        globalStore.set(tabRecencyBumpAtom, globalStore.get(tabRecencyBumpAtom) + 1);
    }

    getRecencyMap(): Record<string, number> {
        return globalStore.get(this.recencyMapAtom) ?? {};
    }
}

export const tabRecencyStore = TabRecencyStore.getInstance();

// [DIAG] CDP eval 探针, 同 agent-status-done-ack-store 的 window.__diagDoneAck 模式.
// 验证: window.__diagTabRecency.get() 返回 map 内容,
//       window.__diagTabRecency.readLS() 直接读 localStorage,
//       二者应一致.
if (typeof window !== "undefined") {
    // @ts-ignore
    window.__diagTabRecency = {
        atom: tabRecencyStore.recencyMapAtom,
        get: () => globalStore.get(tabRecencyStore.recencyMapAtom),
        readLS: readTabRecencyMap,
    };
}
