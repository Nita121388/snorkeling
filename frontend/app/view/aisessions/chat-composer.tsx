// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Chat composer — Paseo-style card: borderless auto-growing textarea inside a
// rounded floating card, bottom tool row (attach / model·thinking picker /
// round send), keybinding hints. Real pi slash commands (get_commands registry
// + GUI-mapped built-ins), image attachments, steering while streaming. Pure
// slash logic lives in chat-slash.ts (unit-tested).

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

type PanelMode = null | "commands" | "picker";

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
    const [pickerQuery, setPickerQuery] = useState("");
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
            setTimeout(() => {
                sendEventsRef.current = [];
            }, 600);
        },
    });

    const sendEventsRef = useRef<ChatEvent[]>(events);
    useEffect(() => {
        sendEventsRef.current = events;
    }, [events]);

    // Paseo-style auto-grow: height follows content up to ~190px.
    useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 190)}px`;
    }, [input]);

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

    const openPicker = useCallback(async () => {
        setPanelMode("picker");
        setPickerQuery("");
        const [modelsRes, levelsRes] = await Promise.all([
            runChatCommand(endpoint, { ...baseBody, command: { name: "get_available_models" } }),
            runChatCommand(endpoint, { ...baseBody, command: { name: "get_available_thinking_levels" } }),
        ]);
        setModelOptions(Array.isArray(modelsRes.data?.models) ? modelsRes.data.models : []);
        setThinkingLevels(Array.isArray(levelsRes.data?.levels) ? levelsRes.data.levels.map(String) : []);
    }, [endpoint, baseBody, runChatCommand]);

    // —— 面板数据：命令过滤 / 模型+思考深度合并选择器 ——
    const slashQuery = parseSlashQuery(input);
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
        if (effectiveMode === "picker") {
            // 模型搜索：按名称/id/provider 子串过滤；思考深度仅按级别名匹配
            const q = pickerQuery.trim().toLowerCase();
            const models = q
                ? modelOptions.filter((m) =>
                      `${m.name || ""} ${m.id || ""} ${m.provider || ""}`.toLowerCase().includes(q)
                  )
                : modelOptions;
            const levels = q ? thinkingLevels.filter((l) => l.toLowerCase().includes(q)) : thinkingLevels;
            return [
                ...models.map((item) => ({ kind: "model" as const, item })),
                ...levels.map((level) => ({ kind: "level" as const, level })),
            ];
        }
        return [];
    }, [effectiveMode, slashQuery, allCommands, modelOptions, thinkingLevels, pickerQuery]);

    const [cmdIndex, setCmdIndex] = useState(0);
    useEffect(() => {
        setCmdIndex(0);
    }, [panelMode, slashQuery, pickerQuery, modelOptions.length, thinkingLevels.length]);
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
            if (name === "model" || name === "think") {
                void openPicker();
            } else if (name === "compact") {
                void runControl("compact", undefined, "已请求压缩上下文");
            }
        },
        [openPicker, runControl]
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
                    void runControl(
                        "set_model",
                        { provider: item.provider, modelId: item.id },
                        `模型已切换: ${item.name || item.id}`
                    );
                } else {
                    flashNotice("✗ 该模型缺少 provider/id");
                }
                setPanelMode(null);
                inputRef.current?.focus();
                return;
            }
            void runControl("set_thinking_level", { level: row.level }, `思考深度: ${row.level}`);
            setPanelMode(null);
            inputRef.current?.focus();
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
        [effectiveMode, panelRows, cmdIndex, moveIndex, applyCommandRow, handleSubmit]
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

    const toolEndEvents = events.filter((evt) => evt.type === "tool_call_end" && evt.toolName);
    const toolStartEvents = events.filter((evt) => evt.type === "tool_call_start" && evt.toolName);
    const runningToolNames = toolStartEvents
        .filter((start) => !toolEndEvents.some((end) => end.toolName === start.toolName))
        .map((e) => e.toolName);

    const hasStream = assistantText.length > 0 || toolEndEvents.length > 0 || runningToolNames.length > 0;
    const currentModelLabel = agentState?.model ? agentState.model.name || agentState.model.id : "";
    const currentThinking =
        agentState?.thinkingLevel && agentState.thinkingLevel !== "off" ? agentState.thinkingLevel : "";
    const panelOpen = effectiveMode != null && panelRows.length > 0;

    const modelChipLabel = currentModelLabel ? `${source} · ${currentModelLabel}` : `${source} · 选择模型`;

    // 搜索框内键盘导航：与 textarea 面板导航同一套行选中逻辑
    const handlePickerSearchKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                moveIndex(1);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                moveIndex(-1);
            } else if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                applyCommandRow(panelRows[cmdIndex]);
            } else if (e.key === "Escape") {
                e.preventDefault();
                setPanelMode(null);
                setPickerQuery("");
                inputRef.current?.focus();
            }
        },
        [moveIndex, applyCommandRow, panelRows, cmdIndex]
    );

    return (
        <div className="shrink-0 bg-panel">
            <div className="mx-auto w-full max-w-3xl px-6 pb-2.5 pt-1">
                {/* Streaming bubble — only shown when there's active content. */}
                {hasStream ? (
                    <div
                        ref={bubbleRef}
                        className="mb-1.5 max-h-[180px] overflow-y-auto rounded-xl border border-border/60 bg-bg/40 px-3 py-2 text-xs text-primary/90"
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
                {notice ? (
                    <div className="pb-1 pt-0.5 text-[11px] text-secondary" role="status">
                        {notice}
                    </div>
                ) : null}
                <div className="relative">
                    {panelOpen ? (
                        <div className="absolute bottom-full left-0 z-40 mb-2 flex max-h-80 w-[22rem] flex-col overflow-hidden rounded-xl border border-border bg-modalbg py-1 shadow-2xl">
                            {effectiveMode === "commands" && slashQuery != null ? (
                                <div className="shrink-0 border-b border-border/50 px-3 py-1 text-[10px] uppercase tracking-wide text-secondary">
                                    Commands · Tab/Enter 补全 · Esc 关闭
                                </div>
                            ) : null}
                            {effectiveMode === "picker" ? (
                                <div className="shrink-0 border-b border-border/50 p-1.5">
                                    <input
                                        autoFocus
                                        type="text"
                                        value={pickerQuery}
                                        onChange={(e) => setPickerQuery(e.target.value)}
                                        onKeyDown={handlePickerSearchKeyDown}
                                        placeholder="搜索模型…"
                                        className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-primary outline-none placeholder:text-secondary/70 focus:border-secondary/50"
                                        aria-label="Search models"
                                    />
                                </div>
                            ) : null}
                            <div className="min-h-0 flex-1 overflow-y-auto">
                            {panelRows.map((row, idx) => {
                                const prev = idx > 0 ? panelRows[idx - 1] : null;
                                const showSection =
                                    effectiveMode === "picker" && row.kind !== "command" && prev?.kind !== row.kind;
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
                                        <div key={`model-${row.item.provider}-${row.item.id}`}>
                                            {showSection ? (
                                                <div className="border-b border-border/50 px-3 pb-1 pt-1.5 text-[10px] uppercase tracking-wide text-secondary">
                                                    模型
                                                </div>
                                            ) : null}
                                            <button
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
                                                <span className="shrink-0 text-[9px] opacity-70">
                                                    {row.item.provider}
                                                </span>
                                            </button>
                                        </div>
                                    );
                                }
                                return (
                                    <div key={`level-${row.level}`}>
                                        {showSection ? (
                                            <div className="border-b border-border/50 px-3 pb-1 pt-1.5 text-[10px] uppercase tracking-wide text-secondary">
                                                思考深度
                                            </div>
                                        ) : null}
                                        <button
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
                                            <i className="fa-sharp fa-solid fa-brain shrink-0 text-[10px] text-accent" />
                                            <span className="flex-1">{row.level}</span>
                                            {currentThinking === row.level ? (
                                                <span className="text-[9px] text-accent">当前</span>
                                            ) : null}
                                        </button>
                                    </div>
                                );
                            })}
                            {panelRows.length === 0 ? (
                                <div className="px-3 py-3 text-center text-xs text-secondary">
                                    {effectiveMode === "picker" && pickerQuery.trim()
                                        ? `无匹配「${pickerQuery.trim()}」`
                                        : "暂无可选项"}
                                </div>
                            ) : null}
                            </div>
                        </div>
                    ) : null}
                    {/* Paseo 卡片：圆角浮起容器，无边框输入区在卡内 */}
                    <div
                        className={cn(
                            "rounded-[18px] border bg-surface p-1.5 shadow-lg transition-colors",
                            panelOpen || input ? "border-secondary/50" : "border-border focus-within:border-secondary/50"
                        )}
                        onClick={(e) => {
                            // 点击卡片空白处聚焦输入框（按钮点击不触发）
                            if (e.target === e.currentTarget) inputRef.current?.focus();
                        }}
                    >
                        {/* Attachment preview chips — 卡内顶部 */}
                        {images.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5 px-1.5 pb-1 pt-1">
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
                        <textarea
                            ref={inputRef}
                            className="block max-h-[190px] w-full resize-none border-none bg-transparent px-2.5 pb-1 pt-2 text-sm leading-relaxed text-primary outline-none placeholder:text-secondary/70"
                            placeholder={
                                isRunning ? "Agent 运行中… Enter 插话排队" : "给 Agent 输入任务…"
                            }
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            rows={1}
                        />
                        {/* 卡内底部工具行：➕ 附件 · 模型▾ · 发送 */}
                        <div className="flex items-center gap-1 px-0.5 pb-0.5 pt-1">
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
                            <button
                                type="button"
                                className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-secondary hover:bg-hover hover:text-primary"
                                title="附加图片"
                                aria-label="Attach images"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <i className="fa-sharp fa-solid fa-plus text-[13px]" />
                            </button>
                            <button
                                type="button"
                                className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs text-secondary hover:bg-hover hover:text-primary"
                                title="切换模型与思考深度"
                                onClick={() => {
                                    if (effectiveMode === "picker") {
                                        setPanelMode(null);
                                    } else {
                                        void openPicker();
                                    }
                                }}
                            >
                                <span className="max-w-52 truncate">{modelChipLabel}</span>
                                <i
                                    className={cn(
                                        "fa-sharp fa-solid fa-chevron-down text-[9px] transition-transform",
                                        effectiveMode === "picker" && "rotate-180"
                                    )}
                                />
                            </button>
                            {isRunning ? (
                                <button
                                    type="button"
                                    className="ml-auto flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-error text-white hover:bg-error/85"
                                    title="停止 (Esc 中止流式气泡后可再点)"
                                    aria-label="Stop"
                                    onClick={abort}
                                >
                                    <i className="fa-sharp fa-solid fa-square text-[10px]" />
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className={cn(
                                        "ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all",
                                        canSubmit
                                            ? "cursor-pointer bg-accent text-primary-contrast hover:brightness-110"
                                            : "cursor-default bg-surface-strong text-secondary"
                                    )}
                                    title="发送 (Enter)"
                                    aria-label="Send message"
                                    disabled={!canSubmit}
                                    onClick={handleSubmit}
                                >
                                    <i className="fa-sharp fa-solid fa-arrow-up text-[13px]" />
                                </button>
                            )}
                        </div>
                    </div>
                    {/* 键位提示行 */}
                    <div className="flex gap-4 px-2 pb-0.5 pt-1.5 text-[10.5px] text-secondary/80">
                        <span>
                            <span className="rounded border border-border px-1 py-px font-mono text-[10px]">Enter</span> 发送
                        </span>
                        <span>
                            <span className="rounded border border-border px-1 py-px font-mono text-[10px]">Shift</span>+
                            <span className="rounded border border-border px-1 py-px font-mono text-[10px]">Enter</span> 换行
                        </span>
                        <span>
                            <span className="rounded border border-border px-1 py-px font-mono text-[10px]">/</span> 命令
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}

export const ChatComposer = memo(ChatComposerInner);
