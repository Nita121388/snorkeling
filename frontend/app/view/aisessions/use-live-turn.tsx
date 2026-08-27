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
import { cn } from "@/util/util";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatEvent } from "./use-chat-stream";

export type LiveToolRun = { name: string; status?: string; detail?: string };

export type LiveTurn = {
    userText: string;
    text: string;
    thinking: boolean;
    tools: LiveToolRun[];
};

export type LiveTurns = Record<string, LiveTurn>;

const emptyTurn = (): LiveTurn => ({ userText: "", text: "", thinking: false, tools: [] });
const LiveTurnFlushIntervalMs = 32;

export function reduceLiveTurn(base: LiveTurn, evt: ChatEvent): LiveTurn {
    switch (evt.type) {
        case "message_start":
            return evt.role === "user" ? { ...base, userText: evt.text ?? "" } : base;
        case "assistant_delta":
            return { ...base, text: base.text + (evt.text ?? "") };
        case "thinking_delta":
            return { ...base, thinking: true };
        case "tool_call_start":
            return {
                ...base,
                thinking: false,
                tools: [...base.tools, { name: evt.toolName ?? "" }],
            };
        case "tool_call_end": {
            const tools = [...base.tools];
            for (let i = tools.length - 1; i >= 0; i--) {
                if (tools[i].name === evt.toolName && tools[i].status == null) {
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

    const startLiveTurn = useCallback((key: string) => {
        if (key === "") return;
        pendingEventsRef.current.delete(key);
        setLiveTurns((current) => ({ ...current, [key]: emptyTurn() }));
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

    const flushLiveTurn = useCallback((key: string) => {
        if (key === "") return;
        if (flushTimerRef.current != null) {
            clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
        }
        const pending = pendingEventsRef.current.get(key);
        if (pending == null || pending.length === 0) return;
        pendingEventsRef.current.delete(key);
        setLiveTurns((current) => {
            let next = current;
            for (const evt of pending) {
                next = reduceLiveTurns(next, key, evt);
            }
            return next;
        });
    }, []);

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

    return { liveTurns, startLiveTurn, handleChatEvent, clearLiveTurn, moveLiveTurn: moveLiveTurnState, flushLiveTurn };
}

/**
 * Inline streaming block rendered at the bottom of the message list: user
 * echo bubble, live tool rows, growing assistant text with cursor, and a
 * typing-dots placeholder covering TTFT dead time.
 */
export function LiveTurnBlock({ turn }: { turn: LiveTurn }) {
    return (
        <div className="mt-2 flex flex-col gap-2">
            {turn.userText ? (
                <div className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-accent/15 px-3 py-2 text-sm leading-relaxed">
                        {turn.userText}
                    </div>
                </div>
            ) : null}
            {turn.tools.map((tool, idx) => (
                <div
                    key={`live-tool-${idx}`}
                    className="rounded-lg border border-border/60 bg-bg/40 px-3 py-1.5 text-xs text-secondary"
                >
                    <span
                        className={cn(
                            "mr-1.5 inline-flex w-3 items-center justify-center font-medium",
                            tool.status === "failed" ? "text-error" : "text-accent"
                        )}
                    >
                        {tool.status == null ? (
                            <i className="fa-sharp fa-solid fa-spinner animate-spin text-[10px]" />
                        ) : tool.status === "failed" ? (
                            "✗"
                        ) : (
                            "✓"
                        )}
                    </span>
                    <span className="font-medium text-primary/80">{tool.name}</span>
                    {tool.detail ? (
                        <span className="ml-1 opacity-70">
                            {tool.detail.length > 120 ? tool.detail.slice(0, 120) + "…" : tool.detail}
                        </span>
                    ) : null}
                </div>
            ))}
            {turn.text ? (
                <div className="min-w-0 rounded-2xl rounded-bl-sm border border-border/60 bg-surface px-3 py-2 text-sm">
                    {/* parseIncompleteMarkdown 兼容流中未闭合语法；▌作为字符追加，跟随最后一个文本块内联闪烁 */}
                    <WaveStreamdown
                        text={turn.text + (turn.tools.some((t) => t.status == null) ? "" : " ▌")}
                        parseIncompleteMarkdown
                    />
                </div>
            ) : !turn.tools.some((t) => t.status == null) ? (
                // 首包前的等待指示（TTFT 期间给足活感）
                <div className="flex items-center gap-1 px-1 py-2">
                    {[0, 1, 2].map((i) => (
                        <span
                            key={i}
                            className="h-1.5 w-1.5 animate-bounce rounded-full bg-secondary"
                            style={{ animationDelay: `${i * 150}ms` }}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
}
