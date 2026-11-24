// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview 卡片 composer（列表行内 variant="inline" + 看板浮层 variant="popover" 共用，
// 11-23-board-card-actions 从 session-overview.tsx 整段搬出，列表行为零变化）。
//
// 为什么单独成模块：看板卡与列表行要发同一句话给同一个 agent。复制一份 composer 意味着
// 「等回复 / 失败重试 / 改为不等待 / 继续等」四条链路会有两份实现，修一处必然漏另一处。
// 这里只管交互与渲染；请求组装（buildCardSendRequest）、超时（cardSendRpcTimeoutMs）、
// 结果映射（outcomeFromSend）、E_AGENT_NOT_READY 逃生口（isAgentNotReadyCode）全部
// 来自 `overview-card-send.ts` 纯函数，不复制逻辑。
//
// 状态挂在面板级（design §4）：`expandedBlockId` 互斥（同时只有一张列表卡展开）、
// `draftByBlock` 存草稿、`sendByBlock` 存行程/结果、`waitReply` 是「发送后等回复」勾选，
// 全部不持久化。看板浮层与列表行共享同一份草稿/行程（同一个 blockId 同一份）。
//
// 契约来源：`11-22-overview-card-send` design §4、`11-23-board-card-actions` design §4；
// roundtrip 语义见 `.trellis/spec/snorkeling-docs/backend/agent-roundtrip-contract.md`
// （超时不是错误）。

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { i18n } from "@/i18n/config";
import { cn, makeIconClass } from "@/util/util";
import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    getSessionOverviewCacheSnapshot,
    subscribeSessionOverviewCache,
} from "./session-overview-session-cache";
import {
    buildCardSendRequest,
    cardSendRpcTimeoutMs,
    CardSendPhaseLabelKey,
    CardSendPhaseTone,
    isAgentNotReadyCode,
    outcomeFromSend,
    type CardSendResult,
} from "./overview-card-send";

/** composer 只需要「发到哪个块 / 继续等哪个会话」，不需要整只 OverviewBlock。 */
export type CardSendTarget = {
    blockId: string;
    sessionId: string;
};

type CardSendEntry = CardSendResult | "sending";

type CardSendSubmitOverrides = {
    /** 显式覆盖「等回复」勾选（失败重试用同一值，「改为不等待」用 false+dispatch）。 */
    waitReply?: boolean;
    /** 异步派发（失败逃生口「改为不等待」）：async:true，立即返回 queued。 */
    dispatch?: boolean;
};

type CardSendState = {
    expandedBlockId: string | null;
    draftByBlock: Record<string, string>;
    sendByBlock: Record<string, CardSendEntry>;
    sendingStartedAt: Record<string, number>;
    waitReply: boolean;
    setWaitReply: (value: boolean) => void;
    toggleExpanded: (blockId: string) => void;
    collapse: () => void;
    setDraft: (blockId: string, text: string) => void;
    submit: (target: CardSendTarget, text: string, overrides?: CardSendSubmitOverrides) => void;
    retry: (target: CardSendTarget, overrides?: CardSendSubmitOverrides) => void;
    continueWait: (target: CardSendTarget) => void;
    /** unknown 态的 [查状态]：先读派发回执，无记录则强刷会话比对回合数增长。 */
    checkUnknown: (target: CardSendTarget) => void;
    cancelWait: (target: CardSendTarget) => void;
    retryRead: (target: CardSendTarget) => void;
};

export const CardSendContext = React.createContext<CardSendState | null>(null);

function removeRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
    if (!(key in record)) return record;
    const next = { ...record };
    delete next[key];
    return next;
}

