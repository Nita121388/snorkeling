// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Chat composer: real pi slash commands (get_commands registry + GUI-mapped
// built-ins), image attachments, steering while streaming, model/thinking
// pickers. Pure slash logic lives in chat-slash.ts (unit-tested).

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/util/util";
import { getWebServerEndpoint } from "@/util/endpoints";
import {
    filterSlashItems,
    mergeSlashItems,
    parseSlashQuery,
    slashSourceLabel,
    type SlashItem,
} from "./chat-slash";
import { runChatCommand, useChatStream, type ChatEvent } from "./use-chat-stream";

type PendingImage = {
    id: string;
    name: string;
    dataUrl: string;
    base64: string;
    mimeType: string;
};

let pendingImageSeq = 0;

function fileToPendingImage(file: File): Promise<PendingImage> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = typeof reader.result === "string" ? reader.result : "";
            const commaIdx = dataUrl.indexOf(",");
            if (!dataUrl.startsWith("data:") || commaIdx < 0) {
                reject(new Error("unexpected file data"));
                return;
            }
            pendingImageSeq += 1;
            resolve({
                id: `img-${Date.now()}-${pendingImageSeq}`,
                name: file.name,
                dataUrl,
                base64: dataUrl.slice(commaIdx + 1),
                mimeType: file.type || "image/png",
            });
        };
        reader.onerror = () => reject(reader.error ?? new Error("read failed"));
        reader.readAsDataURL(file);
    });
}

type AgentStateInfo = {
    sessionId?: string;
    thinkingLevel?: string;
    model?: { provider?: string; id?: string; name?: string } | null;
};

type PanelMode = null | "commands" | "models" | "thinking";

