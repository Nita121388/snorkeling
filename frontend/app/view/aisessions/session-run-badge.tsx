// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// SessionRow 右侧运行徽章（细粒度）。
//
// 与左侧 `RunningDot` 分工：
//   RunningDot  粗粒度、不带文字，只回答「这个会话有活着的块」（点击跳转）。
//   本组件      细粒度、带状态词与跑时，回答「跑到哪一步 + 跑了多久」。
//
// 呈现数据全部来自 `buildSessionRunBadgeView()`（纯函数，React 无关），
// 本组件只把 view 装配成 DOM。文案来源是共享的 `agentStatusPresentation`，
// 所以与 block 头部徽章、Overview chip 不可能漂移。
//
// 为什么不用 `RunningDot` 那套 `shellprocstatus` 当唯一输入：进程活着 ≠ agent 在产出。
// `AgentStatus` 才有 phase（thinking / tool）与 activeSince，才能算出跑时。
//
// 布局约束（不要改）：
//   徽章是 `row-meta` 的 flex 子项 + `ml-auto`。元信息行本身是 flex-wrap，
//   默认 320px 宽度下左侧 5–6 个元素已占满 1 行，所以徽章会把该行撑成 2 行
//   （实测 15 → 38px）。这是已知代价，见
//   design/prototypes/aisessions-running-indicator/README.md。

import { AgentStatusStore } from "@/app/agent-status/agent-status-store";
import { agentStatusSecondTickAtom } from "@/app/agent-status/agent-status-second-tick";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { Tooltip } from "@/app/element/tooltip";
import { cn, useAtomValueSafe } from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";
import "@/app/view/aisessions/session-run-badge.scss";
import { buildSessionRunBadgeView } from "./session-run-badge-view";
import type { SessionRunningState } from "./use-sessions-running";

/**
 * 读取某个 block 的 canonical AgentStatus（presented = 含 staleness 翻转）。
 *
 * 与 `block.tsx` 的 `useInlineTabAgentStatus` 同一套 acquire/release 引用计数：
 * 行滚出视口即释放订阅，不会给长列表白付 N 份事件订阅。
 *
 * 先用 `peekPresentedStatusAtom` 探测：从未被订阅过的 block（比如这个 block
 * 从没打开过）不该因为出现在列表里就新建订阅 —— 那种情况走「进程存活」降级分支，
 * 不为了一个徽章给整个列表挂 N 份 agentstatus 事件监听。
 */
function useSessionAgentStatus(blockId: string | null): AgentStatus | null {
    const store = AgentStatusStore.getInstance();
    const [statusAtom, setStatusAtom] = React.useState<jotai.Atom<AgentStatus | null> | null>(null);

    React.useEffect(() => {
        if (blockId == null || blockId === "") {
            setStatusAtom(null);
            return;
        }
        const existing = store.peekPresentedStatusAtom(blockId);
        if (existing == null) {
            setStatusAtom(null);
            return;
        }
        const atom = store.acquire(blockId);
        setStatusAtom(atom);
        return () => {
            store.release(blockId);
        };
    }, [store, blockId]);

    return useAtomValueSafe(statusAtom);
}

export type SessionRunBadgeProps = {
    /** 该会话的活跃块（null = 没有活着的块）。 */
    runningState?: SessionRunningState | null;
    /** 该会话正在跑 GUI 对话（没有 block 时也能有这条信息）。 */
    chatRunning?: boolean;
    onJumpToBlock: (runningState: SessionRunningState) => void;
};

/**
 * 右侧运行徽章。返回 null 表示该行**不渲染**徽章 —— 调用方直接丢进 JSX 即可。
 * 分支判定见 `buildSessionRunBadgeView` 的注释。
 */
export function SessionRunBadge({
    runningState = null,
    chatRunning = false,
    onJumpToBlock,
}: SessionRunBadgeProps): React.ReactElement | null {
    const status = useSessionAgentStatus(runningState?.blockId ?? null);

    // 秒级跑时：只有确实需要显示跑时的分支才订阅，其余情况不白付 1Hz 代价。
    const tickEnabled = status != null
        ? buildSessionRunBadgeView({ runningState, status, chatRunning, nowMs: 0 })?.runtime !== ""
        : false;
    const tick = tickEnabled ? (useAtomValueSafe(agentStatusSecondTickAtom) ?? 0) : 0;

    const view = buildSessionRunBadgeView({
        runningState,
        status,
        chatRunning,
        nowMs: Math.max(Date.now(), tick),
    });
    if (view == null) {
        return null;
    }

    const click = (event: React.MouseEvent) => {
        event.stopPropagation();
        if (runningState != null) {
            onJumpToBlock(runningState);
        }
    };

    const content = (
        <>
            {view.tone === "live" ? (
                <span className="session-run-badge-dot" aria-hidden="true" />
            ) : (
                <i className={cn("fa-sharp fa-solid", `fa-${view.icon}`, "session-run-badge-icon")} />
            )}
            <span className="session-run-badge-label">{view.label}</span>
            {view.runtime !== "" ? <span className="session-run-badge-runtime">{view.runtime}</span> : null}
        </>
    );

    const shared = {
        className: view.className,
        "aria-label": view.title,
        "data-run-tone": view.tone,
    } as const;

    // chat 态没有 block 可跳，渲染成非交互 span（嵌在行 div 里，不该出现无效按钮）。
    if (!view.clickable) {
        return (
            <span {...shared} title={view.title}>
                {content}
            </span>
        );
    }

    return (
        <Tooltip content={view.title} placement="top" openDelay={200} hideOnClick divClassName="inline-flex">
            <button type="button" {...shared} onClick={click}>
                {content}
            </button>
        </Tooltip>
    );
}
