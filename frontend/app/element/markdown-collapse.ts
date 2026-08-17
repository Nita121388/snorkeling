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
