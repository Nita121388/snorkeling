// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// useLiveTurn: accumulates in-flight chat SSE events (user echo / assistant
// text / tool runs) into a single "live turn" view model so the message list
// can render streaming output inline. Cleared by the caller once the
// post-turn DetailDelta refresh lands (see handleTurnEnd below).
//
// 时间线模型：事件按真实到达顺序追加为有序 items（thinking / text / tool
// 交替分段），与落盘渲染（消息 + ToolCallCard 按时间线交错）天然对齐——
// 旧版把事件分桶后按固定顺序 thinking→tools→text 渲染，会在工具插队时把
// 已到达正文推到底部、落盘瞬间又跳回，造成视觉断裂。
//
// ponytail: steer turns ride a second, silently-drained SSE connection and do
// NOT feed this hook; their content appears via the next DetailDelta refresh.
// Upgrade path: multiplex both connections through one event reducer.

import { WaveStreamdown } from "@/app/element/streamdown";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatEvent } from "./use-chat-stream";
import { ThinkingDisclosure, ToolCallRow } from "./session-message";

export type LiveToolRun = {
    id?: string;
    name: string;
    /** undefined = 仍在运行 */
    status?: string;
    /** 调用参数（tool_call_start 的 detail），用于行预览，对齐落盘 ToolCall.summary */
    args?: string;
    /** 执行结果（update/end 的 detail），放展开区，对齐落盘 ToolCall.output */
    result?: string;
};

export type LiveItem =
    | { kind: "thinking"; text: string }
    | { kind: "text"; text: string }
    | { kind: "tool"; tool: LiveToolRun };

export type LiveTurn = {
    userText: string;
    userMessageSeqFloor: number;
    items: LiveItem[];
};

export type LiveTurns = Record<string, LiveTurn>;

const emptyTurn = (userText = "", userMessageSeqFloor = 0): LiveTurn => ({
    userText,
    userMessageSeqFloor,
    items: [],
});
const LiveTurnFlushIntervalMs = 32;

/** 后端 previewArgs 给 tool_call_start 的 detail 带 "args " 前缀，落盘 summary 没有，去掉对齐。 */
function stripArgsPrefix(detail?: string): string | undefined {
    if (detail == null) return detail;
    return detail.startsWith("args ") ? detail.slice("args ".length) : detail;
}

function matchesTool(tool: LiveToolRun, evt: ChatEvent): boolean {
    return evt.toolCallId ? tool.id === evt.toolCallId : tool.name === evt.toolName;
}

/** 从尾部找最近一个匹配的工具 item 并更新（工具可能同名/乱序结束）。 */
function updateLastMatchingTool(items: LiveItem[], evt: ChatEvent, patch: (tool: LiveToolRun) => LiveToolRun): LiveItem[] {
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item.kind === "tool" && matchesTool(item.tool, evt)) {
            const next = [...items];
            next[i] = { kind: "tool", tool: patch(item.tool) };
            return next;
        }
    }
    return items;
}

export function reduceLiveTurn(base: LiveTurn, evt: ChatEvent): LiveTurn {
    const items = base.items;
    const last = items.length > 0 ? items[items.length - 1] : null;
    switch (evt.type) {
        case "message_start":
            return evt.role === "user" ? { ...base, userText: evt.text ?? "" } : base;
        case "assistant_delta": {
            const delta = evt.text ?? "";
            if (last != null && last.kind === "text") {
                const next = [...items];
                next[items.length - 1] = { kind: "text", text: last.text + delta };
                return { ...base, items: next };
            }
            // 新文本段：落盘按消息切分，这里按工具/思考边界切分，顺序与落盘一致。
            return { ...base, items: [...items, { kind: "text", text: delta }] };
        }
        case "thinking_delta": {
            const delta = evt.text ?? "";
            if (last != null && last.kind === "thinking") {
                const next = [...items];
                next[items.length - 1] = { kind: "thinking", text: last.text + delta };
                return { ...base, items: next };
            }
            return { ...base, items: [...items, { kind: "thinking", text: delta }] };
        }
        case "tool_call_start":
            return {
                ...base,
                items: [
                    ...items,
                    {
                        kind: "tool",
                        tool: {
                            ...(evt.toolCallId ? { id: evt.toolCallId } : {}),
                            name: evt.toolName ?? "",
                            args: stripArgsPrefix(evt.detail),
                        },
                    },
                ],
            };
        case "tool_call_update":
            return {
                ...base,
                items: updateLastMatchingTool(items, evt, (tool) => ({
                    ...tool,
                    status: evt.toolStatus ?? tool.status,
                    result: evt.detail ?? tool.result,
                })),
            };
        case "tool_call_end":
            return {
                ...base,
                items: updateLastMatchingTool(items, evt, (tool) => ({
                    ...tool,
                    status: evt.toolStatus,
                    result: evt.detail,
                })),
            };
        default:
            return base;
    }
}

