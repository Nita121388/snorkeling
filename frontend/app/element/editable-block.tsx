// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * EditableBlock — A3 在位编辑（wysiwyg-inplace）的编辑体组件。
 *
 * 设计目标（prd R1）：**渲染面就是编辑面，只有一套样式**。当某个块命中活跃
 * 会话（`ctx.inplaceSession`）时，渲染器把该块改渲染为本组件——根元素的
 * tag + className 与预览渲染器的输出**逐字一致**，因此命中同一套
 * `.markdown .content` 样式 → 编辑态与预览态差异 by construction 为零。
 *
 * 结构（按 kind）：
 *   - p      → `<div class="paragraph" data-* contenteditable>`（与渲染器 p 输出一致）
 *   - h      → `<div class="heading is-N" data-*><span class="heading-title" contenteditable>`
 *              外层 heading 提供字号/字重/边距（预览样式），内层 title span 承载文本
 *              （与渲染器 CollapsibleHeading 的 `.heading > .heading-title` 同构）
 *   - quote  → `<blockquote data-* contenteditable>`（与渲染器 blockquote 输出一致）
 *   - callout→ `<calloutalert class="markdown-alert" data-* contenteditable>`
 *
 * 内部直接复用 `WysiwygEditor`（键盘/IME/序列化/活体 kind 转换全在里面），通过
 * `rootTag` / `rootClassName` / `rootAttrs` 三个新增 props 覆盖默认的 wysiwyg-*
 * 根形态（overlay 路径不传这三个 props → 行为逐字节不变）。
 *
 * 冻结：编辑期间该块不读 textAtom 内容（种子来自会话捕获的 `seedHtml`），
 * 组件用 `memo` 包裹且 props 引用稳定 → React 复用实例、不重写 contentEditable DOM。
 *
 * 提交/取消：blur → 序列化（WysiwygEditor.getMarkdown）→ 调 `onCommit`（宿主侧
 * prepareInlineEditCommit → 写盘 + undo）；Esc → `onCancel`（无写盘，会话清除）。
 */

import React, { memo, useCallback, useEffect, useRef } from "react";
import { WysiwygEditor, type WysiwygEditorHandle } from "./wysiwyg-editor";
import type { InplaceRenderSession } from "@md/core/render";
import { headingRootAttrs, srcLineAttrs } from "@md/core/render";

export type EditableBlockProps = {
    /** 活跃会话（含定位信息 + 种子 HTML + callout 前缀）。 */
    session: InplaceRenderSession;
    /** 渲染器透传的 react-markdown 块 props（根 data-* 从这里取，与预览一致）。 */
    blockProps?: any;
    /** 提交回调：宿主侧执行 prepareInlineEditCommit → 写盘（内容为序列化后的完整块 markdown）。 */
    onCommit?: (content: string) => void;
    /** 取消回调：宿主侧清除会话，不写盘。 */
    onCancel?: () => void;
    /**
     * Enter 拆分回调（A3 与 overlay 同源，prd R3）：裸 Enter（非 IME / 非 Shift / 非 Cmd）
     * 把当前块在光标处拆成两块——before 留在原块提交，after 作为新块插入并继续编辑。
     * 宿主侧复用 splitBlockAtCaretText → handleInlineEditCommit → 新行开 inplace 会话。
     */
    onSplit?: (content: string, caretMarkdown: number) => void;
    /**
     * 保存回调（⌘/Ctrl+S）：宿主侧先提交当前块再 flush 到磁盘（与 overlay 的
     * makeInlineEditKeydown save 语义一致）。缺省时 ⌘S 只提交不落盘。
     */
    onSave?: () => void;
};

/**
 * 预览渲染器产出的根元素形态（与 renderer-registry 的 p / CollapsibleHeading /
 * blockquote / CalloutAlert / ul / ol 输出逐字一致）。EditableBlock 的根复用这里的
 * tag + className，保证命中同一套样式。callout 的 className 含类型后缀
 * （`markdown-alert markdown-alert-note`），从 blockProps 原样透传。
 *
 * 关键不变量：**本函数的返回值必须能由根同构对拍测试验证**
 * （inplace-root-isomorphism.test.tsx）。新增块型时同步在那边加 case。
 */
