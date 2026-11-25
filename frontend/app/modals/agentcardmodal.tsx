// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AgentCardModal — Agent 悬浮卡的「整卡放大」弹窗。
//
// 用全仓唯一弹窗壳 Modal（结构化 header：会话标题 + ✕ 在流内），
// 内部 AgentHoverCard 以 frameless 形态渲染 —— 弹窗表面本身就是卡面，
// 不再嵌套 .info-card 的 border / border-radius / box-shadow / background
// （docs/design-system.md §8: "Do not place cards inside modal cards"）。
//
// header 的标题是**可编辑的**：双击进入编辑（与 session-detail 头栏同一手感）。
// ESC 语义分两层（必须都成立）：
//   1. 编辑中按 ESC → 只退出编辑，不关弹窗（EditableTitle 里 stopPropagation 拦掉
//      全局 cancelTopModal，见 editable-title.tsx 的注释）；
//   2. 未编辑时按 ESC → 照旧关弹窗（走全局 keymodel）。
//
// 打开整卡后，卡内底部提供「打开会话详情」入口（data-agent-card-detail），
// 点击往 modal 栈上再压一层 AISessionDetailModal —— 两级弹窗各自可退一层。
// 无 sessionId 的块该按钮 disabled（与卡片点击的判定同源）。

import { ackAgentStatus } from "@/app/agent-status/agent-status-ack";
import { resolveBlockSessionId } from "@/app/block/block-info-card-meta";
import { EditableTitle } from "@/app/element/info-card/editable-title";
import { Modal } from "@/app/modals/modal";
import { buildRecentMessageSquares } from "@/app/session-overview/session-message-items";
import { SessionMessageSquares } from "@/app/session-overview/session-message-squares";
import { SessionMetrics } from "@/app/session-overview/session-metrics";
import { normalizeTimeMs } from "@/app/session-overview/session-time";
import { jumpToOverviewBlock } from "@/app/session-overview/session-overview-model";
import {
    getCachedSessionDetail,
    loadCachedSessionDetail,
} from "@/app/session-overview/session-overview-session-cache";
import { modalsModel } from "@/app/store/modalmodel";
import { AISessionsServiceType } from "@/app/store/services";
import { useAgentStatusForCard, useSessionNoteState } from "@/app/store/session-note-hook";
import { AgentHoverCard } from "@/app/view/term/agent-hover-card";
import * as React from "react";
import { useTranslation } from "react-i18next";
import "@/app/session-overview/session-overview.scss";

type AgentCardModalProps = {
    blockId: string;
    blockData: Block | null;
    /** 该 block 所在 tab。由 Overview 看板传入（看板知道每个块挂在哪个 tab）；
     *  不传（如 term 头部悬浮卡放大）就不渲染「定位到块」—— 块本来就在眼前。 */
    tabId?: string;
};

/**
 * 该会话的最近消息方块（11-25 R3）：与看板卡同一份缓存与裁断管线。
 *
 * 数据源纪律（design §R3）：先用 `getCachedSessionDetail` 的同步缓存初值（看板已拉过的
 * 会话直接命中，零请求），缺失时用 `loadCachedSessionDetail(service, sessionId, {tail:100})`
 * 拉取（与看板 detail 同一个 TTL / 并发队列 / single-flight）。失败保持空态 —— 不渲染空行、
 * 不弹错误行（弹窗是「放大看板卡」，不是全功能会话页）。
 *
 * 返回 `items + overflow` 供共用组件 `SessionMessageSquares` 直接消费。
 */
function useSessionRecentMessages(sessionId: string): {
    items: ReturnType<typeof buildRecentMessageSquares>["items"];
    overflow: number;
} {
    const service = React.useMemo(() => new AISessionsServiceType(), []);
    const [detail, setDetail] = React.useState<SessionDetail | null>(() =>
        sessionId !== "" ? getCachedSessionDetail(sessionId) : null
    );
    React.useEffect(() => {
        if (sessionId === "") {
            setDetail(null);
            return;
        }
        let cancelled = false;
        // 同步缓存初值：避免每次打开弹窗都闪一下空态。
        setDetail(getCachedSessionDetail(sessionId));
        loadCachedSessionDetail(service, sessionId, { tail: 100 })
            .then((loaded) => {
                if (!cancelled) setDetail(loaded);
            })
            .catch(() => {
                // 会话不存在 / 加载失败：保留缓存值（可能为 null）→ 空态不渲染。
            });
        return () => {
            cancelled = true;
        };
    }, [sessionId, service]);
    return React.useMemo(() => buildRecentMessageSquares(detail), [detail]);
}

