// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const visual = readFileSync(new URL("./waveaivisual.tsx", import.meta.url), "utf8");

/**
 * Contract tests for the Wave AI modes editor. These guard the behaviours the
 * design review called out — they are cheap source assertions rather than
 * render tests because the component depends on RPC services and jotai atoms.
 */
describe("Wave AI modes editor contracts", () => {
    it("does not use native browser dialogs", () => {
        expect(visual).not.toContain("window.confirm");
        expect(visual).not.toContain("window.alert");
        expect(visual).not.toContain("window.location.reload");
    });

    it("does not use the theme-blind surface tokens", () => {
        // bg-surface* compiles to a literal white rgba and ignores light themes.
        expect(visual).not.toMatch(/\bbg-surface(?:-soft|-strong)?\b/);
    });

    it("routes confirmations and errors through the modal system", () => {
        expect(visual).toContain("modalsModel.pushModal");
        expect(visual).toContain('"ConfirmModal"');
        expect(visual).toContain('"MessageModal"');
    });

    it("reuses the shared inline rename input", () => {
        expect(visual).toContain("@/app/element/inline-rename-input");
        expect(visual).toContain("<InlineRenameInput");
    });

    it("keeps disabled controls off the not-allowed cursor", () => {
        expect(visual).not.toContain("cursor-not-allowed");
    });

    it("passes the mode's api token to both probe buttons", () => {
        // "Test connection" and "Fetch models" must use the same token priority
        // as the chat path, so both handlers forward ai:apitoken to the backend.
        const occurrences = visual.split('apiToken: form["ai:apitoken"]').length - 1;
        expect(occurrences).toBeGreaterThanOrEqual(2);
    });
});