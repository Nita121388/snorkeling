// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { useAgentReadContext } from "@/app/agent-status/use-agent-status-view";
import { cn } from "@/util/util";
import { AgentStatusChip } from "./agent-status-chip";
import {
    formatBoardAge,
    groupBlocksByStatus,
    type OverviewBoardAvatar,
    type OverviewBoardCard,
    type OverviewBoardStatus,
    type OverviewBoardStatusInput,
} from "./overview-board-model";
import "./session-overview.scss";

export type OverviewBoardProps = {
    cards: readonly OverviewBoardCard[];
    presentedStatuses: Readonly<Record<string, OverviewBoardStatusInput>>;
    /** Real status objects, used by the status chip (label / elapsed / ack). */
    agentStatuses?: Readonly<Record<string, AgentStatus | null>>;
    /** Total card cap, applied across columns in fixed order. */
    maxTotal?: number;
    /** Keep every status column visible even when it has no cards. */
    includeEmpty?: boolean;
    now: number;
    onOpenSession: (card: OverviewBoardCard) => void;
    onAckStatus?: (blockId: string, status: AgentStatus) => void;
};

function BoardAvatar({ avatar }: { avatar: OverviewBoardAvatar }) {
    return (
        <span className="session-overview-board-card-avatar" data-avatar-kind={avatar.kind} aria-hidden="true">
            {avatar.kind === "emoji" ? (
                <span className="agent-emoji-icon">{avatar.emoji}</span>
            ) : avatar.kind === "logo" ? (
                <span style={avatar.color ? { color: avatar.color } : undefined}>{avatar.icon}</span>
            ) : (
                <i className={avatar.iconClass} />
            )}
        </span>
    );
}

function BoardCard({
    card,
    status,
    now,
    onOpenSession,
    onAckStatus,
}: {
    card: OverviewBoardCard;
    status: AgentStatus | null;
    now: number;
    onOpenSession: (card: OverviewBoardCard) => void;
    onAckStatus?: (blockId: string, status: AgentStatus) => void;
}) {
    const age = formatBoardAge(card.updatedAt, now);
    const readContext = useAgentReadContext(card.blockId, status);
    const unread = readContext.read === "unread";
    const chips = [card.providerLabel, card.projectName || card.tabName].filter((chip) => chip !== "");
    const visibleChips = chips.slice(0, 2);

    // Chip 内部是 <button>，卡片容器不能再是 <button>（嵌套按钮是非法 HTML，点击会串）。
    const openCard = () => onOpenSession(card);

    return (
        <div
            className="session-overview-board-card"
            data-block-id={card.blockId}
            data-agent-like={card.isAgentLike ? "true" : "false"}
            role="button"
            tabIndex={0}
            onClick={openCard}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openCard();
                }
            }}
            aria-label={`Open session ${card.title}`}
            title={card.preview ? `${card.title}\n${card.preview}` : card.title}
        >
            <span className="session-overview-board-card-head">
                <BoardAvatar avatar={card.avatar} />
                <span className="session-overview-board-card-title">{card.title}</span>
                {age ? <span className="session-overview-board-card-age">{age}</span> : null}
            </span>
            <span className="session-overview-board-card-meta">
                {status != null && onAckStatus != null ? (
                    <AgentStatusChip
                        status={status}
                        now={now}
                        blockId={card.blockId}
                        unread={unread}
                        onAck={onAckStatus}
                        className="is-board-card"
                    />
                ) : (
                    <span className="session-overview-board-card-view-label">{card.kindLabel}</span>
                )}
                {visibleChips.map((chip, index) => (
                    <span key={`${chip}-${index}`} className="session-overview-board-chip" title={chip}>
                        {chip}
                    </span>
                ))}
            </span>
            {card.preview ? <span className="session-overview-board-card-preview">{card.preview}</span> : null}
            {card.note ? (
                <span className="session-overview-board-card-note">
                    <span className="session-overview-board-card-note-mark" aria-hidden="true">
                        ✎
                    </span>
                    {card.note}
                </span>
            ) : null}
        </div>
    );
}

export function OverviewBoard({
    cards,
    presentedStatuses,
    agentStatuses,
    maxTotal,
    includeEmpty,
    now,
    onOpenSession,
    onAckStatus,
}: OverviewBoardProps) {
    const columns = groupBlocksByStatus(cards, presentedStatuses, { maxTotal, includeEmpty });
    if (columns.length === 0) {
        return <div className="session-overview-empty">No agent sessions match the current filters.</div>;
    }
    return (
        <div className="session-overview-board" role="group" aria-label="Overview board">
            {columns.map((column) => (
                <section
                    key={column.status}
                    className={cn("session-overview-board-column", column.blocks.length === 0 && "is-empty")}
                    aria-label={`${column.title}，${column.blocks.length} 个会话`}
                >
                    <h3 className="session-overview-board-column-head">
                        <span
                            className={cn("session-overview-board-column-dot", `is-${column.status}`)}
                            aria-hidden="true"
                        />
                        <span className="session-overview-board-column-title">{column.title}</span>
                        <span className="session-overview-board-column-count" role="status">
                            {column.blocks.length}
                        </span>
                    </h3>
                    <div className="session-overview-board-cards">
                        {column.blocks.length === 0 ? (
                            <div className="session-overview-board-empty">暂无</div>
                        ) : (
                            column.blocks.map((card) => (
                                <BoardCard
                                    key={card.blockId}
                                    card={card}
                                    status={agentStatuses?.[card.blockId] ?? null}
                                    now={now}
                                    onOpenSession={onOpenSession}
                                    onAckStatus={onAckStatus}
                                />
                            ))
                        )}
                    </div>
                </section>
            ))}
        </div>
    );
}

export type { OverviewBoardStatus };
