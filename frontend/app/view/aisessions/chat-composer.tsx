// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/util/util";
import { getWebServerEndpoint } from "@/util/endpoints";
import { useChatStream, type ChatEvent, type ChatStreamStatus } from "./use-chat-stream";

/** 斜杠命令注册表：可扩展；insert 为发送文本，pi 自行解释 */
export type SlashCommand = {
    name: string;
    description: string;
};
const SLASH_COMMANDS: SlashCommand[] = [
    { name: "think", description: "切换深度思考级别" },
    { name: "model", description: "切换模型" },
    { name: "tools", description: "查看/开关工具" },
    { name: "session", description: "会话信息与切换" },
    { name: "clear", description: "清空当前对话上下文" },
    { name: "help", description: "显示可用命令" },
];

type ChatComposerProps = {
    source: string;
    sessionId: string;
    projectPath?: string;
    provider?: string;
    model?: string;
    onEvent?: (evt: ChatEvent) => void;
};

function ChatComposerInner({ source, sessionId, projectPath, provider, model, onEvent }: ChatComposerProps) {
    const [input, setInput] = useState("");
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const bubbleRef = useRef<HTMLDivElement>(null);
    const endpoint = `${getWebServerEndpoint()}/api/aisessions-chat`;

    const { status, events, send, abort } = useChatStream({
        endpoint,
        onEvent,
        onTurnEnd: (evt) => {
            onEvent?.(evt);
            // After a short delay clear the streaming bubble so the detail
            // refresh (DetailDelta) takes over with the canonical messages.
            setTimeout(() => {
                sendEventsRef.current = [];
            }, 600);
        },
    });

    // Keep a ref to the live events array so the turnEnd timeout always reads
    // the latest state without re-mounting the callback.
    const sendEventsRef = useRef<ChatEvent[]>(events);
    useEffect(() => {
        sendEventsRef.current = events;
    }, [events]);

    const canSubmit = input.trim().length > 0 && (status === "idle" || status === "error");
    const isRunning = status === "sending" || status === "streaming";

    // —— 斜杠命令面板：输入 “/xxx” 且未出现空格时弹出 ——
    const slashQuery = input.startsWith("/") && !input.includes(" ") ? input.slice(1) : null;
    const cmdMatches = useMemo(
        () =>
            slashQuery == null
                ? []
                : SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(slashQuery.toLowerCase())),
        [slashQuery]
    );
    const cmdOpen = cmdMatches.length > 0;
    const [cmdIndex, setCmdIndex] = useState(0);
    useEffect(() => {
        setCmdIndex(0);
    }, [slashQuery]);
    const applyCommand = useCallback(
        (cmd: SlashCommand) => {
            setInput(`/${cmd.name} `);
            inputRef.current?.focus();
        },
        []
    );

    const handleSubmit = useCallback(() => {
        if (!canSubmit) return;
        const text = input.trim();
        setInput("");
        send({
            source,
            sessionId: sessionId || undefined, // empty => backend spawns a new session
            projectPath: projectPath ?? undefined,
            provider: provider ?? undefined,
            model: model ?? undefined,
            message: text,
        });
        inputRef.current?.focus();
    }, [canSubmit, input, send, source, sessionId, projectPath, provider, model]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (cmdOpen) {
                if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setCmdIndex((current) => (current + 1) % cmdMatches.length);
                    return;
                }
                if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setCmdIndex((current) => (current - 1 + cmdMatches.length) % cmdMatches.length);
                    return;
                }
                if (e.key === "Tab" || e.key === "Enter") {
                    e.preventDefault();
                    applyCommand(cmdMatches[cmdIndex]);
                    return;
                }
                if (e.key === "Escape") {
                    e.preventDefault();
                    setInput("");
                    return;
                }
            }
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (isRunning) return;
                handleSubmit();
            }
        },
        [handleSubmit, isRunning, cmdOpen, cmdMatches, cmdIndex, applyCommand]
    );

    // Auto-scroll the streaming bubble as new text arrives.
    useEffect(() => {
        if (bubbleRef.current && isRunning) {
            bubbleRef.current.scrollTop = bubbleRef.current.scrollHeight;
        }
    }, [events.length, isRunning]);

    // Derive the accumulated assistant text from the events stream.
    const assistantText = events
        .filter((evt) => evt.type === "assistant_delta" && evt.text)
        .map((evt) => evt.text!)
        .join("");

    // Show tool calls that completed during this turn.
    const toolEndEvents = events.filter((evt) => evt.type === "tool_call_end" && evt.toolName);
    const toolStartEvents = events.filter((evt) => evt.type === "tool_call_start" && evt.toolName);
    // In-flight (started but not ended).
    const runningToolNames = toolStartEvents
        .filter((start) => !toolEndEvents.some((end) => end.toolName === start.toolName))
        .map((e) => e.toolName);

    const hasStream = assistantText.length > 0 || toolEndEvents.length > 0 || runningToolNames.length > 0;

    return (
        <div className="shrink-0 border-t border-border bg-panel">
            <div className="mx-auto w-full max-w-3xl">
            {/* Streaming bubble — only shown when there's active content. */}
            {hasStream && (
                <div
                    ref={bubbleRef}
                    className="max-h-[180px] overflow-y-auto border-b border-border/50 bg-bg/30 px-3 py-2 text-xs text-primary/90"
                >
                    {toolEndEvents.map((evt, idx) => (
                        <div key={`tc-${idx}`} className="mb-1 rounded bg-accent/5 px-2 py-1 text-[10px] text-secondary">
                            <span className="mr-1 font-medium text-accent">✓</span>
                            <span className="font-medium">{evt.toolName}</span>
                            {evt.detail ? (
                                <span className="ml-1 opacity-70">
                                    {evt.detail.length > 120 ? evt.detail.slice(0, 120) + "…" : evt.detail}
                                </span>
                            ) : null}
                        </div>
                    ))}
                    {runningToolNames.map((name) => (
                        <div key={`tc-run-${name}`} className="mb-1 rounded bg-accent/5 px-2 py-1 text-[10px] text-secondary">
                            <span className="mr-1 inline-block animate-spin">
                                <i className="fa-sharp fa-solid fa-spinner text-[8px]" />
                            </span>
                            <span className="font-medium">{name}</span>
                            <span className="ml-1 opacity-70">running…</span>
                        </div>
                    ))}
                    {assistantText ? (
                        <div className="whitespace-pre-wrap break-words leading-5">{assistantText}</div>
                    ) : null}
                </div>
            )}
            <div className="relative flex items-end gap-2 px-3 py-2">
                {cmdOpen ? (
                    <div className="absolute bottom-full left-3 z-40 mb-1 w-72 overflow-hidden rounded-xl border border-border bg-panel py-1 shadow-2xl">
                        {cmdMatches.map((cmd, idx) => (
                            <button
                                key={cmd.name}
                                type="button"
                                className={cn(
                                    "flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs",
                                    idx === cmdIndex ? "bg-accent/10 text-primary" : "text-secondary hover:bg-hover"
                                )}
                                onMouseEnter={() => setCmdIndex(idx)}
                                onClick={() => applyCommand(cmd)}
                            >
                                <span className="shrink-0 font-mono font-medium text-accent">/{cmd.name}</span>
                                <span className="min-w-0 truncate">{cmd.description}</span>
                            </button>
                        ))}
                    </div>
                ) : null}
                <textarea
                    ref={inputRef}
                    className="min-h-[38px] max-h-[140px] flex-1 resize-none rounded-xl border border-border bg-bg px-3 py-2 text-xs text-primary outline-none focus:border-accent"
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
            </div>
        </div>
    );
}

export const ChatComposer = memo(ChatComposerInner);
