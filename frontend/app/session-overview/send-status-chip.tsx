// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Agent 卡常驻发送状态 chip（11-24 R6 + R7，`11-24-agentsend-status`）。
//
// 为什么必须常驻：发送行程原来只在**展开的 composer 内**渲染徽章 —— 卡片折叠时用户
// 完全看不到「发到哪一步了」。2026-11-24 的「292/aaaa」事故就是这么发生的：新建 agent
// 的首发消息走 async 后台派发（排队→就绪注入→补回车），整个投递过程 UI 不可见，
// 用户无法把「我填过一段草稿」和「会话里出现这条 user 消息」联系起来。
//
// 契约（design §4 / §6）：
//   · 数据只来自 `CardSendContext`（`sendByBlock` / `sendingStartedAt` / `dispatchByBlock`）；
//   · 文案与配色只取 `CardSendPhaseLabelKey` / `CardSendPhaseTone`，不在这里另立口径；
//   · 无行程 → 渲染 null（不占位）；
//   · 终态（submitted/replied）3s 后自动淡出（本地 timer，不写 store）；
//   · 派发中（pending/delivering）懒拉 `AgentDispatchGetCommand`，3s 重查上限 40 次，
//     不引全局轮询（R7）。`pkg/agentdispatch` 纯内存，重启即丢 —— 无记录时不显示"未发送"。
//   · 点击 chip 重开该卡 composer（看板走 onOpenSendPanel，列表走 toggleExpanded）。

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { i18n } from "@/i18n/config";
import { cn } from "@/util/util";
import { useContext, useEffect, useRef, useState } from "react";
import { CardSendPhaseLabelKey, CardSendPhaseTone, type CardSendPhase } from "./overview-card-send";
import { CardSendContext, useSendingSeconds } from "./overview-card-send-panel";

/** 终态自动淡出延迟（design §4.2：成功 3s 后不长期占位）。 */
export const SendStatusChipHideDelayMs = 3000;
/** 派发回执重查间隔与次数上限（design §6.2：3s × 40 ≈ 5 分钟）。 */
export const SendStatusChipPollIntervalMs = 3000;
export const SendStatusChipPollMaxTicks = 40;

export type SendStatusChipProps = {
    blockId: string;
    surface: "board" | "row";
    /** 点击 chip 重开 composer（看板需要 anchor 元素；列表缺省 toggleExpanded）。 */
    onOpen?: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

/** 发送状态 chip：无行程不占位；终态 3s 淡出；派发中按需拉回执。 */
export function SendStatusChip({ blockId, surface, onOpen }: SendStatusChipProps): React.JSX.Element | null {
    const cardSend = useContextSafe();
    const entry = cardSend?.sendByBlock[blockId];
    const startedAt = cardSend?.sendingStartedAt[blockId];
    const dispatch = cardSend?.dispatchByBlock[blockId];
    const sending = entry === "sending";
    const phase: CardSendPhase | null = entry == null ? null : entry === "sending" ? "sending" : entry.phase;
    const seconds = useSendingSeconds(sending ? startedAt : undefined);
    const [hidden, setHidden] = useState(false);

    // 终态 3s 淡出：只影响本地渲染，不改 store（下一次发送会换 phase 重新出现）。
    useEffect(() => {
        setHidden(false);
        if (phase !== "submitted" && phase !== "replied") return;
        const timer = window.setTimeout(() => setHidden(true), SendStatusChipHideDelayMs);
        return () => window.clearTimeout(timer);
    }, [phase, entry]);

    // R7：派发中懒拉回执（3s 重查，40 次上限）。回执终态由 context 应用（清稿/转 failed）。
    // 次数记在 ref 上：每次回执更新都会换 context 引用 → effect 重跑并重建 timer，
    // 若把计数放 effect 内会每拍归零 → 上限永远到不了（真机表现 = 无限轮询）。
    const ticksRef = useRef(0);
    const dispatchId = dispatch?.dispatchId ?? "";
    const dispatchState = dispatch?.state ?? "";
    useEffect(() => {
        ticksRef.current = 0;
    }, [dispatchId]);
    useEffect(() => {
        if (cardSend == null || dispatchId === "") return;
        if (dispatchState !== "pending" && dispatchState !== "delivering") return;
        let cancelled = false;
        let timer: number | undefined;
        const stop = () => {
            if (timer != null) window.clearInterval(timer);
            timer = undefined;
        };
        const tick = () => {
            if (cancelled) return;
            if (ticksRef.current >= SendStatusChipPollMaxTicks) {
                stop();
                return;
            }
            ticksRef.current += 1;
            void RpcApi.AgentDispatchGetCommand(TabRpcClient, { dispatchid: dispatchId })
                .then((record) => {
                    if (cancelled) return;
                    cardSend.applyDispatchReceipt(
                        blockId,
                        record == null
                            ? null
                            : {
                                  dispatchid: (record as Record<string, unknown>).dispatchid as string | undefined,
                                  state: (record as Record<string, unknown>).state as string | undefined,
                                  error: (record as Record<string, unknown>).error as string | undefined,
                              }
                    );
                })
                .catch(() => {
                    /* 回执查询是 best-effort：失败按下一拍再查，不弹错 */
                });
        };
        timer = window.setInterval(tick, SendStatusChipPollIntervalMs);
        return () => {
            cancelled = true;
            stop();
        };
    }, [cardSend, blockId, dispatchId, dispatchState]);

    if (phase == null || hidden) return null;
    const tone = CardSendPhaseTone[phase];
    return (
        <button
            type="button"
            className={cn("session-overview-send-status-chip", `is-${tone}`, `is-${surface}`)}
            data-board-send-status={surface === "board" ? phase : undefined}
            data-row-send-status={surface === "row" ? phase : undefined}
            title={i18n.t(CardSendPhaseLabelKey[phase])}
            aria-label={i18n.t(CardSendPhaseLabelKey[phase])}
            onClick={(event) => {
                event.stopPropagation();
                if (onOpen != null) {
                    onOpen(event);
                    return;
                }
                cardSend?.toggleExpanded(blockId);
            }}
            onMouseDown={(event) => event.stopPropagation()}
        >
            {sending ? (
                <span>{i18n.t("session-overview:panel.cardSendSending", { secs: seconds })}</span>
            ) : (
                <span>{i18n.t(CardSendPhaseLabelKey[phase])}</span>
            )}
        </button>
    );
}

function useContextSafe() {
    // 单独包一层只为读清楚：chip 可以嵌在没有 provider 的测试/嵌入场景里（返回 null 不报错）。
    return useContext(CardSendContext);
}

