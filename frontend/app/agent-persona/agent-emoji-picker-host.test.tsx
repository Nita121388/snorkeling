// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
    closeAgentEmojiPicker,
    getAgentEmojiPickerSnapshot,
    openAgentEmojiPicker,
    subscribeAgentEmojiPicker,
} from "./picker-host";

afterEach(() => {
    closeAgentEmojiPicker();
    vi.restoreAllMocks();
});

describe("agent emoji picker host store", () => {
    it("opens below the trigger when there is room", () => {
        openAgentEmojiPicker("block-1", "claude", { top: 100, bottom: 120, left: 40 });
        const state = getAgentEmojiPickerSnapshot();
        expect(state?.blockId).toBe("block-1");
        expect(state?.provider).toBe("claude");
        expect(state?.placement).toBe("bottom");
        expect(state?.anchor).toEqual({ top: 124, left: 40 });
        expect(state?.initialScope).toBe("block");
    });

    it("flips above when the trigger sits near the viewport bottom", () => {
        const original = window.innerHeight;
        Object.defineProperty(window, "innerHeight", { value: 400, configurable: true });
        try {
            openAgentEmojiPicker("block-2", "pi", { top: 390, bottom: 398, left: 10 });
            const state = getAgentEmojiPickerSnapshot();
            expect(state?.placement).toBe("top");
            expect(state?.anchor.top).toBe(386);
        } finally {
            Object.defineProperty(window, "innerHeight", { value: original, configurable: true });
        }
    });

    it("toggles closed when the same block icon is clicked again", () => {
        openAgentEmojiPicker("block-1", "claude", { top: 100, bottom: 120, left: 40 });
        openAgentEmojiPicker("block-1", "claude", { top: 100, bottom: 120, left: 40 });
        expect(getAgentEmojiPickerSnapshot()).toBeNull();
    });

    it("switches state when another block opens it", () => {
        openAgentEmojiPicker("block-1", "claude", { top: 100, bottom: 120, left: 40 });
        openAgentEmojiPicker("block-2", "pi", { top: 200, bottom: 220, left: 60 });
        expect(getAgentEmojiPickerSnapshot()?.blockId).toBe("block-2");
    });

    it("notifies subscribers on open/close", () => {
        const listener = vi.fn();
        const unsubscribe = subscribeAgentEmojiPicker(listener);
        openAgentEmojiPicker("block-1", "claude", { top: 100, bottom: 120, left: 40 });
        expect(listener).toHaveBeenCalledTimes(1);
        closeAgentEmojiPicker();
        expect(listener).toHaveBeenCalledTimes(2);
        // closing an already-closed picker is a no-op
        closeAgentEmojiPicker();
        expect(listener).toHaveBeenCalledTimes(2);
        unsubscribe();
    });

    it("supports an initial provider scope (right-click entry)", () => {
        openAgentEmojiPicker("block-1", "claude", { top: 100, bottom: 120, left: 40 }, "provider");
        expect(getAgentEmojiPickerSnapshot()?.initialScope).toBe("provider");
    });
});
