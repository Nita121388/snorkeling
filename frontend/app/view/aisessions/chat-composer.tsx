// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { memo, useCallback, useRef, useState } from "react";
import { cn } from "@/util/util";
import { getWebServerEndpoint } from "@/util/endpoints";
import { useChatStream, type ChatEvent, type ChatStreamStatus } from "./use-chat-stream";

type ChatComposerProps = {
    /** Session summary fields needed to start a chat turn. */
    source: string;
    sessionId: string;
    projectPath?: string;
    provider?: string;
    model?: string;
    /** Called for every streaming event (turn_end triggers a DetailDelta refresh). */
    onEvent?: (evt: ChatEvent) => void;
};

function ChatComposerInner({ source, sessionId, projectPath, provider, model, onEvent }: ChatComposerProps) {
    const [input, setInput] = useState("");
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const endpoint = `${getWebServerEndpoint()}/api/aisessions-chat`;

    const { status, send, abort } = useChatStream({
        endpoint,
        onEvent,
        onTurnEnd: (evt) => {
            // After the turn ends the server has written to the JSONL; the
            // frontend's DetailDelta will pick up new messages.
            onEvent?.(evt);
        },
    });

    const canSubmit = input.trim().length > 0 && (status === "idle" || status === "error");
    const isRunning = status === "sending" || status === "streaming";

    const handleSubmit = useCallback(() => {
        if (!canSubmit) return;
        const text = input.trim();
        setInput("");
        send({
            source,
            sessionId,
            projectPath: projectPath ?? undefined,
            provider: provider ?? undefined,
            model: model ?? undefined,
            message: text,
        });
        inputRef.current?.focus();
    }, [canSubmit, input, send, source, sessionId, projectPath, provider, model]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (isRunning) return;
                handleSubmit();
            }
        },
        [handleSubmit, isRunning]
    );

    return (
        <div className="flex shrink-0 items-end gap-2 border-t border-border bg-panel px-3 py-2">
            <textarea
                ref={inputRef}
                className="min-h-[36px] max-h-[120px] flex-1 resize-none rounded border border-border bg-bg px-3 py-2 text-xs text-primary outline-none focus:border-accent"
                placeholder={isRunning ? "Agent is thinking..." : "Send a message..."}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isRunning}
                rows={1}
            />
            {isRunning ? (
                <button
                    type="button"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-error/10 text-error hover:bg-error/20"
                    title="Stop"
                    aria-label="Stop"
                    onClick={abort}
                >
                    <i className="fa-sharp fa-solid fa-stop text-[11px]" />
                </button>
            ) : (
                <button
                    type="button"
                    className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded",
                        canSubmit
                            ? "bg-accent text-primary-contrast hover:bg-accent/80"
                            : "bg-border/40 text-secondary"
                    )}
                    title="Send"
                    aria-label="Send"
                    disabled={!canSubmit}
                    onClick={handleSubmit}
                >
                    <i className="fa-sharp fa-solid fa-paper-plane text-[11px]" />
                </button>
            )}
        </div>
    );
}

export const ChatComposer = memo(ChatComposerInner);
