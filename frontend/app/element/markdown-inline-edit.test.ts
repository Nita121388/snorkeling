// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import {
    resolveInlineEditTarget,
    spliceInsertBlock,
    type InlineEditSession,
} from "./markdown-inline-edit";

describe("markdown inline edit target", () => {
    it("resolves the current block after React replaces the clicked element, kind-agnostic", () => {
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
        // p/h/ul/ol/li/table/pre all carry data-source-line; the resolver no longer special-cases
        // block class — it queries by attribute alone so list/table/code blocks resolve too.
        expect(querySelector).toHaveBeenCalledWith('.markdown-render-root [data-source-line="4"]');
    });

    it("resolves list/table/code blocks through the same generic selector", () => {
        const target = {} as HTMLElement;
        const querySelector = vi.fn(() => target);
        const viewport = {
            contains: vi.fn(() => false),
            querySelector,
        } as unknown as HTMLElement;
        for (const blockKind of ["list", "table", "code"] as const) {
            querySelector.mockClear();
            const session = { blockKind, startLine: 9, targetEl: { isConnected: false } as HTMLElement } as InlineEditSession;
            expect(resolveInlineEditTarget(viewport, session)).toBe(target);
            expect(querySelector).toHaveBeenCalledWith('.markdown-render-root [data-source-line="9"]');
        }
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

describe("spliceInsertBlock (block-edge insert buttons)", () => {
    const lines = ["# title", "", "hello", "", "tail"];

    it("inserts below the anchor line, bracketed by a blank line", () => {
        const next = spliceInsertBlock(lines, 3, "after", ["new"]);
        expect(next).toEqual(["# title", "", "hello", "", "new", "", "tail"]);
    });

    it("inserts above the anchor line, bracketed by a blank line", () => {
        const next = spliceInsertBlock(lines, 3, "before", ["new"]);
        expect(next).toEqual(["# title", "", "new", "", "hello", "", "tail"]);
    });

    it("keeps multi-line drafts verbatim (blank lines inside the draft stay)", () => {
        const next = spliceInsertBlock(lines, 3, "after", ["a", "", "b"]);
        expect(next).toEqual(["# title", "", "hello", "", "a", "", "b", "", "tail"]);
    });

    it("clamps out-of-range anchor lines", () => {
        expect(spliceInsertBlock(lines, 99, "after", ["x"])).toEqual([
            "# title",
            "",
            "hello",
            "",
            "tail",
            "",
            "x",
        ]);
    });
});
