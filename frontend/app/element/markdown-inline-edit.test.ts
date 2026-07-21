// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { resolveInlineEditTarget, type InlineEditSession } from "./markdown-inline-edit";

describe("markdown inline edit target", () => {
    it("resolves the current paragraph after React replaces the clicked element", () => {
        const staleTarget = { isConnected: false } as HTMLElement;
        const currentTarget = {} as HTMLElement;
        const querySelector = vi.fn(() => currentTarget);
        const viewport = {
            contains: vi.fn(() => false),
            querySelector,
        } as unknown as HTMLElement;
        const session = {
            blockKind: "p",
            startLine: 4,
            targetEl: staleTarget,
        } as InlineEditSession;

        expect(resolveInlineEditTarget(viewport, session)).toBe(currentTarget);
        expect(querySelector).toHaveBeenCalledWith('.markdown-render-root .paragraph[data-source-line="4"]');
    });

    it("keeps using the clicked element while it remains in the viewport", () => {
        const target = { isConnected: true } as HTMLElement;
        const querySelector = vi.fn();
        const viewport = {
            contains: vi.fn(() => true),
            querySelector,
        } as unknown as HTMLElement;
        const session = {
            blockKind: "h",
            startLine: 2,
            targetEl: target,
        } as InlineEditSession;

        expect(resolveInlineEditTarget(viewport, session)).toBe(target);
        expect(querySelector).not.toHaveBeenCalled();
    });
});