export function useCardSendState(reload: () => void): CardSendState {
    const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);
    const [draftByBlock, setDraftByBlock] = useState<Record<string, string>>({});
    const [sendByBlock, setSendByBlock] = useState<Record<string, CardSendEntry>>({});
    const [sendingStartedAt, setSendingStartedAt] = useState<Record<string, number>>({});
    const [waitReply, setWaitReply] = useState(true);
    // 引用镜像：回调里要读最新值，但不想为此每次渲染都换函数引用。
    const waitReplyRef = useRef(waitReply);
    waitReplyRef.current = waitReply;
    const draftRef = useRef(draftByBlock);
    draftRef.current = draftByBlock;
    // 每次发送一个序号：只认最后一次结果（用户可能失败后立即「改为不等待」重发）。
    const sendSeqRef = useRef<Record<string, number>>({});

    const applyOutcome = React.useCallback((blockId: string, outcome: CardSendResult) => {
        setSendByBlock((current) => ({ ...current, [blockId]: outcome }));
        setSendingStartedAt((current) => removeRecordKey(current, blockId));
    }, []);

    const runSend = React.useCallback(
        (target: CardSendTarget, text: string, overrides?: CardSendSubmitOverrides) => {
            const blockId = target.blockId;
            const useWaitReply = overrides?.waitReply ?? waitReplyRef.current;
            const built = buildCardSendRequest({
                blockId,
                text,
                waitReply: useWaitReply,
                dispatch: overrides?.dispatch === true,
            });
            // 空文本在 UI 层就被禁发；这里再兑底一次（纯函数返回 ok:false，不投递）。
            if (!built.ok) return;
            const seq = (sendSeqRef.current[blockId] ?? 0) + 1;
            sendSeqRef.current[blockId] = seq;
            setSendByBlock((current) => ({ ...current, [blockId]: "sending" }));
            setSendingStartedAt((current) => ({ ...current, [blockId]: Date.now() }));
            // RPC timeout 必须覆盖服务端全预算（30s 安静等待 + 180s 提交确认 + 可选等回复窗口），
            // 否则提交确认还在路上就被客户端假杀成「发送失败」（R8 假失败事故根因）。
            const timeout = cardSendRpcTimeoutMs(built.req.replywaitms, useWaitReply);
            RpcApi.AgentSendCommand(TabRpcClient, built.req, { timeout })
                .then((rtn) => {
                    if (sendSeqRef.current[blockId] !== seq) return;
                    const outcome = outcomeFromSend(rtn ?? null);
                    applyOutcome(blockId, outcome);
                    // 只有真发出去才清稿：失败保留给 [重试]；unknown 保留给用户核实后再处置（防重复投递）。
                    if (outcome.phase !== "failed" && outcome.phase !== "unknown") {
                        setDraftByBlock((current) => removeRecordKey(current, blockId));
                    }
                    if (outcome.phase === "replied" || outcome.phase === "timeout") {
                        reload();
                    }
                })
                .catch((error) => {
                    if (sendSeqRef.current[blockId] !== seq) return;
                    const outcome = outcomeFromSend(null, error);
                    console.warn("[overview-card-send] 发送未完成", {
                        blockId,
                        phase: outcome.phase,
                        code: outcome.errorCode,
                        error,
                    });
                    applyOutcome(blockId, outcome);
                });
        },
        [applyOutcome, reload]
    );

    const retry = React.useCallback(
        (target: CardSendTarget, overrides?: CardSendSubmitOverrides) => {
            // 失败时草稿未清（见 runSend），原样重发；「改为不等待」只换投递模式。
            runSend(target, draftRef.current[target.blockId] ?? "", overrides);
        },
        [runSend]
    );

    const continueWait = React.useCallback(
        (target: CardSendTarget) => {
            const blockId = target.blockId;
            const sessionId = target.sessionId;
            if (!sessionId) return;
            setSendingStartedAt((current) => ({ ...current, [blockId]: Date.now() }));
            // 超时后的「继续等」只等状态落回 idle，不重发消息（重发 = 重复投递）。
            RpcApi.SessionWaitCommand(
                TabRpcClient,
                { identifier: sessionId, blockid: blockId, until: "idle", timeoutms: 60_000 },
                { timeout: 75_000 }
            )
                .then((rtn) => {
                    setSendingStartedAt((current) => removeRecordKey(current, blockId));
                    if (rtn?.matched !== true) return;
                    setSendByBlock((current) => {
                        const prev = current[blockId];
                        const base = prev != null && prev !== "sending" ? prev : outcomeFromSend(null);
                        return {
                            ...current,
                            [blockId]: {
                                ...base,
                                phase: "replied",
                                warnings: [],
                                waitedMs: rtn.waitedms ?? base.waitedMs,
                            },
                        };
                    });
                    reload();
                })
                .catch((error) => {
                    console.warn("[overview-card-send] 继续等失败", { blockId, error });
                    setSendingStartedAt((current) => removeRecordKey(current, blockId));
                });
        },
        [reload]
    );

    // unknown 态的 [查状态]（design §5.4）：
    //   1) async 派发路径：读派发回执（AgentDispatchListCommand，内存态，重启即丢）；
    //   2) 无记录（waitreply 同步路径 / 内存已丢）：强刷会话，比对 messageCount 增长
    //      —— 涨了 = 已送达（转 submitted 并清稿）；没涨维持 unknown（诚实，不谎报）。
    const checkUnknown = React.useCallback(
        (target: CardSendTarget) => {
            const blockId = target.blockId;
            const sessionId = target.sessionId;
            void (async () => {
                try {
                    const records = await RpcApi.AgentDispatchListCommand(TabRpcClient, { blockid: blockId, limit: 1 });
                    const record = Array.isArray(records) && records.length > 0 ? records[0] : null;
                    const state =
                        record != null ? ((record as Record<string, unknown>).state as string | undefined) : undefined;
                    if (state === "confirmed") {
                        setSendByBlock((current) => {
                            const prev = current[blockId];
                            const base = prev != null && prev !== "sending" ? prev : outcomeFromSend(null);
                            return { ...current, [blockId]: { ...base, phase: "submitted", warnings: [] } };
                        });
                        setDraftByBlock((current) => removeRecordKey(current, blockId));
                        reload();
                        return;
                    }
                    if (state === "failed") {
                        const message = String((record as Record<string, unknown>).error ?? "");
                        setSendByBlock((current) => {
                            const prev = current[blockId];
                            const base = prev != null && prev !== "sending" ? prev : outcomeFromSend(null);
                            return { ...current, [blockId]: { ...base, phase: "failed", errorMessage: message } };
                        });
                        return;
                    }
                    if (state === "pending" || state === "delivering") {
                        // 派发仍在途：维持 unknown，回执可再查。
                        return;
                    }
                } catch (e) {
                    console.warn("[overview-card-send] 查派发回执失败", { blockId, e });
                }
                if (sessionId == null || sessionId === "") return;
                // 无派发记录：刷新会话比对回合数。
                const before =
                    getSessionOverviewCacheSnapshot([sessionId]).summaries[sessionId]?.messageCount ?? null;
                reload();
                let settled = false;
                const unsubscribe = subscribeSessionOverviewCache(() => {
                    if (settled) return;
                    const after =
                        getSessionOverviewCacheSnapshot([sessionId]).summaries[sessionId]?.messageCount ?? null;
                    if (after == null || before == null) return;
                    if (after > before) {
                        settled = true;
                        unsubscribe();
                        setSendByBlock((current) => {
                            const prev = current[blockId];
                            const base = prev != null && prev !== "sending" ? prev : outcomeFromSend(null);
                            return { ...current, [blockId]: { ...base, phase: "submitted", warnings: [] } };
                        });
                        setDraftByBlock((current) => removeRecordKey(current, blockId));
                    }
                });
                window.setTimeout(() => unsubscribe(), 15_000);
            })();
        },
        [reload]
    );

    const cancelWait = React.useCallback((target: CardSendTarget) => {
        setSendByBlock((current) => removeRecordKey(current, target.blockId));
        setSendingStartedAt((current) => removeRecordKey(current, target.blockId));
    }, []);

    const retryRead = React.useCallback(
        (target: CardSendTarget) => {
            // reply-empty：答复存在但索引没跟上；強刷 detail（refreshSeq → forceRefresh）。
            setSendByBlock((current) => {
                const prev = current[target.blockId];
                if (prev == null || prev === "sending") return current;
                return {
                    ...current,
                    [target.blockId]: {
                        ...prev,
                        warnings: prev.warnings.filter((warning) => warning !== "reply-empty"),
                    },
                };
            });
            reload();
        },
        [reload]
    );

    const toggleExpanded = React.useCallback((blockId: string) => {
        // 互斥：再点同一张卡 = 收起；面板同一时刻只有一张卡展开。
        setExpandedBlockId((current) => (current === blockId ? null : blockId));
    }, []);

    return useMemo<CardSendState>(
        () => ({
            expandedBlockId,
            draftByBlock,
            sendByBlock,
            sendingStartedAt,
            waitReply,
            setWaitReply,
            toggleExpanded,
            collapse: () => setExpandedBlockId(null),
            setDraft: (blockId, text) => setDraftByBlock((current) => ({ ...current, [blockId]: text })),
            submit: (target, text, overrides) => runSend(target, text, overrides),
            retry,
            continueWait,
            checkUnknown,
            cancelWait,
            retryRead,
        }),
        [
            expandedBlockId,
            draftByBlock,
            sendByBlock,
            sendingStartedAt,
            waitReply,
            runSend,
            retry,
            continueWait,
            checkUnknown,
            cancelWait,
            retryRead,
            toggleExpanded,
        ]
    );
}

