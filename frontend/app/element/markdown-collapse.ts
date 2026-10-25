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
 * Picks the block the viewport should stay pinned to when a heading collapse/expand changes
 * the document height. Whatever the browser does natively (scroll anchoring) is disabled on
 * the scroll container (`overflow-anchor: none`), so this index is the single source of truth
 * for whether scrollTop moves at all.
 *
 * Rule: the first block that is (a) still visible after the toggle and (b) *starts* inside the
 * viewport — `viewportTop <= preTop < viewportBottom`. Its measured top delta is then applied
 * to scrollTop, which cancels the shift.
 *
 * Why "starts inside the viewport" and not "first block below the viewport top" (the previous
 * rule): a block below the fold is not what the reader is looking at, but it still slides up by
 * the collapsed height, so compensating its delta scrolled the whole page by that height — the
 * collapse-jumps-a-screen bug. With this rule:
 *
 * - collapse a section whose content lies below the fold → nothing visible moves → null → 0
 * - collapse/expand a section above the viewport → the first visible block's delta is exactly
 *   the height restored/removed above it → cancels the jump
 * - collapse the section the reader is inside → no surviving block starts in the viewport →
 *   null → the page does not scroll, the following content just rises into place
 *
 * Returns null when no compensation should be applied.
 */
export function findCollapsedScrollAnchorIndex(
    hiddenAfter: readonly boolean[],
    preToggleTops: readonly number[],
    viewportTop: number,
    viewportBottom: number
): number | null {
    for (let i = 0; i < hiddenAfter.length; i++) {
        if (hiddenAfter[i]) {
            continue;
        }
        const top = preToggleTops[i];
        if (!Number.isFinite(top) || top < viewportTop) {
            // Hidden, or straddling / above the fold: not the block the reader is on.
            continue;
        }
        if (top >= viewportBottom) {
            // The first surviving block already starts below the viewport, so nothing the
            // reader can see has moved. Compensating here is what used to yank the page.
            return null;
        }
        return i;
    }
    return null;
}
