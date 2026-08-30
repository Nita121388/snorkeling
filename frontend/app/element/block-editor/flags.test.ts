// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, test } from "vitest";
import { blockEditorFlags, isBlockEditorFeatureEnabled, resetBlockEditorFlagsForTests } from "./flags";

// node test env has no localStorage — everything must fall back to defaults-on.
describe("block-editor flags", () => {
    beforeEach(() => resetBlockEditorFlagsForTests());

    test("all features default ON (no storage)", () => {
        const flags = blockEditorFlags();
        expect(Object.values(flags).every(Boolean)).toBe(true);
        expect(isBlockEditorFeatureEnabled("slash")).toBe(true);
        expect(isBlockEditorFeatureEnabled("toolbar")).toBe(true);
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
