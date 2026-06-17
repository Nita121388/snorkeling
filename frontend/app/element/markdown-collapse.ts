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
