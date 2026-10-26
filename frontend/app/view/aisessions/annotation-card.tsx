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
}: {
    cluster: AnnotationRailCluster;
    nodePreview?: string;
    onJump: (seq: number) => void;
}) {
    return (
        <div
            className="w-80 max-w-[min(320px,70vw)] max-h-[60vh] overflow-y-auto overscroll-contain rounded-lg border border-border bg-modalbg p-2.5 text-left shadow-2xl"
            data-row-action="true"
        >
            <div className="flex items-center justify-between gap-2 pb-1.5">
                <span className="text-[10px] uppercase tracking-wide text-secondary">
                    {cluster.items.length > 1 ? `Cluster · ${cluster.items.length} nodes` : "Node"}
                </span>
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
            </div>
            {nodePreview ? (
                <div className="mb-2 line-clamp-4 whitespace-pre-wrap break-words text-[11px] leading-4 text-secondary">
                    {nodePreview}
                </div>
            ) : null}
            <div className="space-y-2">
                {cluster.items.flatMap((item) =>
                    item.annotations.map((annotation) => (
                        <div key={annotation.id} className="rounded border border-border/70 bg-surface px-2 py-1.5">
                            <div className="flex items-center gap-1.5">
                                <span
                                    className={cn(
                                        "inline-flex h-4 items-center rounded px-1 text-[9px] uppercase",
                                        annotation.status === "draft"
                                            ? "border border-dashed border-accent/60 text-accent"
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
