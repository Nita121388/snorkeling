// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 悬浮卡：显示一个 rail 刻度代表的节点及其全部批注。
//
// v2（B1）新增（主文档 §4.5 卡片层级 / §4.4 键盘 / §5.4 不变量）：
//  - 来源徽章三档：You（中性）/ ✨ AI（accent，草稿附「草稿」小字）/ 🤖 agent（B1 留桩，
//    `author` 字段 B2 落库后自动出现）
//  - 同节点多条批注的上下条导航 `‹ 1 / 5 ›`：位置（index/total）由父级传入，卡内不计算全局
//  - 卡片打开时 ←/→ 切换上下条（只换内容，不移动焦点）、`e` 打开当前条目的编辑器
//  - 外部写入条目只读：Edit 禁用并给 title（`isAnnotationReadOnly` 纯判定）

import { cn } from "@/util/util";
import { i18n } from "@/i18n/config";
import * as React from "react";
import { useTranslation } from "react-i18next";
import type { AnnotationLike, AnnotationRailCluster } from "./annotation-model";

function kindLabel(kind: string): string {
    switch (kind) {
        case "note":
            return i18n.t("aisessions:annotationCard.kind.note");
        case "milestone":
            return i18n.t("aisessions:annotationCard.kind.milestone");
        case "decision":
            return i18n.t("aisessions:annotationCard.kind.decision");
        case "question":
            return i18n.t("aisessions:annotationCard.kind.question");
        default:
            return kind;
    }
}

/**
 * B2 才会在 `AnnotationLike` 上落地的来源字段（`author`，见主文档 §5.3）。
 * B1 阶段数据源还没有该列，这里按可选字段读取：B2 把 author 写库并随 RPC 返回后，
 * 徽章 🤖 档与只读判定自动生效，无需再改本文件。
 */
type AnnotationSourceExtras = { author?: string };

function annotationAuthor(annotation: AnnotationLike): string {
    const author = (annotation as AnnotationSourceExtras).author;
    return typeof author === "string" ? author.trim() : "";
}

/**
 * 外部写入条目对 UI 只读（主文档 §5.4 不变量 1：append-only，任何通道不得修改既有条目）。
 *
 * B1 判定口径：`source === "agent"` 或非空 `author`（B2 字段，目前恒缺省）。
 * 纯函数、不依赖 React —— 单测直接断言。
 */
export function isAnnotationReadOnly(annotation: AnnotationLike): boolean {
    return annotation.source === "agent" || annotationAuthor(annotation) !== "";
}

