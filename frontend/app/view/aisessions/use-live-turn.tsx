// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// useLiveTurn: accumulates in-flight chat SSE events (user echo / assistant
// text / tool runs) into a single "live turn" view model so the message list
// can render streaming output inline. Cleared by the caller once the
// post-turn DetailDelta refresh lands (see handleTurnEnd below).
//
// ponytail: steer turns ride a second, silently-drained SSE connection and do
// NOT feed this hook; their content appears via the next DetailDelta refresh.
// Upgrade path: multiplex both connections through one event reducer.

import { WaveStreamdown } from "@/app/element/streamdown";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatEvent } from "./use-chat-stream";
import { ThinkingDisclosure, ToolCallRow } from "./session-message";

export type LiveToolRun = { id?: string; name: string; status?: string; detail?: string };

export type LiveTurn = {
    userText: string;
    userMessageSeqFloor: number;
    text: string;
    thinkingText: string;
    tools: LiveToolRun[];
};

export type LiveTurns = Record<string, LiveTurn>;

const emptyTurn = (userText = "", userMessageSeqFloor = 0): LiveTurn => ({
    userText,
    userMessageSeqFloor,
    text: "",
    thinkingText: "",
    tools: [],
});
const LiveTurnFlushIntervalMs = 32;

export function reduceLiveTurn(base: LiveTurn, evt: ChatEvent): LiveTurn {
    switch (evt.type) {
        case "message_start":
            return evt.role === "user" ? { ...base, userText: evt.text ?? "" } : base;
        case "assistant_delta":
            // 不清空 thinkingText：思考过程在正文开始流式后仍保留展示，
            // turn_end 时与历史消息的 Thinking（后端从会话文件提取）衔接。
            return { ...base, text: base.text + (evt.text ?? "") };
        case "thinking_delta":
            return { ...base, thinkingText: base.thinkingText + (evt.text ?? "") };
        case "tool_call_start":
            return {
                ...base,
                tools: [...base.tools, { ...(evt.toolCallId ? { id: evt.toolCallId } : {}), name: evt.toolName ?? "" }],
            };
        case "tool_call_update": {
            const tools = [...base.tools];
            for (let i = tools.length - 1; i >= 0; i--) {
                const matches = evt.toolCallId ? tools[i].id === evt.toolCallId : tools[i].name === evt.toolName;
                if (matches) {
                    tools[i] = {
                        ...tools[i],
                        status: evt.toolStatus ?? tools[i].status,
                        detail: evt.detail ?? tools[i].detail,
                    };
                    break;
                }
            }
            return { ...base, tools };
        }
        case "tool_call_end": {
            const tools = [...base.tools];
            for (let i = tools.length - 1; i >= 0; i--) {
                const matches = evt.toolCallId ? tools[i].id === evt.toolCallId : tools[i].name === evt.toolName;
                if (matches) {
                    tools[i] = { ...tools[i], status: evt.toolStatus, detail: evt.detail };
                    break;
                }
            }
            return { ...base, tools };
        }
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

/**
 * Inline streaming block rendered at the bottom of the message list: user
 * echo bubble, live tool rows, growing assistant text with cursor, and a
 * typing-dots placeholder covering TTFT dead time.
 */
export function LiveTurnBlock({ turn, userMessagePersisted = false }: { turn: LiveTurn; userMessagePersisted?: boolean }) {
    // live 工具行展开状态（key = tools 数组下标；同一 turn 内顺序稳定）
    const [openLiveTools, setOpenLiveTools] = useState<Record<number, boolean>>({});
    return (
        <div className="mt-2 flex flex-col gap-2">
            {turn.userText && !userMessagePersisted ? (
                <div className="flex justify-end">
                    <div className="max-w-[78%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-accent/25 bg-accent/10 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-primary">
                        {turn.userText}
                    </div>
                </div>
            ) : null}
            {/* 流式思考与历史思考用同一组件（Paseo 风格）：思考进行时展开+脉冲，正文/工具接管后收起 */}
            {turn.thinkingText ? (
                <ThinkingDisclosure
                    text={turn.thinkingText}
                    streaming={turn.text === "" && !turn.tools.some((t) => t.status == null)}
                />
            ) : null}
            {/* live 工具行与落盘 ToolCallCard 共用 ToolCallRow：外观一致，turn_end 交接无缝 */}
            {turn.tools.map((tool, idx) => {
                const running = tool.status == null;
                const preview = tool.detail ? (tool.detail.length > 120 ? tool.detail.slice(0, 120) + "…" : tool.detail) : "";
                return (
                    <ToolCallRow
                        key={`live-tool-${idx}`}
                        name={tool.name}
                        preview={preview}
                        status={running ? "running" : tool.status === "failed" ? "failed" : "completed"}
                        animateStatus={!running}
                        expanded={openLiveTools[idx] ?? false}
                        onToggle={() => setOpenLiveTools((current) => ({ ...current, [idx]: !current[idx] }))}
                    >
                        {tool.detail ? (
                            <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded bg-panel p-2 text-[11px] leading-4 text-primary">
                                {tool.detail}
                            </pre>
                        ) : (
                            <div className="text-secondary">No tool detail.</div>
                        )}
                    </ToolCallRow>
                );
            })}
            {turn.text ? (
                <div className="min-w-0 rounded-2xl rounded-bl-sm border border-border/60 bg-surface px-3 py-2 text-sm">
                    <WaveStreamdown text={turn.text} parseIncompleteMarkdown />
                    {!turn.tools.some((t) => t.status == null) ? <span className="ly-cursor" /> : null}
                </div>
            ) : !turn.thinkingText && !turn.tools.some((t) => t.status == null) ? (
                <div className="flex items-center gap-1.5 px-1 py-2">
                    <span className="ly-flow-dot" />
                    <span className="ly-flow-dot" />
                    <span className="ly-flow-dot" />
                </div>
            ) : null}
        </div>
    );
}