export function inplaceRootShape(
    session: Pick<InplaceRenderSession, "kind" | "headingLevel" | "isCallout" | "listTag">,
    blockProps?: any
): { tag: string; className?: string; contentEditableIsTitleSpan: boolean } {
    if (session.kind === "h") {
        // className 来自 md-core 真源（与 CollapsibleHeading 共用），不手拄 `heading is-N`。
        return {
            tag: "div",
            className: headingRootAttrs(blockProps, session.headingLevel ?? 1, false).className,
            contentEditableIsTitleSpan: true,
        };
    }
    if (session.kind === "quote") {
        if (!session.isCallout) {
            return { tag: "blockquote", contentEditableIsTitleSpan: false };
        }
        // callout：className 从预览 props 原样取（`markdown-alert markdown-alert-<type>`），
        // 与 CalloutAlert 渲染器输出逐字一致。
        const propsClass = typeof blockProps?.className === "string" ? blockProps.className : "";
        return { tag: "calloutalert", className: propsClass, contentEditableIsTitleSpan: false };
    }
    if (session.kind === "list") {
        // list 的预览根就是 <ul>/<ol> 本身（无 class）→ 位根用同一个 tag，不包 div。
        // tag 优先取会话字段，缺省时从 react-markdown 节点 tagName 推。
        const nodeTag = String(blockProps?.node?.tagName ?? "").toLowerCase();
        const tag = session.listTag ?? (nodeTag === "ol" ? "ol" : "ul");
        return { tag, className: undefined, contentEditableIsTitleSpan: false };
    }
    return { tag: "div", className: "paragraph", contentEditableIsTitleSpan: false };
}

/**
 * 从 react-markdown 块 props 提取与预览渲染器**相同**的 data-* 属性。
 *
 * 关键：这里**必须调用 md-core 的 `srcLineAttrs(props)`（唯一真源），不得手拄一份**。
 * 手拄版本曾与真源在退化节点上分叉：`getSourceLineEnd` 在 `position.end.line < start.line`
 * （或非整数）时回退成 **start**，而手拄版会原样吐出那个更小的 end → 在位路径声明出
 * **倒置的** `data-source-line-end`，提交时的源码切片区间反了。
 *
 * 这正是本项目反复栽的“第二份副本”陷阱：零差异要 by construction，根属性就必须
 * 复用渲染器的真源函数，而不是约定“抄得一样”。改srcLineAttrs 时本函数自动跟随。
 */
function previewRootAttrs(
    props: any,
    extra?: Record<string, string | number>
): Record<string, string | undefined> {
    const attrs: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(srcLineAttrs(props ?? {}))) {
        attrs[key] = String(value);
    }
    // heading 的 data-heading-level / data-heading-id 同样来自真源（CollapsibleHeading 共用）。
    // 这两个属性目前全仓只发不读，但缺失它们 = 根形态与预览不一致：日后任何人写一条
    // `.heading[data-heading-level="2"]` 选择器，编辑态就静默失配 —— 而对拍测试会变红。
    for (const [key, value] of Object.entries(extra ?? {})) {
        attrs[key] = String(value);
    }
    const blockId = props?.["data-block-id"];
    if (blockId != null && blockId !== "") {
        attrs["data-block-id"] = String(blockId);
    }
    if (typeof props?.id === "string" && props.id !== "") {
        attrs["id"] = props.id;
    }
    return attrs;
}

/**
 * heading 种子规范化：从 seedHtml 里取 **`.heading-title` 的内层**。
 *
 * 为什么需要：在位种子由 `captureInplaceSeedHtml` 产出，它保留渲染器的全部结构，
 * 所以 heading 的种子本身就是 `<span class="heading-title">…</span>`。而 EditableBlock
 * 已经**自己渲染**了一个 `.heading-title` 作为 contentEditable 根（外层 `.heading`
 * 保持非 contenteditable，否则里面的折叠按钮会落进可编辑区域）。
 * 不剥一层就会变成 `<span class="heading-title"><span class="heading-title">…</span></span>`，
 * 凭空多一层 → 直接破坏零差异。
 *
 * 种子不是 title span 包裹形态时（未来宿主自己拼的种子）原样透传，不猜。
 */
function headingSeedInnerHtml(seedHtml: string): string {
    if (typeof document === "undefined" || !seedHtml.includes("heading-title")) {
        return seedHtml;
    }
    const tpl = document.createElement("template");
    tpl.innerHTML = seedHtml;
    const roots = Array.from(tpl.content.children);
    const first = roots[0];
    if (roots.length === 1 && first?.classList.contains("heading-title")) {
        return first.innerHTML;
    }
    return seedHtml;
}

