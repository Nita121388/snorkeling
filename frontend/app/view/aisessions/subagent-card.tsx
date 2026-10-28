// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { AISessionsServiceType } from "@/app/store/services";
import { cn } from "@/util/util";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AnimatedExpand, MessageCard } from "./session-message";
import { SessionDetailSkeleton } from "./session-detail-skeleton";
import { CancelledError, SubagentLoadQueue, isCancelled } from "./subagent-load-queue";
import { DurationBar } from "./duration-bar";
import { formatDuration, subagentDurationMs } from "./fold-duration";

/** 嵌套深度上限：超过只显示摘要，避免无限展开。 */
export const MaxSubagentDepth = 3;

/**
 * 子会话内容通过这个队列串行加载：一次只放行一个完整会话的解析/渲染，
 * 主时间线的滚动与搜索永远优先。模块级单例，父会话内所有子代理共享。
 */
const subagentQueue = new SubagentLoadQueue();

/** 折叠态的一行摘要：agent + 任务摘要。 */
export function subagentSummary(match: SubagentMatch): string {
    const agent = (match.call.agent ?? "").trim() || "subagent";
    const task = (match.call.task ?? "").replace(/\s+/g, " ").trim();
    return task === "" ? agent : `${agent} · ${task}`;
}

/** 是否允许展开：深度未超限，且确实有候选可加载。 */
export function canExpandSubagent(match: SubagentMatch, depth: number): boolean {
    if (depth >= MaxSubagentDepth) {
        return false;
    }
    return match.status === "matched" || match.status === "ambiguous";
}

/** 折叠行的状态点：无法匹配时降级为普通（不报错）。 */
export function subagentRowStatus(match: SubagentMatch): "completed" | "failed" {
    return match.status === "missing" ? "failed" : "completed";
}

type SubagentChildState = {
    loading: boolean;
    loadingMore: boolean;
    error: string;
    detail: SessionDetail | null;
    nested: SubagentMatch[];
};

const emptyChildState: SubagentChildState = {
    loading: false,
    loadingMore: false,
    error: "",
    detail: null,
    nested: [],
};

/**
 * 会话详情里归位在父消息之下的可折叠子代理卡片。
 *
 * - 折叠：agent + 任务摘要 + 状态；
 * - 展开：先出骨架，随后分帧加载子会话内容（复用 MessageCard），并递归渲染孙代理；
 * - 加载走串行队列（一次只一个），折叠 / 卸载立即取消；
 * - ambiguous：不猜测，列出候选让用户点开；
 * - 超过 MaxSubagentDepth：只显示摘要。
 * 匹配失败（missing）时完全退化成一行普通工具行，不报错。
 */
