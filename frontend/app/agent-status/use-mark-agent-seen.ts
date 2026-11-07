// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 「切到这个 agent block 并且停留」→ 写 seenAt。
//
// 语义边界（关键）：
//   - 只在**挂载后第一次拿到状态**时判定。也就是说「切过去的时候它已经是未读 Done」才算看到；
//     「用户正盯着跑，跑完了」不写 seen —— 否则用户正在看的 block 上 D 提示永远不亮，
//     等于把「跑完了来看结果」这个提示废掉。
//   - 停留门槛 2s：切 tab 路过不算，鼠标滚轮划过去也不算。
//   - hover 卡片不算 seen（那是 AgentHoverCard，不挂本 hook）。
//
// 触发点：TerminalView 挂载（inline tab 只渲染 active 子 block，所以挂载 ≈ 用户切到它）。

import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { markAgentSeen } from "@/app/agent-status/agent-status-ack";
import { useAgentStatusView } from "@/app/agent-status/use-agent-status-view";
import * as React from "react";

/** 停留多久算「看到了」。低于 2s 的多半是切 tab 路过。 */
export const AgentSeenDwellMs = 2000;

/**
 * `status` 传该 block 的 canonical 状态（TermViewModel.agentStatusAtom 的值）。
 * 组件卸载时清掉未完成的计时器，避免"路过 1s 就被标已读"。
 */
export function useMarkAgentSeenOnView(blockId: string, status: AgentStatus | null): void {
    const view = useAgentStatusView(blockId, status);
    const firstSightingHandled = React.useRef(false);
    const viewState = view?.state ?? null;
    const viewRead = view?.read ?? null;
    React.useEffect(() => {
        if (firstSightingHandled.current || viewState == null) {
            return;
        }
        // 只处理挂载后的第一帧状态：之后再变成 done 都不自动标已读。
        firstSightingHandled.current = true;
        if (viewState !== "done" || viewRead !== "unread") {
            return;
        }
        const timer = setTimeout(() => markAgentSeen(blockId, "block-focus"), AgentSeenDwellMs);
        return () => clearTimeout(timer);
        // 故意只依赖"第一帧状态"的两个标量：view 对象每次 recompute 都是新引用。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [blockId, viewState, viewRead]);
}
