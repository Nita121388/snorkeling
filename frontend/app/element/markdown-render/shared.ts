// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Shared helpers for the Markdown block renderers (P0 split). These are pure
 * functions / a React context / the Mermaid module singleton that several
 * block renderer components depend on. Keeping them here lets each block
 * component file import exactly what it needs without coupling to markdown.tsx.
 *
 * NOTE: this module must NOT import from markdown.tsx (no cycles). It only
 * depends on react and mermaid.
 */

import { Children, cloneElement, createContext, isValidElement, useContext } from "react";

// ---------------------------------------------------------------------------
// Source-coordinate helpers (data-source-line / data-source-line-end attrs)
// ---------------------------------------------------------------------------

export function getSourceLine(props: any): number | undefined {
    const line = props?.node?.position?.start?.line;
    return Number.isInteger(line) && line > 0 ? line : undefined;
}

// End line of the source span. Multi-line blocks (paragraphs/soft-broken across several
// source lines) get end > start; single-line blocks have end === start. Falls back to the
// start line so callers that only want the start can ignore the end entirely.
export function getSourceLineEnd(props: any): number | undefined {
    const start = getSourceLine(props);
    if (start == null) {
        return undefined;
    }
    const end = props?.node?.position?.end?.line;
    return Number.isInteger(end) && (end as number) >= start ? (end as number) : start;
}

// Emits both data-source-line (start) and, when distinct, data-source-line-end. The inline
// edit overlay reads the end attribute to slice multi-line paragraphs/headings back into a
// matching source range — without it a soft-broken paragraph collapses to its first line.
export function sourceLineAttrs(sourceLine?: number, endLine?: number): Record<string, number> {
    if (sourceLine == null) {
        return {};
    }
    const attrs: Record<string, number> = { "data-source-line": sourceLine };
    if (endLine != null && endLine !== sourceLine) {
        attrs["data-source-line-end"] = endLine;
    }
    return attrs;
}

// Convenience: derive {data-source-line, [data-source-line-end]} from a rehype node's position
// in one call. Use this at every block element that participates in inline editing so the
// start+end pair stays consistent across p/h/ul/ol/li/table/pre — adding a new block kind is
// a one-line `srcLineAttrs(props)` spread, no need to remember the end-attr fallback.
export function srcLineAttrs(props: any): Record<string, number> {
    return sourceLineAttrs(getSourceLine(props), getSourceLineEnd(props));
}

// ---------------------------------------------------------------------------
// React-node text helpers (used by list folding, code blocks, mermaid)
// ---------------------------------------------------------------------------

export const OrderedListContext = createContext(false);

export function getTextContent(children: React.ReactNode): string {
    if (typeof children === "string" || typeof children === "number") {
        return String(children);
    }
    if (Array.isArray(children)) {
        return children.map(getTextContent).join("");
    }
    if (isValidElement(children)) {
        return getTextContent((children.props as { children?: React.ReactNode }).children);
    }
    return "";
}

export function isLineBreakNode(node: React.ReactNode): boolean {
    return isValidElement(node) && node.type === "br";
}

export function isBlankTextNode(node: React.ReactNode): boolean {
    return typeof node === "string" && node.trim().length === 0;
}

export function trimBlankTextNodes(children: React.ReactNode[]): React.ReactNode[] {
    let startIndex = 0;
    let endIndex = children.length;
    while (startIndex < endIndex && isBlankTextNode(children[startIndex])) {
        startIndex++;
    }
    while (endIndex > startIndex && isBlankTextNode(children[endIndex - 1])) {
        endIndex--;
    }
    return children.slice(startIndex, endIndex);
}

export function cloneWithChildren(
    element: React.ReactElement,
    children: React.ReactNode[]
): React.ReactElement {
    return cloneElement(
        element as React.ReactElement<{ children?: React.ReactNode }>,
        undefined,
        children.length === 1 ? children[0] : children
    );
}

export function splitChildrenAtFirstBreak(children: React.ReactNode): {
    before: React.ReactNode[];
    after: React.ReactNode[];
} | null {
    const childArray = Children.toArray(children);
    const breakIndex = childArray.findIndex(isLineBreakNode);
    if (breakIndex < 0) {
        return null;
    }
    return {
        before: childArray.slice(0, breakIndex),
        after: childArray.slice(breakIndex + 1),
    };
}