export const EditableBlock = memo(function EditableBlock({
    session,
    blockProps,
    onCommit,
    onCancel,
    onSplit,
    onSave,
}: EditableBlockProps) {
    const editorRef = useRef<WysiwygEditorHandle | null>(null);
    const rootShape = inplaceRootShape(session, blockProps);
    const rootAttrs = previewRootAttrs(
        blockProps,
        session.kind === "h" ? headingRootAttrs(blockProps, session.headingLevel ?? 1, false) : undefined
    );

    // 取消：Esc → onCancel（宿主清除会话，不写盘）。
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLElement>) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onCancel?.();
                return;
            }
            // 裸 Enter → 拆分（与 overlay 的 handleEnterSplit 同源，prd R3）。
            // IME 组合中的 Enter 是选候选词（nativeEvent.isComposing），绝不能拆块。
            if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.metaKey &&
                !e.ctrlKey &&
                !(e.nativeEvent as KeyboardEvent).isComposing &&
                onSplit != null
            ) {
                e.preventDefault();
                e.stopPropagation();
                const content = editorRef.current?.getMarkdown() ?? "";
                const caret = editorRef.current?.getCaretMarkdown() ?? content.length;
                onSplit(content, caret);
                return;
            }
            // ⌘/Ctrl+S → 提交 + 保存（与 overlay 的 makeInlineEditKeydown 同源）。
            if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S") && onSave != null) {
                e.preventDefault();
                e.stopPropagation();
                const content = editorRef.current?.getMarkdown() ?? "";
                onCommit?.(content); // 先把当前编辑内容提交进 draft（onSave 才 flush）
                onSave();
                return;
            }
            // 其余按键走浏览器默认（Enter 软换行 / IME 组合由 WysiwygEditor 处理）。
        },
        [onCancel, onSplit, onSave, onCommit, editorRef]
    );

    // 提交：blur → DOM 序列化为完整块 markdown → onCommit（宿主侧守卫 + 写盘）。
    const handleBlur = useCallback(
        (content: string) => {
            onCommit?.(content);
        },
        [onCommit]
    );

    // 会话期间 contentEditable 内的内容不读 textAtom；onInput 由 WysiwygEditor 镜像，
    // 这里只保留 no-op（切片 1 不需要 draftText 镜像，提交直接序列化 DOM）。
    const handleInput = useCallback((_md: string, _caret: number) => {}, []);

    // 挂载后聚焦编辑体（与 overlay 的 InlineEditOverlay focus 语义一致：进入编辑即聚焦）。
    useEffect(() => {
        const raf = requestAnimationFrame(() => {
            editorRef.current?.focus();
        });
        return () => cancelAnimationFrame(raf);
    }, []);

    // 根元素：p / quote / callout 直接用 WysiwygEditor 的根作为预览同 tag（contentEditable），
    // rootTag/rootClassName/rootAttrs 全部来自预览渲染器形态 → 零差异 by construction。
    // heading 需要两层：外层 .heading 命中预览字号/字重/边距，内层 span.heading-title 承载
    // 编辑文本（与渲染器 CollapsibleHeading 的 `.heading > .heading-title` 同构）。
    // 关键：必须保留 collapse-button 占位（preview 的 .heading 是 flex，button 占 0.857em + gap），
    // 否则进入编辑瞬间标题左移 → 违背「进出编辑零跳变」。button 保持 hover 显示语义不变。
    if (rootShape.contentEditableIsTitleSpan) {
        return (
            <div {...rootAttrs} className={rootShape.className ?? undefined}>
                <button
                    type="button"
                    className="heading-collapse-button"
                    title="Collapse section"
                    aria-label="Collapse section"
                    tabIndex={-1}
                />
                {/* 外层 .heading 保持非 contenteditable（样式宿主）；内层 span 才是编辑体 */}
                <WysiwygEditor
                    ref={editorRef}
                    initialHtml={headingSeedInnerHtml(session.seedHtml)}
                    blockKind="h"
                    headingLevel={session.headingLevel ?? 1}
                    rootTag="span"
                    rootClassName="heading-title"
                    onInput={handleInput}
                    onBlur={handleBlur}
                    onKeyDown={handleKeyDown}
                />
            </div>
        );
    }
    return (
        <WysiwygEditor
            ref={editorRef}
            initialHtml={session.seedHtml}
            blockKind={session.kind === "quote" ? "quote" : session.kind === "list" ? "list" : "p"}
            rootTag={rootShape.tag}
            rootClassName={rootShape.className ?? null}
            rootAttrs={rootAttrs}
            onInput={handleInput}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
        />
    );
});

EditableBlock.displayName = "EditableBlock";
