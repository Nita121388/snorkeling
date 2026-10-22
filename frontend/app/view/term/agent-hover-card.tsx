// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { InfoCard, InfoCardIcon, InfoCardSection } from "@/app/element/info-card";
import { SessionNoteSection } from "@/app/element/info-card/session-note-section";
import { useAgentStatusForCard, useSessionNoteState } from "@/app/store/session-note-hook";
import {
    ensureAgentRuntimeMetadata,
    getAgentRuntimeMetadataSnapshot,
    subscribeAgentRuntimeMetadata,
} from "@/app/agent-status/agent-runtime-metadata-store";
import { agentStatusPresentation, formatAgentProvider } from "@/app/agent-status/agent-status-derive";
import { normalizeAgentProvider } from "@/app/view/term/agent-meta";
import { getAgentLogoByProvider } from "@/app/view/term/agent-logo";
import { resolveBlockSessionId } from "@/app/block/block-info-card-meta";
import { cn } from "@/util/util";
import * as React from "react";

/**
 * AgentHoverCard - 统一的 agent 会话卡片 (note + TUI 模式下的用户消息列表)
 * 消费方: Block Header hover (gui) / TermAgentSessionRail 弹出层 (tui)
 *
 * note / tags 状态来自 useSessionNoteState（与 SessionDetailInfoCard 共用），
 * 身份与运行状态仍由本组件自己负责。
 */

function agentSessionConnection(blockData: Block | null): string {
    const connection = blockData?.meta?.connection;
    return typeof connection === "string" ? connection.trim() : "";
}

export type AgentHoverCardProps = {
    blockId: string;
    blockData: Block | null;
    /**
     * gui/tui 语义标记；当前渲染一致（只显示 note），
     * TUI 的用户消息列表由 TermAgentMessageRail 的 SessionOutlineRail 承载。
     */
    mode: "gui" | "tui";
};

const AgentHoverCard = React.memo(({ blockId, blockData, mode }: AgentHoverCardProps) => {
    const sessionId = React.useMemo(
        () => resolveBlockSessionId((blockData?.meta ?? {}) as Record<string, unknown>),
        [blockData]
    );
    const connection = agentSessionConnection(blockData);
    const noteState = useSessionNoteState(sessionId, connection);
    const { summary } = noteState;

    // mode 保留用于语义区分（gui 与 tui 当前渲染一致），TUI 的消息列表由 TermAgentMessageRail 承载。
    void mode;

    // 模型 + 状态信息（来自 block meta、AgentStatusStore 与 AgentRuntimeMetadataStore）
    const agentStatus = useAgentStatusForCard(blockId);
    const rawProvider =
        agentStatus?.provider != null && agentStatus.provider.trim() !== ""
            ? agentStatus.provider
            : normalizeAgentProvider(blockData?.meta?.["agent:provider"]);
    const provider = formatAgentProvider(rawProvider);

    // 异步增强真实模型：立即显示请求模型，live 会话模型到达后增量替换；失败保留原值、不阻塞。
    const runtimeEntry = React.useSyncExternalStore(
        React.useCallback((listener) => subscribeAgentRuntimeMetadata(blockId, listener), [blockId]),
        React.useCallback(() => getAgentRuntimeMetadataSnapshot(blockId), [blockId]),
        React.useCallback(() => getAgentRuntimeMetadataSnapshot(blockId), [blockId])
    );
    React.useEffect(() => {
        ensureAgentRuntimeMetadata(blockId, sessionId, rawProvider);
    }, [blockId, sessionId, rawProvider]);

    const requestedModel =
        (blockData?.meta?.["agent:requestedmodel"] as string)?.trim() ||
        (blockData?.meta?.["model"] as string)?.trim() ||
        "";
    const liveModel = runtimeEntry?.source === "live" ? runtimeEntry.model : undefined;
    const model = liveModel || requestedModel;
    const modelLoading = runtimeEntry?.loading ?? false;
    const statusPres = agentStatus != null ? agentStatusPresentation(agentStatus) : null;
    const statusState = agentStatus?.state ?? "unknown";
    // 状态色：原型 agent-id-card 的映射，用现成主题 token。
    const statusAccent =
        statusState === "working"
            ? "var(--agent-working-color)"
            : statusState === "done"
              ? "var(--agent-done-color)"
              : statusState === "blocked" || statusState === "rate-limited"
                ? "var(--warning-color, #f59e0b)"
                : statusState === "error"
                  ? "var(--error-color)"
                  : "var(--secondary-text-color)";
    const isThinking = agentStatus != null && statusState === "working" && agentStatus.phase === "thinking";
    const agentLogo = getAgentLogoByProvider(rawProvider === "" ? "agent" : rawProvider);
    const showMetaRow =
        (provider !== "" && provider !== "Agent") || model !== "" || modelLoading || statusPres != null;

    // 会话摘要未就绪时也允许渲染（只要 agent 模型/状态信息可用）；Note 段仅在摘要就绪后显示。
    if (!showMetaRow && summary == null) {
        return null;
    }

    return (
        <InfoCard
            className="agent-card"
            style={{ "--info-card-accent": statusAccent } as React.CSSProperties}
        >
            {/* 模型 + 状态 section */}
            {showMetaRow && (
                <InfoCardSection>
                    <div className="agent-card-head">
                        {agentLogo != null ? (
                            <span
                                className="agent-card-logo"
                                style={
                                    agentLogo.iconColor != null
                                        ? { color: agentLogo.iconColor }
                                        : undefined
                                }
                            >
                                {agentLogo.icon}
                            </span>
                        ) : (
                            <InfoCardIcon icon="fa-sharp fa-solid fa-microchip" />
                        )}
                        <span className="agent-card-provider">{provider}</span>
                        <span className="agent-card-model">
                            {model || (modelLoading ? "获取中…" : "未指定")}
                        </span>
                    </div>
                    {statusPres != null && (
                        <div className="agent-card-status-row">
                            <span
                                className={cn("agent-card-status-dot", {
                                    "is-working": statusState === "working",
                                    "is-thinking": isThinking,
                                })}
                            />
                            <span className="agent-card-status-label">{statusPres.label}</span>
                        </div>
                    )}
                </InfoCardSection>
            )}
            {/* Note + tags section（与会话详情卡片共用） */}
            <SessionNoteSection state={noteState} />
            {/* Session ID 底行（复制） */}
            {sessionId !== "" && (
                <div className="agent-card-session-id">
                    <span className="agent-card-session-id-text" title={sessionId}>
                        {sessionId}
                    </span>
                    <button
                        type="button"
                        className="agent-card-copy-btn"
                        title="Copy session id"
                        aria-label="Copy session id"
                        onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard?.writeText(sessionId).catch(() => {});
                        }}
                    >
                        <svg viewBox="0 0 24 24">
                            <path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v16z" />
                        </svg>
                    </button>
                </div>
            )}
        </InfoCard>
    );
});

AgentHoverCard.displayName = "AgentHoverCard";

export { AgentHoverCard };