export function splitOrderedListItemChildren(children: React.ReactNode): {
    summaryChildren: React.ReactNode[];
    bodyChildren: React.ReactNode[];
} {
    const childArray = trimBlankTextNodes(Children.toArray(children));
    if (childArray.length === 0) {
        return { summaryChildren: [], bodyChildren: [] };
    }

    // 紧凑列表（tight list）里 react-markdown 不会把 li 内容包成 <p>，
    // children 直接是 inline 序列 [text, code, text, ...]，可能夹杂 <br/>。
    // 我们对 children 数组本身直接按第一个 <br/> 切分：
    //   - 找到 br：br 之前是 summary，br 之后是 body（"soft break → 可折叠"语义）
    //   - 找不到 br：整段是 summary，没有 body（不要把"第一个 inline 节点之后"
    //     当成 body，那样会把紧跟 text 的 inline code 错误地切下去——见 repro）。
    // 对宽松列表（li 第一个孩子是 <p>），<p>.children 同样按这个规则切，
    // 因此先 unwrap paragraph 再 split，行为统一。
    //
    // 关键修复：br 之后的内容如果包含 <ul>/<ol> 等块级列表节点，
    // 它们会被 cloneWithChildren 错误地保留在 summary 中（因为它们
    // 出现在 br 之后、第一个非空文本之前）。这里在切分后、构建 summary
    // 之前，把 after 中开头的所有块级列表节点移到 body 头部，
    // 确保 summary 只包含内联文本。
    const firstChild = childArray[0];
    let inlineChildren: React.ReactNode[];
    let wrapper: React.ReactElement | null = null;
    if (isValidElement(firstChild) && firstChild.type === "p") {
        const paragraphChildren = Children.toArray((firstChild.props as { children?: React.ReactNode }).children);
        inlineChildren = paragraphChildren;
        wrapper = firstChild;
    } else {
        inlineChildren = childArray;
    }

    const breakIndex = inlineChildren.findIndex(isLineBreakNode);
    if (breakIndex < 0) {
        // 无 br：整段做 summary，无 body。tight list 的"shell `fork` 出..."
        // 不会被错误地从第一个 inline code 处切开。
        const summaryChildren = wrapper != null ? [cloneWithChildren(wrapper, inlineChildren)] : inlineChildren;
        return {
            summaryChildren: trimBlankTextNodes(summaryChildren),
            bodyChildren: [],
        };
    }

    const splitAfter = inlineChildren.slice(breakIndex + 1);
    const hasBody = splitAfter.some((child) => getTextContent(child).trim().length > 0);
    if (!hasBody) {
        // br 之后是空：整段做 summary。
        const summaryChildren =
            wrapper != null
                ? [cloneWithChildren(wrapper, inlineChildren.slice(0, breakIndex))]
                : inlineChildren.slice(0, breakIndex);
        return {
            summaryChildren: trimBlankTextNodes(summaryChildren),
            bodyChildren: [],
        };
    }

    const before = inlineChildren.slice(0, breakIndex);
    const after = inlineChildren.slice(breakIndex + 1);
    // Move any leading block-level list nodes from after into bodyHead.
    // These are <ul>/<ol> that were siblings of the <br/> and must not
    // end up in the summary (cloneWithChildren preserves them in summary).
    let bodyHead: React.ReactNode[] = [];
    let afterForSummary = after;
    while (afterForSummary.length > 0) {
        const node = afterForSummary[0];
        if (isValidElement(node) && (node.type === "ul" || node.type === "ol")) {
            bodyHead.push(afterForSummary.shift()!);
        } else {
            break;
        }
    }
    const summaryChildren = wrapper != null ? [cloneWithChildren(wrapper, before)] : before;
    // body 拼接规则：
    //   - loose list（wrapper != null）：inlineChildren = unwrap(<p>) 的内部 children，
    //     只覆盖第一个 <p> 里的内容；<li> 顶层兄弟（如子列表 <ul>）由 childArray.slice(1) 补回。
    //   - tight list（wrapper == null）：inlineChildren = childArray 本身，
    //     <br/> 之后的 after 已经包含所有顶层节点（含子列表 <ul>），再 concat(childArray.slice(1)) 会重复。
    const bodyBase = bodyHead.concat(wrapper != null ? [cloneWithChildren(wrapper, afterForSummary)] : afterForSummary);
    const bodyChildren = trimBlankTextNodes(wrapper != null ? bodyBase.concat(childArray.slice(1)) : bodyBase);
    return {
        summaryChildren: trimBlankTextNodes(summaryChildren),
        bodyChildren,
    };
}

export function getOrderedListItemId(props: React.LiHTMLAttributes<HTMLLIElement>): string {
    const sourceLine = getSourceLine(props);
    if (sourceLine != null) {
        return String(sourceLine);
    }
    return getTextContent(props.children);
}

// ---------------------------------------------------------------------------
// Mermaid module singleton (shared by CodeBlock's inline mermaid + Mermaid block)
// ---------------------------------------------------------------------------

let mermaidInitialized = false;
let mermaidInstance: any = null;

export const initializeMermaid = async () => {
    if (!mermaidInitialized) {
        const mermaid = await import("mermaid");
        mermaidInstance = mermaid.default;
        mermaidInstance.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
        mermaidInitialized = true;
    }
};

export function getMermaidInstance(): any {
    return mermaidInstance;
}
