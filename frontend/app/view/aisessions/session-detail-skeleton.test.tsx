// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionDetailSkeleton } from "./session-detail-skeleton";

describe("SessionDetailSkeleton", () => {
    it("exposes loading semantics for assistive tech", () => {
        const html = renderToStaticMarkup(<SessionDetailSkeleton />);
        expect(html).toContain('role="status"');
        expect(html).toContain('aria-busy="true"');
        expect(html).toContain('aria-label="Loading conversation"');
    });

    it("renders the default number of placeholder rows", () => {
        const html = renderToStaticMarkup(<SessionDetailSkeleton />);
        // 每个占位行有一个角色点
        const dotCount = (html.match(/h-2 w-2 shrink-0 animate-pulse rounded-full/g) ?? []).length;
        expect(dotCount).toBe(6);
    });

    it("honors an explicit row count", () => {
        const html = renderToStaticMarkup(<SessionDetailSkeleton rows={2} />);
        const dotCount = (html.match(/h-2 w-2 shrink-0 animate-pulse rounded-full/g) ?? []).length;
        expect(dotCount).toBe(2);
    });

    it("never renders more rows than the palette defines", () => {
        const html = renderToStaticMarkup(<SessionDetailSkeleton rows={100} />);
        const dotCount = (html.match(/h-2 w-2 shrink-0 animate-pulse rounded-full/g) ?? []).length;
        expect(dotCount).toBe(6);
    });

    it("always renders at least one row", () => {
        const html = renderToStaticMarkup(<SessionDetailSkeleton rows={0} />);
        const dotCount = (html.match(/h-2 w-2 shrink-0 animate-pulse rounded-full/g) ?? []).length;
        expect(dotCount).toBe(1);
    });

    it("uses pulsing placeholders rather than real content", () => {
        const html = renderToStaticMarkup(<SessionDetailSkeleton />);
        expect(html).toContain("animate-pulse");
    });
});