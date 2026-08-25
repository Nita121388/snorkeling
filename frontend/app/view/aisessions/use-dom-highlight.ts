// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Text-level search highlighting over arbitrary rendered DOM (markdown output,
// shiki code spans…) via the CSS Custom Highlight API. No DOM mutation, so
// React / markdown re-renders are never fought with wrapped <mark> nodes.
// Graceful no-op when the API is unavailable (pre-Chromium-105 webviews).
//
// ponytail: matches within single text nodes; a query spanning element
// boundaries (e.g. across **bold** markers) highlights each segment
// separately. Cap of 200 ranges per message guards pathological inputs.
// Upgrade path: multi-node Ranges if cross-element matching ever matters.

import { useEffect, type RefObject } from "react";

const supported = typeof CSS !== "undefined" && CSS != null && "highlights" in CSS;

/**
 * Register search-match highlights for all text under `containerRef`.
 *
 * - `key` must be unique per message (the CSS.highlights registry is a global
 *   singleton; keys are cleaned up on unmount/disable).
 * - Re-runs when `query`, `enabled`, or `contentVersion` changes — pass e.g.
 *   the streaming text itself as `contentVersion` to keep up with live turns.
 */
export function useDomTextHighlight(
    key: string,
    containerRef: RefObject<HTMLElement | null>,
    query: string,
    enabled: boolean,
    contentVersion?: unknown
) {
    useEffect(() => {
        if (!supported || !CSS.highlights) {
            return;
        }
        const q = query.trim().toLowerCase();
        if (!enabled || q === "" || containerRef.current == null) {
            CSS.highlights.delete(key);
            return;
        }
        const ranges: Range[] = [];
        const walker = document.createTreeWalker(containerRef.current, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node != null; node = walker.nextNode()) {
            const text = node.nodeValue ?? "";
            if (text.length === 0) continue;
            const lower = text.toLowerCase();
            let idx = lower.indexOf(q);
            while (idx >= 0 && ranges.length < 200) {
                const range = new Range();
                range.setStart(node, idx);
                range.setEnd(node, idx + q.length);
                ranges.push(range);
                idx = lower.indexOf(q, idx + q.length);
            }
        }
        if (ranges.length === 0) {
            CSS.highlights.delete(key);
            return;
        }
        CSS.highlights.set(key, new Highlight(...ranges));
        return () => {
            CSS.highlights.delete(key);
        };
    }, [key, containerRef, query, enabled, contentVersion]);
}
