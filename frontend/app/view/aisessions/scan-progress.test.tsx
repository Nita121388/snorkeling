// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScanProgressStrip, SkeletonSessionRows } from "./scan-progress";

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

describe("ScanProgressStrip", () => {
    it("announces progress politely while busy", () => {
        const html = renderToStaticMarkup(<ScanProgressStrip scanned={320} total={1617} />);
        expect(html).toContain('role="status"');
        expect(html).toContain('aria-live="polite"');
        expect(html).toContain('aria-busy="true"');
        expect(html).toContain('data-testid="aisessions-scan-progress"');
    });

    it("shows the scanned/total counter and percentage", () => {
        const html = renderToStaticMarkup(<ScanProgressStrip scanned={320} total={1600} />);
        expect(html).toContain("Syncing sessions 320/1600");
        expect(html).toContain("20%");
    });

    it("omits the percentage when the total is unknown", () => {
        const html = renderToStaticMarkup(<ScanProgressStrip scanned={0} total={0} />);
        expect(html).toContain("Syncing sessions");
        expect(html).not.toContain("0/0");
        expect(html).not.toContain("%");
    });

    it("clamps the percentage at 100", () => {
        const html = renderToStaticMarkup(<ScanProgressStrip scanned={2000} total={1600} />);
        expect(html).toContain("100%");
        expect(html).not.toContain("125%");
    });
});
