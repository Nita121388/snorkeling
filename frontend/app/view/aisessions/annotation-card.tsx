// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 悬浮卡：显示一个 rail 刻度代表的节点及其全部批注。

import { cn } from "@/util/util";
import type { AnnotationRailCluster } from "./annotation-model";

const KindLabel: Record<string, string> = {
    note: "Note",
    milestone: "Milestone",
    decision: "Decision",
    question: "Question",
};

export function AnnotationCard({
    cluster,
    nodePreview,
    onJump,
    onAccept,
    onDiscard,
    onPin,
    onClose,
}: {
    cluster: AnnotationRailCluster;
    nodePreview?: string;
    onJump: (seq: number) => void;
    onAccept?: (id: number) => void;
    onDiscard?: (id: number) => void;
    onPin?: () => void;
    onClose?: () => void;
}) {
    return (
        <div
            className="w-80 max-w-[min(320px,70vw)] max-h-[60vh] overflow-y-auto overscroll-contain rounded-lg border border-border bg-modalbg p-2.5 text-left shadow-2xl"
            data-row-action="true"
            // 在卡片里按下鼠标就钉住，防止点按钮途中卡片被 hover 逻辑关掉。
            onMouseDown={() => onPin?.()}
        >
            <div className="flex items-center justify-between gap-2 pb-1.5">
                <span className="text-[10px] uppercase tracking-wide text-secondary">
                    {cluster.items.length > 1 ? `Cluster · ${cluster.items.length} nodes` : "Node"}
                </span>
                <div className="flex items-center gap-1">
                    {onClose != null ? (
                        <span
                            className="flex items-center gap-0.5 rounded bg-accent/15 px-1 py-0.5 text-[9px] text-accent"
                            title="Pinned — click Jump's ✕ or the tick again to close"
                        >
                            <i className="fa-sharp fa-solid fa-thumbtack" />
                            pinned
                        </span>
                    ) : null}
                    <button
                        type="button"
                        className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent/10"
                        onClick={(event) => {
                            event.stopPropagation();
                            onJump(cluster.seq);
                        }}
                    >
                        Jump
                    </button>
                    {onClose != null ? (
                        <button
                            type="button"
                            className="cursor-pointer rounded px-1 py-0.5 text-[10px] text-secondary hover:bg-hover hover:text-primary"
                            title="Close"
                            aria-label="Close"
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
            {nodePreview ? (
                <div className="mb-2 line-clamp-4 whitespace-pre-wrap break-words text-[11px] leading-4 text-secondary">
                    {nodePreview}
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
                                    {KindLabel[annotation.kind] ?? annotation.kind}
                                </span>
                                {annotation.orphaned ? (
                                    <span className="text-[9px] text-warning" title="Anchor no longer resolves">
                                        orphan
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
                                            Discard
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
                                            Accept
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
