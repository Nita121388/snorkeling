// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CopyButton } from "@/app/element/copybutton";
import { ImageLightbox } from "@/app/element/image-lightbox";
import { shouldHideMarkdownElementForCollapsedHeadings } from "@/app/element/markdown-collapse";
import {
    InlineEditOverlay,
    makeInlineEditKeydown,
    deleteBlockRange,
    replaceSourceRange,
    spliceBlankRow,
    spliceInsertBlock,
    splitBlockAtCaretText,
    useInlineEdit,
    type InlineEditBlockKind,
} from "@/app/element/markdown-inline-edit";
import { MarkdownOutline, type MarkdownOutlineItem } from "@/app/element/markdown-outline";
import {
    MarkdownContentBlockType,
    editImageSyntaxInFullText,
    removeImageSyntaxInLine,
    replaceImageSrcInLine,
    resolveRemoteFile,
    resolveSrcSet,
    transformBlocks,
} from "@/app/element/markdown-util";
import { makeRemarkPlugins } from "@/app/element/remark";
import remarkFrontmatterToWaveBlock from "@/app/element/remark/frontmatter-to-waveblock";
export { linkifyMarkdownFileReferences } from "@/app/element/remark";
import { getMarkdownHeadings } from "@/app/monaco/markdown-folding";
import { boundNumber, cn, useAtomValueSafe } from "@/util/util";
import clsx from "clsx";
import { atom, Atom, useAtomValue } from "jotai";
import { loadable } from "jotai/utils";
import ReactDOM from "react-dom";

// Stable no-op atom used when callers omit `textAtom` — keeps the `useAtomValue(loadable(...))`
// call unconditional so the Rules of Hooks remain satisfied below.
const NullStringAtom = atom<string | null>(null);
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import {
    Children,
    cloneElement,
    createContext,
    isValidElement,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import ReactMarkdown, { Components, defaultUrlTransform } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import { openLink } from "../store/global";
import { ContextMenuModel } from "../store/contextmenu";
import { RpcApi } from "../store/wshclientapi";
import { TabRpcClient } from "../store/wshrpcutil";
import { formatRemoteUri } from "@/util/waveutil";
import { arrayToBase64, stringToBase64 } from "@/util/util";
import {
    makeMarkdownWikiLinkHref,
    normalizeLinkedFilePath,
    openFileLinkInPreview,
    parseMarkdownFileLineReference,
    parseMarkdownWikiLink,
} from "../view/preview/file-link-navigation";
import { IconButton } from "./iconbutton";
import "./markdown.scss";

function isLiveScrollDebugEnabled(): boolean {
    return typeof window !== "undefined" && window.localStorage?.getItem("snorkelingLiveScrollDebug") === "1";
}

function liveScrollDebug(message: string, details: Record<string, unknown> = {}) {
    if (!isLiveScrollDebugEnabled()) {
        return;
    }
    console.info("[live-scroll]", message, details);
}

// Soft-breaks, file-refs, and blank-line spacers live in the remark/ directory
// (`frontend/app/element/remark/`) so new pipeline stages can be added without
// growing this file. `makeRemarkPlugins` assembles the full chain.

export function shouldOpenMarkdownLinkInNewBlock(event: Pick<React.MouseEvent, "ctrlKey" | "metaKey">): boolean {
    return event.ctrlKey || event.metaKey;
}

let mermaidInitialized = false;
let mermaidInstance: any = null;

const initializeMermaid = async () => {
    if (!mermaidInitialized) {
        const mermaid = await import("mermaid");
        mermaidInstance = mermaid.default;
        mermaidInstance.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
        mermaidInitialized = true;
    }
};

const Link = ({
    focusHeading,
    props,
    resolveOpts,
}: {
    props: React.AnchorHTMLAttributes<HTMLAnchorElement>;
    focusHeading: (href: string) => void;
    resolveOpts?: MarkdownResolveOpts;
}) => {
    const onClick = (e: React.MouseEvent) => {
        const href = props.href ?? "";
        const forceNewBlock = shouldOpenMarkdownLinkInNewBlock(e);
        const onOpenPath = resolveOpts?.openLink
            ? (path: string, lineNumber: number | null) =>
                  resolveOpts.openLink(path, { lineNumber, forceNewBlock })
            : undefined;
        e.preventDefault();
        if (href.startsWith("#")) {
            focusHeading(href);
        } else {
            const wikiLink = parseMarkdownWikiLink(href);
            if (wikiLink != null) {
                void openFileLinkInPreview(wikiLink.target, {
                    connection: resolveOpts?.connName,
                    baseDir: resolveOpts?.baseDir,
                    openDirectoryIndex: true,
                    heading: wikiLink.heading,
                    onOpenPath,
                }).then((opened) => {
                    if (!opened) {
                        openLink(href);
                    }
                });
                return;
            }
            const fileReference = parseMarkdownFileLineReference(href);
            void openFileLinkInPreview(fileReference?.filePath ?? href, {
                connection: resolveOpts?.connName,
                baseDir: resolveOpts?.baseDir,
                openDirectoryIndex: true,
                lineNumber: fileReference?.lineNumber,
                onOpenPath,
            }).then((opened) => {
                if (!opened) {
                    openLink(href);
                }
            });
        }
    };
    return (
        <a href={props.href} onClick={onClick} className="text-accent hover:underline">
            {props.children}
        </a>
    );
};

const FilePathHrefProtocols = [
    ...(defaultSchema.protocols?.href ?? []),
    "file",
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
];

function markdownUrlTransform(value: string): string {
    if (value.startsWith("wave-wiki:")) {
        return value;
    }
    if (normalizeLinkedFilePath(value) != null) {
        return value;
    }
    return defaultUrlTransform(value);
}

function decodeHeadingFragment(fragment: string): string {
    try {
        return decodeURIComponent(fragment);
    } catch {
        return fragment;
    }
}

function getHeadingIdFromHref(idPrefix: string, href: string): string {
    return idPrefix + decodeHeadingFragment(href.slice(1));
}

const ScrollTargetTopOffset = 24;
const ScrollTargetTolerancePx = 3;
const ProgrammaticScrollIgnoreMs = 120;
const InitialScrollRevealFallbackMs = 150;
const ScrollTextMatchWindow = 4;
const BottomCompensationStepPx = 80;

function normalizeScrollTargetText(text: string): string {
    return text
        .replace(/^[\s#>*+\-.`~[\]()!]+/, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function getElementTextForScrollMatch(elem: HTMLElement): string {
    return normalizeScrollTargetText(elem.textContent ?? "");
}

function getSourceLine(props: any): number | undefined {
    const line = props?.node?.position?.start?.line;
    return Number.isInteger(line) && line > 0 ? line : undefined;
}

// End line of the source span. Multi-line blocks (paragraphs/soft-broken across several
// source lines) get end > start; single-line blocks have end === start. Falls back to the
// start line so callers that only want the start can ignore the end entirely.
function getSourceLineEnd(props: any): number | undefined {
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
function sourceLineAttrs(sourceLine?: number, endLine?: number): Record<string, number> {
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
function srcLineAttrs(props: any): Record<string, number> {
    return sourceLineAttrs(getSourceLine(props), getSourceLineEnd(props));
}

const OrderedListContext = createContext(false);

function getTextContent(children: React.ReactNode): string {
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

function isLineBreakNode(node: React.ReactNode): boolean {
    return isValidElement(node) && node.type === "br";
}

function isBlankTextNode(node: React.ReactNode): boolean {
    return typeof node === "string" && node.trim().length === 0;
}

function trimBlankTextNodes(children: React.ReactNode[]): React.ReactNode[] {
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

function cloneWithChildren(element: React.ReactElement, children: React.ReactNode[]): React.ReactElement {
    return cloneElement(
        element as React.ReactElement<{ children?: React.ReactNode }>,
        undefined,
        children.length === 1 ? children[0] : children
    );
}

function splitChildrenAtFirstBreak(children: React.ReactNode): {
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
        const summaryChildren = wrapper != null
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
    const bodyBase = bodyHead.concat(
        wrapper != null ? [cloneWithChildren(wrapper, afterForSummary)] : afterForSummary
    );
    const bodyChildren = trimBlankTextNodes(
        wrapper != null ? bodyBase.concat(childArray.slice(1)) : bodyBase
    );
    return {
        summaryChildren: trimBlankTextNodes(summaryChildren),
        bodyChildren,
    };
}

function getOrderedListItemId(props: React.LiHTMLAttributes<HTMLLIElement>): string {
    const sourceLine = getSourceLine(props);
    if (sourceLine != null) {
        return String(sourceLine);
    }
    return getTextContent(props.children);
}

type HeadingProps = {
    props: React.HTMLAttributes<HTMLHeadingElement>;
    hnum: number;
    collapsed: boolean;
    onToggle: (headingId: string) => void;
};

const CollapsibleHeading = ({ props, hnum, collapsed, onToggle }: HeadingProps) => {
    const headingId = typeof props.id === "string" ? props.id : "";
    return (
        <div
            id={props.id}
            className={clsx("heading", `is-${hnum}`, { collapsed })}
            data-heading-level={hnum}
            data-heading-id={headingId}
            {...srcLineAttrs(props)}
        >
            <button
                type="button"
                className="heading-collapse-button"
                title={collapsed ? "Expand section" : "Collapse section"}
                aria-label={collapsed ? "Expand section" : "Collapse section"}
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (headingId) {
                        onToggle(headingId);
                    }
                }}
            >
                <i className={clsx("fa-sharp fa-solid", collapsed ? "fa-chevron-right" : "fa-chevron-down")} />
            </button>
            <span className="heading-title">{props.children}</span>
        </div>
    );
};

const MarkdownOrderedList = ({
    props,
    collapsible,
}: {
    props: React.OlHTMLAttributes<HTMLOListElement>;
    collapsible: boolean;
}) => (
    <OrderedListContext.Provider value={collapsible}>
        <ol {...props} {...srcLineAttrs(props)} />
    </OrderedListContext.Provider>
);

const MarkdownUnorderedList = (props: React.HTMLAttributes<HTMLUListElement>) => (
    <OrderedListContext.Provider value={false}>
        <ul {...props} {...srcLineAttrs(props)} />
    </OrderedListContext.Provider>
);

const CollapsibleOrderedListItem = ({
    props,
    collapsed,
    onToggle,
}: {
    props: React.LiHTMLAttributes<HTMLLIElement>;
    collapsed: boolean;
    onToggle: (itemId: string) => void;
}) => {
    const sourceLine = getSourceLine(props);
    const itemId = getOrderedListItemId(props);
    const { summaryChildren, bodyChildren } = splitOrderedListItemChildren(props.children);
    const canCollapse = bodyChildren.length > 0 && itemId.length > 0;
    if (!canCollapse) {
        return <li {...props} {...srcLineAttrs(props)} />;
    }
    return (
        <li
            {...props}
            {...srcLineAttrs(props)}
            className={clsx(props.className, "ordered-list-collapsible", { collapsed })}
        >
            <div className="ordered-list-summary-row">
                <button
                    type="button"
                    className="ordered-list-collapse-button"
                    title={collapsed ? "Expand list item" : "Collapse list item"}
                    aria-label={collapsed ? "Expand list item" : "Collapse list item"}
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onToggle(itemId);
                    }}
                >
                    <i className={clsx("fa-sharp fa-solid", collapsed ? "fa-chevron-right" : "fa-chevron-down")} />
                </button>
                <div className="ordered-list-summary-content">{summaryChildren}</div>
            </div>
            {collapsed ? null : <div className="ordered-list-collapse-body">{bodyChildren}</div>}
        </li>
    );
};

const MarkdownListItem = ({
    props,
    collapsed,
    onToggle,
}: {
    props: React.LiHTMLAttributes<HTMLLIElement>;
    collapsed: boolean;
    onToggle: (itemId: string) => void;
}) => {
    const orderedListCollapsible = useContext(OrderedListContext);
    if (orderedListCollapsible) {
        return <CollapsibleOrderedListItem props={props} collapsed={collapsed} onToggle={onToggle} />;
    }
    return <li {...props} {...srcLineAttrs(props)} />;
};

const CollapsibleTable = ({
    props,
    collapsed,
    onToggle,
}: {
    props: React.HTMLAttributes<HTMLTableElement>;
    collapsed: boolean;
    onToggle: () => void;
}) => {
    return (
        <div className={clsx("table-wrapper", { collapsed })} {...srcLineAttrs(props)}>
            <button
                type="button"
                className="table-collapse-button"
                title={collapsed ? "Expand table" : "Collapse table"}
                aria-label={collapsed ? "Expand table" : "Collapse table"}
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onToggle();
                }}
            >
                <i className={clsx("fa-sharp fa-solid", collapsed ? "fa-chevron-right" : "fa-chevron-down")} />
            </button>
            <table {...props} />
        </div>
    );
};

const Mermaid = ({ chart }: { chart: string }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const renderMermaid = async () => {
            try {
                setIsLoading(true);
                setError(null);

                await initializeMermaid();
                if (!ref.current || !mermaidInstance) {
                    return;
                }

                // Normalize the chart text
                const normalizedChart = chart
                    .replace(/<br\s*\/?>/gi, "\n") // Convert <br/> and <br> to newlines
                    .replace(/\r\n?/g, "\n") // Normalize \r \r\n to \n
                    .replace(/\n+$/, ""); // Remove final newline

                ref.current.removeAttribute("data-processed");
                ref.current.textContent = normalizedChart;
                // console.log("mermaid", normalizedChart);
                await mermaidInstance.run({ nodes: [ref.current] });
                setIsLoading(false);
            } catch (err) {
                console.error("Error rendering mermaid diagram:", err);
                setError(`Failed to render diagram: ${err.message || err}`);
                setIsLoading(false);
            }
        };

        renderMermaid();
    }, [chart]);

    useEffect(() => {
        if (!ref.current) return;

        if (error) {
            ref.current.textContent = `Error: ${error}`;
            ref.current.className = "mermaid error";
        } else if (isLoading) {
            ref.current.textContent = "Loading diagram...";
            ref.current.className = "mermaid";
        } else {
            ref.current.className = "mermaid";
        }
    }, [isLoading, error]);

    return <div className="mermaid" ref={ref} />;
};

