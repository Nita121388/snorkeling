// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Chat streaming client for /api/aisessions-chat (SSE, one POST per turn).
//
// runChatStream is a pure async function (no React) so the SSE parsing logic
// is unit-testable; useChatStream is a thin React wrapper that maps events to
// state and exposes abort().

import { useCallback, useEffect, useRef, useState } from "react";

/** A single SSE data frame the backend emits. */
export type ChatEvent = {
    type: string;
    text?: string;
    role?: string;
    toolName?: string;
    toolCallId?: string;
    toolStatus?: string;
    detail?: string;
    error?: string;
    notice?: string;
    usage?: { it?: number; ot?: number; cost?: number };
    turnId?: string;
    state?: any; // session_state shape
    // command_result frames
    command?: string;
    data?: any;
};

/** One inline image attachment (base64). */
export type ChatImage = { data: string; mimeType: string };

export type ChatStreamStatus = "idle" | "sending" | "streaming" | "error";

type ChatStreamCallbacks = {
    onEvent?: (evt: ChatEvent) => void;
    onDone?: () => void;
};

export type ChatCommandResult = {
    ok: boolean;
    error?: string;
    data?: any;
    state?: any; // follow-up session_state snapshot if emitted
};

/**
 * Run one allowlisted agent control call (get_commands/set_model/compact…)
 * against the chat endpoint and collect the short-lived SSE result frames.
 */
export async function runChatCommand(
    endpoint: string,
    body: ChatRequestBody & { command: { name: string; args?: Record<string, unknown> } }
): Promise<ChatCommandResult> {
    const result: ChatCommandResult = { ok: false };
    const ac = new AbortController();
    await runChatStream(
        endpoint,
        body,
        {
            onEvent: (evt) => {
                if (evt.type === "command_result") {
                    result.ok = evt.error == null;
                    result.error = evt.error;
                    result.data = evt.data;
                } else if (evt.type === "session_state") {
                    result.state = evt.state;
                } else if (evt.type === "error") {
                    result.ok = false;
                    result.error = evt.error ?? "unknown error";
                }
            },
        },
        ac.signal
    );
    return result;
}

/**
 * POST one chat turn and parse the SSE response stream, invoking onEvent for
 * every data frame. Resolves when the stream ends; rejects on abort or fetch
 * errors (AbortError is surfaced for the caller's abort handling).
 */
export type ChatRequestBody = {
    source: string;
    sessionId?: string;
    projectPath?: string;
    provider?: string;
    model?: string;
    sessionDir?: string;
    message?: string;
    images?: ChatImage[];
    streamingBehavior?: "steer" | "followUp";
    command?: { name: string; args?: Record<string, unknown> };
};

export async function runChatStream(
    endpoint: string,
    body: ChatRequestBody,
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
        const event = JSON.parse(line.slice(6)) as ChatEvent & { errorText?: string };
        if (event.type === "error") {
            return { type: "turn_failed", error: event.errorText ?? event.error ?? "Chat request failed" };
        }
        return event;
    } catch {
        return null;
    }
}

type UseChatStreamOptions = {
    endpoint: string;
    onEvent?: (evt: ChatEvent) => void;
};

export function useChatStream({ endpoint, onEvent }: UseChatStreamOptions) {
    const [status, setStatus] = useState<ChatStreamStatus>("idle");
    const abortRef = useRef<AbortController | null>(null);

    const abort = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        setStatus("idle");
    }, []);

    const send = useCallback(
        (body: ChatRequestBody) => {
            const steering = body.streamingBehavior != null;
            if (!steering) {
                abort(); // kill any in-flight turn
            }
            const ac = new AbortController();
            abortRef.current = ac;
            setStatus(steering ? "streaming" : "sending");

            runChatStream(
                endpoint,
                body,
                {
                    onEvent: (evt) => {
                        onEvent?.(evt);
                    },
                    onDone: () => setStatus("idle"),
                },
                ac.signal
            )
                .catch((err: Error) => {
                    if (err.name === "AbortError") {
                        setStatus("idle");
                    } else {
                        setStatus("error");
                        onEvent?.({ type: "turn_failed", error: err.message });
                        console.error("chat stream error", err);
                    }
                })
                .finally(() => {
                    abortRef.current = null;
                });
        },
        [endpoint, onEvent, abort]
    );

    /**
     * Queue a steering message on the running turn without disturbing the
     * active event stream. ponytail: the second SSE connection is drained
     * silently — events between steer acceptance and the final turn end are
     * not rendered live; the post-turn DetailDelta refresh reconciles.
     * Upgrade path: multiplex both connections through one event reducer.
     */
    const steer = useCallback(
        (body: ChatRequestBody) => {
            void runChatStream(
                endpoint,
                { ...body, streamingBehavior: "steer" },
                {},
                new AbortController().signal
            ).catch((err: Error) => console.error("chat steer error", err));
        },
        [endpoint]
    );

    return { status, send, steer, abort } as const;
}

