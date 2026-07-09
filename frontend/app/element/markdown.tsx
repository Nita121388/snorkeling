// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CopyButton } from "@/app/element/copybutton";
import { shouldHideMarkdownElementForCollapsedHeadings } from "@/app/element/markdown-collapse";
import { createContentBlockPlugin } from "@/app/element/markdown-contentblock-plugin";
import { MarkdownOutline, type MarkdownOutlineItem } from "@/app/element/markdown-outline";
import {
    MarkdownContentBlockType,
    resolveRemoteFile,
    resolveSrcSet,
    transformBlocks,
} from "@/app/element/markdown-util";
import remarkMermaidToTag from "@/app/element/remark-mermaid-to-tag";
import { getMarkdownHeadings } from "@/app/monaco/markdown-folding";
import { boundNumber, cn, useAtomValueSafe } from "@/util/util";
import clsx from "clsx";
import { Atom } from "jotai";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import {
    Children,
    cloneElement,
    createContext,
    isValidElement,
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
import remarkGfm from "remark-gfm";
import { openLink } from "../store/global";
import { normalizeLinkedFilePath, openFileLinkInPreview } from "../view/preview/file-link-navigation";
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

function remarkSoftBreaks() {
    return (tree: any) => {
        const visitNode = (node: any) => {
            if (!node || !Array.isArray(node.children)) {
                return;
            }
            const nextChildren: any[] = [];
            for (const child of node.children) {
                if (child?.type === "text" && typeof child.value === "string" && child.value.includes("\n")) {
                    const lines = child.value.split("\n");
                    lines.forEach((line, index) => {
                        if (index > 0) {
                            nextChildren.push({ type: "break" });
                        }
                        if (line.length > 0) {
                            nextChildren.push({ ...child, value: line });
                        }
                    });
                    continue;
                }
                visitNode(child);
                nextChildren.push(child);
            }
            node.children = nextChildren;
        };
        visitNode(tree);
    };
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
        e.preventDefault();
        if (href.startsWith("#")) {
            focusHeading(href);
        } else {
            void openFileLinkInPreview(href, {
                connection: resolveOpts?.connName,
                baseDir: resolveOpts?.baseDir,
                openDirectoryIndex: true,
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

function sourceLineAttrs(sourceLine?: number): Record<string, number> {
    return sourceLine == null ? {} : { "data-source-line": sourceLine };
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
    // 因此先unwrap paragraph 再 split，行为统一。
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
    const summaryChildren = wrapper != null ? [cloneWithChildren(wrapper, before)] : before;
    const bodyChildren = (wrapper != null ? [cloneWithChildren(wrapper, after)] : after).concat(childArray.slice(1));
    return {
        summaryChildren: trimBlankTextNodes(summaryChildren),
        bodyChildren: trimBlankTextNodes(bodyChildren),
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
    const sourceLine = getSourceLine(props);
    const headingId = typeof props.id === "string" ? props.id : "";
    return (
        <div
            id={props.id}
            className={clsx("heading", `is-${hnum}`, { collapsed })}
            data-heading-level={hnum}
            data-heading-id={headingId}
            {...sourceLineAttrs(sourceLine)}
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
        <ol {...props} {...sourceLineAttrs(getSourceLine(props))} />
    </OrderedListContext.Provider>
);

const MarkdownUnorderedList = (props: React.HTMLAttributes<HTMLUListElement>) => (
    <OrderedListContext.Provider value={false}>
        <ul {...props} {...sourceLineAttrs(getSourceLine(props))} />
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
        return <li {...props} {...sourceLineAttrs(sourceLine)} />;
    }
    return (
        <li
            {...props}
            {...sourceLineAttrs(sourceLine)}
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
    return <li {...props} {...sourceLineAttrs(getSourceLine(props))} />;
};

const MarkdownTable = (props: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="table-wrapper" {...sourceLineAttrs(getSourceLine(props))}>
        <table {...props} />
    </div>
);

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
};

const CodeBlock = ({ children, onClickExecute, sourceLine }: CodeBlockProps) => {
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
        <pre className="codeblock" {...sourceLineAttrs(sourceLine)}>
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
}

function WaveBlock(props: WaveBlockProps) {
    const { blockkey, blockmap } = props;
    const block = blockmap.get(blockkey);
    if (block == null) {
        return null;
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
}: {
    props: React.ImgHTMLAttributes<HTMLImageElement>;
    resolveOpts: MarkdownResolveOpts;
}) => {
    const [resolvedSrc, setResolvedSrc] = useState<string>(props.src);
    const [resolvedSrcSet, setResolvedSrcSet] = useState<string>(props.srcSet);
    const [resolvedStr, setResolvedStr] = useState<string>(null);
    const [resolving, setResolving] = useState<boolean>(true);

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

    if (resolving) {
        return null;
    }
    if (resolvedStr != null) {
        return <span>{resolvedStr}</span>;
    }
    if (resolvedSrc != null) {
        return <img {...props} src={resolvedSrc} srcSet={resolvedSrcSet} />;
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
    scrollable = true,
    rehype = true,
    onClickExecute,
}: MarkdownProps) => {
    const textAtomValue = useAtomValueSafe<string>(textAtom);
    const showToc = useAtomValueSafe(showTocAtom) ?? false;
    const contentsOsRef = useRef<OverlayScrollbarsComponentRef>(null);
    const programmaticScrollUntilRef = useRef(0);
    const lastAppliedScrollTargetRef = useRef<{ line: number; text: string } | null>(null);
    const lastViewportScrollTopRef = useRef(0);
    const previousTransformedTextRef = useRef<string | null>(null);
    const [initialScrollReadyKey, setInitialScrollReadyKey] = useState<string | null>(null);
    const [focusedHeadingId, setFocusedHeadingId] = useState<string>(null);
    const [collapsedHeadings, setCollapsedHeadings] = useState<Set<string>>(() => new Set());
    const [collapsedOrderedListItems, setCollapsedOrderedListItems] = useState<Set<string>>(() => new Set());

    // Ensure uniqueness of ids between MD preview instances.
    const [idPrefix] = useState<string>(crypto.randomUUID());

    text = textAtomValue ?? text ?? "";
    const transformedOutput = transformBlocks(text);
    const transformedText = transformedOutput.content;
    const contentBlocksMap = transformedOutput.blocks;
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
            viewport.scrollTop = lastViewportScrollTopRef.current;
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

    const handleMarkdownScroll = () => {
        if (onUserScrollSourceLine == null || Date.now() < programmaticScrollUntilRef.current) {
            return;
        }
        const instance = contentsOsRef.current?.osInstance();
        if (!instance) {
            return;
        }
        const { viewport } = instance.elements();
        lastViewportScrollTopRef.current = viewport.scrollTop;
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
            <div className="paragraph" {...props} {...sourceLineAttrs(getSourceLine(props))} />
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
        table: MarkdownTable,
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
        img: (props: React.HTMLAttributes<HTMLImageElement>) => <MarkdownImg props={props} resolveOpts={resolveOpts} />,
        source: (props: React.HTMLAttributes<HTMLSourceElement>) => (
            <MarkdownSource props={props} resolveOpts={resolveOpts} />
        ),
        code: Code,
        pre: (props: React.HTMLAttributes<HTMLPreElement>) => (
            <CodeBlock children={props.children} onClickExecute={onClickExecute} sourceLine={getSourceLine(props)} />
        ),
    };
    markdownComponents["waveblock"] = (props: any) => <WaveBlock {...props} blockmap={contentBlocksMap} />;
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
                        href: FilePathHrefProtocols,
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
    const remarkPlugins: any = [
        remarkMermaidToTag,
        remarkSoftBreaks,
        remarkGfm,
        [createContentBlockPlugin, { blocks: contentBlocksMap }],
    ];

    const mergedStyle = { ...style };
    if (fontSizeOverride != null) {
        mergedStyle["--markdown-font-size"] = `${boundNumber(fontSizeOverride, 6, 64)}px`;
    }
    if (fixedFontSizeOverride != null) {
        mergedStyle["--markdown-fixed-font-size"] = `${boundNumber(fixedFontSizeOverride, 6, 64)}px`;
    }
    return (
        <div className={clsx("markdown", className)} style={mergedStyle}>
            {scrollable ? (
                <OverlayScrollbarsComponent
                    ref={contentsOsRef}
                    className={cn("content", contentClassName, shouldHideForInitialScroll && "invisible")}
                    options={{ scrollbars: { autoHide: "leave" } }}
                    events={{
                        initialized: () => requestAnimationFrame(() => applyScrollTarget("initialized")),
                        scroll: handleMarkdownScroll,
                    }}
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