const Code = ({ className = "", children }: { className?: string; children: React.ReactNode }) => {
    if (/\blanguage-mermaid\b/.test(className)) {
        const text = Array.isArray(children) ? children.join("") : String(children ?? "");
        return <Mermaid chart={text} />;
    }
    return <code className={className}>{children}</code>;
};

type CodeBlockProps = {
    children: React.ReactNode;
    onClickExecute?: (cmd: string) => void;
    sourceLine?: number;
    sourceLineEnd?: number;
};

const CodeBlock = ({ children, onClickExecute, sourceLine, sourceLineEnd }: CodeBlockProps) => {
    const getTextContent = (children: any): string => {
        if (typeof children === "string") {
            return children;
        } else if (Array.isArray(children)) {
            return children.map(getTextContent).join("");
        } else if (children.props && children.props.children) {
            return getTextContent(children.props.children);
        }
        return "";
    };

    const handleCopy = async (e: React.MouseEvent) => {
        let textToCopy = getTextContent(children);
        textToCopy = textToCopy.replace(/\n$/, ""); // remove trailing newline
        await navigator.clipboard.writeText(textToCopy);
    };

    const handleExecute = (e: React.MouseEvent) => {
        let textToCopy = getTextContent(children);
        textToCopy = textToCopy.replace(/\n$/, ""); // remove trailing newline
        if (onClickExecute) {
            onClickExecute(textToCopy);
            return;
        }
    };

    return (
        <pre className="codeblock" {...sourceLineAttrs(sourceLine, sourceLineEnd)}>
            {children}
            <div className="codeblock-actions">
                <CopyButton onClick={handleCopy} title="Copy" />
                {onClickExecute && (
                    <IconButton
                        decl={{
                            elemtype: "iconbutton",
                            icon: "regular@square-terminal",
                            click: handleExecute,
                        }}
                    />
                )}
            </div>
        </pre>
    );
};

const MarkdownSource = ({
    props,
    resolveOpts,
}: {
    props: React.HTMLAttributes<HTMLSourceElement> & {
        srcSet?: string;
        media?: string;
    };
    resolveOpts: MarkdownResolveOpts;
}) => {
    const [resolvedSrcSet, setResolvedSrcSet] = useState<string>(props.srcSet);
    const [resolving, setResolving] = useState<boolean>(true);

    useEffect(() => {
        const resolvePath = async () => {
            const resolved = await resolveSrcSet(props.srcSet, resolveOpts);
            setResolvedSrcSet(resolved);
            setResolving(false);
        };

        resolvePath();
    }, [props.srcSet]);

    if (resolving) {
        return null;
    }

    return <source srcSet={resolvedSrcSet} media={props.media} />;
};

interface WaveBlockProps {
    blockkey: string;
    blockmap: Map<string, MarkdownContentBlockType>;
    /** Optional: delegate rendering by block type (e.g. Obsidian properties card). */
    renderers?: Record<string, (block: MarkdownContentBlockType) => React.ReactNode>;
}

function WaveBlock(props: WaveBlockProps) {
    const { blockkey, blockmap, renderers } = props;
    const block = blockmap.get(blockkey);
    if (block == null) {
        return null;
    }
    const renderer = renderers?.[block.type];
    if (renderer) {
        return <>{renderer(block)}</>;
    }
    const sizeInKB = Math.round((block.content.length / 1024) * 10) / 10;
    const displayName = block.id.replace(/^"|"$/g, "");
    return (
        <div className="waveblock">
            <div className="wave-block-content">
                <div className="wave-block-icon">
                    <i className="fas fa-file-code"></i>
                </div>
                <div className="wave-block-info">
                    <span className="wave-block-filename">{displayName}</span>
                    <span className="wave-block-size">{sizeInKB} KB</span>
                </div>
            </div>
        </div>
    );
}

const MarkdownImg = ({
    props,
    resolveOpts,
    fullText,
    onInlineEditCommit,
}: {
    props: React.ImgHTMLAttributes<HTMLImageElement>;
    resolveOpts: MarkdownResolveOpts;
    // Source text + commit channel for edit operations ("edit path" / "delete image").
    // LivePreview omits onInlineEditCommit, so its images are view/copy only.
    fullText?: string;
    onInlineEditCommit?: (newFullText: string) => void;
}) => {
    const [resolvedSrc, setResolvedSrc] = useState<string>(props.src);
    const [resolvedSrcSet, setResolvedSrcSet] = useState<string>(props.srcSet);
    const [resolvedStr, setResolvedStr] = useState<string>(null);
    const [resolving, setResolving] = useState<boolean>(true);
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [pathInputOpen, setPathInputOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [inputPos, setInputPos] = useState<{ top: number; left: number } | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);
    const [newPath, setNewPath] = useState("");

    useEffect(() => {
        if (props.src.startsWith("data:image/")) {
            setResolving(false);
            setResolvedSrc(props.src);
            setResolvedStr(null);
            return;
        }
        if (resolveOpts == null) {
            setResolving(false);
            setResolvedSrc(null);
            setResolvedStr(`[img:${props.src}]`);
            return;
        }

        const resolveFn = async () => {
            const [resolvedSrc, resolvedSrcSet] = await Promise.all([
                resolveRemoteFile(props.src, resolveOpts),
                resolveSrcSet(props.srcSet, resolveOpts),
            ]);

            setResolvedSrc(resolvedSrc);
            setResolvedSrcSet(resolvedSrcSet);
            setResolvedStr(null);
            setResolving(false);
        };
        resolveFn();
    }, [props.src, props.srcSet]);

    // Only real, loadable images participate in the lightbox / context menu. Placeholder
    // ([img:...]) and data-URI images are excluded from edit ops but data: URIs still zoom.
    const imageUsable = resolvedStr == null && resolvedSrc != null;
    // Edit ops need the source line (from the rehype node position) plus the commit channel.
    // rehype attaches the source position to the hast node; ImgHTMLAttributes doesn't
    // type it, so reach through a cast (mirrors getSourceLine's `props: any`).
    const nodePos = (props as any)?.node?.position;
    const sourceLine = nodePos?.start?.line;
    const sourceSrc = props.src;

    // Edit ops need the source line (from the rehype node position) plus the commit channel.
    // (data: URI images have no source line and are excluded from edit ops.)
    const canEdit = fullText != null && onInlineEditCommit != null && sourceLine != null;

    const openPathInput = () => {
        const rect = imgRef.current?.getBoundingClientRect();
        if (rect == null) {
            return;
        }
        setInputPos({ top: rect.bottom + 4, left: rect.left });
        setNewPath(sourceSrc);
        setPathInputOpen(true);
    };

    const commitPathEdit = () => {
        if (!canEdit || sourceLine == null) {
            return;
        }
        const newText = editImageSyntaxInFullText(fullText, sourceLine, (lineText) =>
            replaceImageSrcInLine(lineText, sourceSrc, newPath.trim())
        );
        if (newText != null) {
            onInlineEditCommit(newText);
        }
        setPathInputOpen(false);
    };

    const deleteImage = () => {
        if (!canEdit || sourceLine == null) {
            return;
        }
        const newText = editImageSyntaxInFullText(fullText, sourceLine, (lineText) => {
            const removed = removeImageSyntaxInLine(lineText, sourceSrc);
            if (removed == null) {
                return null;
            }
            // The image syntax was the only content on its line: drop the whole line so
            // the surrounding text closes up. Otherwise keep the line minus the fragment.
            return removed.isEmpty ? "" : removed.text;
        });
        if (newText != null) {
            // No confirmation dialog: the edit lands in the shared draft (newFileContent)
            // and is Revert-able until Save, same safety net as paragraph inline editing.
            onInlineEditCommit(newText);
        }
        setPathInputOpen(false);
    };

    const copyImagePath = async () => {
        await navigator.clipboard.writeText(sourceSrc ?? "");
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
    };

    const handleImgClick = (e: React.MouseEvent) => {
        if (!imageUsable) {
            return;
        }
        // An image wrapped in a link ([![alt](img)](url)) keeps the link's navigation;
        // the lightbox is reachable via the context menu in that case.
        if ((e.target as HTMLElement).closest("a") != null) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        setLightboxOpen(true);
    };

    const handleImgContextMenu = (e: React.MouseEvent) => {
        if (!imageUsable) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        const menu: ContextMenuItem[] = [
            { label: "放大查看", click: () => setLightboxOpen(true) },
            { label: "复制图片路径", click: () => void copyImagePath() },
        ];
        if (canEdit) {
            menu.push({ type: "separator" });
            menu.push({ label: "修改路径", click: openPathInput });
            menu.push({ label: "删除图片", click: deleteImage });
        }
        ContextMenuModel.getInstance().showContextMenu(menu, e);
    };

    if (resolving) {
        return null;
    }
    if (resolvedStr != null) {
        return <span>{resolvedStr}</span>;
    }
    if (resolvedSrc != null) {
        return (
            <>
                <img
                    ref={imgRef}
                    {...props}
                    src={resolvedSrc}
                    srcSet={resolvedSrcSet}
                    className={cn(props.className, "markdown-img-clickable")}
                    onClick={handleImgClick}
                    onContextMenu={handleImgContextMenu}
                />
                {copied && <span className="markdown-img-copied">已复制路径</span>}
                {lightboxOpen && <ImageLightbox src={resolvedSrc} alt={props.alt} onClose={() => setLightboxOpen(false)} />}
                {pathInputOpen && inputPos != null &&
                    ReactDOM.createPortal(
                        <div className="markdown-img-path-input" style={{ top: inputPos.top, left: inputPos.left }}>
                            <input
                                ref={inputRef}
                                autoFocus
                                value={newPath}
                                spellCheck={false}
                                placeholder="图片路径"
                                onChange={(e) => setNewPath(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        commitPathEdit();
                                    } else if (e.key === "Escape") {
                                        setPathInputOpen(false);
                                    }
                                }}
                                onBlur={() => setPathInputOpen(false)}
                            />
                        </div>,
                        document.body
                    )}
            </>
        );
    }
    return <span>[img]</span>;
};

