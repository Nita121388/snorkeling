// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { groupBlocksByStatus, type OverviewBoardStatus, type OverviewBoardStatusInput } from "./overview-board-model";
import "./session-overview.scss";

/**
 * Structural shape the board needs from `OverviewBlock`. Kept local to avoid importing
 * the panel module (and creating a runtime import cycle).
 */
export type OverviewBoardItem = {
    tabId: string;
    tabName: string;
    blockId: string;
    view: string;
    title: string;
    isAgentLike: boolean;
    agentProvider: string;
    sessionId: string;
};

export type OverviewBoardProps = {
    blocks: readonly OverviewBoardItem[];
    presentedStatuses: Readonly<Record<string, OverviewBoardStatusInput>>;
    /** Total card cap, applied across columns in fixed order. */
    maxTotal?: number;
    now: number;
    /** Note or last-message preview for a card (already flattened by the caller). */
    getPreview?: (block: OverviewBoardItem) => string | null | undefined;
    /** Recent-activity timestamp in ms; `0`/missing hides the age label. */
    getUpdatedAt?: (block: OverviewBoardItem) => number | null | undefined;
    onOpenSession: (block: OverviewBoardItem) => void;
};

function formatBoardAge(updatedAtMs: number, nowMs: number): string {
    if (!updatedAtMs || updatedAtMs <= 0) return "";
    const diffMs = Math.max(0, nowMs - updatedAtMs);
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 1) return "now";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
}

function truncatePreview(text: string | null | undefined): string {
    const normalized = text?.replace(/\s+/g, " ").trim() ?? "";
    if (!normalized) return "";
    if (normalized.length <= 120) return normalized;
    return `${normalized.slice(0, 117)}...`;
}

function BoardCard({
    block,
    status,
    now,
    preview,
    updatedAt,
    onOpenSession,
}: {
    block: OverviewBoardItem;
    status: OverviewBoardStatus;
    now: number;
    preview: string;
    updatedAt: number;
    onOpenSession: (block: OverviewBoardItem) => void;
}) {
    const age = formatBoardAge(updatedAt, now);
    const chips: string[] = [];
    if (block.agentProvider) chips.push(block.agentProvider);
    if (block.tabName) chips.push(block.tabName);
    if (block.view && block.view !== "term") chips.push(block.view);
    const visibleChips = chips.slice(0, 3);

    return (
        <button
            type="button"
            className="session-overview-board-card"
            onClick={() => onOpenSession(block)}
            title={preview ? `${block.title}\n${preview}` : block.title}
            aria-label={`Open session ${block.title}`}
        >
            <span className="session-overview-board-card-head">
                <span
                    className={cn("session-overview-board-card-dot", `is-${status}`)}
                    aria-hidden="true"
                />
                <span className="session-overview-board-card-title">{block.title}</span>
                {age ? <span className="session-overview-board-card-age">{age}</span> : null}
            </span>
            {preview ? <span className="session-overview-board-card-preview">{preview}</span> : null}
            {visibleChips.length > 0 ? (
                <span className="session-overview-board-card-chips">
                    {visibleChips.map((chip, index) => (
                        <span key={`${chip}-${index}`} className="session-overview-board-chip">
                            {chip}
                        </span>
                    ))}
                </span>
            ) : null}
        </button>
    );
}

export function OverviewBoard({
    blocks,
    presentedStatuses,
    maxTotal,
    now,
    getPreview,
    getUpdatedAt,
    onOpenSession,
}: OverviewBoardProps) {
    const columns = groupBlocksByStatus(blocks, presentedStatuses, { maxTotal });
    if (columns.length === 0) {
        return <div className="session-overview-empty">No agent sessions match the current filters.</div>;
    }
    return (
        <div className="session-overview-board" role="group" aria-label="Overview board">
            {columns.map((column) => (
                <section key={column.status} className="session-overview-board-column">
                    <h3
                        className="session-overview-board-column-head"
                        aria-label={`${column.title}，${column.blocks.length} 个会话`}
                    >
                        <span
                            className={cn("session-overview-board-card-dot", `is-${column.status}`)}
                            aria-hidden="true"
                        />
                        <span className="session-overview-board-column-title">{column.title}</span>
                        <span className="session-overview-board-column-count" role="status">
                            {column.blocks.length}
                        </span>
                    </h3>
                    <div className="session-overview-board-cards">
                        {column.blocks.map((block) => (
                            <BoardCard
                                key={block.blockId}
                                block={block}
                                status={column.status}
                                now={now}
                                preview={truncatePreview(getPreview?.(block))}
                                updatedAt={getUpdatedAt?.(block) ?? 0}
                                onOpenSession={onOpenSession}
                            />
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}