type ModelOption = { provider?: string; id?: string; name?: string };

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
    const [images, setImages] = useState<PendingImage[]>([]);
    const [dynamicCommands, setDynamicCommands] = useState<SlashItem[]>([]);
    const [agentState, setAgentState] = useState<AgentStateInfo | null>(null);
    const [notice, setNotice] = useState("");
    const [panelMode, setPanelMode] = useState<PanelMode>(null);
    const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
    const [thinkingLevels, setThinkingLevels] = useState<string[]>([]);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const bubbleRef = useRef<HTMLDivElement>(null);
    const endpoint = `${getWebServerEndpoint()}/api/aisessions-chat`;

    const baseBody = useMemo(
        () => ({
            source,
            sessionId: sessionId || undefined, // empty => backend spawns a new session
            projectPath: projectPath ?? undefined,
            provider: provider ?? undefined,
            model: model ?? undefined,
        }),
        [source, sessionId, projectPath, provider, model]
    );

    const handleEvent = useCallback(
        (evt: ChatEvent) => {
            if (evt.type === "session_state" && evt.state) {
                setAgentState(evt.state as AgentStateInfo);
            }
            onEvent?.(evt);
        },
        [onEvent]
    );

    const { status, events, send, steer, abort } = useChatStream({
        endpoint,
        onEvent: handleEvent,
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

    const flashNotice = useCallback((text: string) => {
        setNotice(text);
        window.setTimeout(() => setNotice((current) => (current === text ? "" : current)), 2500);
    }, []);

    const runControl = useCallback(
        async (name: string, args?: Record<string, unknown>, okMsg?: string) => {
            const res = await runChatCommand(endpoint, { ...baseBody, command: { name, args } });
            if (!res.ok) {
                flashNotice(`✗ ${name}: ${res.error ?? "failed"}`);
                return false;
            }
            if (res.state) {
                setAgentState(res.state as AgentStateInfo);
            }
            if (okMsg) flashNotice(okMsg);
            return true;
        },
        [endpoint, baseBody, flashNotice]
    );

    // —— 真实斜杠命令：挂载后拉取 pi 的命令注册表（extension/prompt/skill）——
    useEffect(() => {
        let cancelled = false;
        void runChatCommand(endpoint, { ...baseBody, command: { name: "get_commands" } }).then((res) => {
            if (cancelled || !res.ok || !Array.isArray(res.data?.commands)) return;
            setDynamicCommands(
                res.data.commands
                    .filter((c: any) => typeof c?.name === "string")
                    .map((c: any) => ({
                        name: c.name as string,
                        description: c.description as string | undefined,
                        source: c.source as string | undefined,
                    }))
            );
        });
        return () => {
            cancelled = true;
        };
    }, [endpoint, baseBody]);

    const isRunning = status === "sending" || status === "streaming";
    const hasContent = input.trim().length > 0 || images.length > 0;
    // Streaming 状态下允许继续提交：走 steer 队列而不是杀掉在飞的 turn。
    const canSubmit = hasContent && (status === "idle" || status === "error" || isRunning);

    const openModelPicker = useCallback(async () => {
        setPanelMode("models");
        const res = await runChatCommand(endpoint, { ...baseBody, command: { name: "get_available_models" } });
        setModelOptions(Array.isArray(res.data?.models) ? res.data.models : []);
    }, [endpoint, baseBody, runChatCommand]);

    const openThinkingPicker = useCallback(async () => {
        setPanelMode("thinking");
        const res = await runChatCommand(endpoint, { ...baseBody, command: { name: "get_available_thinking_levels" } });
        setThinkingLevels(Array.isArray(res.data?.levels) ? res.data.levels.map(String) : []);
    }, [endpoint, baseBody, runChatCommand]);

    // —— 斜杠面板数据：按模式给出候选列表 ——
    const slashQuery = parseSlashQuery(input);
    // 输入 “/” 自动进入命令模式；选择内置项后切换到 models/thinking 子面板
    const effectiveMode: PanelMode = panelMode ?? (slashQuery != null ? "commands" : null);
    const allCommands = useMemo(() => mergeSlashItems(dynamicCommands), [dynamicCommands]);
    type PanelRow =
        | { kind: "command"; item: SlashItem }
        | { kind: "model"; item: ModelOption }
        | { kind: "level"; level: string };

    const panelRows: PanelRow[] = useMemo(() => {
        if (effectiveMode === "commands" && slashQuery != null) {
            return filterSlashItems(allCommands, slashQuery).map((item) => ({ kind: "command" as const, item }));
        }
        if (effectiveMode === "models") {
            return modelOptions.map((m) => ({ kind: "model" as const, item: m }));
        }
        if (effectiveMode === "thinking") {
            return thinkingLevels.map((level) => ({ kind: "level" as const, level }));
        }
        return [];
    }, [effectiveMode, slashQuery, allCommands, modelOptions, thinkingLevels]);

    const [cmdIndex, setCmdIndex] = useState(0);
    useEffect(() => {
        setCmdIndex(0);
    }, [panelMode, slashQuery, modelOptions.length, thinkingLevels.length]);
    const moveIndex = useCallback(
        (delta: number) => {
            const count = panelRows.length;
            if (count === 0) return;
            setCmdIndex((current) => (current + delta + count) % count);
        },
        [panelRows.length]
    );

    const applyBuiltin = useCallback(
        (name: string) => {
            setInput("");
            if (name === "model") {
                void openModelPicker();
            } else if (name === "think") {
                void openThinkingPicker();
            } else if (name === "compact") {
                void runControl("compact", undefined, "已请求压缩上下文");
            }
        },
        [openModelPicker, openThinkingPicker, runControl]
    );

    const applyCommandRow = useCallback(
        (row: PanelRow | undefined) => {
            if (row == null) return;
            if (row.kind === "command") {
                const { item } = row;
                if (item.source === "gui") {
                    applyBuiltin(item.name);
                    return;
                }
                setInput(`/${item.name} `); // pi expands skills/templates/extension commands on send
                if (effectiveMode === "commands") {
                    setPanelMode(null);
                }
                inputRef.current?.focus();
                return;
            }
            if (row.kind === "model") {
                const { item } = row;
                if (item.provider && item.id) {
                    void runControl("set_model", { provider: item.provider, modelId: item.id }, `模型已切换: ${item.name || item.id}`);
                } else {
                    flashNotice("✗ 该模型缺少 provider/id");
                }
                setPanelMode(null);
                return;
            }
            void runControl("set_thinking_level", { level: row.level }, `思考深度: ${row.level}`);
            setPanelMode(null);
        },
        [applyBuiltin, runControl, flashNotice, effectiveMode]
    );

    const handleSubmit = useCallback(() => {
        if (!canSubmit) return;
        const text = input.trim();
        // 斜杠内置命令兜底拦截（面板打开时 Enter 已被 keydown 处理）
        if (slashQuery != null && text === `/${slashQuery}`) {
            const match = allCommands.find((cmd) => cmd.name.toLowerCase() === slashQuery.toLowerCase());
            if (match?.source === "gui") {
                applyBuiltin(match.name);
                return;
            }
        }
        const body = {
            ...baseBody,
            message: text,
            images:
                images.length > 0 ? images.map((img) => ({ data: img.base64, mimeType: img.mimeType })) : undefined,
        };
        setInput("");
        setImages([]);
        if (isRunning) {
            steer(body);
        } else {
            send(body);
        }
        inputRef.current?.focus();
    }, [canSubmit, input, slashQuery, allCommands, applyBuiltin, baseBody, images, isRunning, steer, send]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (effectiveMode != null && panelRows.length > 0) {
                if (e.key === "ArrowDown") {
                    e.preventDefault();
                    moveIndex(1);
                    return;
                }
                if (e.key === "ArrowUp") {
                    e.preventDefault();
                    moveIndex(-1);
                    return;
                }
                if (e.key === "Tab" || e.key === "Enter") {
                    e.preventDefault();
                    applyCommandRow(panelRows[cmdIndex]);
                    return;
                }
                if (e.key === "Escape") {
                    e.preventDefault();
                    setPanelMode(null);
                    setInput("");
                    return;
                }
            }
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
            }
        },
        [panelMode, panelRows, cmdIndex, moveIndex, applyCommandRow, handleSubmit]
    );

    // Auto-scroll the streaming bubble as new text arrives.
    useEffect(() => {
        if (bubbleRef.current && isRunning) {
            bubbleRef.current.scrollTop = bubbleRef.current.scrollHeight;
        }
    }, [events.length, isRunning]);

    const pickFiles = useCallback(
        async (fileList: FileList | null) => {
            if (fileList == null) return;
            const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
            if (files.length === 0) return;
            try {
                const pending = await Promise.all(files.map(fileToPendingImage));
                // ponytail: cap at 8 images per turn; raise if a use case appears
                setImages((prev) => [...prev, ...pending].slice(0, 8));
            } catch {
                flashNotice("✗ 图片读取失败");
            }
        },
        [flashNotice]
    );

    const removeImage = useCallback((id: string) => {
        setImages((prev) => prev.filter((img) => img.id !== id));
    }, []);

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
    const currentModelLabel = agentState?.model ? agentState.model.name || agentState.model.id : "";
    const currentThinking =
        agentState?.thinkingLevel && agentState.thinkingLevel !== "off" ? agentState.thinkingLevel : "";
    const panelOpen = effectiveMode != null && panelRows.length > 0;

    return (
        <div className="shrink-0 border-t border-border bg-panel">
            <div className="mx-auto w-full max-w-3xl">
                {/* Streaming bubble — only shown when there's active content. */}
                {hasStream ? (
                    <div
                        ref={bubbleRef}
                        className="max-h-[180px] overflow-y-auto border-b border-border/50 bg-bg/30 px-3 py-2 text-xs text-primary/90"
                    >
                        {toolEndEvents.map((evt, idx) => (
                            <div key={`tc-${idx}`} className="mb-1 rounded bg-accent/5 px-2 py-1 text-[10px] text-secondary">
                                <span
                                    className={cn(
                                        "mr-1 font-medium",
                                        evt.toolStatus === "failed" ? "text-error" : "text-accent"
                                    )}
                                >
                                    {evt.toolStatus === "failed" ? "✗" : "✓"}
                                </span>
                                <span className="font-medium">{evt.toolName}</span>
                                {evt.detail ? (
                                    <span className="ml-1 opacity-70">
                                        {evt.detail.length > 120 ? evt.detail.slice(0, 120) + "…" : evt.detail}
                                    </span>
                                ) : null}
                            </div>
                        ))}
                        {runningToolNames.map((name) => (
                            <div
                                key={`tc-run-${name}`}
                                className="mb-1 rounded bg-accent/5 px-2 py-1 text-[10px] text-secondary"
                            >
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
                ) : null}
                {/* Attachment preview chips */}
                {images.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 px-3 pt-2">
                        {images.map((img) => (
                            <div
                                key={img.id}
                                className="group relative h-14 w-14 overflow-hidden rounded-lg border border-border"
                            >
                                <img src={img.dataUrl} alt={img.name} className="h-full w-full object-cover" />
                                <button
                                    type="button"
                                    aria-label={`Remove ${img.name}`}
                                    onClick={() => removeImage(img.id)}
                                    className="absolute right-0 top-0 hidden h-4 w-4 items-center justify-center rounded-bl bg-error/80 text-[8px] text-white group-hover:flex"
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                    </div>
                ) : null}
                {notice ? (
                    <div className="px-3 pt-2 text-[11px] text-secondary" role="status">
                        {notice}
                    </div>
                ) : null}
                <div className="relative flex items-end gap-2 px-3 py-2">
                    {panelOpen ? (
                        <div className="absolute bottom-full left-3 z-40 mb-1 max-h-72 w-80 overflow-y-auto rounded-xl border border-border bg-panel py-1 shadow-2xl">
                            {effectiveMode === "commands" && slashQuery != null ? (
                                <div className="border-b border-border/50 px-3 py-1 text-[10px] uppercase text-secondary">
                                    Commands · Tab/Enter 补全 · Esc 关闭
                                </div>
                            ) : null}
                            {panelRows.map((row, idx) => {
                                if (row.kind === "command") {
                                    const badge = slashSourceLabel(row.item.source);
                                    return (
                                        <button
                                            key={`cmd-${row.item.name}`}
                                            type="button"
                                            className={cn(
                                                "flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs",
                                                idx === cmdIndex
                                                    ? "bg-accent/10 text-primary"
                                                    : "text-secondary hover:bg-hover"
                                            )}
                                            onMouseEnter={() => setCmdIndex(idx)}
                                            onClick={() => applyCommandRow(row)}
                                        >
                                            <span className="shrink-0 font-mono font-medium text-accent">
                                                /{row.item.name}
                                            </span>
                                            <span className="min-w-0 flex-1 truncate">{row.item.description}</span>
                                            {badge ? (
                                                <span className="shrink-0 rounded border border-border px-1 text-[9px]">
                                                    {badge}
                                                </span>
                                            ) : null}
                                        </button>
                                    );
                                }
                                if (row.kind === "model") {
                                    return (
                                        <button
                                            key={`model-${row.item.provider}-${row.item.id}`}
                                            type="button"
                                            className={cn(
                                                "flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs",
                                                idx === cmdIndex
                                                    ? "bg-accent/10 text-primary"
                                                    : "text-secondary hover:bg-hover"
                                            )}
                                            onMouseEnter={() => setCmdIndex(idx)}
                                            onClick={() => applyCommandRow(row)}
                                        >
                                            <i className="fa-sharp fa-solid fa-microchip shrink-0 text-[10px] text-accent" />
                                            <span className="min-w-0 flex-1 truncate">
                                                {row.item.name || row.item.id}
                                            </span>
                                            <span className="shrink-0 text-[9px] opacity-70">{row.item.provider}</span>
                                        </button>
                                    );
                                }
                                return (
                                    <button
                                        key={`level-${row.level}`}
                                        type="button"
                                        className={cn(
                                            "flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs",
                                            idx === cmdIndex ? "bg-accent/10 text-primary" : "text-secondary hover:bg-hover"
                                        )}
                                        onMouseEnter={() => setCmdIndex(idx)}
                                        onClick={() => applyCommandRow(row)}
                                    >
                                        <i className="fa-sharp fa-solid fa-brain shrink-0 text-[10px] text-accent" />
                                        <span className="flex-1">{row.level}</span>
                                        {currentThinking === row.level ? (
                                            <span className="text-[9px] text-accent">当前</span>
                                        ) : null}
                                    </button>
                                );
                            })}
                        </div>
                    ) : null}
                    <button
                        type="button"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-secondary hover:bg-hover hover:text-primary"
                        title="Attach images"
                        aria-label="Attach images"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <i className="fa-sharp fa-solid fa-paperclip text-[12px]" />
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                            void pickFiles(e.target.files);
                            e.target.value = ""; // allow re-picking the same file
                        }}
                    />
                    <textarea
                        ref={inputRef}
                        className="min-h-[38px] max-h-[140px] flex-1 resize-none rounded-xl border border-border bg-bg px-3 py-2 text-xs text-primary outline-none focus:border-accent"
                        placeholder={
                            isRunning
                                ? "Agent is thinking… (Enter 发送会排队 steer)"
                                : "Send a message… (/ 唤起命令，📎 附图)"
                        }
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
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
                {!hasStream && (currentModelLabel || currentThinking) ? (
                    <div className="flex items-center justify-end gap-1.5 px-3 pb-1.5">
                        {currentModelLabel ? (
                            <span
                                className="max-w-48 truncate rounded border border-border px-1.5 py-0.5 text-[10px] text-secondary"
                                title={currentModelLabel}
                            >
                                {currentModelLabel}
                            </span>
                        ) : null}
                        {currentThinking ? (
                            <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-secondary">
                                think:{currentThinking}
                            </span>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

export const ChatComposer = memo(ChatComposerInner);
