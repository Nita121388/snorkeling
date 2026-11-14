// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 悬浮卡：显示一个 rail 刻度代表的节点及其全部批注。

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

export function AnnotationCard({
    cluster,
    nodePreview,
    onJump,
    onAccept,
    onDiscard,
    onPin,
    onClose,
    onNodeTextSave,
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
    return (
        <div
            className="w-80 max-w-[min(320px,70vw)] max-h-[60vh] overflow-y-auto overscroll-contain rounded-lg border border-border bg-modalbg p-2.5 text-left shadow-2xl"
            data-row-action="true"
            // 在卡片里按下鼠标就钉住，防止点按钮途中卡片被 hover 逻辑关掉。
            onMouseDown={() => onPin?.()}
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
                        <div key={annotation.id} className="rounded border border-border bg-panel px-2 py-1.5">
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
                                <span className="text-[9px] text-secondary">{annotation.source}</span>
                            </div>
                            {annotation.title ? (
                                <div className="mt-1 text-[11px] font-medium text-primary">{annotation.title}</div>
                            ) : null}
                            {annotation.body ? (
                                <div className="mt-0.5 whitespace-pre-wrap break-words text-[11px] leading-4 text-secondary">
                                    {annotation.body}
                                </div>
                            ) : null}
                            {annotation.status === "draft" && (onAccept != null || onDiscard != null) ? (
                                <div className="mt-1 flex items-center justify-end gap-1.5">
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
        </div>
    );
}
