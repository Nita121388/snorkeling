// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, afterEach, vi } from "vitest";
import { loadStoredExportOptions } from "./export-options-modal";
import { defaultExportOptions } from "./export-provider";

// Node 测试环境没有 window.localStorage —— 手动注入 mock 后再 stub 到 globalThis.window。
function createLocalStorageMock(): Storage {
    const store = new Map<string, string>();
    return {
        get length() {
            return store.size;
        },
        clear: () => store.clear(),
        getItem: (key: string) => store.get(key) ?? null,
        key: (index: number) => [...store.keys()][index] ?? null,
        removeItem: (key: string) => store.delete(key),
        setItem: (key: string, value: string) => store.set(key, value),
    };
}

describe("loadStoredExportOptions", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("returns defaults when nothing is stored", () => {
        const mockStorage = createLocalStorageMock();
        vi.stubGlobal("window", { localStorage: mockStorage });
        const opts = loadStoredExportOptions();
        expect(opts).toEqual(defaultExportOptions);
    });

    it("returns defaults on invalid JSON", () => {
        const mockStorage = createLocalStorageMock();
        mockStorage.setItem("snorkeling:markdown-export-options", "not-json!!!");
        vi.stubGlobal("window", { localStorage: mockStorage });
        const opts = loadStoredExportOptions();
        expect(opts).toEqual(defaultExportOptions);
    });

    it("restores saved includeFrontmatter=false", () => {
        const mockStorage = createLocalStorageMock();
        mockStorage.setItem("snorkeling:markdown-export-options", '{"includeFrontmatter":false}');
        vi.stubGlobal("window", { localStorage: mockStorage });
        const opts = loadStoredExportOptions();
        expect(opts.includeFrontmatter).toBe(false);
        expect(opts.includeToc).toBe(defaultExportOptions.includeToc);
        expect(opts.darkTheme).toBe(defaultExportOptions.darkTheme);
    });

    it("restores all saved options", () => {
        const mockStorage = createLocalStorageMock();
        mockStorage.setItem(
            "snorkeling:markdown-export-options",
            JSON.stringify({
                includeFrontmatter: false,
                includeToc: true,
                darkTheme: true,
                inlineImages: true,
                bodyOnly: true,
            })
        );
        vi.stubGlobal("window", { localStorage: mockStorage });
        const opts = loadStoredExportOptions();
        expect(opts.includeFrontmatter).toBe(false);
        expect(opts.includeToc).toBe(true);
        expect(opts.darkTheme).toBe(true);
        expect(opts.inlineImages).toBe(true);
        expect(opts.bodyOnly).toBe(true);
    });
});
