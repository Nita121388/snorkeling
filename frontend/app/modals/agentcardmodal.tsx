// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AgentCardModal — Agent 悬浮卡的整卡放大编辑弹窗。
//
// 用户在悬浮卡头部（或 Note 弹窗旁）点击"放大"icon 时打开：
// 把整张 agent 卡（模型 / 状态 / Note / Tags / 属性）放大成 App 级弹窗，
// 常驻可编辑（无 hover 消失问题），复用 AgentHoverCard 的 embedded 形态。

import { Modal } from "@/app/modals/modal";
import { AgentHoverCard } from "@/app/view/term/agent-hover-card";
import * as React from "react";

type AgentCardModalProps = {
    blockId: string;
    blockData: Block | null;
};

function AgentCardModal({ blockId, blockData }: AgentCardModalProps) {
    return (
        <Modal className="w-[min(680px,calc(100vw-32px))]" onClickBackdrop={() => undefined}>
            <AgentHoverCard blockId={blockId} blockData={blockData} mode="gui" embedded />
        </Modal>
    );
}

AgentCardModal.displayName = "AgentCardModal";

export { AgentCardModal };
