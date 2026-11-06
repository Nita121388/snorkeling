// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { openAgentEmojiPicker } from "@/app/agent-persona/picker-host";
import { useAgentPersonas } from "@/app/agent-persona/use-agent-personas";
import { useSessionEmojis } from "@/app/agent-persona/use-session-personas";
import {
    ensureAgentRuntimeMetadata,
    getAgentRuntimeMetadataSnapshot,
    subscribeAgentRuntimeMetadata,
} from "@/app/agent-status/agent-runtime-metadata-store";
import { resolveBlockSessionId } from "@/app/block/block-info-card-meta";
import { CopyButton } from "@/app/element/copybutton";
import { InfoCard, InfoCardSection } from "@/app/element/info-card";
import { SessionNoteSection } from "@/app/element/info-card/session-note-section";
import { useAgentStatusForCard, useSessionNoteState } from "@/app/store/session-note-hook";
import { ackAgentStatus } from "@/app/agent-status/agent-status-ack";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { agentStatusAccent } from "@/app/agent-status/agent-status-view";
import { useAgentStatusView } from "@/app/agent-status/use-agent-status-view";
import { AgentStatusChip } from "@/app/session-overview/agent-status-chip";
import { getAgentIcon } from "@/app/view/term/agent-logo";
import { normalizeAgentProvider } from "@/app/view/term/agent-meta";
import { humanizeKey } from "@/app/view/aisessions/property/property-model";
import { modalsModel } from "@/app/store/modalmodel";
import { copyText } from "@/util/clipboard";
import { cn } from "@/util/util";
import * as React from "react";
import {
    getAgentProviderKey,
    resolveAgentModel,
    resolveAgentProviderLabel,
    resolveAgentVendorName,
    resolveAnyAgentVendorName,
} from "@/app/view/term/agent-identity";

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
    /** 弹窗内渲染（AgentCardModal）：放大尺寸，不显示悬浮卡底部复制栏。 */
    embedded?: boolean;
    /**
     * 无外框形态：不渲染 .info-card 的 border / radius / shadow / 背景，
     * 让弹窗表面本身充当卡面（design-system §8 禁止 modal 内嵌 card）。
     * 只做减法，左侧状态色条与状态圆点保留。
     */
    frameless?: boolean;
};

