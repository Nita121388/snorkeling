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
import { jumpToOverviewBlock } from "@/app/session-overview/session-overview-model";
import { EditableTitle } from "@/app/element/info-card/editable-title";
import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { useAgentStatusForCard, useSessionNoteState } from "@/app/store/session-note-hook";
import { AgentHoverCard } from "@/app/view/term/agent-hover-card";
import * as React from "react";

type AgentCardModalProps = {
    blockId: string;
    blockData: Block | null;
    /** 该 block 所在 tab。由 Overview 看板传入（看板知道每个块挂在哪个 tab）；
     *  不传（如 term 头部悬浮卡放大）就不渲染「定位到块」—— 块本来就在眼前。 */
    tabId?: string;
};

function AgentCardModal({ blockId, blockData, tabId }: AgentCardModalProps) {
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

    const closeModal = React.useCallback(() => {
        modalsModel.popModal();
    }, []);

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
                            title="定位到该会话所在的块"
                            aria-label="定位到该会话所在的块"
                            onClick={(event) => {
                                event.stopPropagation();
                                handleJumpToBlock();
                            }}
                        >
                            <i className="fa-sharp fa-solid fa-location-crosshairs mr-1" />
                            定位到块
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="cursor-pointer rounded px-2 py-1 text-[11px] text-secondary transition-colors hover:bg-hover hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                        data-agent-card-detail
                        disabled={sessionId === ""}
                        title={sessionId === "" ? "该块没有会话 id" : "打开会话详情"}
                        aria-label="打开会话详情"
                        onClick={(event) => {
                            event.stopPropagation();
                            if (sessionId === "") return;
                            // 叠在整卡之上：modal 栈天然支持逐层退（详情 ✕ 先退，再退整卡）。
                            modalsModel.pushModal("AISessionDetailModal", { sessionId });
                        }}
                    >
                        <i className="fa-sharp fa-solid fa-arrow-up-right-from-square mr-1" />
                        打开会话详情
                    </button>
                    <span className="flex-1" />
                </div>
            }
        >
            <AgentHoverCard blockId={blockId} blockData={blockData} mode="gui" embedded frameless />
        </Modal>
    );
}

AgentCardModal.displayName = "AgentCardModal";

export { AgentCardModal };