function useSendingSeconds(startedAt: number | undefined): number {
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        if (startedAt == null) {
            setElapsed(0);
            return;
        }
        const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
        tick();
        const timer = window.setInterval(tick, 1000);
        return () => window.clearInterval(timer);
    }, [startedAt]);
    return elapsed;
}

export type CardSendPanelVariant = "inline" | "popover";

export type CardSendPanelProps = {
    blockId: string;
    /** 继续等（SessionWaitCommand）需要会话标识；恢复/发送链路本身只用 blockId。 */
    sessionId: string;
    /** inline = 列表行内展开体（行为与 11-22 版零变化）；popover = 看板浮层（320px，浮在卡上）。 */
    variant: CardSendPanelVariant;
    /** popover 的「发送后等回复」初值（默认 true）；inline 恒跟随面板级勾选。 */
    defaultWaitReply?: boolean;
    /** 挂载后聚焦输入框（不切激活块 / 不切 Tab）。 */
    autoFocus?: boolean;
    /** Esc / 收起回调：popover 传 onClose 关浮层；inline 不传则收起展开体。 */
    onClose?: () => void;
};

/**
 * 卡片 composer：textarea（Enter 发送 / Shift+Enter 换行 / Esc 收起）+ 等回复勾选 +
 * 行程徽章 + 失败重试（E_AGENT_NOT_READY 额外给「改为不等待」）+ 超时继续等 + reply-empty 重读。
 * variant 只切根类名（is-inline / is-popover），行为同一条链路。
 */
