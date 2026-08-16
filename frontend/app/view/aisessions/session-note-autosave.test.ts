// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { NoteAutoSaveDelayMs, shouldAutoSaveNote } from "./session-note-autosave";

describe("shouldAutoSaveNote", () => {
    it("saves only when the editor is loaded, visible, has changes, and is not already saving", () => {
        const base = { loaded: true, visible: true, unchanged: false, saving: false };
        expect(shouldAutoSaveNote(base)).toBe(true);
        expect(shouldAutoSaveNote({ ...base, loaded: false })).toBe(false);
        expect(shouldAutoSaveNote({ ...base, visible: false })).toBe(false);
        expect(shouldAutoSaveNote({ ...base, unchanged: true })).toBe(false);
        expect(shouldAutoSaveNote({ ...base, saving: true })).toBe(false);
    });

    it("keeps the debounce delay at 3s so the three editors stay in sync", () => {
        expect(NoteAutoSaveDelayMs).toBe(3000);
    });
});