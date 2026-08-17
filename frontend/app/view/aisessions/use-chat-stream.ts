// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// useChatStream manages one POST/SSE turn to /api/aisessions-chat. The returned
// turnId/eventChannel are stable for the duration of one turn; the caller can
// mount a streaming bubble that re-renders as deltas arrive.
//
// Design mirrors WaveAI's PostMessageHandler + AI SDK's useChat transport: one
// POST per turn, the response is an SSE stream; AbortController cancellation
// stops both the fetch and the running turn on the server.

import { useCallback, useRef, useState } from "react";

/** A single line the backend emits as an SSE data frame. */
export type ChatEvent = {
    type: string;
    text?: string;
    role?: string;
    toolName?: string;
    toolStatus?: string;
    detail?: string;
    error?: string;
    notice?: string;
    usage?: { it?: number; ot?: number; cost?: number };
    turnId?: string;
    state?: any; // session_state shape (ignored by renderer, consumed by header)
};

export type ChatStreamStatus = "idle" | "sending" | "streaming" | "error";

type UseChatStreamOptions = {
    /** Absolute or relative URL of the streaming endpoint. */
    endpoint: string;
    /** Called for every event in the turn. */
    onEvent?: (evt: ChatEvent) => void;
    /** Called once when a turn ends (TurnEnd or TurnFailed). */
    onTurnEnd?: (evt: ChatEvent) => void;
};

export function useChatStream({ endpoint, onEvent, onTurnEnd }: UseChatStreamOptions) {
    const [status, setStatus] = useState<ChatStreamStatus>("idle");
    const abortRef = useRef<AbortController | null>(null);

    const abort = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        setStatus("idle");
    }, []);

    const send = useCallback(
        (body: { source: string; sessionId?: string; projectPath?: string; provider?: string; model?: string; sessionDir?: string; message: string }) => {
            abort(); // kill any in-flight turn
            const ac = new AbortController();
            abortRef.current = ac;
            setStatus("sending");

            (async () => {
                try {
                    const resp = await fetch(endpoint, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body),
                        signal: ac.signal,
                    });
                    if (!resp.ok) {
                        throw new Error(`chat stream ${resp.status}: ${resp.statusText}`);
                    }
                    setStatus("streaming");

                    // Parse SSE data lines.
                    const reader = resp.body!.getReader();
                    const decoder = new TextDecoder();
                    let buffer = "";
                    let lineBuf = "";

                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        lineBuf += decoder.decode(value, { stream: true });

                        // Split on LF only (pi RPC spec: U+2028/2029 are valid in JSON strings).
                        const parts = lineBuf.split("\n");
                        lineBuf = parts.pop() ?? "";

                        for (const rawLine of parts) {
                            const line = rawLine.trim();
                            if (line === "" || line.startsWith(":")) continue; // blank or comment
                            if (!line.startsWith("data: ")) continue;
                            const jsonStr = line.slice(6);
                            try {
                                const evt: ChatEvent = JSON.parse(jsonStr);
                                onEvent?.(evt);
                                if (evt.type === "turn_end" || evt.type === "turn_failed") {
                                    onTurnEnd?.(evt);
                                }
                            } catch {
                                // tolerate malformed frames
                            }
                        }
                    }

                    // Flush remaining buffer
                    if (lineBuf.trim()) {
                        const remaining = lineBuf.trim();
                        if (remaining.startsWith("data: ")) {
                            try {
                                const evt: ChatEvent = JSON.parse(remaining.slice(6));
                                onEvent?.(evt);
                                onTurnEnd?.(evt);
                            } catch { /* ignore */ }
                        }
                    }

                    setStatus("idle");
                } catch (err: any) {
                    if (err.name === "AbortError") {
                        setStatus("idle");
                    } else {
                        setStatus("error");
                        console.error("chat stream error", err);
                    }
                } finally {
                    abortRef.current = null;
                }
            })();
        },
        [endpoint, onEvent, onTurnEnd, abort]
    );

    return { status, send, abort } as const;
}