type MarkdownProps = {
    text?: string;
    textAtom?: Atom<string> | Atom<Promise<string>>;
    showTocAtom?: Atom<boolean>;
    style?: React.CSSProperties;
    className?: string;
    contentClassName?: string;
    onClickExecute?: (cmd: string) => void;
    resolveOpts?: MarkdownResolveOpts;
    scrollable?: boolean;
    rehype?: boolean;
    fontSizeOverride?: number;
    fixedFontSizeOverride?: number;
    scrollTargetLine?: number | null;
    scrollTargetText?: string | null;
    scrollTargetSourceState?: MarkdownScrollSourceState | null;
    scrollTargetBehavior?: ScrollBehavior;
    hideUntilInitialScroll?: boolean;
    onInitialScrollReady?: () => void;
    onUserScrollSourceLine?: (line: number) => void;
    collapsibleOrderedLists?: boolean;
    copyContextPath?: string;
    /**
     * Stable prefix for rehype-slug heading ids. When two Markdown instances render the same
     * md file, ids collide; when the *same* block is unmounted/remounted (tab switch) a random
     * prefix makes the persisted collapsedSet unmatchable. Pass a blockId+path-derived prefix
     * from preview-markdown so collapse state survives remount. Omit for one-shot renderers
     * (vdom, input modal) which keep the random default.
     */
    idPrefix?: string;
    /**
     * Controlled heading-collapse set (element ids). When provided, the Markdown instance seeds
     * its local state from this and reports each change back via onCollapsedHeadingsChange, so
     * the caller can persist across remounts. When omitted, the instance owns its own state.
     */
    collapsedHeadings?: Set<string>;
    onCollapsedHeadingsChange?: (next: Set<string>) => void;
    collapsedOrderedListItems?: Set<string>;
    onCollapsedOrderedListItemsChange?: (next: Set<string>) => void;
    collapsedTables?: Set<string>;
    onCollapsedTablesChange?: (next: Set<string>) => void;
    /**
     * Restore a saved viewport scrollTop (px) on mount, after scrollHeight stabilizes. Caller persists
     * live changes via onScrollTopChange so the value survives BlockInner remount on tab switch.
     * Honored only when no scrollTargetLine jump is pending (searchline meta takes precedence).
     */
    savedScrollTop?: number;
    onScrollTopChange?: (scrollTop: number) => void;
    /**
     * Invoked with the full new markdown text when the user commits an inline edit on a
     * paragraph or heading (dblclick → textarea → blur/Cmd+S/Cmd+Enter). The caller owns
     * "really save to disk" — this only stages the new text into the shared draft so the
     * existing Save/Revert flow picks it up. Omit to disable inline editing entirely.
     */
    onInlineEditCommit?: (newFullText: string) => void;
    /**
     * Optional: flush the staged inline-edit draft to disk. Triggered only when the user presses
     * ⌘/Ctrl+S inside the inline-edit textarea (after `onInlineEditCommit` has already written the
     * draft to the shared atom). Preview-mode callers wire `model.handleFileSave` here because no
     * global ⌘S listener runs in that view, so bubbling the keystroke would otherwise save nothing.
     */
    onInlineEditSave?: () => void;
    /**
     * Optional: replace the frontmatter region [startLine..endLine] (1-based, inclusive) at the
     * mdast level with a waveblock node keyed by `blockKey`, and register that key in the content
     * block map with the given YAML text. The raw text and its line numbers are untouched, so
     * inline-edit coordinates stay valid and a commit never loses the frontmatter. Pair with
     * `waveBlockRenderers` to render the region as a custom component (e.g. Obsidian properties).
     */
    frontmatterBlock?: {
        startLine: number;
        endLine: number;
        yamlText: string;
        blockKey: string;
    } | null;
    /**
     * Optional: delegate content-block (waveblock) rendering by block.type. When a block matches,
     * the custom component renders instead of the default file-card.
     */
    waveBlockRenderers?: Record<string, (block: MarkdownContentBlockType) => React.ReactNode>;
};

type MarkdownScrollSourceState = {
    sequence: number;
    origin: "editor" | "preview" | "none";
    previewControlUntil: number;
    bottomScrollIntent: boolean;
    direction: "up" | "down" | "none";
    isAtBottom: boolean;
};

