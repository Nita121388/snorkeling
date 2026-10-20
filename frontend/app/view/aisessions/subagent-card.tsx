// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { AISessionsServiceType } from "@/store/services";
import { cn } from "@/util/util";
import { memo, useCallback, useEffect, useState } from "react";
import { MessageCard, ToolCallRow } from "./session-message";

/** 嵌套深度上限：超过只显示摘要，避免无限展开。 */
export const MaxSubagentDepth = 3;

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
    error: string;
    detail: SessionDetail | null;
    nested: SubagentMatch[];
};

const emptyChildState: SubagentChildState = { loading: false, error: "", detail: null, nested: [] };

/**
 * 会话详情里的可折叠子代理卡片。
 *
 * - 折叠：agent + 任务摘要 + 状态；
 * - 展开：加载子会话内容（复用 MessageCard），并递归渲染孙代理；
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

    const loadChild = useCallback(
        async (sessionKey: string) => {
            setState({ loading: true, error: "", detail: null, nested: [] });
            try {
                const detail = await service.Detail({ id: sessionKey, connection });
                let nested: SubagentMatch[] = [];
                if (depth + 1 < MaxSubagentDepth) {
                    try {
                        const fold = await service.SubagentFold({ id: sessionKey, connection });
                        nested = fold?.matches ?? [];
                    } catch {
                        // 孙代理信息拿不到不影响子会话内容展示。
                        nested = [];
                    }
                }
                setState({ loading: false, error: "", detail, nested });
            } catch (err) {
                setState({
                    loading: false,
                    error: err instanceof Error ? err.message : String(err),
                    detail: null,
                    nested: [],
                });
            }
        },
        [connection, depth, service]
    );

    // 只在匹配唯一时自动预加载，避免展开空转。
    useEffect(() => {
        if (expanded && match.status === "matched" && state.detail == null && !state.loading && state.error === "") {
            void loadChild(match.sessionKey);
        }
    }, [expanded, match.status, match.sessionKey, state, loadChild]);

    const openSession = useCallback(
        (key: string) => {
            onOpenSession?.(key);
        },
        [onOpenSession]
    );

    return (
        <ToolCallRow
            name="subagent"
            preview={subagentSummary(match)}
            status={subagentRowStatus(match)}
            expanded={expanded}
            onToggle={() => {
                if (expandable) {
                    setExpanded((current) => !current);
                }
            }}
        >
            <div className="ml-4 border-l border-border pl-3 pb-2">
                {match.status === "ambiguous" ? (
                    <div className="space-y-1 py-1">
                        <div className="text-[10px] text-secondary">
                            匹配到多个候选，请选择正确的子会话：
                        </div>
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
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] text-secondary">子会话内容</span>
                            {onOpenSession ? (
                                <button
                                    type="button"
                                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-accent transition-colors hover:bg-hover cursor-pointer"
                                    onClick={() => openSession(match.sessionKey)}
                                >
                                    <i className="fa-sharp fa-solid fa-up-right-from-square text-[9px]" />
                                    打开子会话
                                </button>
                            ) : null}
                        </div>
                        {state.loading ? (
                            <div className="text-[10px] text-secondary">加载中…</div>
                        ) : state.error !== "" ? (
                            <div className="text-[10px] text-error">{state.error}</div>
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
        </ToolCallRow>
    );
});
