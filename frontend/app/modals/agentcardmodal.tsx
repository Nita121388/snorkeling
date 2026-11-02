// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AgentCardModal — Agent 悬浮卡的「整卡放大」弹窗。
//
// 用全仓唯一弹窗壳 Modal（结构化 header：会话标题 + ✕ 在流内），
// 内部 AgentHoverCard 以 frameless 形态渲染 —— 弹窗表面本身就是卡面，
// 不再嵌套 .info-card 的 border / border-radius / box-shadow / background
// （docs/design-system.md §8: "Do not place cards inside modal cards"）。

import { resolveBlockSessionId } from "@/app/block/block-info-card-meta";
import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { useSessionNoteState } from "@/app/store/session-note-hook";
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
    // 与卡片共用同一份 note/tags 订阅源；这里只取标题给 header 用，不做第二份状态推导。
    const noteState = useSessionNoteState(sessionId, connection);

    const closeModal = React.useCallback(() => {
        modalsModel.popModal();
    }, []);

    return (
        <Modal
            className="agent-dialog w-[min(680px,calc(100vw-32px))]"
            onClose={closeModal}
            // 属性 inline 编辑中误关会丢草稿 → 只允许 ✕ / ESC 关闭。
            closeOnBackdrop={false}
            title={noteState.title}
        >
            <AgentHoverCard blockId={blockId} blockData={blockData} mode="gui" embedded frameless />
        </Modal>
    );
}

AgentCardModal.displayName = "AgentCardModal";

export { AgentCardModal };
