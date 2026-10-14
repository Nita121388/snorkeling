// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, test } from "vitest";
import { blockEditorFlags, isBlockEditorFeatureEnabled, resetBlockEditorFlagsForTests } from "./flags";

// node test env has no localStorage — everything must fall back to defaults-on.
describe("block-editor flags", () => {
    beforeEach(() => resetBlockEditorFlagsForTests());

    test("all features default ON (no storage), including wysiwyg-inplace", () => {
        const flags = blockEditorFlags();
        // A3 切片 4：wysiwyg-inplace 转正为默认开（沙箱 p/h/quote/callout/ul/ol 实测 0 差异）。
        // 默认关的集合现在是**空集**；若以后新增双轨 feature，它会进这里，不再是空集。
        expect(Object.entries(flags).every(([, v]) => Boolean(v))).toBe(true);
        expect(flags["wysiwyg-inplace"]).toBe(true);
        expect(isBlockEditorFeatureEnabled("slash")).toBe(true);
        expect(isBlockEditorFeatureEnabled("toolbar")).toBe(true);
    });

    test("explicit off in storage still disables wysiwyg-inplace (双轨回退开关仍在)", () => {
        // 转正只改**缺省值**：显式写 off 仍能回退到 overlay，这是上线后的回滚阀。
        const store = new Map<string, string>([["snorkeling:block-editor:wysiwyg-inplace", "off"]]);
        (globalThis as any).window = {
            localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: () => {} },
        };
        resetBlockEditorFlagsForTests();
        expect(isBlockEditorFeatureEnabled("wysiwyg-inplace")).toBe(false);
        expect(isBlockEditorFeatureEnabled("wysiwyg")).toBe(true);
    });

    test("master switch gates sub-features", () => {
        // simulate: master off via injected storage
        const store = new Map<string, string>();
        (globalThis as any).window = {
            localStorage: {
                getItem: (k: string) => store.get(k) ?? null,
                setItem: () => {},
            },
        };
        try {
            store.set("snorkeling:block-editor:blockeditor", "off");
            store.set("snorkeling:block-editor:slash", "on");
            resetBlockEditorFlagsForTests();
            expect(isBlockEditorFeatureEnabled("blockeditor")).toBe(false);
            expect(isBlockEditorFeatureEnabled("slash")).toBe(false); // master forces off
        } finally {
            delete (globalThis as any).window;
            resetBlockEditorFlagsForTests();
        }
    });

    test("per-feature off", () => {
        const store = new Map<string, string>();
        (globalThis as any).window = {
            localStorage: {
                getItem: (k: string) => store.get(k) ?? null,
                setItem: () => {},
            },
        };
        try {
            store.set("snorkeling:block-editor:toolbar", "off");
            resetBlockEditorFlagsForTests();
            expect(isBlockEditorFeatureEnabled("toolbar")).toBe(false);
            expect(isBlockEditorFeatureEnabled("slash")).toBe(true);
        } finally {
            delete (globalThis as any).window;
            resetBlockEditorFlagsForTests();
        }
    });
});