export function CardSendPanel({
    blockId,
    sessionId,
    variant,
    defaultWaitReply = true,
    autoFocus,
    onClose,
}: CardSendPanelProps) {
    const { t } = useTranslation("session-overview");
    const cardSend = React.useContext(CardSendContext);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const draft = cardSend?.draftByBlock[blockId] ?? "";
    const entry = cardSend?.sendByBlock[blockId];
    const sending = entry === "sending";
    const result = entry != null && entry !== "sending" ? entry : null;
    const elapsedSecs = useSendingSeconds(cardSend?.sendingStartedAt[blockId]);
    // 浮层自己记「等回复」勾选（初值 defaultWaitReply）；行内沿用面板级共享勾选（行为零变化）。
    const [localWaitReply, setLocalWaitReply] = useState<boolean | null>(
        variant === "popover" ? defaultWaitReply : null
    );
    const waitReply = localWaitReply ?? (cardSend?.waitReply ?? true);
    const target = useMemo<CardSendTarget>(() => ({ blockId, sessionId }), [blockId, sessionId]);
    const draftEmpty = draft.trim() === "";
    // Esc 收起：popover 只关浮层；inline 沿用原行为（collapse 展开体）。
    const closePanel = () => {
        if (onClose != null) {
            onClose();
        } else {
            cardSend?.collapse();
        }
    };
    const submitDraft = () => {
        if (cardSend == null || draftEmpty) return;
        cardSend.submit(target, draft, { waitReply });
    };
    // 展开即聚焦输入框，但不切激活块/不切 Tab：只 focus，不碰 layout/focus API。
    useEffect(() => {
        if (!autoFocus) return;
        const node = textareaRef.current;
        if (node == null) return;
        const timer = window.setTimeout(() => node.focus({ preventScroll: true }), 0);
        return () => window.clearTimeout(timer);
    }, [autoFocus, blockId]);

    return (
        <div
            className={cn("session-overview-card-send-panel", variant === "popover" ? "is-popover" : "is-inline")}
            data-overview-card-send-panel={variant}
        >
            {/* composer：Enter 发送 / Shift+Enter 换行 / Esc 收起 */}
            <textarea
                ref={textareaRef}
                className="session-overview-card-send-input"
                data-overview-card-send-input={blockId}
                placeholder={t("session-overview:panel.cardSendPlaceholder")}
                value={draft}
                spellCheck={false}
                aria-label={t("session-overview:panel.cardSendPlaceholder")}
                onChange={(event) => cardSend?.setDraft(blockId, event.target.value)}
                onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Escape") {
                        closePanel();
                        return;
                    }
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        submitDraft();
                    }
                }}
            />
            <div className="session-overview-card-send-footer">
                <label className="session-overview-card-send-wait">
                    <input
                        type="checkbox"
                        data-overview-card-send-wait={blockId}
                        checked={waitReply}
                        onChange={(event) => {
                            // inline 写回面板级共享勾选（原行为）；popover 只改本地。
                            if (variant === "inline") {
                                cardSend?.setWaitReply(event.target.checked);
                            } else {
                                setLocalWaitReply(event.target.checked);
                            }
                        }}
                    />
                    <span>{t("session-overview:panel.cardSendWaitReply")}</span>
                </label>
                {/* 行程徽章：发送中显秒数，结果按 phase 上色（replied 绿 / timeout 黄 / failed 红 / unconfirmed 橙） */}
                {sending ? (
                    <span className="session-overview-card-send-badge is-pending">
                        <i className={makeIconClass("spinner", false)} />
                        <span>{i18n.t("session-overview:panel.cardSendSending", { secs: elapsedSecs })}</span>
                    </span>
                ) : result != null ? (
                    <span className={cn("session-overview-card-send-badge", `is-${CardSendPhaseTone[result.phase]}`)}>
                        <span>{i18n.t(CardSendPhaseLabelKey[result.phase])}</span>
                        {result.phase === "timeout" ? (
                            <span className="session-overview-card-send-badge-note">
                                {Math.floor(result.waitedMs / 1000)}s
                            </span>
                        ) : null}
                    </span>
                ) : null}
                <button
                    type="button"
                    className="session-overview-card-send-submit"
                    data-overview-card-send-submit={blockId}
                    disabled={sending || draftEmpty}
                    onClick={(event) => {
                        event.stopPropagation();
                        submitDraft();
                    }}
                >
                    <span>{t("session-overview:panel.cardSendSubmit")}</span>
                </button>
            </div>
            {/* R3.3 失败不弹窗：原地 ⚠ <code> <msg> [重试]；E_AGENT_NOT_READY 额外给 [改为不等待] */}
            {result?.phase === "failed" ? (
                <div className="session-overview-card-send-alert is-danger" role="alert">
                    <span className="session-overview-card-send-alert-text">
                        {"⚠ "}
                        {result.errorCode ? `${result.errorCode} ` : ""}
                        {result.errorMessage ?? ""}
                    </span>
                    <button
                        type="button"
                        className="session-overview-card-send-alert-button"
                        data-overview-card-send-retry={blockId}
                        onClick={(event) => {
                            event.stopPropagation();
                            cardSend?.retry(target, { waitReply });
                        }}
                    >
                        {t("session-overview:panel.cardSendRetry")}
                    </button>
                    {isAgentNotReadyCode(result.errorCode) ? (
                        <button
                            type="button"
                            className="session-overview-card-send-alert-button"
                            onClick={(event) => {
                                event.stopPropagation();
                                cardSend?.retry(target, { waitReply: false, dispatch: true });
                            }}
                        >
                            {t("session-overview:panel.cardSendNoWait")}
                        </button>
                    ) : null}
                </div>
            ) : null}
            {/* unknown（客户端超时/取消）：结果未知，绝不给 [重试]（防重复投递），只给 [查状态] [继续等] */}
            {result?.phase === "unknown" ? (
                <div className="session-overview-card-send-alert is-warn" data-overview-card-send-unknown={blockId}>
                    <span className="session-overview-card-send-alert-text">
                        {"⚠ "}
                        {t("session-overview:panel.cardSendUnknown")}
                    </span>
                    <button
                        type="button"
                        className="session-overview-card-send-alert-button"
                        data-overview-card-send-check-status={blockId}
                        onClick={(event) => {
                            event.stopPropagation();
                            cardSend?.checkUnknown(target);
                        }}
                    >
                        {t("session-overview:panel.cardSendCheckStatus")}
                    </button>
                    <button
                        type="button"
                        className="session-overview-card-send-alert-button"
                        onClick={(event) => {
                            event.stopPropagation();
                            cardSend?.continueWait(target);
                        }}
                    >
                        {t("session-overview:panel.cardSendContinueWait")}
                    </button>
                </div>
            ) : null}
            {/* 超时不算失败（agent-roundtrip-contract §3）：停在等回复，给 [继续等] [取消] */}
            {result?.phase === "timeout" ? (
                <div className="session-overview-card-send-alert is-warn">
                    <button
                        type="button"
                        className="session-overview-card-send-alert-button"
                        onClick={(event) => {
                            event.stopPropagation();
                            cardSend?.continueWait(target);
                        }}
                    >
                        {t("session-overview:panel.cardSendContinueWait")}
                    </button>
                    <button
                        type="button"
                        className="session-overview-card-send-alert-button"
                        onClick={(event) => {
                            event.stopPropagation();
                            cardSend?.cancelWait(target);
                        }}
                    >
                        {t("session-overview:panel.cardSendCancelWait")}
                    </button>
                </div>
            ) : null}
            {/* reply-empty：答复存在但索引没跟上，给 [重试读取] */}
            {result != null && result.warnings.includes("reply-empty") ? (
                <div className="session-overview-card-send-alert is-warn">
                    <span className="session-overview-card-send-alert-text">{"⚠ reply-empty"}</span>
                    <button
                        type="button"
                        className="session-overview-card-send-alert-button"
                        onClick={(event) => {
                            event.stopPropagation();
                            cardSend?.retryRead(target);
                        }}
                    >
                        {t("session-overview:panel.cardSendRetryRead")}
                    </button>
                </div>
            ) : null}
        </div>
    );
}
