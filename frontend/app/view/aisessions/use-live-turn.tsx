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

import { useCallback, useState } from "react";
import { cn } from "@/util/util";
import type { ChatEvent } from "./use-chat-stream";

export type LiveToolRun = { name: string; status?: string; detail?: string };

export type LiveTurn = {
    userText: string;
    text: string;
    thinking: boolean;
    tools: LiveToolRun[];
};

const emptyTurn = (): LiveTurn => ({ userText: "", text: "", thinking: false, tools: [] });

/**
 * Returns the current live turn (null when idle) and an event handler that
 * feeds it. onTurnFinal fires on turn_end/turn_failed BEFORE the live turn is
 * cleared by clearLiveTurn() — wire it to requestDetailDelta so canonical
 * data replaces the temporary block without flicker:
 *
 *   const { liveTurn, handleChatEvent } = useLiveTurn({
 *       onTurnFinal: () => void requestDetailDelta("bottom").finally(clearLiveTurn),
 *   });
 */
export function useLiveTurn(opts?: { onTurnFinal?: () => void }) {
    const [liveTurn, setLiveTurn] = useState<LiveTurn | null>(null);

    // Turn end keeps the bubble until refresh lands; caller invokes
    // clearLiveTurn in the refresh's finally().
    const clearLiveTurn = useCallback(() => setLiveTurn(null), []);

    const handleChatEvent = useCallback(
        (evt: ChatEvent) => {
            if (evt.type === "turn_end" || evt.type === "turn_failed") {
                opts?.onTurnFinal?.();
                return;
            }
            setLiveTurn((prev) => {
                const base = prev ?? emptyTurn();
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
                        return prev ?? base;
                }
            });
        },
        [opts?.onTurnFinal]
    );

    return { liveTurn, handleChatEvent, clearLiveTurn };
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
                <div className="whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm border border-border/60 bg-surface px-3 py-2 text-sm leading-relaxed">
                    {turn.text}
                    <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-accent align-middle" />
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
