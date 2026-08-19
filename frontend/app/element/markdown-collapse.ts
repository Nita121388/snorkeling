// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export function shouldHideMarkdownElementForCollapsedHeadings(
    elementHeadingLevel: number | null,
    elementHeadingId: string | null,
    collapsedHeadingIds: Set<string>,
    collapsedHeadingStack: number[]
): boolean {
    while (
        elementHeadingLevel != null &&
        collapsedHeadingStack.length > 0 &&
        elementHeadingLevel <= collapsedHeadingStack[collapsedHeadingStack.length - 1]
    ) {
        collapsedHeadingStack.pop();
    }

    const hidden = collapsedHeadingStack.length > 0;

    if (elementHeadingLevel != null && elementHeadingId != null && collapsedHeadingIds.has(elementHeadingId)) {
        collapsedHeadingStack.push(elementHeadingLevel);
    }

    return hidden;
}

/**
 * Batch form of the collapsed-heading walk over an ordered list of top-level markdown blocks:
 * returns one `hidden` flag per element (true = lives inside a collapsed section). Extracted so
 * the preview can drive `.collapsed-hidden` from a single pass and the algorithm is testable in
 * isolation (no DOM). `elements` may be derived from DOM children or from rendered block data.
 */
export function computeCollapsedHiddenFlags(
    elements: ReadonlyArray<{ level: number | null; id: string | null }>,
    collapsedHeadingIds: Set<string>
): boolean[] {
    const collapsedHeadingStack: number[] = [];
    return elements.map((elem) =>
        shouldHideMarkdownElementForCollapsedHeadings(elem.level, elem.id, collapsedHeadingIds, collapsedHeadingStack)
    );
}

/**
 * Picks the top-level block the viewport should stay pinned to when a collapsed-
 * heading visibility change shrinks the document height. Collapsing hides blocks
 * with display:none, which makes Chromium's own scroll anchoring pick a wrong or
 * missing anchor and jump the view to the document top/bottom.
 *
 * Rule: the first block that (a) survives the change and (b) sits at or below the
 * viewport top (pre-toggle rect.bottom). If the whole viewport lies inside the
 * newly-hidden region, fall back to the first surviving block anywhere — the view
 * then scrolls back up to the collapsed section boundary. Returns null when every
 * block is hidden (nothing left to pin to — let the browser clamp).
 */
export function findCollapsedScrollPinIndex(
    flags: readonly boolean[],
    preToggleBottoms: ReadonlyArray<number>,
    viewportTop: number
): number | null {
    const atOrBelowViewport = flags.findIndex((hidden, i) => !hidden && preToggleBottoms[i] > viewportTop);
    if (atOrBelowViewport >= 0) {
        return atOrBelowViewport;
    }
    const firstSurvivor = flags.findIndex((hidden) => !hidden);
    return firstSurvivor >= 0 ? firstSurvivor : null;
}