const Markdown = ({
    text,
    textAtom,
    showTocAtom,
    style,
    className,
    contentClassName,
    resolveOpts,
    fontSizeOverride,
    fixedFontSizeOverride,
    scrollTargetLine,
    scrollTargetText,
    scrollTargetSourceState,
    scrollTargetBehavior = "smooth",
    hideUntilInitialScroll = false,
    onInitialScrollReady,
    onUserScrollSourceLine,
    collapsibleOrderedLists = false,
    copyContextPath,
    onInlineEditCommit,
    onInlineEditSave,
    scrollable = true,
    rehype = true,
    onClickExecute,
    idPrefix: idPrefixProp,
    collapsedHeadings: collapsedHeadingsProp,
    onCollapsedHeadingsChange,
    collapsedOrderedListItems: collapsedOrderedListItemsProp,
    onCollapsedOrderedListItemsChange,
    collapsedTables: collapsedTablesProp,
    onCollapsedTablesChange,
    savedScrollTop,
    onScrollTopChange,
    frontmatterBlock,
    waveBlockRenderers,
}: MarkdownProps) => {
    // `fileContentAtom` is an async atom (Atom<Promise<string>>). On invalidation `useAtomValue`
    // throws the pending Promise → without a Suspense boundary above, ReactMarkdown's subtree
    // unmounts for one frame and the user sees "loading flash" then re-mount + scroll jump. Wrap
    // the atom in `loadable(...)` so the throw becomes a plain {state, data, error} object we can
    // read synchronously, and on the pending frame restream the last resolved string from a ref
    // so the ReactMarkdown DOM tree stays mounted and only the textarea's commit lands without a
    // blink. Writing the ref during render is fine here — assignment is idempotent (same string
    // each re-render) and free of side effects external to this hook.
    const textAtomLoadable = useAtomValue(loadable(textAtom ?? NullStringAtom));
    const lastResolvedTextRef = useRef<string | null>(null);
    let textAtomValue: string | undefined;
    if (textAtomLoadable != null) {
        if (textAtomLoadable.state === "hasData") {
            lastResolvedTextRef.current = textAtomLoadable.data;
            textAtomValue = textAtomLoadable.data;
        } else if (textAtomLoadable.state === "loading") {
            // pending: keep the ReactMarkdown subtree mounted on the previous content rather than
            // rendering empty — that's the frame that caused the loading-flash symptom on Save.
            textAtomValue = lastResolvedTextRef.current ?? undefined;
        } else {
            // hasError — fall through to the prop fallback so caller surfaces the error path.
            textAtomValue = undefined;
        }
    }
    const showToc = useAtomValueSafe(showTocAtom) ?? false;
    const contentsOsRef = useRef<OverlayScrollbarsComponentRef>(null);
    const programmaticScrollUntilRef = useRef(0);
    const lastAppliedScrollTargetRef = useRef<{ line: number; text: string } | null>(null);
    const lastViewportScrollTopRef = useRef(0);
    const previousTransformedTextRef = useRef<string | null>(null);
    const savedScrollTopAppliedRef = useRef(false);
    const scrollTopWriteRafRef = useRef<number | null>(null);
    const [initialScrollReadyKey, setInitialScrollReadyKey] = useState<string | null>(null);
    const [focusedHeadingId, setFocusedHeadingId] = useState<string>(null);
    // Controlled seeding: when a caller persists collapse across remounts it passes a snapshot
    // captured at unmount as the initial here, plus an onChange callback to write back live.
    const [collapsedHeadings, setCollapsedHeadings] = useState<Set<string>>(
        () => collapsedHeadingsProp ?? new Set()
    );
    const [collapsedOrderedListItems, setCollapsedOrderedListItems] = useState<Set<string>>(
        () => collapsedOrderedListItemsProp ?? new Set()
    );
    const [collapsedTables, setCollapsedTables] = useState<Set<string>>(
        () => collapsedTablesProp ?? new Set()
    );

    // Ensure uniqueness of ids between MD preview instances. When the caller supplies a stable
    // idPrefix (blockId+path-derived) the persisted collapsedHeadings Set stays matchable across
    // remount; otherwise fall back to a per-instance random prefix.
    const [idPrefix] = useState<string>(() => idPrefixProp ?? crypto.randomUUID());

    text = textAtomValue ?? text ?? "";
    // useMemo 稳定 transformedOutput/contentBlocksMap 引用：鼠标移动（handleRootMouseOver →
    // setInsertAnchor）、滚动（measureInsertAnchor → setInsertPos）等无关重渲染不改变 text，
    // memo 命中后下游 waveblock 委托引用稳定，React 保留波块子树实例，块内组件 state
    // （ObsidianPropertiesCard 折叠/编辑）不随重渲染丢失。frontmatter 注册随 transform 一起
    // memo：blockKey ↔ yamlText 幂等，内容不变时引用不变。
    const transformedOutput = useMemo(() => {
        const output = transformBlocks(text);
        if (frontmatterBlock) {
            // 注册 frontmatter 内容块：后续 remark 插件把 mdast 层 frontmatter 节点替换成
            // waveblock 占位（blockkey 指向该条目）。type 固定 "obsidian-props"
            // （waveBlockRenderers 字典键）。
            output.blocks.set(frontmatterBlock.blockKey, {
                type: "obsidian-props",
                id: frontmatterBlock.blockKey,
                content: frontmatterBlock.yamlText,
            });
        }
        return output;
    }, [text, frontmatterBlock]);
    const transformedText = transformedOutput.content;
    const contentBlocksMap = transformedOutput.blocks;

    const getViewportEl = useCallback((): HTMLElement | null => {
        const inst = contentsOsRef.current?.osInstance();
        if (!inst) {
            return null;
        }
        return inst.elements().viewport;
    }, []);

    const handleInlineEditCommit = useCallback(
        (newFullText: string) => {
            if (!onInlineEditCommit) {
                return;
            }
            onInlineEditCommit(newFullText);
        },
        [onInlineEditCommit]
    );

    const inlineEdit = useInlineEdit({
        fullText: text,
        onCommit: handleInlineEditCommit,
        getViewportEl,
        resetKey: onInlineEditCommit,
    });

    // Shared target resolution for dblclick- and click-to-edit. Walks the click target up
    // to its enclosing [data-source-line] block, promoting <LI> to its parent <OL>/<UL> so the
    // editor owns the whole list (M2 ships list-as-block, not listitem-as-block), then maps the
    // element's tag/class to one of the InlineEditBlockKind values the editor knows how to slice.
    //
    // Returns null when the click didn't land on a block the editor supports — caller returns and
    // native behavior (selection, link navigation, heading toggle) takes over. Also returns null
    // for a heading currently in the `collapsed` state: a folded heading should expand on click
    // rather than open the editor, mirroring the dblclick path's long-standing guard.
    const resolveEditTargetFromEvent = useCallback(
        (e: React.MouseEvent<HTMLDivElement>): { target: HTMLElement; line: number; blockKind: InlineEditBlockKind } | null => {
            // Images are read-only in the preview: clicking zooms, right-click opens the
            // image menu. Never let a click/dblclick on an <img> fall through to paragraph
            // inline editing — that used to pop the editor over the whole paragraph.
            if ((e.target as HTMLElement | null)?.closest("img") != null) {
                return null;
            }
            let target = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-source-line]");
            if (target == null) {
                return null;
            }
            if (target.tagName === "LI") {
                const parentList = target.parentElement?.closest<HTMLElement>("[data-source-line]");
                if (parentList != null && (parentList.tagName === "OL" || parentList.tagName === "UL")) {
                    target = parentList;
                }
            }
            const lineAttr = target.dataset.sourceLine;
            if (lineAttr == null) {
                return null;
            }
            const line = Number(lineAttr);
            if (!Number.isFinite(line) || line < 1) {
                return null;
            }
            const tag = target.tagName;
            let blockKind: InlineEditBlockKind | null = null;
            // Spacers render through the same `p` component as paragraphs but carry the
            // `blank-spacer` class (see remark/blank-line-spacers). A blank line is not prose —
            // editing it should target the blank source line(s), not open a paragraph textarea.
            if (target.classList.contains("blank-spacer")) {
                blockKind = "blank";
            } else if (tag === "HR") {
                blockKind = "hr";
            } else if (tag === "P" || target.classList.contains("paragraph")) {
                blockKind = "p";
            } else if (
                tag === "H1" ||
                tag === "H2" ||
                tag === "H3" ||
                tag === "H4" ||
                tag === "H5" ||
                tag === "H6" ||
                // CollapsibleHeading renders as <div class="heading is-N"> rather than <hN>;
                // match by class so click-to-edit works for the headings the user actually sees.
                target.classList.contains("heading")
            ) {
                blockKind = "h";
            } else if (tag === "OL" || tag === "UL") {
                blockKind = "list";
            } else if (tag === "TABLE" || target.classList.contains("table-wrapper")) {
                blockKind = "table";
            } else if (tag === "PRE" || target.classList.contains("codeblock")) {
                blockKind = "code";
            } else {
                // Block kind not yet supported by inline editing. Plain click/dblclick → native
                // selection for now; add a branch above to enable a new kind.
                return null;
            }
            // Don't intercept on a heading that is currently collapsed. CollapsibleHeading
            // expresses state via the `collapsed` class (no aria-expanded on the div), so a
            // click on a folded heading should expand it, not open the editor. For raw <hN>
            // tags (non-collapsible render path) there's no collapsed class, so this check is a
            // no-op and the editor opens normally.
            if (blockKind === "h" && target.classList.contains("collapsed")) {
                return null;
            }
            return { target, line, blockKind };
        },
        []
    );

    const handleInlineEditDblClick = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            // Only intercept when inline editing has been opted in by the parent
            // (onInlineEditCommit wired). Without that, dblclick should fall through to
            // native text selection behavior.
            if (!onInlineEditCommit) {
                return;
            }
            // Capture phase: ensure we get one shot before any renderer's own dblclick toggles
            // (e.g. CollapsibleHeading would fold/unfold on dblclick otherwise).
            const resolved = resolveEditTargetFromEvent(e);
            if (resolved == null) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            inlineEdit.beginEdit(resolved.blockKind, resolved.line, resolved.target);
        },
        [inlineEdit, onInlineEditCommit, resolveEditTargetFromEvent]
    );

    // Records the selection string present at mousedown time so the click handler can tell
    // whether the mousedown→mouseup cycle produced NEW selection (drag-select) or just
    // preserved/cleared pre-existing selection (pure click intent). Set from a capture-phase
    // mousedown on the render root so it's in place before any mousemove-driven selection
    // changes the global selection.
    const mousedownSelectionRef = useRef<string>("");

    // Maps the click's clientX/Y to a character offset within the clicked block's rendered
    // text. Uses Chromium's caretRangeFromPoint (the renderer is Electron), then walks the
    // block's text nodes to turn the per-text-node offset into a block-absolute offset.
    // Returns null when the hit is outside the block's text (blank edge, no caret API) —
    // callers then fall back to select-all / line-start.
    const computeRenderedOffset = (clientX: number, clientY: number, block: HTMLElement): number | null => {
        if (typeof document.caretRangeFromPoint !== "function") {
            return null;
        }
        const range = document.caretRangeFromPoint(clientX, clientY);
        if (range == null) {
            return null;
        }
        const container = range.startContainer;
        if (container == null || !block.contains(container as Node)) {
            return null;
        }
        let offset = range.startOffset;
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node != null && node !== container) {
            offset += (node as Text).data.length;
            node = walker.nextNode();
        }
        return node != null ? offset : null;
    };

    // ponytail: the rendered offset is used directly as a draft (source) offset. It is exact
    // for plain text and soft-wrapped lines (\n renders 1:1 as a space), and off by the length
    // of inline markdown markers (**bold**, [link](...), `code`) on styled lines — the caret
    // lands nearby and the user nudges it. Upgrade path: map through the markdown AST so
    // rendered offset → source offset is exact.
    const beginEditAtPoint = (e: React.MouseEvent, resolved: { target: HTMLElement; line: number; blockKind: InlineEditBlockKind }) => {
        const caret = computeRenderedOffset(e.clientX, e.clientY, resolved.target);
        inlineEdit.beginEdit(resolved.blockKind, resolved.line, resolved.target, caret ?? undefined);
    };

    // Single-click entry path. Differs from dblclick in two ways:
    //   1. Bound on bubble phase (onClick, not onClickCapture) so <Link>'s onClick and the
    //      CollapsibleHeading chevron button's onClick (which calls stopPropagation) get first
    //      crack. We additionally bail when e.defaultPrevented is true (the Link handler calls
    //      preventDefault to route the href through WaveTerm's openFileLinkInPreview/openLink)
    //      and when the click landed inside an <a>/<button> — defensive in case a future
    //      component forgets to call preventDefault.
    //   2. Suppresses drag-select gestures: a click that arrived after the user dragged to
    //      select text (so the global selection grew during this mousedown cycle) must NOT
    //      enter edit, or every "select a phrase" gesture would also pop the editor. We
    //      compare the live selection length against the mousedown-captured baseline; growth
    //      during the press cycle = drag intent, skip.
    const handleInlineEditClick = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (!onInlineEditCommit) {
                return;
            }
            // Already editing — let the overlay/textarea own clicks while a session is open
            // (e.g. clicking another block while the textarea is focused commits on blur first).
            if (inlineEdit.editSession != null) {
                return;
            }
            if (e.button !== 0) {
                return;
            }
            // A child element already consumed this click (Link navigation, button activation).
            if (e.defaultPrevented) {
                return;
            }
            // Defensive: even without defaultPrevented, never enter edit when the press landed
            // on an interactive element. Headings' chevron button calls stopPropagation so its
            // clicks never reach here, but <a> only calls preventDefault — belt-and-braces.
            const interactive = (e.target as HTMLElement | null)?.closest<HTMLElement>("a, button, .heading-collapse-button, input, textarea, [contenteditable]");
            if (interactive != null) {
                return;
            }
            // Drag-select suppression. Baseline was captured at mousedown (capture phase,
            // before any selectionchange fired). If the live selection is now longer, the
            // user dragged to select — keep native selection, don't open the editor.
            const curSel = typeof window !== "undefined" ? (window.getSelection()?.toString() ?? "") : "";
            if (curSel.length > mousedownSelectionRef.current.length) {
                return;
            }
            const resolved = resolveEditTargetFromEvent(e);
            if (resolved == null) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            // Single click = edit at the clicked position (caret lands where the user
            // clicked). Dblclick still select-alls via beginEdit without a caret — the two
            // gestures complement each other.
            beginEditAtPoint(e, resolved);
        },
        [inlineEdit, onInlineEditCommit, resolveEditTargetFromEvent, beginEditAtPoint]
    );

    const handleInlineEditMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button !== 0) {
            return;
        }
        mousedownSelectionRef.current = typeof window !== "undefined" ? (window.getSelection()?.toString() ?? "") : "";
    }, []);

    // ---- Block-edge insert buttons --------------------------------------------------
    // Hovering an editable block shows a small ↑/↓ pair at its left edge; clicking one
    // opens a blank inline editor that inserts a new block before/after (see
    // useInlineEdit.beginInsertEdit). Tracked here because the buttons must follow the
    // block as the user scrolls.
    //
    // We store ONLY the source line, not the element: any re-render of the Markdown subtree
    // (hover state, ReactMarkdown plugin identity churn) replaces the block's DOM node, so a
    // cached element goes stale and its isConnected flips false. Re-resolve the element from
    // [data-source-line] at measure/click time (same fallback pattern as inline editing).
    const [insertAnchor, setInsertAnchor] = useState<{ line: number } | null>(null);
    const [insertPos, setInsertPos] = useState<{ top: number; left: number } | null>(null);

    // Buttons are portal'd to body (outside the block DOM), so moving the pointer from the
    // block onto a button fires the block's mouseout. Keep the buttons alive for a short
    // grace window after the pointer leaves, and cancel it while the pointer is over them —
    // same pattern as FlyoutMenu's hover close.
    const hideInsertTimerRef = useRef<number | null>(null);
    const scheduleHideInsert = useCallback(() => {
        if (hideInsertTimerRef.current != null) {
            window.clearTimeout(hideInsertTimerRef.current);
        }
        hideInsertTimerRef.current = window.setTimeout(() => {
            setInsertAnchor(null);
            setInsertPos(null);
            setGripOpen(false);
        }, 400);
    }, []);
    const cancelHideInsert = useCallback(() => {
        if (hideInsertTimerRef.current != null) {
            window.clearTimeout(hideInsertTimerRef.current);
            hideInsertTimerRef.current = null;
        }
    }, []);

    // A/B insert actions visibility. They are independent portal'd buttons mounted whenever
    // the block grip is (insertPos != null) but visually hidden until the pointer is over the
    // grip C or the actions themselves. Same 400ms grace pattern, on a separate timer so that
    // moving C → A/B (through the gap between them) keeps them alive.
    const [gripOpen, setGripOpen] = useState(false);
    const hideGripTimerRef = useRef<number | null>(null);
    const scheduleHideGrip = useCallback(() => {
        if (hideGripTimerRef.current != null) {
            window.clearTimeout(hideGripTimerRef.current);
        }
        hideGripTimerRef.current = window.setTimeout(() => {
            setGripOpen(false);
        }, 400);
    }, []);
    const cancelHideGrip = useCallback(() => {
        if (hideGripTimerRef.current != null) {
            window.clearTimeout(hideGripTimerRef.current);
            hideGripTimerRef.current = null;
        }
    }, []);
    // Shared enter/leave handlers for C, A and B: hovering any of them keeps the block anchor
    // alive (cancelHideInsert, in case the pointer is crossing from the block) and reveals A/B.
    const handleGripEnter = useCallback(() => {
        cancelHideInsert();
        cancelHideGrip();
        setGripOpen(true);
    }, [cancelHideInsert, cancelHideGrip]);
    const handleGripLeave = useCallback(() => {
        scheduleHideGrip();
    }, [scheduleHideGrip]);

    // --- Block selection (click the four-dot grip) --------------------------------
    // Clicking the grip C marks its block as selected (a highlight overlay + right-click
    // menu with Copy / Duplicate / Delete. Block-scoped, driven by start/end line of the
    // hovered block, and resolved live so it follows re-renders.
    const [selectedBlock, setSelectedBlock] = useState<{ line: number; rect: { top: number; left: number; width: number; height: number } } | null>(null);
    // live DOM ref for the selected block element, re-resolved from [data-source-line] so the
    // highlight overlay tracks re-renders / line edits.
    const selectedLineRef = useRef<number | null>(null);
    selectedLineRef.current = selectedBlock?.line ?? null;

    // Measure the currently selected block element (re-resolving from its line) so the
    // highlight overlay follows re-renders and scrolls. Kept in step with insertAnchor's own
    // scroll/resize watcher below.
    const measureSelectedBlock = useCallback(() => {
        const line = selectedLineRef.current;
        if (line == null) {
            return;
        }
        const viewport = getViewportEl();
        const el = viewport && viewport.querySelector<HTMLElement>(`.markdown-render-root [data-source-line="${line}"]`);
        if (el == null) {
            setSelectedBlock(null); // block no longer exists (deleted / file changed)
            return;
        }
        const rect = el.getBoundingClientRect();
        setSelectedBlock((prev) => {
            if (
                prev != null &&
                prev.line === line &&
                prev.rect.top === rect.top &&
                prev.rect.left === rect.left &&
                prev.rect.width === rect.width &&
                prev.rect.height === rect.height
            ) {
                return prev; // unchanged — avoid re-render churn
            }
            return { line, rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height } };
        });
    }, [getViewportEl]);

    // Re-measure the selection on scroll/resize/after-commit so the overlay hugs the block.
    useEffect(() => {
        if (selectedBlock == null) {
            return;
        }
        const viewport = getViewportEl();
        measureSelectedBlock();
        const onScrollOrResize = () => requestAnimationFrame(measureSelectedBlock);
        viewport?.addEventListener("scroll", onScrollOrResize, { passive: true });
        window.addEventListener("resize", onScrollOrResize);
        return () => {
            viewport?.removeEventListener("scroll", onScrollOrResize);
            window.removeEventListener("resize", onScrollOrResize);
        };
    }, [selectedBlock, getViewportEl, measureSelectedBlock]);

    // Escape clears any block selection (unless the inline editor is open — it owns Escape).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape" && selectedLineRef.current != null && inlineEdit.editSession == null) {
                setSelectedBlock(null);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inlineEdit.editSession]);

    // Helper: wait for the markdown preview to re-render after a commit, then open a blank
    // editor at `newLine` (used by handleInsertClick and handleEnterSplit). The revert callback
    // is forwarded so Esc can undo the whole insert.
    const focusEditedLine = useCallback(
        (newLine: number, revert?: () => void, placeholder?: boolean | "inline") => {
            // Give ReactMarkdown time to commit the new text to the DOM (one frame is usually
            // sufficient; a second rAF guards against double-batched concurrent renders).
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    const viewport = getViewportEl();
                    const el =
                        viewport &&
                        viewport.querySelector<HTMLElement>(`.markdown-render-root [data-source-line="${newLine}"]`);
                    if (el != null) {
                        inlineEdit.beginEdit("p", newLine, el, 0, revert, placeholder);
                    }
                });
            });
        },
        [getViewportEl, inlineEdit]
    );

    // --- Enter / split-at-caret ---------------------------------------------------
    // Handles the user pressing bare Enter while editing a block (paragraph, blank row,
    // or list). Paragraphs split into two blocks (front stays, back becomes a new block
    // with its own editor); lists add a new list item without closing the editor.
    // - Shift+Enter stays the native soft line break (no split).
    // - Code / table / heading blocks fall through to the default behavior (line break).
    const handleEnterSplit = useCallback(() => {
        const session = inlineEdit.editSession;
        const ta = inlineEdit.textareaRef.current;
        if (session == null || ta == null) {
            return;
        }
        const pos = ta.selectionStart;
        const draft = inlineEdit.draftText;

        // --- List: add a new item within the same list (same editor stays open) -----------
        if (session.blockKind === "list") {
            const lineEnd = draft.indexOf("\n", pos);
            const lineStart = draft.lastIndexOf("\n", pos) + 1;
            const line = draft.slice(lineStart, lineEnd === -1 ? draft.length : lineEnd);
            const prefix = (line.match(/^(\s*[-+*]\s|\s*\d+\.\s)/) || [""])[0];
            const before = draft.slice(0, pos);
            const after = draft.slice(pos);
            const newDraft = before + "\n" + prefix + after;
            inlineEdit.setDraftText(newDraft);
            const newPos = pos + 1 + prefix.length; // after the newline + prefix
            // schedule after the render so setSelectionRange sticks
            requestAnimationFrame(() => {
                ta.selectionStart = newPos;
                ta.selectionEnd = newPos;
            });
            return;
        }

        // --- Paragraph / blank row: split into two blocks ---------------------------------
        // Only split for the block kinds the user actually presses Enter in; headings,
        // code, and tables fall through (browser's native line-break is fine).
        if (session.blockKind !== "p" && session.blockKind !== "blank") {
            return; // let the textarea do its native newline
        }

        const { text: newFull, newLine } = splitBlockAtCaretText(
            text,
            session.startLine,
            session.endLine,
            draft,
            pos
        );
        const revert = () => {
            handleInlineEditCommit(text); // restore the document to what it was before the split
        };
        handleInlineEditCommit(newFull);
        // The split pre-inserted a single placeholder row — same commit/revert semantics as
        // the block-edge insert buttons (see commitPlaceholderBlock), so Enter nets exactly
        // one new block and an empty commit leaves nothing behind.
        focusEditedLine(newLine, revert, true);
    }, [inlineEdit, text, handleInlineEditCommit, focusEditedLine]);

    // --- Paste image → save to assets/ + insert ![..](assets/..) + render ----------------------
    // Mirrors Obsidian: pasting an image while editing a block saves it to a sibling `assets`
    // directory (created on demand) and inserts a markdown image reference at the caret. The
    // image FILE is written to disk immediately (independent of the md save flow); only the
    // markdown line goes through the shared draft (so Save/Revert still apply to the text).
    // Pure-text pastes are untouched (handler returns undefined → native paste proceeds).
    const handleEditorPaste = useCallback(
        async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
            const session = inlineEdit.editSession;
            const ta = inlineEdit.textareaRef.current;
            const baseDir = resolveOpts?.baseDir;
            if (session == null || ta == null || baseDir == null) {
                return; // not editing / no file dir to write into → native paste
            }
            // Find an image item in the clipboard (png/jpg/gif/webp). If none, fall through.
            const items = Array.from(e.clipboardData?.items ?? []);
            const imageItem = items.find((it) => it.kind === "file" && it.type.startsWith("image/"));
            if (imageItem == null || e.clipboardData.files == null || e.clipboardData.files.length === 0) {
                return;
            }
            const blob = e.clipboardData.files[0];
            if (!blob.type.startsWith("image/")) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();

            const ext = blob.type === "image/jpeg" ? "jpg" : blob.type.replace("image/", "").split("+")[0] || "png";
            const date = new Date();
            const pad = (n: number) => String(n).padStart(2, "0");
            const stamp =
                `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
                `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
            const rand = Math.floor(Math.random() * 900 + 100);
            const fileName = `image-${stamp}-${rand}.${ext}`;
            const relPath = `assets/${fileName}`;

            try {
                // 1) ensure the sibling assets/ directory exists
                const baseUri = formatRemoteUri(baseDir, resolveOpts?.connName ?? "local");
                await RpcApi.FileMkdirCommand(TabRpcClient, {
                    info: { path: `${baseUri}/assets`, mimetype: "directory" },
                });
                // 2) write the image bytes
                const buf = await blob.arrayBuffer();
                const data64 = arrayToBase64(new Uint8Array(buf));
                await RpcApi.FileWriteCommand(TabRpcClient, {
                    info: { path: `${baseUri}/${relPath}`, mimetype: blob.type },
                    data64,
                });
            } catch (err) {
                console.error("[markdown] paste-image write failed", err);
                return;
            }

            // 3) insert `![图片](assets/xxx.png)` at the caret and commit
            const caretPos = ta.selectionStart;
            const draft = inlineEdit.draftText;
            const imgMarkdown = `![图片](${relPath})`;
            const newDraft = draft.slice(0, caretPos) + imgMarkdown + draft.slice(caretPos);
            const newFull = replaceSourceRange(text, session.startLine, session.endLine, newDraft);
            handleInlineEditCommit(newFull);
        },
        [inlineEdit, resolveOpts, text, handleInlineEditCommit]
    );

    const resolveInsertAnchorEl = useCallback(
        (line: number): HTMLElement | null => {
            const viewport = getViewportEl();
            if (viewport == null) {
                return null;
            }
            return viewport.querySelector<HTMLElement>(`.markdown-render-root [data-source-line="${line}"]`);
        },
        [getViewportEl]
    );

    // Resolve the BLOCK-level anchor for an insert/menu action: same lookup as
    // resolveInsertAnchorEl, but a hovered <LI> is promoted to its parent <OL>/<UL> so
    // insert-above/below (and the copy/duplicate/delete menu) act on the WHOLE list, never
    // tearing a (possibly nested) list open mid-level. Mirrors resolveEditTargetFromEvent's
    // LI→list promotion; keeping it here means the insert path and the menu path share the
    // same block-granularity understanding of "the hovered block".
    const resolveBlockAnchorEl = useCallback(
        (line: number): HTMLElement | null => {
            const el = resolveInsertAnchorEl(line);
            if (el == null || el.tagName !== "LI") {
                return el;
            }
            const parentList = el.parentElement?.closest<HTMLElement>("ol, ul");
            return parentList != null && parentList.dataset.sourceLine != null ? parentList : el;
        },
        [resolveInsertAnchorEl]
    );

    // --- Grip menu: click the 4-dot grip → select the block + popup (copy / duplicate / delete)
    // Resolves the current anchor block's [start..end] source range, shows a selection
    // highlight overlay over it, and opens a native context menu. Block-scoped operations are
    // applied to the markdown source via the same range helpers the editor uses.
    const handleGripMenuClick = useCallback(
        (e: React.MouseEvent) => {
            const anchor = insertAnchorRef.current;
            if (anchor == null) {
                return;
            }
            // Whole-block granularity: an LI hover resolves to its parent list (same promotion
            // as the insert path), so copy/duplicate/delete never split a nested list open.
            const el = resolveBlockAnchorEl(anchor.line);
            if (el == null) {
                return;
            }
            const startLineRaw = Number(el.dataset.sourceLine);
            if (!Number.isFinite(startLineRaw) || startLineRaw < 1) {
                return;
            }
            const endLineRaw = el.dataset.sourceLineEnd != null ? Number(el.dataset.sourceLineEnd) : startLineRaw;
            const endLine = Number.isFinite(endLineRaw) && endLineRaw >= startLineRaw ? endLineRaw : startLineRaw;
            e.preventDefault();
            e.stopPropagation();

            const lines = text.split(/\r\n|\n/);
            const blockSource = lines.slice(startLineRaw - 1, endLine).join("\n");

            // Live-highlight: set the overlay now; measureSelectedBlock re-anchors after render if needed.
            const rect = el.getBoundingClientRect();
            setSelectedBlock({
                line: startLineRaw,
                rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
            });

            const copyBlock = async () => {
                await navigator.clipboard.writeText(blockSource);
            };
            const duplicateBlock = () => {
                const newFull = spliceInsertBlock(lines, startLineRaw, endLine, "after", blockSource.split(/\r\n|\n/)).join("\n");
                handleInlineEditCommit(newFull);
            };
            const deleteBlock = () => {
                const newFull = deleteBlockRange(text, startLineRaw, endLine);
                handleInlineEditCommit(newFull);
                setSelectedBlock(null);
            };

            const menu: ContextMenuItem[] = [
                { label: "复制", click: () => void copyBlock() },
                { label: "复制为副本", click: duplicateBlock },
                { type: "separator" },
                { label: "删除", click: deleteBlock },
            ];
            ContextMenuModel.getInstance().showContextMenu(menu, e, {
                onClose: () => setSelectedBlock(null),
            });
        },
        [resolveBlockAnchorEl, text, handleInlineEditCommit]
    );

    const measureInsertAnchor = useCallback(() => {
        const anchor = insertAnchorRef.current;
        if (anchor == null) {
            setInsertPos(null);
            return;
        }
        const el = resolveInsertAnchorEl(anchor.line);
        if (el == null) {
            setInsertPos(null);
            return;
        }
        const rect = el.getBoundingClientRect();
        // Grip sits in the gutter left of the block, anchored to the block's TOP-LEFT (like
        // Notion's handle): insertPos.top is the anchor center for translate(-50%, -50%), so
        // rect.top + 8 centers the 16px grip on the block's top edge (half above, half beside
        // the first line). NOT the vertical middle — centering on tall blocks (lists, code,
        // multi-line paragraphs) floated the grip mid-block, looking detached from the hovered
        // row. The insert actions (A/B) are placed relative to the same anchor in the JSX.
        // Clamp to viewport for far-left blocks (content has ~15px padding).
        // ponytail: the block's hovered row can be deep in a list (LI) while data-source-line
        // resolves to the UL — the grip then anchors to the list's top-left, acceptable.
        setInsertPos({ top: rect.top + 8, left: Math.max(rect.left - 26, 8) });
    }, [resolveInsertAnchorEl]);
    const insertAnchorRef = useRef<{ line: number } | null>(null);
    insertAnchorRef.current = insertAnchor;

    // Hover tracking on the render root: resolve the nearest [data-source-line] block,
    // skipping images (they own their click/right-click) and blocks we can't edit.
    const handleRootMouseOver = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (!onInlineEditCommit) {
                return;
            }
            // Our own grip portal elements live on body: when React mounts/re-mounts them
            // under a stationary pointer, the browser fires a synthetic mouseover on them
            // (topmost element changed) whose target is not inside a [data-source-line] block.
            // Clearing the anchor there would unmount the grip → pointer over the block again
            // → re-mount → synthetic mouseover → … an every-frame flicker loop (the grip
            // visually jumps). Hovering C/A/B is a continuation of the same hover intent —
            // ignore and keep the anchor.
            if (
                e.target instanceof HTMLElement &&
                e.target.closest(".markdown-block-grip-dots, .markdown-block-grip-action") != null
            ) {
                return;
            }
            // Don't fight the inline-edit overlay itself (portal is on body, but the
            // mouseover can still bubble from the textarea's DOM if it renders inside root).
            if (inlineEdit.editSession != null) {
                setInsertAnchor(null);
                return;
            }
            const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(
                "[data-source-line]:not(img)"
            );
            if (target == null || target.closest("img") != null) {
                // Non-block target (padding, gutter, spacers). Deliberately do NOT clear the
                // anchor here: the pointer moving from the block text toward the gutter grip
                // crosses the block's left boundary first, and a synchronous clear would
                // unmount the grip before the pointer reaches it. Leaving the block entirely
                // is handled by the OSB mouseleave → scheduleHideInsert's 400ms grace.
                return;
            }
            const lineAttr = target.dataset.sourceLine;
            if (lineAttr == null) {
                setInsertAnchor(null);
                return;
            }
            cancelHideInsert();
            setInsertAnchor({ line: Number(lineAttr) });
            // Clear any active block selection when hovering a new block.
            setSelectedBlock(null);
        },
        [cancelHideInsert, inlineEdit.editSession, onInlineEditCommit]
    );

    // Measure AFTER the anchor state has been committed to a render (so insertAnchorRef is
    // current) — measuring inside the mouseover handler races the render and reads a stale
    // ref, which left the buttons hidden forever. Synchronous call (no rAF): the effect runs
    // post-commit, DOM is up to date, and getBoundingClientRect forces the layout we need;
    // rAF would additionally stall in a background/occluded window where rAF is paused.
    useEffect(() => {
        if (insertAnchor == null) {
            setInsertPos(null);
            return;
        }
        measureInsertAnchor();
    }, [insertAnchor, measureInsertAnchor]);

    const handleRootMouseLeave = useCallback(() => {
        scheduleHideInsert();
    }, [scheduleHideInsert]);

    // Re-position the insert buttons while scrolling / resizing so they track the block.
    useEffect(() => {
        if (insertAnchor == null) {
            return;
        }
        const viewport = getViewportEl();
        const onScrollOrResize = () => requestAnimationFrame(measureInsertAnchor);
        viewport?.addEventListener("scroll", onScrollOrResize, { passive: true });
        window.addEventListener("resize", onScrollOrResize);
        return () => {
            viewport?.removeEventListener("scroll", onScrollOrResize);
            window.removeEventListener("resize", onScrollOrResize);
        };
    }, [getViewportEl, insertAnchor, measureInsertAnchor]);

    const handleInsertClick = useCallback(
        (mode: "before" | "after") => {
            const anchor = insertAnchorRef.current;
            if (anchor == null) {
                return;
            }
            // Whole-block granularity: an LI hover resolves to its parent list so inserting
            // below a nested item lands after the WHOLE list, never mid-level.
            const el = resolveBlockAnchorEl(anchor.line);
            if (el == null) {
                return;
            }
            // Bracket the WHOLE block: multi-line blocks (lists, tables, code, soft-broken
            // paragraphs) carry data-source-line-end; "after" must splice below endLine or it
            // tears the block open (new row lands mid-list). Falls back to the start line for
            // legacy renders without the end attribute.
            const startLine = Number(el.dataset.sourceLine);
            const endLineRaw = el.dataset.sourceLineEnd != null ? Number(el.dataset.sourceLineEnd) : startLine;
            const endLine = Number.isFinite(endLineRaw) && endLineRaw >= startLine ? endLineRaw : startLine;

            // Inline-mode anchor: a plain paragraph (NOT a blank spacer) gets a soft-broken new
            // line flush inside the paragraph (no stray separator blank — the paragraph's own
            // surrounding blanks already bracket it). Every other block keeps the block-level
            // insert (a separated independent block), because pushing a new row inside a
            // heading / list / table / code / quote / hr would tear its structure.
            const isParagraph = el.tagName === "P" || el.classList.contains("paragraph");
            const isBlankSpacer = el.classList.contains("blank-spacer");
            const inlineMode = isParagraph && !isBlankSpacer;

            // Insert a SINGLE blank row into the document immediately (so the preview visibly
            // gains one line the moment the user clicks), remember the pre-edit text for
            // Esc/empty-commit revert, and open a blank editor on that row. The final commit
            // replaces the row with the draft — inline paragraphs replace with no separator
            // blanks (flush new line), block-level anchors re-add separators as needed — so
            // one click nets exactly one new row/block, with no stray blanks left behind.
            const originalText = text;
            const newFull = spliceBlankRow(text.split(/\r\n|\n/), startLine, endLine, mode).join("\n");
            handleInlineEditCommit(newFull);
            const newLine = mode === "before" ? startLine : endLine + 1;
            focusEditedLine(newLine, () => handleInlineEditCommit(originalText), inlineMode ? "inline" : true);

            setInsertAnchor(null);
            setInsertPos(null);
            setGripOpen(false);
        },
        [handleInlineEditCommit, resolveBlockAnchorEl, text, focusEditedLine]
    );

    const inlineEditKeyDown = useMemo(
        () =>
            makeInlineEditKeydown({
                commit: inlineEdit.commit,
                cancel: inlineEdit.cancel,
                save: onInlineEditSave,
                onSplitCaret: handleEnterSplit,
            }),
        [inlineEdit.commit, inlineEdit.cancel, onInlineEditSave, handleEnterSplit]
    );

    const normalizedScrollTargetText = useMemo(
        () => normalizeScrollTargetText(scrollTargetText ?? ""),
        [scrollTargetText]
    );

    const updateCollapsedHeadingVisibility = () => {
        if (!contentsOsRef.current?.osInstance()) {
            return;
        }
        const { viewport } = contentsOsRef.current.osInstance().elements();
        const root = viewport.querySelector(".markdown-render-root");
        if (root == null) {
            return;
        }
        const elements = Array.from(root.children) as HTMLElement[];
        const collapsedHeadingStack: number[] = [];
        for (const elem of elements) {
            const headingLevelValue = Number(elem.dataset.headingLevel);
            const headingLevel = Number.isFinite(headingLevelValue) && headingLevelValue > 0 ? headingLevelValue : null;
            const hidden = shouldHideMarkdownElementForCollapsedHeadings(
                headingLevel,
                elem.dataset.headingId ?? null,
                collapsedHeadings,
                collapsedHeadingStack
            );
            elem.classList.toggle("collapsed-hidden", hidden);
        }
    };

    useEffect(() => {
        updateCollapsedHeadingVisibility();
    }, [collapsedHeadings, transformedText]);

    useLayoutEffect(() => {
        const instance = contentsOsRef.current?.osInstance();
        if (!instance) {
            previousTransformedTextRef.current = transformedText;
            return;
        }
        const { viewport } = instance.elements();
        const previousTransformedText = previousTransformedTextRef.current;
        if (previousTransformedText != null && previousTransformedText !== transformedText) {
            // OverlayScrollbars resets scrollTop during ReactMarkdown's child re-mount for one
            // visible frame — the user sees a flash to the top before we set it back. Mask that
            // frame: hide the viewport's contents for the layout pass, snap scrollTop to the
            // user's live ref position, then reveal on the next animation frame once layout has
            // stabilized. visibility:hidden (vs display:none) keeps the box geometry intact so the
            // restore scrollTop value lands on the right row, the OS only skips painting the glow.
            const prevVisibility = viewport.style.visibility;
            viewport.style.visibility = "hidden";
            viewport.scrollTop = lastViewportScrollTopRef.current;
            requestAnimationFrame(() => {
                viewport.style.visibility = prevVisibility;
            });
            liveScrollDebug("restore preview scroll after content update", {
                restoredScrollTop: lastViewportScrollTopRef.current,
            });
        }
        previousTransformedTextRef.current = transformedText;
    }, [transformedText]);

    useEffect(() => {
        if (!hideUntilInitialScroll) {
            setInitialScrollReadyKey(transformedText);
            onInitialScrollReady?.();
            return;
        }
        const timer = window.setTimeout(() => {
            setInitialScrollReadyKey((readyKey) => {
                if (readyKey == null) {
                    onInitialScrollReady?.();
                    return transformedText;
                }
                return readyKey;
            });
        }, InitialScrollRevealFallbackMs);
        return () => window.clearTimeout(timer);
    }, [hideUntilInitialScroll, onInitialScrollReady, transformedText]);

    const shouldHideForInitialScroll = hideUntilInitialScroll && initialScrollReadyKey !== transformedText;

    const toggleHeadingCollapse = (headingId: string) => {
        setCollapsedHeadings((prev) => {
            const next = new Set(prev);
            if (next.has(headingId)) {
                next.delete(headingId);
            } else {
                next.add(headingId);
            }
            onCollapsedHeadingsChange?.(next);
            return next;
        });
    };

    const toggleOrderedListItemCollapse = (itemId: string) => {
        setCollapsedOrderedListItems((prev) => {
            const next = new Set(prev);
            if (next.has(itemId)) {
                next.delete(itemId);
            } else {
                next.add(itemId);
            }
            onCollapsedOrderedListItemsChange?.(next);
            return next;
        });
    };

    const toggleTableCollapse = (tableKey: string) => {
        setCollapsedTables((prev) => {
            const next = new Set(prev);
            if (next.has(tableKey)) {
                next.delete(tableKey);
            } else {
                next.add(tableKey);
            }
            onCollapsedTablesChange?.(next);
            return next;
        });
    };

    const focusHeading = (href: string) => {
        const headingId = getHeadingIdFromHref(idPrefix, href);
        setCollapsedHeadings((prev) => {
            if (!prev.has(headingId)) {
                return prev;
            }
            const next = new Set(prev);
            next.delete(headingId);
            return next;
        });
        setFocusedHeadingId(headingId);
    };

    const focusHeadingLine = (lineNumber: number) => {
        const instance = contentsOsRef.current?.osInstance();
        if (!instance) {
            return;
        }
        const { viewport } = instance.elements();
        const heading = viewport.querySelector<HTMLElement>(
            `.markdown-render-root .heading[data-source-line="${lineNumber}"]`
        );
        if (!heading) {
            return;
        }
        const headingId = heading.dataset.headingId;
        if (headingId) {
            setCollapsedHeadings((prev) => {
                if (!prev.has(headingId)) {
                    return prev;
                }
                const next = new Set(prev);
                next.delete(headingId);
                return next;
            });
        }
        const headingBoundingRect = heading.getBoundingClientRect();
        const viewportBoundingRect = viewport.getBoundingClientRect();
        const headingTop = headingBoundingRect.top - viewportBoundingRect.top;
        viewport.scrollBy({ top: headingTop });
    };

    useEffect(() => {
        if (focusedHeadingId && contentsOsRef.current && contentsOsRef.current.osInstance()) {
            const { viewport } = contentsOsRef.current.osInstance().elements();
            const heading = document.getElementById(focusedHeadingId);
            if (heading) {
                const headingBoundingRect = heading.getBoundingClientRect();
                const viewportBoundingRect = viewport.getBoundingClientRect();
                const headingTop = headingBoundingRect.top - viewportBoundingRect.top;
                viewport.scrollBy({ top: headingTop });
            }
        }
    }, [focusedHeadingId]);

    const applyScrollTarget = (trigger: string) => {
        if (scrollTargetLine == null || !contentsOsRef.current?.osInstance()) {
            lastAppliedScrollTargetRef.current = null;
            liveScrollDebug("skip preview scroll: no target or no instance", {
                trigger,
                hasTarget: scrollTargetLine != null,
                hasInstance: !!contentsOsRef.current?.osInstance(),
            });
            return;
        }
        const { viewport } = contentsOsRef.current.osInstance().elements();
        if (scrollTargetSourceState?.origin === "preview" && Date.now() < scrollTargetSourceState.previewControlUntil) {
            liveScrollDebug("skip preview scroll: preview owns scroll", {
                trigger,
                scrollTargetLine,
                sourceSequence: scrollTargetSourceState.sequence,
                previewControlUntil: scrollTargetSourceState.previewControlUntil,
            });
            setInitialScrollReadyKey(transformedText);
            onInitialScrollReady?.();
            return;
        }
        const previewRemainingPx = Math.max(0, viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop);
        const bottomCompensationPx =
            scrollTargetSourceState?.bottomScrollIntent &&
            scrollTargetSourceState.isAtBottom &&
            scrollTargetSourceState.direction === "down" &&
            previewRemainingPx > ScrollTargetTolerancePx
                ? Math.min(BottomCompensationStepPx, previewRemainingPx)
                : 0;
        const lastAppliedTarget = lastAppliedScrollTargetRef.current;
        if (lastAppliedTarget?.line === scrollTargetLine && lastAppliedTarget.text === transformedText) {
            if (bottomCompensationPx <= 0) {
                liveScrollDebug("skip preview scroll: duplicate target", { trigger, scrollTargetLine });
                setInitialScrollReadyKey(transformedText);
                onInitialScrollReady?.();
                return;
            }
            programmaticScrollUntilRef.current = Date.now() + ProgrammaticScrollIgnoreMs;
            liveScrollDebug("apply preview bottom compensation", {
                trigger,
                scrollTargetLine,
                bottomCompensationPx,
                previewRemainingPx,
                sourceSequence: scrollTargetSourceState?.sequence,
                previousScrollTop: viewport.scrollTop,
            });
            viewport.scrollBy({ top: bottomCompensationPx, behavior: scrollTargetBehavior });
            lastViewportScrollTopRef.current = viewport.scrollTop;
            setInitialScrollReadyKey(transformedText);
            onInitialScrollReady?.();
            return;
        }
        const lineElems = Array.from(viewport.querySelectorAll<HTMLElement>("[data-source-line]"));
        if (lineElems.length === 0) {
            liveScrollDebug("skip preview scroll: no source line elements", { trigger, scrollTargetLine });
            return;
        }
        let targetElem: HTMLElement | null = null;
        let targetElemIndex = -1;
        for (const elem of lineElems) {
            const elemIndex = lineElems.indexOf(elem);
            const elemLine = Number(elem.dataset.sourceLine);
            if (!Number.isFinite(elemLine)) {
                continue;
            }
            if (elemLine <= scrollTargetLine) {
                targetElem = elem;
                targetElemIndex = elemIndex;
                continue;
            }
            if (targetElem == null) {
                targetElem = elem;
                targetElemIndex = elemIndex;
            }
            break;
        }
        if (targetElem == null) {
            targetElem = lineElems[lineElems.length - 1];
            targetElemIndex = lineElems.length - 1;
        }
        let textMatched = false;
        if (normalizedScrollTargetText.length >= 3 && targetElemIndex >= 0) {
            const startIndex = Math.max(0, targetElemIndex - ScrollTextMatchWindow);
            const endIndex = Math.min(lineElems.length - 1, targetElemIndex + ScrollTextMatchWindow);
            for (let index = startIndex; index <= endIndex; index++) {
                const elem = lineElems[index];
                const elemText = getElementTextForScrollMatch(elem);
                if (elemText.length < 3) {
                    continue;
                }
                if (elemText.includes(normalizedScrollTargetText) || normalizedScrollTargetText.includes(elemText)) {
                    targetElem = elem;
                    targetElemIndex = index;
                    textMatched = true;
                    break;
                }
            }
        }
        const targetSourceLine = Number(targetElem.dataset.sourceLine);
        const targetBoundingRect = targetElem.getBoundingClientRect();
        const viewportBoundingRect = viewport.getBoundingClientRect();
        const targetTop = targetBoundingRect.top - viewportBoundingRect.top;
        const isAlreadyNearTarget = Math.abs(targetTop - ScrollTargetTopOffset) <= ScrollTargetTolerancePx;
        if (isAlreadyNearTarget && bottomCompensationPx <= 0) {
            lastAppliedScrollTargetRef.current = { line: scrollTargetLine, text: transformedText };
            liveScrollDebug("skip preview scroll: already near target", {
                trigger,
                scrollTargetLine,
                scrollTargetText,
                textMatched,
                targetSourceLine,
                targetTop,
            });
            setInitialScrollReadyKey(transformedText);
            onInitialScrollReady?.();
            return;
        }
        programmaticScrollUntilRef.current = Date.now() + ProgrammaticScrollIgnoreMs;
        const scrollDelta = (isAlreadyNearTarget ? 0 : targetTop - ScrollTargetTopOffset) + bottomCompensationPx;
        liveScrollDebug("apply preview scroll", {
            trigger,
            scrollTargetLine,
            scrollTargetText,
            textMatched,
            targetSourceLine,
            targetTop,
            delta: scrollDelta,
            behavior: scrollTargetBehavior,
            bottomCompensationPx,
            previewRemainingPx,
            sourceSequence: scrollTargetSourceState?.sequence,
            previousScrollTop: viewport.scrollTop,
        });
        viewport.scrollBy({ top: scrollDelta, behavior: scrollTargetBehavior });
        lastViewportScrollTopRef.current = viewport.scrollTop;
        lastAppliedScrollTargetRef.current = { line: scrollTargetLine, text: transformedText };
        setInitialScrollReadyKey(transformedText);
        onInitialScrollReady?.();
    };

    useEffect(() => {
        applyScrollTarget("effect");
    }, [
        normalizedScrollTargetText,
        scrollTargetBehavior,
        scrollTargetLine,
        scrollTargetSourceState?.sequence,
        transformedText,
    ]);

    // Restore the caller's savedScrollTop once per mount, after the ReactMarkdown subtree has
    // produced content (so scrollHeight reflects the file). Skipped when scrollTargetLine is set —
    // a "preview:searchline" jump from block.meta takes precedence (mirrors the editor viewState
    // vs revealSearchTargetLine precedence in preview-edit.tsx). Two rAF passes handle the common
    // case where images/mermaid still inflate scrollHeight on the first frame.
    useEffect(() => {
        if (savedScrollTopAppliedRef.current) {
            return;
        }
        if (savedScrollTop == null || !Number.isFinite(savedScrollTop) || savedScrollTop <= 0) {
            return;
        }
        if (scrollTargetLine != null && Number.isFinite(scrollTargetLine)) {
            savedScrollTopAppliedRef.current = true;
            return;
        }
        const instance = contentsOsRef.current?.osInstance();
        const viewport = instance?.elements().viewport;
        if (!viewport || !transformedText) {
            return;
        }
        if (viewport.scrollHeight <= viewport.clientHeight) {
            return; // wait for content to populate
        }
        viewport.scrollTop = savedScrollTop;
        programmaticScrollUntilRef.current = Date.now() + ProgrammaticScrollIgnoreMs;
        savedScrollTopAppliedRef.current = true;
        // Re-apply on the next two frames in case scrollHeight grows after images/code settle.
        const raf1 = requestAnimationFrame(() => {
            const inst = contentsOsRef.current?.osInstance();
            const vp = inst?.elements().viewport;
            if (vp) {
                vp.scrollTop = savedScrollTop;
                programmaticScrollUntilRef.current = Date.now() + ProgrammaticScrollIgnoreMs;
            }
        });
        const raf2 = requestAnimationFrame(() => {
            const inst = contentsOsRef.current?.osInstance();
            const vp = inst?.elements().viewport;
            if (vp) {
                vp.scrollTop = savedScrollTop;
                programmaticScrollUntilRef.current = Date.now() + ProgrammaticScrollIgnoreMs;
            }
        });
        return () => {
            cancelAnimationFrame(raf1);
            cancelAnimationFrame(raf2);
        };
    }, [savedScrollTop, scrollTargetLine, transformedText]);

    // Cancel any pending scrollTop write-back on unmount.
    useEffect(() => {
        return () => {
            if (scrollTopWriteRafRef.current != null) {
                cancelAnimationFrame(scrollTopWriteRafRef.current);
                scrollTopWriteRafRef.current = null;
            }
        };
    }, []);

    const handleMarkdownScroll = () => {
        // Always sync the live scrollTop into the ref, even when we're going to bail below. The ref
        // is the restore-ancla for the useLayoutEffect that runs after `transformedText` changes
        // (line 963 → viewport.scrollTop = lastViewportScrollTopRef.current on a content update).
        // Without this line, in preview mode (where onUserScrollSourceLine is null) the ref would
        // stay at its initial 0 — so any save / inline-edit commit that flips transformedText
        // yanks the viewport back to the top of the file. Hijacking early-return here is the
        // smallest patch: the user-visible scroll position stays live across edits + saves.
        const instance = contentsOsRef.current?.osInstance();
        if (instance) {
            const { viewport } = instance.elements();
            lastViewportScrollTopRef.current = viewport.scrollTop;
        }
        if (Date.now() < programmaticScrollUntilRef.current) {
            return;
        }
        if (onScrollTopChange != null && instance) {
            const { viewport } = instance.elements();
            // Debounce on rAF so a flinging trackpad doesn't write on every pixel.
            if (scrollTopWriteRafRef.current != null) {
                cancelAnimationFrame(scrollTopWriteRafRef.current);
            }
            const st = viewport.scrollTop;
            scrollTopWriteRafRef.current = requestAnimationFrame(() => {
                scrollTopWriteRafRef.current = null;
                onScrollTopChange(st);
            });
        }
        if (onUserScrollSourceLine == null) {
            return;
        }
        if (!instance) {
            return;
        }
        const { viewport } = instance.elements();
        const viewportBoundingRect = viewport.getBoundingClientRect();
        const lineElems = Array.from(viewport.querySelectorAll<HTMLElement>("[data-source-line]"));
        if (lineElems.length === 0) {
            return;
        }
        let targetLine: number | null = null;
        let smallestDistance = Number.POSITIVE_INFINITY;
        for (const elem of lineElems) {
            const elemLine = Number(elem.dataset.sourceLine);
            if (!Number.isFinite(elemLine)) {
                continue;
            }
            const elemTop = elem.getBoundingClientRect().top - viewportBoundingRect.top;
            const distance = Math.abs(elemTop - ScrollTargetTopOffset);
            if (elemTop <= ScrollTargetTopOffset) {
                targetLine = elemLine;
                continue;
            }
            if (targetLine == null && distance < smallestDistance) {
                targetLine = elemLine;
                smallestDistance = distance;
            }
            break;
        }
        if (targetLine == null) {
            const lastElem = lineElems[lineElems.length - 1];
            const elemLine = Number(lastElem.dataset.sourceLine);
            targetLine = Number.isFinite(elemLine) ? elemLine : null;
        }
        if (targetLine != null) {
            onUserScrollSourceLine(targetLine);
        }
    };

    const markdownComponents: Partial<Components> = {
        a: (props: React.HTMLAttributes<HTMLAnchorElement>) => (
            <Link props={props} focusHeading={focusHeading} resolveOpts={resolveOpts} />
        ),
        p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
            <div className="paragraph" {...props} {...srcLineAttrs(props)} />
        ),
        h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
            <CollapsibleHeading
                props={props}
                hnum={1}
                collapsed={collapsedHeadings.has(String(props.id))}
                onToggle={toggleHeadingCollapse}
            />
        ),
        h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
            <CollapsibleHeading
                props={props}
                hnum={2}
                collapsed={collapsedHeadings.has(String(props.id))}
                onToggle={toggleHeadingCollapse}
            />
        ),
        h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
            <CollapsibleHeading
                props={props}
                hnum={3}
                collapsed={collapsedHeadings.has(String(props.id))}
                onToggle={toggleHeadingCollapse}
            />
        ),
        h4: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
            <CollapsibleHeading
                props={props}
                hnum={4}
                collapsed={collapsedHeadings.has(String(props.id))}
                onToggle={toggleHeadingCollapse}
            />
        ),
        h5: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
            <CollapsibleHeading
                props={props}
                hnum={5}
                collapsed={collapsedHeadings.has(String(props.id))}
                onToggle={toggleHeadingCollapse}
            />
        ),
        h6: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
            <CollapsibleHeading
                props={props}
                hnum={6}
                collapsed={collapsedHeadings.has(String(props.id))}
                onToggle={toggleHeadingCollapse}
            />
        ),
        hr: (props: React.HTMLAttributes<HTMLHRElement>) => (
            <hr {...props} {...srcLineAttrs(props)} />
        ),
        table: (props: React.HTMLAttributes<HTMLTableElement>) => (
            <CollapsibleTable
                props={props}
                collapsed={collapsedTables.has(String(getSourceLine(props)))}
                onToggle={() => toggleTableCollapse(String(getSourceLine(props)))}
            />
        ),
        ol: (props: React.OlHTMLAttributes<HTMLOListElement>) => (
            <MarkdownOrderedList props={props} collapsible={collapsibleOrderedLists} />
        ),
        ul: MarkdownUnorderedList,
        li: (props: React.HTMLAttributes<HTMLLIElement>) => (
            <MarkdownListItem
                props={props}
                collapsed={collapsedOrderedListItems.has(getOrderedListItemId(props))}
                onToggle={toggleOrderedListItemCollapse}
            />
        ),
        img: (props: React.HTMLAttributes<HTMLImageElement>) => (
            <MarkdownImg
                props={props}
                resolveOpts={resolveOpts}
                fullText={text}
                onInlineEditCommit={handleInlineEditCommit}
            />
        ),
        source: (props: React.HTMLAttributes<HTMLSourceElement>) => (
            <MarkdownSource props={props} resolveOpts={resolveOpts} />
        ),
        code: Code,
        pre: (props: React.HTMLAttributes<HTMLPreElement>) => (
            <CodeBlock
                children={props.children}
                onClickExecute={onClickExecute}
                sourceLine={getSourceLine(props)}
                sourceLineEnd={getSourceLineEnd(props)}
            />
        ),
    };
    // useCallback 稳定 waveblock 委托的组件引用（根治 remount 丢 state）：内联箭头函数每次
    // 渲染都是新引用，React 把 waveblock 子树判定为「新组件类型」→ 卸载重挂 → 块内组件
    // state（ObsidianPropertiesCard 的折叠/编辑）全部归零——鼠标移动（hover anchor）、
    // 滚动（insertPos）都会触发 Markdown 重渲染，折叠态因此一碰就丢（见 1359 行注释：
    // hover 重渲染会替换块的 DOM 节点）。依赖 contentBlocksMap/waveBlockRenderers 均已
    // useMemo/useCallback 稳定，此回调在 text 不变时引用不变。
    const waveBlockComponent = useCallback(
        (props: any) => <WaveBlock {...props} blockmap={contentBlocksMap} renderers={waveBlockRenderers} />,
        [contentBlocksMap, waveBlockRenderers]
    );
    markdownComponents["waveblock"] = waveBlockComponent;
    markdownComponents["mermaidblock"] = (props: any) => {
        const getTextContent = (children: any): string => {
            if (typeof children === "string") {
                return children;
            } else if (Array.isArray(children)) {
                return children.map(getTextContent).join("");
            } else if (children && typeof children === "object" && children.props && children.props.children) {
                return getTextContent(children.props.children);
            }
            return String(children || "");
        };

        const chartText = getTextContent(props.children);
        return <Mermaid chart={chartText} />;
    };

    const tocItems = useMemo<MarkdownOutlineItem[]>(
        () =>
            getMarkdownHeadings(transformedText).map((heading, index) => ({
                id: `${heading.lineNumber}-${index}`,
                label: heading.text,
                level: heading.level,
                lineNumber: heading.lineNumber,
            })),
        [transformedText]
    );

    const handleSelectTocItem = (item: MarkdownOutlineItem) => {
        if (item.lineNumber != null) {
            focusHeadingLine(item.lineNumber);
        }
    };

    let rehypePlugins = null;
    if (rehype) {
        rehypePlugins = [
            rehypeRaw,
            rehypeHighlight,
            () =>
                rehypeSanitize({
                    ...defaultSchema,
                    attributes: {
                        ...defaultSchema.attributes,
                        p: [
                            // blank-line-spacers plugin emits spacer paragraphs tagged with
                            // className=["paragraph","blank-spacer"] + dataSpacerLines +
                            // dataEmptySpacer. defaultSchema has no `p` entry so sanitize
                            // would strip these and the .paragraph.blank-spacer CSS sizing
                            // rules would never match.
                            //
                            // hast property names are camelCased (hastscript normalises
                            // kebab `data-spacer-lines` -> `dataSpacerLines`); a regex like
                            // /^data./ would also work, but pinning the exact names keeps
                            // the surface tight.
                            ["className", "paragraph", "blank-spacer"],
                            "dataSpacerLines",
                            "dataEmptySpacer",
                        ],
                        span: [
                            ...(defaultSchema.attributes?.span || []),
                            // Allow all class names starting with `hljs-`.
                            ["className", /^hljs-./],
                            ["srcset"],
                            ["media"],
                            ["type"],
                            // Alternatively, to allow only certain class names:
                            // ['className', 'hljs-number', 'hljs-title', 'hljs-variable']
                        ],
                        waveblock: [["blockkey"]],
                    },
                    protocols: {
                        ...defaultSchema.protocols,
                        href: [...FilePathHrefProtocols, "wave-wiki"],
                    },
                    tagNames: [
                        ...(defaultSchema.tagNames || []),
                        "span",
                        "waveblock",
                        "picture",
                        "source",
                        "mermaidblock",
                    ],
                }),
            () => rehypeSlug({ prefix: idPrefix }),
        ];
    }
    const remarkPlugins: any = makeRemarkPlugins({
        contentBlocksMap,
    });
    if (frontmatterBlock) {
        // 必须 push 插件+参数元组（ReactMarkdown 的 PluggableList 约定），
        // 不能 push 调用结果：unified 会把函数当插件以无参调用，transformer 的
        // tree 参数会变成 undefined → 运行时崩溃。
        remarkPlugins.push([
            remarkFrontmatterToWaveBlock,
            {
                startLine: frontmatterBlock.startLine,
                endLine: frontmatterBlock.endLine,
                blockKey: frontmatterBlock.blockKey,
            },
        ]);
    }

    const mergedStyle = { ...style };
    if (fontSizeOverride != null) {
        mergedStyle["--markdown-font-size"] = `${boundNumber(fontSizeOverride, 6, 64)}px`;
    }
    if (fixedFontSizeOverride != null) {
        mergedStyle["--markdown-fixed-font-size"] = `${boundNumber(fixedFontSizeOverride, 6, 64)}px`;
    }
    return (
        <div
            className={clsx("markdown", className)}
            style={mergedStyle}
            data-copy-context-path={copyContextPath || undefined}
        >
            {scrollable ? (
                <OverlayScrollbarsComponent
                    ref={contentsOsRef}
                    className={cn("content", contentClassName, shouldHideForInitialScroll && "invisible")}
                    options={{ scrollbars: { autoHide: "leave" } }}
                    events={{
                        initialized: () => requestAnimationFrame(() => applyScrollTarget("initialized")),
                        scroll: handleMarkdownScroll,
                    }}
                    // Capture-phase dblclick so we beat CollapsibleHeading's own dblclick toggle
                    // and any native selection side effects. The handler no-ops unless the
                    // parent wired onInlineEditCommit (i.e. opt-in to inline editing).
                    onDoubleClickCapture={handleInlineEditDblClick}
                    // Mousedown (capture) records the pre-press selection so the bubble-phase
                    // click handler can tell drag-select from pure click.
                    onMouseDownCapture={handleInlineEditMouseDown}
                    // Bubble-phase click — single-click-to-edit. Runs after <Link> and chevron
                    // button onClick, so e.defaultPrevented / e.target.closest(...) guard
                    // interactive children, and a grown live selection guards drag-select.
                    onClick={handleInlineEditClick}
                    onMouseOver={handleRootMouseOver}
                    onMouseLeave={handleRootMouseLeave}
                >
                    <ReactMarkdown
                        remarkPlugins={remarkPlugins}
                        rehypePlugins={rehypePlugins}
                        components={markdownComponents}
                        urlTransform={markdownUrlTransform}
                        className="markdown-render-root"
                    >
                        {transformedText}
                    </ReactMarkdown>
                    {onInlineEditCommit && (
                        <InlineEditOverlay
                            overlayRect={inlineEdit.overlayRect}
                            blockKind={inlineEdit.editSession?.blockKind ?? null}
                            draftText={inlineEdit.draftText}
                            textareaRef={inlineEdit.textareaRef}
                            onTextChange={inlineEdit.setDraftText}
                            onKeyDown={inlineEditKeyDown}
                            onPaste={handleEditorPaste}
                            onBlur={inlineEdit.commit}
                        />
                    )}
                    {onInlineEditCommit && selectedBlock != null && inlineEdit.editSession == null &&
                        ReactDOM.createPortal(
                            <div
                                className="markdown-block-selected"
                                style={{
                                    top: selectedBlock.rect.top,
                                    left: selectedBlock.rect.left,
                                    width: selectedBlock.rect.width,
                                    height: selectedBlock.rect.height,
                                }}
                            />,
                            document.body
                        )}
                    {onInlineEditCommit && insertPos != null && inlineEdit.editSession == null &&
                        ReactDOM.createPortal(
                            <>
                                {/* C: 4-dot grip — gutter left of the block, top-left. Click selects the block + opens the block menu. */}
                                <div
                                    className="markdown-block-grip-dots"
                                    style={{ top: insertPos.top, left: insertPos.left }}
                                    onMouseEnter={handleGripEnter}
                                    onMouseLeave={handleGripLeave}
                                    onClick={handleGripMenuClick}
                                    role="button"
                                    aria-label="Block actions"
                                    title="Block actions"
                                >
                                    <i className="markdown-block-grip-dot" aria-hidden="true" />
                                    <i className="markdown-block-grip-dot" aria-hidden="true" />
                                    <i className="markdown-block-grip-dot" aria-hidden="true" />
                                    <i className="markdown-block-grip-dot" aria-hidden="true" />
                                </div>
                                {/* A: insert above — same column, just above the grip. */}
                                <button
                                    className={
                                        "markdown-block-grip-action" +
                                        (gripOpen ? "" : " markdown-block-grip-action-hidden")
                                    }
                                    title="Insert block above"
                                    aria-label="Insert block above"
                                    style={{ top: insertPos.top - 33, left: insertPos.left }}
                                    onMouseEnter={handleGripEnter}
                                    onMouseLeave={handleGripLeave}
                                    onClick={() => handleInsertClick("before")}
                                >
                                    <i className="fa-sharp fa-solid fa-plus" />
                                </button>
                                {/* B: insert below — same column, just below the grip. */}
                                <button
                                    className={
                                        "markdown-block-grip-action" +
                                        (gripOpen ? "" : " markdown-block-grip-action-hidden")
                                    }
                                    title="Insert block below"
                                    aria-label="Insert block below"
                                    style={{ top: insertPos.top + 15, left: insertPos.left }}
                                    onMouseEnter={handleGripEnter}
                                    onMouseLeave={handleGripLeave}
                                    onClick={() => handleInsertClick("after")}
                                >
                                    <i className="fa-sharp fa-solid fa-plus" />
                                </button>
                            </>,
                            document.body
                        )}
                </OverlayScrollbarsComponent>
            ) : (
                <div className={cn("content non-scrollable", contentClassName)}>
                    <ReactMarkdown
                        remarkPlugins={remarkPlugins}
                        rehypePlugins={rehypePlugins}
                        components={markdownComponents}
                        urlTransform={markdownUrlTransform}
                    >
                        {transformedText}
                    </ReactMarkdown>
                </div>
            )}
            {showToc && (
                <div className="toc">
                    <MarkdownOutline
                        items={tocItems}
                        placement="sidebar"
                        resizeAxes={{ width: true }}
                        resizeStorageKey="snorkeling.markdownOutline.preview.size"
                        onSelectItem={handleSelectTocItem}
                    />
                </div>
            )}
        </div>
    );
};

export { Markdown };