export function useChatStreams() {
    const [statuses, setStatuses] = useState<Record<string, ChatStreamStatus>>({});
    const controllersRef = useRef(new Map<string, AbortController>());
    const aliasesRef = useRef(new Map<string, string>());

    const resolveKey = useCallback((key: string) => aliasesRef.current.get(key) ?? key, []);

    const setStatus = useCallback((key: string, status: ChatStreamStatus) => {
        setStatuses((current) => {
            if (status !== "idle") return { ...current, [key]: status };
            if (current[key] == null) return current;
            const next = { ...current };
            delete next[key];
            return next;
        });
    }, []);

    const abort = useCallback(
        (key: string) => {
            const resolvedKey = resolveKey(key);
            controllersRef.current.get(resolvedKey)?.abort();
            controllersRef.current.delete(resolvedKey);
            setStatus(resolvedKey, "idle");
        },
        [resolveKey, setStatus]
    );

    const move = useCallback(
        (fromKey: string, toKey: string) => {
            if (fromKey === "" || toKey === "" || fromKey === toKey) return;
            const resolvedFrom = resolveKey(fromKey);
            aliasesRef.current.set(fromKey, toKey);
            const controller = controllersRef.current.get(resolvedFrom);
            if (controller != null) {
                controllersRef.current.set(toKey, controller);
                controllersRef.current.delete(resolvedFrom);
            }
            setStatuses((current) => {
                const status = current[resolvedFrom];
                if (status == null) return current;
                const next = { ...current, [toKey]: status };
                delete next[resolvedFrom];
                return next;
            });
        },
        [resolveKey]
    );

    const send = useCallback(
        (key: string, endpoint: string, body: ChatRequestBody, onEvent?: (evt: ChatEvent, key: string) => void) => {
            const resolvedKey = resolveKey(key);
            abort(resolvedKey);
            const controller = new AbortController();
            let terminalEvent: "turn_end" | "turn_failed" | null = null;
            controllersRef.current.set(resolvedKey, controller);
            setStatus(resolvedKey, "sending");
            void runChatStream(
                endpoint,
                body,
                {
                    onEvent: (evt) => {
                        if (evt.type === "turn_end" || evt.type === "turn_failed") {
                            terminalEvent = evt.type;
                        }
                        onEvent?.(evt, resolveKey(key));
                    },
                    onDone: () => {
                        const finalKey = resolveKey(key);
                        if (controllersRef.current.get(finalKey) === controller) {
                            if (terminalEvent == null) {
                                terminalEvent = "turn_failed";
                                onEvent?.(
                                    { type: "turn_failed", error: "Chat stream ended before the turn completed" },
                                    finalKey
                                );
                            }
                            setStatus(finalKey, terminalEvent === "turn_failed" ? "error" : "idle");
                        }
                    },
                },
                controller.signal
            )
                .catch((err: Error) => {
                    if (err.name === "AbortError") return;
                    const finalKey = resolveKey(key);
                    if (controllersRef.current.get(finalKey) !== controller) return;
                    setStatus(finalKey, "error");
                    onEvent?.({ type: "turn_failed", error: err.message }, finalKey);
                    console.error("chat stream error", err);
                })
                .finally(() => {
                    const finalKey = resolveKey(key);
                    if (controllersRef.current.get(finalKey) === controller) {
                        controllersRef.current.delete(finalKey);
                    }
                    aliasesRef.current.delete(key);
                });
        },
        [abort, resolveKey, setStatus]
    );

    const steer = useCallback((endpoint: string, body: ChatRequestBody) => {
        void runChatStream(endpoint, { ...body, streamingBehavior: "steer" }, {}, new AbortController().signal).catch(
            (err: Error) => console.error("chat steer error", err)
        );
    }, []);

    useEffect(() => {
        return () => {
            for (const controller of controllersRef.current.values()) controller.abort();
        };
    }, []);

    return { statuses, send, steer, abort, move } as const;
}