const AgentHoverCard = React.memo(({ blockId, blockData, mode, embedded = false, frameless = false }: AgentHoverCardProps) => {
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
    // Persona session key: block meta/command resolution first, then the live
    // agent status (hooks may know the session id before it is persisted).
    const personaSessionId = sessionId || agentStatus?.sessionId || "";
    const metaRecord = (blockData?.meta ?? {}) as Record<string, unknown>;
    const rawProvider =
        agentStatus?.provider != null && agentStatus.provider.trim() !== ""
            ? agentStatus.provider
            : normalizeAgentProvider(metaRecord["agent:provider"]);
    const providerKey = getAgentProviderKey(rawProvider);
    const vendorName = resolveAgentVendorName(metaRecord, providerKey) || resolveAnyAgentVendorName(metaRecord);
    const providerLabel = resolveAgentProviderLabel(metaRecord, agentStatus);
    const displayProvider = vendorName || providerLabel;

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
        (metaRecord["agent:requestedmodel"] as string)?.trim() || (metaRecord["model"] as string)?.trim() || "";
    const liveModel = runtimeEntry?.source === "live" ? runtimeEntry.model : undefined;
    const sessionResolvedModel = runtimeEntry?.source === "session" ? runtimeEntry.model : undefined;
    const model = resolveAgentModel({ liveModel, requestedModel, sessionModel: sessionResolvedModel });
    const modelLoading = runtimeEntry?.loading ?? false;
    const statusView = useAgentStatusView(blockId, agentStatus);
    // read 由 AgentStatusView 统一判定（ack 指纹 + Done 完成态已读时刻），
    // 卡片不再自己拼 "有状态就绿色" —— 那是 Done 永不跟随 seen 的根因。
    const statusRead = statusView?.read ?? "seen";
    // 状态色：原型 agent-id-card 的映射，用现成主题 token；已读收敛到 secondary。
    const statusAccent = agentStatusAccent(statusView?.tone ?? "unknown", statusRead);
    // 卡片 ack：与头部徽章走同一个收口函数，保证 R 指纹与 D 完成态两份 map 同时写。
    const handleAckCardStatus = React.useCallback((targetBlockId: string, status: AgentStatus) => {
        ackAgentStatus(targetBlockId, status, "card-pill");
    }, []);
    /**
     * 手动改名。
     *
     * 写入成功 → 如果这个 block 当前已经处于 Done（用户改标题 bump 了 UpdatedAt，
     * presentAgentStatus 会把 idle + 未读活动提升成 done），立刻 ack 掉：这是用户
     * 自己制造的更新，不该再提示一次。不改后端行为、不改 derive 规则。
     */
    const handleRenameTitle = React.useCallback(
        async (next: string) => {
            const updated = await noteState.renameTitle(next);
            if (updated != null && agentStatus != null && statusView?.state === "done") {
                ackAgentStatus(blockId, agentStatus, "title-edit");
            }
            return updated;
        },
        [agentStatus, blockId, noteState, statusView]
    );
    const personas = useAgentPersonas();
    const sessionEmojis = useSessionEmojis();
    const agentIcon = getAgentIcon(rawProvider === "" ? "agent" : rawProvider, {
        meta: blockData?.meta,
        personas,
        sessionEmojis,
        sessionId: personaSessionId || null,
    });
    const [copyFailed, setCopyFailed] = React.useState(false);

    // 失败提示 2.5s 后自清，不留一个常驻的红色 id。
    React.useEffect(() => {
        if (!copyFailed) {
            return;
        }
        const handle = setTimeout(() => setCopyFailed(false), 2500);
        return () => clearTimeout(handle);
    }, [copyFailed]);

    // 复制结果反馈：CopyButton 成功才变绿勾（2s 恢复），并短暂给按钮绿色底；
    // 失败时 session id 转红 + title 标 (failed)，2.5s 自清——这张卡 hover 出现、
    // 移开就消失，放 toast 会和卡片脱钩。
    const handleCopySessionId = React.useCallback(
        async (e: React.MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation();
            setCopyFailed(false);
            await copyText(sessionId);
        },
        [sessionId]
    );
    // 整卡放大编辑：打开 App 级弹窗（AgentCardModal）。悬浮卡内点击放大按钮触发。
    const openCardDialog = React.useCallback(() => {
        modalsModel.pushModal("AgentCardModal", {
            blockId,
            blockData,
        });
    }, [blockId, blockData]);
    // 头部区只在确实有身份/模型/状态信息时才渲染：providerLabel 的 "Agent" 是
    // 无任何来源时的兜底展示，不能拿它当“有信息”的判据，否则空会话也会长出空白头。
    const showMetaRow =
        providerLabel !== "Agent" || model !== "" || modelLoading || statusView != null;
    // 星标与标题来源从属性区上移：星标进右上角，titleSource 并入副标题。
    const starred = noteState.summary?.marked === true;
    const titleSource = noteState.summary?.titleSource ?? "";
    const modelText = model || (modelLoading ? "获取中…" : "未指定");
    const subline = titleSource !== "" ? `${modelText} · ${humanizeKey(titleSource)}` : modelText;
    // session id 只留头尾，全文进 title：340px 宽的 hover 卡放不下完整 uuid。
    const shortSessionId =
        sessionId.length > 14 ? `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}` : sessionId;

    // 会话摘要未就绪时也允许渲染（只要 agent 模型/状态信息可用）；Note 段仅在摘要就绪后显示。
    if (!showMetaRow && summary == null) {
        return null;
    }

    return (
        <InfoCard
            className={cn(
                "agent-card",
                embedded && "agent-card--embedded",
                frameless && "agent-card--frameless"
            )}
            style={{ "--info-card-accent": statusAccent } as React.CSSProperties}
        >
            {/* 模型 + 状态 section：头像 / 名称 + 副标题 / 右上角三件套 */}
            {showMetaRow && (
                <InfoCardSection className="agent-card-head-section">
                    <div className="agent-card-head">
                        {agentIcon != null ? (
                            <button
                                type="button"
                                className={cn("agent-card-avatar", agentIcon.kind === "emoji" && "is-emoji")}
                                title="设置 emoji 人格"
                                aria-label="设置 emoji 人格"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    openAgentEmojiPicker(
                                        blockId,
                                        rawProvider,
                                        e.currentTarget.getBoundingClientRect(),
                                        "session",
                                        personaSessionId || null
                                    );
                                }}
                                style={
                                    agentIcon.kind === "logo" && agentIcon.iconColor != null
                                        ? { color: agentIcon.iconColor }
                                        : undefined
                                }
                            >
                                {agentIcon.kind === "emoji" ? (
                                    <span className="agent-emoji-icon">{agentIcon.emoji}</span>
                                ) : (
                                    agentIcon.icon
                                )}
                            </button>
                        ) : (
                            <span className="agent-card-avatar">
                                <i className="fa-sharp fa-solid fa-microchip" />
                            </span>
                        )}
                        <div className="agent-card-id">
                            <span className="agent-card-name" title={vendorName ? `${vendorName} (${providerLabel})` : providerLabel}>
                                {displayProvider !== "" ? displayProvider : "Agent"}
                            </span>
                            <span
                                className="agent-card-sub"
                                title={titleSource !== "" ? `Title source: ${titleSource}` : modelText}
                            >
                                {subline}
                            </span>
                        </div>
                        {/* 右上角：状态 / 收藏 / 放大，同一基线右对齐 */}
                        <div className="agent-card-actions">
                            {statusView != null ? (
                                // 共享 chip 的 card 变体：几何（20px 胶囊 + dot）与文案/跑时全部
                                // 来自 agent-status-chip.scss + buildAgentStatusChipView，
                                // 本文件不再自己拼 label / class / 动画。
                                <AgentStatusChip
                                    variant="card"
                                    status={agentStatus}
                                    now={Date.now()}
                                    blockId={blockId}
                                    unread={statusRead === "unread"}
                                    onAck={statusView.ackable ? handleAckCardStatus : undefined}
                                />
                            ) : null}
                            {noteState.summary != null ? (
                                <button
                                    type="button"
                                    className={cn("agent-card-icon-btn", "is-star", starred && "is-on")}
                                    aria-pressed={starred}
                                    aria-busy={noteState.starPending}
                                    aria-label={starred ? "取消收藏" : "收藏"}
                                    title={starred ? "取消收藏" : "收藏"}
                                    disabled={noteState.starPending}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        void noteState.toggleStarred();
                                    }}
                                >
                                    <i className="fa-sharp fa-solid fa-star" />
                                </button>
                            ) : null}
                            {!embedded ? (
                                <button
                                    type="button"
                                    className="agent-card-icon-btn agent-card-expand-btn"
                                    title="Open card in dialog"
                                    aria-label="Open card in dialog"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        openCardDialog();
                                    }}
                                >
                                    <i className="fa-sharp fa-solid fa-up-right-and-down-left-from-center" />
                                </button>
                            ) : null}
                        </div>
                    </div>
                </InfoCardSection>
            )}
            {/* Note + tags section（与会话详情卡片共用）；悬浮卡也允许内联编辑，
                编辑时 InfoCardPortal 的 cardProps 焦点保活会防止 hover 离开打断。
                session id + 复制通过 footerExtra 进到「Add property」同一行。 */}
            <SessionNoteSection
                state={noteState}
                canEditProperties
                variant="hover"
                onOpenCardDialog={embedded ? undefined : openCardDialog}
                onRenameTitle={handleRenameTitle}
                footerExtra={
                    sessionId !== "" ? (
                        <span className="agent-card-session">
                            <span
                                className={cn("agent-card-sid", { "is-error": copyFailed })}
                                title={sessionId}
                            >
                                {shortSessionId}
                            </span>
                            <CopyButton
                                className="agent-card-copy-btn"
                                title={`Copy session id${copyFailed ? " (failed)" : ""}`}
                                onClick={handleCopySessionId}
                                onError={() => setCopyFailed(true)}
                            />
                        </span>
                    ) : null
                }
            />
        </InfoCard>
    );
});

AgentHoverCard.displayName = "AgentHoverCard";

export { AgentHoverCard };
