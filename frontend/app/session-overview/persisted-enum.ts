// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// localStorage 持久化的枚举开关（viewMode / boardGroup / timelineRange 共用）。
//
// 每个开关都要「读时校验、非法值回落默认、写失败不炸、跨窗口 storage 事件同步」，
// 之前每加一个开关就复制 60 行 —— 现在只有这一份实现。
//
// 额外约定：`isValue` 只放行**当前版本已实现**的取值。这样未来版本写进 storage 的新值，
// 在旧版本会回落默认（例如 timeline 未实现时回落 list），而不是渲染出空白界面。

import { atomWithStorage } from "jotai/vanilla/utils";
import type { SyncStorage } from "jotai/vanilla/utils/atomWithStorage";

export type PersistedEnumStorageLike = {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem?(key: string): void;
};

export function getDefaultPersistedEnumStorage(): PersistedEnumStorageLike | null {
    if (typeof window === "undefined") {
        return null;
    }
    try {
        return window.localStorage ?? null;
    } catch {
        return null;
    }
}

export type PersistedEnum<T extends string> = {
    key: string;
    default: T;
    read: (storage: PersistedEnumStorageLike | null) => T;
    write: (storage: PersistedEnumStorageLike | null, value: T) => T | null;
    subscribe: (callback: () => void, target?: EventTarget | null) => () => void;
    syncStorage: SyncStorage<T>;
    atom: ReturnType<typeof atomWithStorage<T>>;
};

export function createPersistedEnum<T extends string>(
    key: string,
    isValue: (value: unknown) => value is T,
    fallback: T
): PersistedEnum<T> {
    const read = (storage: PersistedEnumStorageLike | null): T => {
        if (storage == null) return fallback;
        try {
            const raw = storage.getItem(key);
            return isValue(raw) ? raw : fallback;
        } catch {
            return fallback;
        }
    };
    const write = (storage: PersistedEnumStorageLike | null, value: T): T | null => {
        if (storage == null || !isValue(value)) return null;
        try {
            storage.setItem(key, value);
            return value;
        } catch {
            return null;
        }
    };
    const subscribe = (
        callback: () => void,
        target: EventTarget | null = typeof window === "undefined" ? null : window
    ): (() => void) => {
        if (target == null || typeof target.addEventListener !== "function") {
            return () => {};
        }
        const handleStorage = (event: Event) => {
            const eventKey = (event as StorageEvent).key;
            if (eventKey != null && eventKey !== key) return;
            callback();
        };
        target.addEventListener("storage", handleStorage);
        return () => target.removeEventListener("storage", handleStorage);
    };
    const syncStorage: SyncStorage<T> = {
        getItem: () => read(getDefaultPersistedEnumStorage()),
        setItem: (_key, value) => {
            write(getDefaultPersistedEnumStorage(), value);
        },
        removeItem: () => {
            const storage = getDefaultPersistedEnumStorage();
            try {
                storage?.removeItem?.(key);
            } catch {
                // Ignore: a failed cleanup must not break rendering.
            }
        },
        subscribe: (_key, callback) => subscribe(() => callback(read(getDefaultPersistedEnumStorage()))),
    };
    return {
        key,
        default: fallback,
        read,
        write,
        subscribe,
        syncStorage,
        atom: atomWithStorage<T>(key, fallback, syncStorage, { getOnInit: true }),
    };
}

/**
 * 数值枚举版（例如时间窗 2/8/24/168 小时）：storage 里是字符串，读出来转回 number。
 * 和字符串版共用同一套「非法值回落 / 写失败不炸 / 跨窗口同步」语义。
 */
export type PersistedNumberEnum<T extends number> = {
    key: string;
    default: T;
    read: (storage: PersistedEnumStorageLike | null) => T;
    write: (storage: PersistedEnumStorageLike | null, value: T) => T | null;
    subscribe: (callback: () => void, target?: EventTarget | null) => () => void;
    syncStorage: SyncStorage<T>;
    atom: ReturnType<typeof atomWithStorage<T>>;
};

export function createPersistedNumberEnum<T extends number>(
    key: string,
    values: readonly T[],
    fallback: T
): PersistedNumberEnum<T> {
    const isValue = (value: unknown): value is T =>
        typeof value === "number" && (values as readonly number[]).includes(value);
    const parse = (raw: string | null): T => {
        const numeric = raw == null || raw.trim() === "" ? Number.NaN : Number(raw);
        return isValue(numeric) ? numeric : fallback;
    };
    const read = (storage: PersistedEnumStorageLike | null): T => {
        if (storage == null) return fallback;
        try {
            return parse(storage.getItem(key));
        } catch {
            return fallback;
        }
    };
    const write = (storage: PersistedEnumStorageLike | null, value: T): T | null => {
        if (storage == null || !isValue(value)) return null;
        try {
            storage.setItem(key, String(value));
            return value;
        } catch {
            return null;
        }
    };
    const subscribe = (
        callback: () => void,
        target: EventTarget | null = typeof window === "undefined" ? null : window
    ): (() => void) => {
        if (target == null || typeof target.addEventListener !== "function") {
            return () => {};
        }
        const handleStorage = (event: Event) => {
            const eventKey = (event as StorageEvent).key;
            if (eventKey != null && eventKey !== key) return;
            callback();
        };
        target.addEventListener("storage", handleStorage);
        return () => target.removeEventListener("storage", handleStorage);
    };
    const syncStorage: SyncStorage<T> = {
        getItem: () => read(getDefaultPersistedEnumStorage()),
        setItem: (_key, value) => {
            write(getDefaultPersistedEnumStorage(), value);
        },
        removeItem: () => {
            const storage = getDefaultPersistedEnumStorage();
            try {
                storage?.removeItem?.(key);
            } catch {
                // Ignore: a failed cleanup must not break rendering.
            }
        },
        subscribe: (_key, callback) => subscribe(() => callback(read(getDefaultPersistedEnumStorage()))),
    };
    return {
        key,
        default: fallback,
        read,
        write,
        subscribe,
        syncStorage,
        atom: atomWithStorage<T>(key, fallback, syncStorage, { getOnInit: true }),
    };
}