export function reduceLiveTurns(turns: LiveTurns, key: string, evt: ChatEvent): LiveTurns {
    return { ...turns, [key]: reduceLiveTurn(turns[key] ?? emptyTurn(), evt) };
}

export function moveLiveTurn(turns: LiveTurns, fromKey: string, toKey: string): LiveTurns {
    const turn = turns[fromKey];
    if (turn == null || fromKey === toKey) return turns;
    const next = { ...turns, [toKey]: turn };
    delete next[fromKey];
    return next;
}

export function useLiveTurns() {
    const [liveTurns, setLiveTurns] = useState<LiveTurns>({});
    const pendingEventsRef = useRef(new Map<string, ChatEvent[]>());
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const flushPending = useCallback(() => {
        if (flushTimerRef.current != null) {
            clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
        }
        const pending = pendingEventsRef.current;
        pendingEventsRef.current = new Map();
        if (pending.size === 0) return;
        setLiveTurns((current) => {
            let next = current;
            for (const [key, events] of pending) {
                for (const evt of events) {
                    next = reduceLiveTurns(next, key, evt);
                }
            }
            return next;
        });
    }, []);

    const scheduleFlush = useCallback(() => {
        if (flushTimerRef.current != null) return;
        flushTimerRef.current = setTimeout(flushPending, LiveTurnFlushIntervalMs);
    }, [flushPending]);

    useEffect(() => {
        return () => {
            if (flushTimerRef.current != null) clearTimeout(flushTimerRef.current);
            pendingEventsRef.current.clear();
        };
    }, []);

    const startLiveTurn = useCallback((key: string, userText = "", userMessageSeqFloor = 0) => {
        if (key === "") return;
        pendingEventsRef.current.delete(key);
        setLiveTurns((current) => ({ ...current, [key]: emptyTurn(userText, userMessageSeqFloor) }));
    }, []);

    const clearLiveTurn = useCallback((key: string) => {
        if (key === "") return;
        pendingEventsRef.current.delete(key);
        setLiveTurns((current) => {
            if (current[key] == null) return current;
            const next = { ...current };
            delete next[key];
            return next;
        });
    }, []);

    const moveLiveTurnState = useCallback((fromKey: string, toKey: string) => {
        if (fromKey === "" || toKey === "" || fromKey === toKey) return;
        const pending = pendingEventsRef.current.get(fromKey);
        if (pending != null) {
            pendingEventsRef.current.set(toKey, [...(pendingEventsRef.current.get(toKey) ?? []), ...pending]);
            pendingEventsRef.current.delete(fromKey);
        }
        setLiveTurns((current) => moveLiveTurn(current, fromKey, toKey));
    }, []);

    const flushLiveTurn = useCallback(
        (key: string) => {
            if (key === "") return;
            if (flushTimerRef.current != null) {
                clearTimeout(flushTimerRef.current);
                flushTimerRef.current = null;
            }
            const pending = pendingEventsRef.current.get(key);
            if (pending == null || pending.length === 0) {
                if (pendingEventsRef.current.size > 0) scheduleFlush();
                return;
            }
            pendingEventsRef.current.delete(key);
            setLiveTurns((current) => {
                let next = current;
                for (const evt of pending) {
                    next = reduceLiveTurns(next, key, evt);
                }
                return next;
            });
            if (pendingEventsRef.current.size > 0) scheduleFlush();
        },
        [scheduleFlush]
    );

    const handleChatEvent = useCallback(
        (key: string, evt: ChatEvent) => {
            if (key === "" || evt.type === "turn_end" || evt.type === "turn_failed") return;
            const pending = pendingEventsRef.current.get(key) ?? [];
            pending.push(evt);
            pendingEventsRef.current.set(key, pending);
            scheduleFlush();
        },
        [scheduleFlush]
    );

    return {
        liveTurns,
        startLiveTurn,
        handleChatEvent,
        clearLiveTurn,
        moveLiveTurn: moveLiveTurnState,
        flushLiveTurn,
    };
}

