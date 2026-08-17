// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Chat streaming client for /api/aisessions-chat (SSE, one POST per turn).
//
// runChatStream is a pure async function (no React) so the SSE parsing logic
// is unit-testable; useChatStream is a thin React wrapper that maps events to
// state and exposes abort().

import { useCallback, useRef, useState } from "react";

/** A single SSE data frame the backend emits. */
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
    state?: any; // session_state shape
};

export type ChatStreamStatus = "idle" | "sending" | "streaming" | "error";

type ChatStreamCallbacks = {
    onEvent?: (evt: ChatEvent) => void;
    onDone?: () => void;
};

/**
 * POST one chat turn and parse the SSE response stream, invoking onEvent for
 * every data frame. Resolves when the stream ends; rejects on abort or fetch
 * errors (AbortError is surfaced for the caller's abort handling).
 */
export async function runChatStream(
    endpoint: string,
    body: { source: string; sessionId?: string; projectPath?: string; provider?: string; model?: string; sessionDir?: string; message: string },
    callbacks: ChatStreamCallbacks,
    signal: AbortSignal
): Promise<void> {
    const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
    });
    if (!resp.ok) {
        throw new Error(`chat stream ${resp.status}: ${resp.statusText}`);
    }
    if (!resp.body) {
        throw new Error("chat stream: empty response body");
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let lineBuf = "";

    const handleFrame = (evt: ChatEvent) => callbacks.onEvent?.(evt);

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        lineBuf += decoder.decode(value, { stream: true });

        // Split on LF only (pi RPC spec: U+2028/2029 are valid inside JSON strings).
        const parts = lineBuf.split("\n");
        lineBuf = parts.pop() ?? "";

        for (const rawLine of parts) {
            const evt = parseSseDataLine(rawLine);
            if (evt) handleFrame(evt);
        }
    }
    // Flush any trailing line without a final newline.
    const last = parseSseDataLine(lineBuf);
    if (last) handleFrame(last);

    callbacks.onDone?.();
}

/**
 * Parse a single SSE line into a ChatEvent, or null if it is not a data frame
 * (blank, comment, non-data). Malformed JSON frames are tolerated (null).
 */
export function parseSseDataLine(rawLine: string): ChatEvent | null {
    const line = rawLine.trim();
    if (line === "" || line.startsWith(":")) return null;
    if (!line.startsWith("data: ")) return null;
    try {
        return JSON.parse(line.slice(6)) as ChatEvent;
    } catch {
        return null;
    }
}

type UseChatStreamOptions = {
    endpoint: string;
    onEvent?: (evt: ChatEvent) => void;
    onTurnEnd?: (evt: ChatEvent) => void;
};

type ChatSendBody = {
    source: string;
    sessionId?: string;
    projectPath?: string;
    provider?: string;
    model?: string;
    sessionDir?: string;
    message: string;
};

export function useChatStream({ endpoint, onEvent, onTurnEnd }: UseChatStreamOptions) {
    const [status, setStatus] = useState<ChatStreamStatus>("idle");
    const [events, setEvents] = useState<ChatEvent[]>([]);
    const abortRef = useRef<AbortController | null>(null);

    const abort = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        setStatus("idle");
        setEvents([]);
    }, []);

    const send = useCallback(
        (body: ChatSendBody) => {
            abort(); // kill any in-flight turn
            const ac = new AbortController();
            abortRef.current = ac;
            setStatus("sending");
            setEvents([]);

            runChatStream(
                endpoint,
                body,
                {
                    onEvent: (evt) => {
                        setEvents((prev) => [...prev, evt]);
                        onEvent?.(evt);
                        if (evt.type === "turn_end" || evt.type === "turn_failed") {
                            onTurnEnd?.(evt);
                        }
                    },
                    onDone: () => setStatus("idle"),
                },
                ac.signal
            )
                .catch((err: Error) => {
                    if (err.name === "AbortError") {
                        setStatus("idle");
                        setEvents([]);
                    } else {
                        setStatus("error");
                        setEvents([]);
                        console.error("chat stream error", err);
                    }
                })
                .finally(() => {
                    abortRef.current = null;
                });
        },
        [endpoint, onEvent, onTurnEnd, abort]
    );

    return { status, events, send, abort } as const;
}