export const SubagentCard = memo(function SubagentCard({
    match,
    depth = 0,
    service,
    connection,
    onOpenSession,
}: {
    match: SubagentMatch;
    depth?: number;
    service: AISessionsServiceType;
    connection?: string | null;
    onOpenSession?: (sessionKey: string) => void;
}) {
    const expandable = canExpandSubagent(match, depth);
    const [expanded, setExpanded] = useState(false);
    const [state, setState] = useState<SubagentChildState>(emptyChildState);
    // 世代号：折叠 / 卸载时递增，迟到响应据此丢弃，避免内容串位。
    const generationRef = useRef(0);
    const sessionKey = match.sessionKey;

    const cancelInFlight = useCallback(() => {
        generationRef.current += 1;
        subagentQueue.cancel((id) => id === sessionKey);
    }, [sessionKey]);

    const loadFrames = useCallback(
        async (startDetail: SessionDetail, generation: number) => {
            let detail = startDetail;
            // 分帧补齐：首帧已在 state 里，这里只补后续帧。
            while (detail.hasMore) {
                const delta = await subagentQueue.submit({
                    id: sessionKey,
                    run: () =>
                        service.DetailDelta({
                            id: sessionKey,
                            connection,
                            source: detail.summary.source,
                            filePath: detail.summary.filePath,
                            messageCount: detail.summary.messageCount,
                            loadAll: true,
                            messageOffset: detail.nextMessageOffset ?? detail.messages?.length ?? 0,
                            includeTools: true,
                            // LoadAll 分帧按消息下标推进，字节游标不参与；类型要求必填。
                            cursor: { byteOffset: 0, fileSize: 0, mtime: 0, lastSeq: 0 },
                        }),
                });
                if (generation !== generationRef.current) return;
                if (delta.status === "rejected") {
                    if (isCancelled(delta.error)) return;
                    // 补帧失败不丢已渲染内容：保留内容 + 提示重试
                    setState((current) => ({
                        ...current,
                        loadingMore: false,
                        error: delta.error instanceof Error ? delta.error.message : String(delta.error),
                    }));
                    return;
                }
                const value = delta.value;
                const messages = [...(detail.messages ?? []), ...(value.messages ?? [])];
                const toolCalls = [...(detail.toolCalls ?? []), ...(value.toolCalls ?? [])];
                detail = {
                    ...detail,
                    messages,
                    toolCalls,
                    summary: { ...detail.summary, messageCount: value.summary?.messageCount ?? detail.summary.messageCount },
                    hasMore: value.hasMore ?? false,
                    nextMessageOffset: value.nextMessageOffset ?? messages.length,
                };
                setState((current) => ({
                    ...current,
                    loadingMore: value.hasMore ?? false,
                    detail: current.detail == null ? null : detail,
                }));
            }
        },
        [connection, service, sessionKey]
    );

    const loadChild = useCallback(
        async (key: string) => {
            const generation = ++generationRef.current;
            setState({ loading: true, loadingMore: false, error: "", detail: null, nested: [] });
            try {
                const outcome = await subagentQueue.submit({
                    id: key,
                    run: () =>
                        service.Detail({
                            id: key,
                            connection,
                            includeTools: true,
                            loadAll: true,
                        }),
                });
                if (generation !== generationRef.current) return;
                if (outcome.status === "rejected") {
                    if (isCancelled(outcome.error)) return;
                    setState({
                        loading: false,
                        loadingMore: false,
                        error: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
                        detail: null,
                        nested: [],
                    });
                    return;
                }
                const detail = outcome.value;
                setState({
                    loading: false,
                    loadingMore: detail.hasMore ?? false,
                    error: "",
                    detail,
                    nested: [],
                });
                // 孙代理信息拿不到不影响子会话内容展示。
                if (depth + 1 < MaxSubagentDepth) {
                    try {
                        const fold = await subagentQueue.submit({
                            id: `${key}:fold`,
                            run: () => service.SubagentFold({ id: key, connection }),
                        });
                        if (generation !== generationRef.current) return;
                        if (fold.status === "fulfilled") {
                            setState((current) => ({ ...current, nested: fold.value?.matches ?? [] }));
                        }
                    } catch {
                        // 忽略：孙代理为可选增强
                    }
                }
                await loadFrames(detail, generation);
            } catch (err) {
                if (generation !== generationRef.current) return;
                if (isCancelled(err)) return;
                setState({
                    loading: false,
                    loadingMore: false,
                    error: err instanceof Error ? err.message : String(err),
                    detail: null,
                    nested: [],
                });
            }
        },
        [connection, depth, loadFrames, service]
    );

    // 只在匹配唯一时自动加载，避免展开空转。
    useEffect(() => {
        if (expanded && match.status === "matched" && state.detail == null && !state.loading && state.error === "") {
            void loadChild(sessionKey);
        }
    }, [expanded, match.status, sessionKey, state, loadChild]);

    // 折叠或卸载：取消在途请求，迟到响应被世代号丢弃。
    useEffect(() => {
        return () => cancelInFlight();
    }, [cancelInFlight]);

    const openSession = useCallback(
        (key: string) => {
            onOpenSession?.(key);
        },
        [onOpenSession]
    );

    const retry = useCallback(() => {
        setState((current) => ({ ...current, error: "", detail: null, nested: [] }));
        void loadChild(sessionKey);
    }, [loadChild, sessionKey]);

    const toggle = useCallback(() => {
        if (!expandable) return;
        setExpanded((current) => {
            const next = !current;
            if (!next) cancelInFlight();
            return next;
        });
    }, [expandable, cancelInFlight]);

    const agentName = (match.call.agent ?? "").trim() || "subagent";
    const taskText = (match.call.task ?? "").replace(/\s+/g, " ").trim();
    const failed = subagentRowStatus(match) === "failed";
    // 折叠态即可显示的时长：子会话最后更新时间 - 派发时间。不依赖子会话内容加载。
    const durationMs = subagentDurationMs(match.call.timestamp, match.updatedAt);

    return (
        <div
            className={cn(
                "my-1 min-w-0 overflow-hidden rounded-lg border border-border/60 border-l-2 bg-surface-soft transition-colors hover:bg-surface",
                !expandable && "opacity-90"
            )}
            style={{ borderLeftColor: "var(--agent-stale-color)" }}
        >
            <div
                className="flex w-full items-center gap-2 px-2 py-1 text-left transition-colors hover:bg-hover"
                role="button"
                tabIndex={expandable ? 0 : -1}
                onClick={toggle}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggle();
                    }
                }}
            >
                <i
                    className={cn(
                        "fa-sharp fa-solid shrink-0 text-[9px] text-secondary transition-transform duration-200",
                        expanded ? "fa-chevron-down" : "fa-chevron-right"
                    )}
                />
                {durationMs != null && durationMs > 0 ? (
                    <DurationBar
                        durationMs={durationMs}
                        maxDurationMs={0}
                        showText
                        label={`Total ${formatDuration(durationMs)}`}
                        fillColor="var(--agent-stale-color)"
                    />
                ) : null}
                <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px]"
                    style={{
                        color: "var(--agent-stale-color)",
                        backgroundColor: "color-mix(in srgb, var(--agent-stale-color) 16%, transparent)",
                    }}
                >
                    <i className="fa-sharp fa-solid fa-robot" />
                </span>
                <span className="shrink-0 text-[11px] font-semibold" style={{ color: "var(--agent-stale-color)" }}>
                    {agentName}
                </span>
                {taskText !== "" ? (
                    <span className="min-w-0 flex-1 truncate text-[11px] text-secondary">{taskText}</span>
                ) : (
                    <span className="flex-1" />
                )}
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", failed ? "bg-error" : "bg-success")} />
                {onOpenSession ? (
                    <button
                        type="button"
                        className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors hover:bg-hover"
                        style={{ color: "var(--agent-stale-color)" }}
                        onClick={(e) => {
                            e.stopPropagation();
                            openSession(match.sessionKey);
                        }}
                    >
                        <i className="fa-sharp fa-solid fa-up-right-from-square text-[9px]" />
                        Open
                    </button>
                ) : null}
            </div>
            <AnimatedExpand open={expanded}>
                <div
                    className="ml-2 border-l pl-3 pb-1"
                    style={{ borderLeftColor: "color-mix(in srgb, var(--agent-stale-color) 35%, transparent)" }}
                >
                {match.status === "ambiguous" ? (
                    <div className="space-y-1 py-1">
                        <div className="text-[10px] text-secondary">Multiple candidates matched. Pick the correct child session:</div>
                        {match.candidates?.map((candidate) => (
                            <button
                                key={candidate.sessionKey}
                                type="button"
                                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] transition-colors hover:bg-hover cursor-pointer"
                                onClick={() => openSession(candidate.sessionKey)}
                            >
                                <i className="fa-sharp fa-solid fa-up-right-from-square text-[9px] text-secondary" />
                                <span className="min-w-0 flex-1 truncate">{candidate.name || candidate.sessionKey}</span>
                            </button>
                        ))}
                    </div>
                ) : null}

                {match.status === "matched" ? (
                    <div className="space-y-2 py-1">
                        <div className="text-[10px] text-secondary">Child session</div>
                        {state.loading ? (
                            // 骨架占位：让用户立刻看到"正在加载"的结构，而不是一行静止文字
                            <SessionDetailSkeleton rows={3} />
                        ) : state.error !== "" ? (
                            <div className="space-y-1.5">
                                <div className="text-[10px] text-error">{state.error}</div>
                                {state.detail != null ? (
                                    <div className="text-[10px] text-secondary">Loaded content is preserved.</div>
                                ) : null}
                                <button
                                    type="button"
                                    className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-secondary transition-colors hover:bg-hover hover:text-primary"
                                    onClick={retry}
                                >
                                    <i className="fa-sharp fa-solid fa-rotate-right text-[9px]" />
                                    Retry
                                </button>
                            </div>
                        ) : (
                            <div className={cn("space-y-1")}>
                                {state.detail?.messages?.map((message) => (
                                    <MessageCard
                                        key={message.itemKey ?? message.seq}
                                        message={message}
                                        registerRef={() => {}}
                                        groupStart={false}
                                    />
                                ))}
                                {state.loadingMore ? (
                                    <div
                                        className="flex items-center gap-1.5 px-1 py-1 text-[10px] text-secondary"
                                        role="status"
                                        aria-live="polite"
                                    >
                                        <i className="fa-sharp fa-solid fa-spinner animate-spin text-[10px]" />
                                        <span>Loading more…</span>
                                    </div>
                                ) : null}
                                {state.nested.map((childMatch) => (
                                    <SubagentCard
                                        key={childMatch.call.itemKey ?? childMatch.call.entryId ?? subagentSummary(childMatch)}
                                        match={childMatch}
                                        depth={depth + 1}
                                        service={service}
                                        connection={connection}
                                        onOpenSession={onOpenSession}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                ) : null}
            </div>
            </AnimatedExpand>
        </div>
    );
});

export { CancelledError };
