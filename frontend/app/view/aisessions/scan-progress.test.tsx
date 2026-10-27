// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkeletonSessionRows } from "./scan-progress";

describe("SkeletonSessionRows", () => {
    it("is hidden from assistive tech and never focusable", () => {
        const html = renderToStaticMarkup(<SkeletonSessionRows />);
        expect(html).toContain('aria-hidden="true"');
        expect(html).toContain('data-testid="aisessions-scan-skeleton"');
        expect(html).not.toContain("<button");
        expect(html).not.toContain("tabindex");
    });

    it("renders the default six placeholder rows", () => {
        const html = renderToStaticMarkup(<SkeletonSessionRows />);
        expect(html).toContain('data-testid="aisessions-scan-skeleton"');
        const rowCount = (html.match(/border-b border-border bg-block-solid/g) ?? []).length;
        expect(rowCount).toBe(6);
    });

    it("honors an explicit row count", () => {
        const html = renderToStaticMarkup(<SkeletonSessionRows rows={2} />);
        const rowCount = (html.match(/border-b border-border bg-block-solid/g) ?? []).length;
        expect(rowCount).toBe(2);
    });
});
