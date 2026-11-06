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

import { ackAgentStatus } from "@/app/agent-status/agent-status-ack";
import { resolveBlockSessionId } from "@/app/block/block-info-card-meta";
import { EditableTitle } from "@/app/element/info-card/editable-title";
import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { useAgentStatusForCard, useSessionNoteState } from "@/app/store/session-note-hook";
import { AgentHoverCard } from "@/app/view/term/agent-hover-card";
import * as React from "react";

type AgentCardModalProps = {
    blockId: string;
    blockData: Block | null;
};

function AgentCardModal({ blockId, blockData }: AgentCardModalProps) {
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
        >
            <AgentHoverCard blockId={blockId} blockData={blockData} mode="gui" embedded frameless />
        </Modal>
    );
}

AgentCardModal.displayName = "AgentCardModal";

export { AgentCardModal };