/** 与落盘 formatToolCallPreview 同款：折叠空白 + 120 字符截断。 */
function liveToolPreview(text?: string): string {
    if (text == null) return "";
    const collapsed = text.replace(/\s+/g, " ").trim();
    if (collapsed.length <= 120) return collapsed;
    return `${collapsed.slice(0, 120)}...`;
}

/**
 * Inline streaming block rendered at the bottom of the message list: user
 * echo bubble, then the turn's ordered timeline (thinking / text / tool
 * segments in real arrival order). Text segments use the same open-prose
 * style as persisted MessageCard (no bubble) so the turn_end handoff does
 * not shift layout; tool rows share ToolCallRow with persisted ToolCallCard.
 */
export function LiveTurnBlock({ turn, userMessagePersisted = false }: { turn: LiveTurn; userMessagePersisted?: boolean }) {
    // live 工具行展开状态（key = items 数组下标；items 只追加，顺序稳定）
    const [openLiveTools, setOpenLiveTools] = useState<Record<number, boolean>>({});
    const items = turn.items;
    return (
        <div className="mt-2 flex flex-col gap-2">
            {turn.userText && !userMessagePersisted ? (
                <div className="flex justify-end">
                    <div className="max-w-[78%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-accent/25 bg-accent/10 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-primary">
                        {turn.userText}
                    </div>
                </div>
            ) : null}
            {items.map((item, idx) => {
                const isLast = idx === items.length - 1;
                if (item.kind === "thinking") {
                    // 与历史思考同一组件（Paseo 风格）：该段仍在增长时展开+脉冲，后续内容到达后收起
                    return <ThinkingDisclosure key={`live-thinking-${idx}`} text={item.text} streaming={isLast} />;
                }
                if (item.kind === "tool") {
                    const tool = item.tool;
                    // tool_call_update 会带 status="running"：null 和 "running" 都算运行中，
                    // 否则 update 一到（常与 start 同批）就误判完成，spinner 永远看不到。
                    const running = tool.status == null || tool.status === "running";
                    const detailParts = [
                        tool.args ? `Input:\n${tool.args}` : "",
                        tool.result ? `Output:\n${tool.result}` : "",
                    ].filter(Boolean);
                    return (
                        <ToolCallRow
                            key={`live-tool-${idx}`}
                            name={tool.name}
                            preview={liveToolPreview(tool.args)}
                            status={running ? "running" : tool.status === "failed" ? "failed" : "completed"}
                            animateStatus={!running}
                            expanded={openLiveTools[idx] ?? false}
                            onToggle={() => setOpenLiveTools((current) => ({ ...current, [idx]: !current[idx] }))}
                        >
                            {detailParts.length > 0 ? (
                                <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded bg-panel p-2 text-[11px] leading-4 text-primary">
                                    {detailParts.join("\n\n")}
                                </pre>
                            ) : (
                                <div className="text-secondary">No tool detail.</div>
                            )}
                        </ToolCallRow>
                    );
                }
                // 文本段：与落盘 MessageCard 的 AI 正文同款开放散文（无气泡），交接时样式不断裂
                return (
                    <div key={`live-text-${idx}`} className="w-full min-w-0 px-1 py-0.5 text-sm">
                        <WaveStreamdown text={item.text} parseIncompleteMarkdown />
                        {isLast ? <span className="ly-cursor" /> : null}
                    </div>
                );
            })}
            {items.length === 0 ? (
                <div className="flex items-center gap-1.5 px-1 py-2">
                    <span className="ly-flow-dot" />
                    <span className="ly-flow-dot" />
                    <span className="ly-flow-dot" />
                </div>
            ) : null}
        </div>
    );
}
