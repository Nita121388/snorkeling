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

type PanelMode = null | "commands" | "agents" | "models" | "levels";

type ModelOption = { provider?: string; id?: string; name?: string };

// GUI 聊天可选的 agent 清单。后端 chatProviderForSource 目前只实现 pi；
// 其余项仅展示并禁用（升级路径：后端补 Provider 后去掉 available:false）。
const AGENT_CHOICES = [
    { id: "pi", label: "Pi", available: true },
    { id: "codex", label: "Codex", available: false },
    { id: "claude", label: "Claude Code", available: false },
] as const;

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
    // 可拖拽调整的输入框最大高度，持久化到 localStorage
    const [maxH, setMaxH] = useState(() => {
        const saved = window.localStorage.getItem("aisessions.composerMaxH");
        const n = saved ? Number(saved) : NaN;
        return Number.isFinite(n) && n >= 80 ? n : 190;
    });
    // 模型 / 思考级别的懒加载标记（避免每次开弹层都打 RPC）
    const [modelsLoaded, setModelsLoaded] = useState(false);
    const [levelsLoaded, setLevelsLoaded] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
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

    // Paseo-style auto-grow: height follows content up to the draggable max.
    // draggingRef：拖拽中跳过自动收缩，否则空内容会把刚拖高的框立刻压回单行（看起来像“拖不动”）。
    const draggingRef = useRef(false);
    useEffect(() => {
        const el = inputRef.current;
        if (!el || draggingRef.current) return;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, maxH)}px`;
    }, [input, maxH]);

    // 卡片顶边整条可拖拽调高：向上拖变高、向下拖变矮（ponytail: 原生 mouse 事件，无依赖）
    const startResize = useCallback(
        (down: React.MouseEvent) => {
            down.preventDefault();
            draggingRef.current = true;
            const startY = down.clientY;
            const startH = maxH;
            const panelBottom = inputRef.current?.getBoundingClientRect().bottom ?? down.clientY;
            const apply = (h: number) => {
                setMaxH(h);
                // 立即把可见高度设为拖拽值，空内容也能看到框变高
                const el = inputRef.current;
                if (el) el.style.height = `${h}px`;
            };
            const onMove = (e: MouseEvent) => {
                const delta = startY - e.clientY; // up => taller
                const ceiling = Math.max(80, Math.round(window.innerHeight * 0.7 - (window.innerHeight - panelBottom)));
                apply(Math.min(Math.max(startH + delta, 80), Math.max(ceiling, 80)));
            };
            const onUp = () => {
                draggingRef.current = false;
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
                setMaxH((h) => {
                    window.localStorage.setItem("aisessions.composerMaxH", String(h));
                    return h;
                });
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
        },
        [maxH]
    );

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
    // 停止后 SSE 直接断开，不会再来 turn_end；补发一个合成事件让主列表
    // 刷新正式数据并清掉实时流式块。
    const handleAbort = useCallback(() => {
        abort();
        onEvent?.({ type: "turn_end" });
        inputRef.current?.focus();
    }, [abort, onEvent]);
    const hasContent = input.trim().length > 0 || images.length > 0;
    // Streaming 状态下允许继续提交：走 steer 队列而不是杀掉在飞的 turn。
    const canSubmit = hasContent && (status === "idle" || status === "error" || isRunning);

    const openPicker = useCallback(
        async (mode: "models" | "levels") => {
            setPanelMode(mode);
            setPickerQuery("");
            // 懒加载：模型/思考级别各自首次打开时拉一次；失败后重置标记允许重试
            if (mode === "models" && modelsLoaded) return;
            if (mode === "levels" && levelsLoaded) return;
            const cmd = mode === "models" ? "get_available_models" : "get_available_thinking_levels";
            const res = await runChatCommand(endpoint, { ...baseBody, command: { name: cmd } });
            if (!res.ok) {
                flashNotice(`✗ ${cmd}: ${res.error ?? "failed"}`);
                setPanelMode(null);
                return;
            }
            if (mode === "models") {
                setModelOptions(Array.isArray(res.data?.models) ? res.data.models : []);
                setModelsLoaded(true);
            } else {
                setThinkingLevels(Array.isArray(res.data?.levels) ? res.data.levels.map(String) : []);
                setLevelsLoaded(true);
            }
        },
        [endpoint, baseBody, modelsLoaded, levelsLoaded, flashNotice]
    );

    // —— 面板数据：命令过滤 / 模型+思考深度合并选择器 ——
    const slashQuery = parseSlashQuery(input);
    const effectiveMode: PanelMode = panelMode ?? (slashQuery != null ? "commands" : null);
    const allCommands = useMemo(() => mergeSlashItems(dynamicCommands), [dynamicCommands]);
    type PanelRow =
        | { kind: "command"; item: SlashItem }
        | { kind: "model"; item: ModelOption }
        | { kind: "level"; level: string }
        | { kind: "agent"; agent: (typeof AGENT_CHOICES)[number] };

    const panelRows: PanelRow[] = useMemo(() => {
        if (effectiveMode === "commands" && slashQuery != null) {
            return filterSlashItems(allCommands, slashQuery).map((item) => ({ kind: "command" as const, item }));
        }
        // 模型搜索：按名称/id/provider 子串过滤；思考深度仅按级别名匹配
        const q = pickerQuery.trim().toLowerCase();
        if (effectiveMode === "models") {
            return (q
                ? modelOptions.filter((m) =>
                      `${m.name || ""} ${m.id || ""} ${m.provider || ""}`.toLowerCase().includes(q)
                  )
                : modelOptions
            ).map((item) => ({ kind: "model" as const, item }));
        }
        if (effectiveMode === "levels") {
            return (q ? thinkingLevels.filter((l) => l.toLowerCase().includes(q)) : thinkingLevels).map(
                (level) => ({ kind: "level" as const, level })
            );
        }
        if (effectiveMode === "agents") {
            return AGENT_CHOICES.filter((a) => !q || a.label.toLowerCase().includes(q)).map((agent) => ({
                kind: "agent" as const,
                agent,
            }));
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
                void openPicker(name === "model" ? "models" : "levels");
            } else if (name === "compact") {
                void runControl("compact", undefined, "已请求压缩上下文");
            }
        },
        [openPicker, runControl]
    );

    const applyCommandRow = useCallback(
        (row: PanelRow | undefined) => {
            if (row == null) return;
            if (row.kind === "agent") {
                if (!row.agent.available) {
                    flashNotice(`✗ ${row.agent.label} 暂未支持`);
                    return;
                }
                flashNotice(`当前 agent: ${row.agent.label}（后端仅实现 Pi）`);
                setPanelMode(null);
                inputRef.current?.focus();
                return;
            }
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

    const currentModelLabel = agentState?.model ? agentState.model.name || agentState.model.id : "";
    const currentThinking =
        agentState?.thinkingLevel && agentState.thinkingLevel !== "off" ? agentState.thinkingLevel : "";
    const panelOpen = effectiveMode != null && panelRows.length > 0;

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
            <div className="w-full px-3 pb-2.5 pt-1">
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
                            {effectiveMode != null && effectiveMode !== "commands" ? (
                                <div className="shrink-0 border-b border-border/50 p-1.5">
                                    <input
                                        autoFocus
                                        type="text"
                                        value={pickerQuery}
                                        onChange={(e) => setPickerQuery(e.target.value)}
                                        onKeyDown={handlePickerSearchKeyDown}
                                        placeholder={
                                            effectiveMode === "models"
                                                ? "搜索模型…"
                                                : effectiveMode === "levels"
                                                  ? "搜索思考强度…"
                                                  : "搜索 Agent…"
                                        }
                                        className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-primary outline-none placeholder:text-secondary/70 focus:border-secondary/50"
                                        aria-label={
                                            effectiveMode === "models"
                                                ? "Search models"
                                                : effectiveMode === "levels"
                                                  ? "Search thinking levels"
                                                  : "Search agents"
                                        }
                                    />
                                </div>
                            ) : null}
                            <div className="min-h-0 flex-1 overflow-y-auto">
                            {panelRows.map((row, idx) => {
                                if (row.kind === "agent") {
                                    return (
                                        <button
                                            key={`agent-${row.agent.id}`}
                                            type="button"
                                            className={cn(
                                                "flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs",
                                                row.agent.available
                                                    ? idx === cmdIndex
                                                        ? "bg-accent/10 text-primary"
                                                        : "text-secondary hover:bg-hover"
                                                    : "cursor-not-allowed text-secondary/40"
                                            )}
                                            onMouseEnter={() => setCmdIndex(idx)}
                                            onClick={() => applyCommandRow(row)}
                                        >
                                            <i className="fa-sharp fa-solid fa-robot shrink-0 text-[10px] text-accent" />
                                            <span className="flex-1">{row.agent.label}</span>
                                            {!row.agent.available ? (
                                                <span className="shrink-0 text-[9px] opacity-60">暂未支持</span>
                                            ) : source === row.agent.id ? (
                                                <span className="text-[9px] text-accent">当前</span>
                                            ) : null}
                                        </button>
                                    );
                                }
                                const prev = idx > 0 ? panelRows[idx - 1] : null;
                                const showSection =
                                    effectiveMode != null &&
                                    effectiveMode !== "commands" &&
                                    row.kind !== "command" &&
                                    prev?.kind !== row.kind;
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
                                    {effectiveMode != null && effectiveMode !== "commands" && pickerQuery.trim()
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
                            "relative rounded-[9px] border bg-surface p-1.5 shadow-lg transition-colors",
                            panelOpen || input ? "border-secondary/50" : "border-border focus-within:border-secondary/50"
                        )}
                        onClick={(e) => {
                            // 点击卡片空白处聚焦输入框（按钮点击不触发）
                            if (e.target === e.currentTarget) inputRef.current?.focus();
                        }}
                    >
                        {/* 顶部隐形拖拽区：覆盖卡片上边缘整条宽度 */}
                        <div
                            role="separator"
                            aria-label="Resize input area"
                            aria-orientation="horizontal"
                            className="absolute inset-x-0 -top-1.5 z-10 h-3 cursor-row-resize"
                            onMouseDown={startResize}
                        />
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
                            style={{ maxHeight: `${maxH}px` }}
                            className="block w-full resize-none border-none bg-transparent px-2.5 pb-1 pt-2 text-sm leading-relaxed text-primary outline-none placeholder:text-secondary/70"
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
                                title="选择 Agent"
                                onClick={() => setPanelMode(panelMode === "agents" ? null : "agents")}
                            >
                                <i className="fa-sharp fa-solid fa-robot text-[11px]" />
                                <span className="max-w-24 truncate">{source || "Pi"}</span>
                                <i
                                    className={cn(
                                        "fa-sharp fa-solid fa-chevron-down text-[9px] transition-transform",
                                        panelMode === "agents" && "rotate-180"
                                    )}
                                />
                            </button>
                            <button
                                type="button"
                                className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs text-secondary hover:bg-hover hover:text-primary"
                                title="切换模型"
                                onClick={() => {
                                    if (panelMode === "models") {
                                        setPanelMode(null);
                                    } else {
                                        void openPicker("models");
                                    }
                                }}
                            >
                                <span className="max-w-40 truncate">{currentModelLabel || "选择模型"}</span>
                                <i
                                    className={cn(
                                        "fa-sharp fa-solid fa-chevron-down text-[9px] transition-transform",
                                        panelMode === "models" && "rotate-180"
                                    )}
                                />
                            </button>
                            <button
                                type="button"
                                className={cn(
                                    "flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs hover:bg-hover",
                                    currentThinking ? "text-accent" : "text-secondary hover:text-primary"
                                )}
                                title="思考强度"
                                onClick={() => {
                                    if (panelMode === "levels") {
                                        setPanelMode(null);
                                    } else {
                                        void openPicker("levels");
                                    }
                                }}
                            >
                                <i className="fa-sharp fa-solid fa-brain text-[11px]" />
                                <span>{currentThinking || "思考"}</span>
                                <i
                                    className={cn(
                                        "fa-sharp fa-solid fa-chevron-down text-[9px] transition-transform",
                                        panelMode === "levels" && "rotate-180"
                                    )}
                                />
                            </button>
                            {isRunning ? (
                                <button
                                    type="button"
                                    className="ml-auto flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-error text-white hover:bg-error/85"
                                    title="停止"
                                    aria-label="Stop"
                                    onClick={handleAbort}
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
