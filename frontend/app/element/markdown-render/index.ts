// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Public entry for the P0 block-renderer split. markdown.tsx imports from here
 * instead of inlining block renderers.
 */

export {
    buildMarkdownComponents,
    getMarkdownRenderer,
    listMarkdownRenderers,
    registerMarkdownRenderer,
    resetMarkdownRenderersForTests,
    type MarkdownRenderContext,
    type MarkdownRendererSpec,
} from "./renderer-registry";

export { CollapsibleHeading, type HeadingProps } from "./heading";
export {
    CollapsibleOrderedListItem,
    MarkdownListItem,
    MarkdownOrderedList,
    MarkdownTaskCheckbox,
    MarkdownUnorderedList,
} from "./list";
export { CollapsibleTable } from "./table";
export { Code, Mermaid } from "./mermaid";
export { CodeBlock, type CodeBlockProps } from "./code-block";
export { MarkdownImg, MarkdownSource } from "./image";
export { Link, MarkdownLinkEditor, MarkdownLinkTooltip, shouldOpenMarkdownLinkInNewBlock } from "./link";
export { WaveBlock, type WaveBlockProps } from "./waveblock";
export {
    getOrderedListItemId,
    getSourceLine,
    getSourceLineEnd,
    getTextContent,
    OrderedListContext,
    sourceLineAttrs,
    splitOrderedListItemChildren,
    srcLineAttrs,
} from "./shared";