function AgentCardModal({ blockId, blockData, tabId }: AgentCardModalProps) {
    const { t } = useTranslation("modals");
    const connection = React.useMemo(() => {
        const value = blockData?.meta?.connection;
        return typeof value === "string" ? value.trim() : "";
    }, [blockData]);
    const sessionId = React.useMemo(
        () => resolveBlockSessionId((blockData?.meta ?? {}) as Record<string, unknown>),
        [blockData]
    );
    // 与卡片共用同一份 note/tags 订阅源；header 与卡内标题因此同源同帧。
    const noteState = useSessionNoteState(sessionId, connection);
    const agentStatus = useAgentStatusForCard(blockId);
    // 最近消息方块（11-25 R3）：与看板卡同一份管线；sessionId 为空时 hook 直接给空。
    const recentSquares = useSessionRecentMessages(sessionId);
    const summary = noteState.summary;
    // 度量轨的 `now` 只用于「多久」类文案；弹窗生命周期短，每帧取当前时间即可。
    const metricsNow = Date.now();

    const closeModal = React.useCallback(() => {
        modalsModel.popModal();
    }, []);

    // 打开会话详情（footer 按钮与方块点击共用同一条链路）：叠在整卡之上，
    // modal 栈天然支持逐层退（详情 ✕ 先退，再退整卡）。
    // connection 必须带：远端 agent 会话的裸 id 不带连接会落到本机 manager。
    const openSessionDetail = React.useCallback(() => {
        if (sessionId === "") return;
        modalsModel.pushModal("AISessionDetailModal", {
            sessionId,
            connection: connection !== "" ? connection : undefined,
        });
    }, [connection, sessionId]);

    // 定位到块：关掉弹窗再切 tab + 高亮块（与 Overview 列表/看板的 jumpToBlock 同一手感）。
    const handleJumpToBlock = React.useCallback(() => {
        if ((tabId ?? "") === "") return;
        modalsModel.popModal();
        jumpToOverviewBlock(tabId, blockId);
    }, [blockId, tabId]);

    // 改名成功后 ack 掉自己制造的这次更新（详见 agent-hover-card 的同名逻辑）。
    const handleRenameTitle = React.useCallback(
        async (next: string) => {
            const updated = await noteState.renameTitle(next);
            if (updated != null && agentStatus != null && agentStatus.state === "done") {
                ackAgentStatus(blockId, agentStatus, "title-edit");
            }
            return updated;
        },
        [agentStatus, blockId, noteState]
    );

    return (
        <Modal
            className="agent-dialog w-[min(680px,calc(100vw-32px))]"
            onClose={closeModal}
            // 属性 inline 编辑中误关会丢草稿 → 只允许 ✕ / ESC 关闭。
            closeOnBackdrop={false}
            title={
                sessionId !== "" ? (
                    <EditableTitle
                        title={noteState.title}
                        titleSource={noteState.summary?.titleSource ?? null}
                        variant="inline"
                        enterToEdit="double"
                        onCommit={handleRenameTitle}
                    />
                ) : (
                    noteState.title
                )
            }
            footer={
                <div className="flex w-full items-center gap-2">
                    {(tabId ?? "") !== "" ? (
                        <button
                            type="button"
                            className="cursor-pointer rounded px-2 py-1 text-[11px] text-secondary transition-colors hover:bg-hover hover:text-primary"
                            data-agent-card-jump
                            title={t("modals:agentCard.jumpToBlockTitle")}
                            aria-label={t("modals:agentCard.jumpToBlockTitle")}
                            onClick={(event) => {
                                event.stopPropagation();
                                handleJumpToBlock();
                            }}
                        >
                            <i className="fa-sharp fa-solid fa-location-crosshairs mr-1" />
                            {t("modals:agentCard.jumpToBlock")}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="cursor-pointer rounded px-2 py-1 text-[11px] text-secondary transition-colors hover:bg-hover hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                        data-agent-card-detail
                        disabled={sessionId === ""}
                        title={
                            sessionId === ""
                                ? t("modals:agentCard.noSessionId")
                                : t("modals:agentCard.openSessionDetail")
                        }
                        aria-label={t("modals:agentCard.openSessionDetail")}
                        onClick={(event) => {
                            event.stopPropagation();
                            // 叠在整卡之上：modal 栈天然支持逐层退（详情 ✕ 先退，再退整卡）。
                            openSessionDetail();
                        }}
                    >
                        <i className="fa-sharp fa-solid fa-arrow-up-right-from-square mr-1" />
                        {t("modals:agentCard.openSessionDetail")}
                    </button>
                    <span className="flex-1" />
                </div>
            }
        >
            <AgentHoverCard blockId={blockId} blockData={blockData} mode="gui" embedded frameless />
            {/* 11-25 R3：放大不降级 —— 把看板卡上的会话方块条 + 度量轨补进弹窗。
                两区块都是共用组件（SessionMessageSquares / SessionMetrics），不复制 JSX。
                空态纪律：无 sessionId 整块不渲染；方块条无消息不渲染；度量轨自身数据全空时返回 null。 */}
            {sessionId !== "" && (recentSquares.items.length > 0 || summary != null) ? (
                <div className="agent-card-modal-sections">
                    {recentSquares.items.length > 0 ? (
                        <div className="agent-card-modal-squares" data-agent-card-squares="true">
                            <SessionMessageSquares
                                surface="modal"
                                items={recentSquares.items}
                                overflow={recentSquares.overflow}
                                onOpen={() => openSessionDetail()}
                            />
                        </div>
                    ) : null}
                    {summary != null ? (
                        <div className="agent-card-modal-metrics">
                            <SessionMetrics
                                surface="modal"
                                messageCount={summary?.messageCount}
                                size={summary?.size}
                                createdAt={normalizeTimeMs(summary?.createdAt)}
                                updatedAt={normalizeTimeMs(summary?.updatedAt)}
                                live={summary?.live === true}
                                now={metricsNow}
                            />
                        </div>
                    ) : null}
                </div>
            ) : null}
        </Modal>
    );
}

AgentCardModal.displayName = "AgentCardModal";

export { AgentCardModal };