/** 输入控件里的按键不归卡片键盘模型管（节点原文 textarea 正在编辑时 ←/→/e 应正常输入）。 */
function isTypingTarget(target: EventTarget | null): boolean {
    if (target == null || !(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * 来源徽章三档（主文档 §4.5）。
 *
 * DOM 锚点 `data-annotation-source="user|ai|agent"` 是 verify 探针的稳定契约，不要只写样式。
 * B1 数据源只有 user / ai：agent 档分支按规格写好留桩（缺 author 不出现），B2 接线后自动出现。
 */
function SourceBadge({ annotation }: { annotation: AnnotationLike }) {
    const { t } = useTranslation("aisessions");
    const author = annotationAuthor(annotation);
    if (annotation.source === "agent" || author !== "") {
        // B2 档：`via wsh annotation add` 由 author 字段与写入来源决定，颜色后续接 --agent-color。
        return (
            <span
                className="ml-auto shrink-0 whitespace-nowrap rounded border border-accent/40 px-1 py-0.5 text-[9px] text-accent"
                data-annotation-source="agent"
                title={t("aisessions:annotationCard.source.agentVia")}
            >
                🤖 {author}
            </span>
        );
    }
    if (annotation.source === "ai") {
        return (
            <span
                className="ml-auto shrink-0 whitespace-nowrap rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent"
                data-annotation-source="ai"
                title={t("aisessions:annotationCard.source.aiTitle")}
            >
                {t("aisessions:annotationCard.source.ai")}
                {annotation.status === "draft" ? (
                    <span className="ml-1 text-[8px] opacity-80">{t("aisessions:annotationCard.source.aiDraft")}</span>
                ) : null}
            </span>
        );
    }
    return (
        <span
            className="ml-auto shrink-0 whitespace-nowrap rounded bg-surface px-1 py-0.5 text-[9px] text-secondary"
            data-annotation-source="user"
        >
            {t("aisessions:annotationCard.source.you")}
        </span>
    );
}

export function AnnotationCard({
    cluster,
    nodePreview,
    onJump,
    onAccept,
    onDiscard,
    onPin,
    onClose,
    onNodeTextSave,
    navIndex,
    navTotal,
    onNavigate,
    onEditAnnotation,
}: {
    cluster: AnnotationRailCluster;
    nodePreview?: string;
    onJump: (seq: number, anchorKey?: string) => void;
    onAccept?: (id: number) => void;
    onDiscard?: (id: number) => void;
    onPin?: () => void;
    onClose?: () => void;
    /** 保存用户手改的「节点原文」；nodeText 为空串表示清除覆盖、回落活节点文本。 */
    onNodeTextSave?: (annotation: AnnotationLike, nodeText: string) => void;
    /** 同节点多条批注时的当前下标（0 基）。由父级传入，卡内不计算全局位置。 */
    navIndex?: number;
    /** 同节点批注总数。> 1 且给了 onNavigate 时才渲染导航行。 */
    navTotal?: number;
    /** 上下条切换：-1 = 上一条，+1 = 下一条。 */
    onNavigate?: (delta: number) => void;
    /** 打开单条批注的编辑器；只读（外部写入）条目禁用。缺省时不渲染 Edit 入口。 */
    onEditAnnotation?: (annotation: AnnotationLike) => void;
}) {
    const { t } = useTranslation("aisessions");
    // NODE 区可编辑：卡片展示的是锚点节点的原文，用户应能就地改一份副本。
    // null = 只读，string = 正在编辑的草稿。
    const [nodeDraft, setNodeDraft] = React.useState<string | null>(null);
    const anchorAnnotation = cluster.items[0]?.annotations[0];
    const nodeOverride = anchorAnnotation?.nodeText?.trim() ?? "";
    const nodeDisplay = nodeOverride !== "" ? nodeOverride : (nodePreview ?? "");
    const canEditNode = onNodeTextSave != null && anchorAnnotation != null;
    const commitNodeDraft = () => {
        if (nodeDraft == null || anchorAnnotation == null || onNodeTextSave == null) return;
        onNodeTextSave(anchorAnnotation, nodeDraft);
        setNodeDraft(null);
    };
    // 上下条导航：位置（index/total）是父级的契约，卡内只渲染与转发。
    const annotations = React.useMemo(() => cluster.items.flatMap((item) => item.annotations), [cluster]);
    const navTotalSafe = navTotal ?? 0;
    const navIndexSafe = navIndex ?? 0;
    const showNav = onNavigate != null && navTotalSafe > 1;
    const canNavPrev = showNav && navIndexSafe > 0;
    const canNavNext = showNav && navIndexSafe < navTotalSafe - 1;
    const currentAnnotation = annotations[navIndexSafe] ?? annotations[0];

    const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (isTypingTarget(event.target)) return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === "ArrowLeft" && canNavPrev) {
            // 只切换卡片内容，不移动焦点（主文档 §4.4）。
            event.preventDefault();
            event.stopPropagation();
            onNavigate?.(-1);
            return;
        }
        if (event.key === "ArrowRight" && canNavNext) {
            event.preventDefault();
            event.stopPropagation();
            onNavigate?.(1);
            return;
        }
        if (event.key === "e" && currentAnnotation != null && onEditAnnotation != null) {
            // 外部写入条目只读：`e` 与 Edit 一样禁用（主文档 §4.4 / §5.4）。
            if (isAnnotationReadOnly(currentAnnotation)) return;
            event.preventDefault();
            event.stopPropagation();
            onEditAnnotation(currentAnnotation);
        }
    };

    const renderEditAction = (annotation: AnnotationLike) => {
        if (onEditAnnotation == null) return null;
        if (isAnnotationReadOnly(annotation)) {
            return (
                <button
                    type="button"
                    disabled
                    data-annotation-edit="readonly"
                    aria-label={t("aisessions:annotationCard.editAnnotationAria")}
                    title={t("aisessions:annotationCard.editReadOnlyTitle")}
                    className="cursor-not-allowed rounded border border-border px-1.5 py-0.5 text-[9px] text-secondary opacity-50"
                >
                    {t("aisessions:annotationCard.editAnnotation")}
                </button>
            );
        }
        return (
            <button
                type="button"
                data-annotation-edit="true"
                aria-label={t("aisessions:annotationCard.editAnnotationAria")}
                className="cursor-pointer rounded border border-border px-1.5 py-0.5 text-[9px] text-secondary hover:bg-hover hover:text-primary"
                onClick={(event) => {
                    event.stopPropagation();
                    onEditAnnotation(annotation);
                }}
            >
                {t("aisessions:annotationCard.editAnnotation")}
            </button>
        );
    };

    return (
        <div
            role="dialog"
            aria-modal="false"
            aria-label={i18n.t("aisessions:annotationCard.dialogAria", { seq: cluster.seq })}
            className="w-80 max-w-[min(320px,70vw)] max-h-[60vh] overflow-y-auto overscroll-contain rounded-lg border border-border bg-modalbg p-2.5 text-left shadow-2xl"
            data-row-action="true"
            data-annotation-card="true"
            // 在卡片里按下鼠标就钉住，防止点按钮途中卡片被 hover 逻辑关掉。
            onMouseDown={() => onPin?.()}
            onKeyDown={handleCardKeyDown}
        >
            <div className="flex items-center justify-between gap-2 pb-1.5">
                <span className="text-[10px] uppercase tracking-wide text-secondary">
                    {cluster.items.length > 1
                        ? i18n.t("aisessions:annotationCard.cluster", { count: cluster.items.length })
                        : t("aisessions:annotationCard.node")}
                </span>
                <div className="flex items-center gap-1">
                    {onClose != null ? (
                        <span
                            className="flex items-center gap-0.5 rounded bg-accent/15 px-1 py-0.5 text-[9px] text-accent"
                            title={t("aisessions:annotationCard.pinnedTitle")}
                        >
                            <i className="fa-sharp fa-solid fa-thumbtack" />
                            {t("aisessions:annotationCard.pinned")}
                        </span>
                    ) : null}
                    <button
                        type="button"
                        className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent/10"
                        onClick={(event) => {
                            event.stopPropagation();
                            // 带上 anchorKey：历史批注的 seq 可能是 0（脏数据），
                            // 由调用方用 anchorKey 反推真实位置，否则 Jump 静默无反应。
                            onJump(cluster.seq, cluster.items[0]?.anchorKey);
                        }}
                    >
                        {t("aisessions:annotationCard.jump")}
                    </button>
                    {onClose != null ? (
                        <button
                            type="button"
                            className="cursor-pointer rounded px-1 py-0.5 text-[10px] text-secondary hover:bg-hover hover:text-primary"
                            title={t("aisessions:annotationCard.close")}
                            aria-label={t("aisessions:annotationCard.close")}
                            onClick={(event) => {
                                event.stopPropagation();
                                onClose();
                            }}
                        >
                            <i className="fa-sharp fa-solid fa-xmark" />
                        </button>
                    ) : null}
                </div>
            </div>
            {nodeDisplay !== "" || canEditNode ? (
                <div className="mb-2">
                    <div className="flex items-center justify-between gap-2 pb-0.5">
                        <span className="text-[9px] uppercase tracking-wide text-secondary">
                            {nodeOverride !== ""
                                ? t("aisessions:annotationCard.nodeEdited")
                                : t("aisessions:annotationCard.node")}
                        </span>
                        {nodeDraft == null && canEditNode ? (
                            <span className="flex items-center gap-1">
                                {nodeOverride !== "" ? (
                                    <button
                                        type="button"
                                        className="cursor-pointer rounded px-1 py-0.5 text-[9px] text-secondary hover:bg-hover hover:text-primary"
                                        title={t("aisessions:annotationCard.resetTitle")}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            if (anchorAnnotation != null) onNodeTextSave?.(anchorAnnotation, "");
                                        }}
                                    >
                                        {t("aisessions:annotationCard.reset")}
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    className="cursor-pointer rounded px-1 py-0.5 text-[9px] text-accent hover:bg-accent/10"
                                    title={t("aisessions:annotationCard.editNodeTitle")}
                                    aria-label={t("aisessions:annotationCard.editNodeAria")}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setNodeDraft(nodeDisplay);
                                    }}
                                >
                                    {t("aisessions:annotationCard.edit")}
                                </button>
                            </span>
                        ) : null}
                    </div>
                    {nodeDraft != null ? (
                        <div className="space-y-1">
                            <textarea
                                autoFocus
                                className="min-h-[88px] w-full resize-y rounded border border-border bg-transparent px-2 py-1 text-[11px] leading-4 text-primary outline-none focus:border-accent"
                                placeholder={t("aisessions:annotationCard.nodeText")}
                                value={nodeDraft}
                                onChange={(event) => setNodeDraft(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Escape") {
                                        event.stopPropagation();
                                        setNodeDraft(null);
                                    }
                                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                                        event.preventDefault();
                                        commitNodeDraft();
                                    }
                                }}
                            />
                            <div className="flex items-center justify-end gap-1">
                                <button
                                    type="button"
                                    className="cursor-pointer rounded px-1.5 py-0.5 text-[9px] text-secondary hover:bg-hover hover:text-primary"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setNodeDraft(null);
                                    }}
                                >
                                    {t("aisessions:annotationCard.cancel")}
                                </button>
                                <button
                                    type="button"
                                    className="cursor-pointer rounded bg-action px-1.5 py-0.5 text-[9px] text-actiontext hover:bg-actionhover"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        commitNodeDraft();
                                    }}
                                >
                                    {t("aisessions:annotationCard.save")}
                                </button>
                            </div>
                        </div>
                    ) : nodeDisplay !== "" ? (
                        <div
                            className={cn(
                                "line-clamp-4 whitespace-pre-wrap break-words text-[11px] leading-4 text-secondary",
                                canEditNode && "cursor-text rounded hover:bg-hover/60"
                            )}
                            title={canEditNode ? t("aisessions:annotationCard.clickToEditNode") : undefined}
                            onClick={(event) => {
                                if (!canEditNode) return;
                                event.stopPropagation();
                                setNodeDraft(nodeDisplay);
                            }}
                        >
                            {nodeDisplay}
                        </div>
                    ) : null}
                </div>
            ) : null}
            <div className="space-y-2">
                {cluster.items.flatMap((item) =>
                    item.annotations.map((annotation) => (
                        <div
                            key={annotation.id}
                            className="rounded border border-border bg-panel px-2 py-1.5"
                            data-annotation-id={annotation.id}
                        >
                            <div className="flex items-center gap-1.5">
                                <span
                                    className={cn(
                                        "inline-flex h-4 items-center rounded px-1 text-[9px] uppercase",
                                        annotation.status === "draft"
                                            ? "border border-dashed border-accent text-accent"
                                            : "bg-accent/10 text-accent"
                                    )}
                                >
                                    {kindLabel(annotation.kind)}
                                </span>
                                {annotation.orphaned ? (
                                    <span className="text-[9px] text-warning" title={t("aisessions:annotationCard.orphanTitle")}>
                                        {t("aisessions:annotationCard.orphan")}
                                    </span>
                                ) : null}
                                <SourceBadge annotation={annotation} />
                            </div>
                            {annotation.title ? (
                                <div className="mt-1 text-[11px] font-medium text-primary">{annotation.title}</div>
                            ) : null}
                            {annotation.body ? (
                                <div className="mt-0.5 whitespace-pre-wrap break-words text-[11px] leading-4 text-secondary">
                                    {annotation.body}
                                </div>
                            ) : null}
                            {onEditAnnotation != null ||
                            (annotation.status === "draft" && (onAccept != null || onDiscard != null)) ? (
                                <div className="mt-1 flex items-center gap-1.5">
                                    {renderEditAction(annotation)}
                                    <div className="ml-auto flex items-center gap-1.5">
                                        {annotation.status === "draft" && (onAccept != null || onDiscard != null) ? (
                                            <>
                                                {onDiscard != null ? (
                                                    <button
                                                        type="button"
                                                        className="cursor-pointer rounded border border-border px-1.5 py-0.5 text-[9px] text-secondary hover:bg-hover"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            onDiscard(annotation.id);
                                                        }}
                                                    >
                                                        {t("aisessions:annotationCard.discard")}
                                                    </button>
                                                ) : null}
                                                {onAccept != null ? (
                                                    <button
                                                        type="button"
                                                        className="cursor-pointer rounded bg-action px-1.5 py-0.5 text-[9px] text-actiontext hover:bg-actionhover"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            onAccept(annotation.id);
                                                        }}
                                                    >
                                                        {t("aisessions:annotationCard.accept")}
                                                    </button>
                                                ) : null}
                                            </>
                                        ) : null}
                                    </div>
                                </div>
                            ) : null}
                            {(annotation.tags?.length ?? 0) > 0 ? (
                                <div className="mt-1 flex flex-wrap gap-1">
                                    {annotation.tags!.map((tag) => (
                                        <span
                                            key={tag}
                                            className="rounded border border-border px-1 py-0.5 text-[9px] text-secondary"
                                        >
                                            #{tag}
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    ))
                )}
            </div>
            {showNav ? (
                <div
                    className="mt-2 flex items-center gap-1.5 border-t border-border pt-1.5"
                    data-annotation-nav="true"
                >
                    <button
                        type="button"
                        data-annotation-nav-prev="true"
                        disabled={!canNavPrev}
                        aria-label={t("aisessions:annotationCard.navPrevAria")}
                        className="cursor-pointer rounded px-1.5 py-0.5 text-[9px] text-secondary enabled:hover:bg-hover enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={(event) => {
                            event.stopPropagation();
                            onNavigate?.(-1);
                        }}
                    >
                        ‹ {t("aisessions:annotationCard.navPrev")}
                    </button>
                    <span
                        className="ml-auto text-[9px] text-secondary"
                        aria-label={i18n.t("aisessions:annotationCard.navPositionAria", {
                            index: navIndexSafe + 1,
                            total: navTotalSafe,
                        })}
                    >
                        {navIndexSafe + 1} / {navTotalSafe}
                    </span>
                    <button
                        type="button"
                        data-annotation-nav-next="true"
                        disabled={!canNavNext}
                        aria-label={t("aisessions:annotationCard.navNextAria")}
                        className="cursor-pointer rounded px-1.5 py-0.5 text-[9px] text-secondary enabled:hover:bg-hover enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={(event) => {
                            event.stopPropagation();
                            onNavigate?.(1);
                        }}
                    >
                        {t("aisessions:annotationCard.navNext")} ›
                    </button>
                </div>
            ) : null}
        </div>
    );
}
