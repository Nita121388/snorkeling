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
import { runChatCommand, type ChatRequestBody, type ChatStreamStatus } from "./use-chat-stream";
import { chatSourcesForAvailability, getChatSource, type AvailableChatSourceDef } from "./sources";
import { GitStatusBar } from "./git-status-bar";

type PendingImage = {
    id: string;
    name: string;
    dataUrl: string;
    base64: string;
    mimeType: string;
};

let pendingImageSeq = 0;

// 输入框高度范围：MIN ≈ 原始单行高度（可拖回初始大小），MAX = 窗口高度的 70%
const COMPOSER_MIN_H = 36;
const composerMaxH = () => Math.max(COMPOSER_MIN_H, Math.round(window.innerHeight * 0.7));

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


type ChatComposerProps = {
    source: string;
    sessionId: string;
    availableSources: ReadonlySet<string>;
    projectPath?: string;
    provider?: string;
    model?: string;
    streamStatus: ChatStreamStatus;
    onSend: (body: ChatRequestBody) => void;
    onSteer: (body: ChatRequestBody) => void;
    onAbort: () => void;
    onSourceChange?: (source: string) => void;
};

function ChatComposerInner({ source, sessionId, availableSources, projectPath, provider, model, streamStatus, onSend, onSteer, onAbort, onSourceChange }: ChatComposerProps) {
    const [input, setInput] = useState("");
    const [images, setImages] = useState<PendingImage[]>([]);
    const [dynamicCommands, setDynamicCommands] = useState<SlashItem[]>([]);
    const [agentState, setAgentState] = useState<AgentStateInfo | null>(null);
    const [notice, setNotice] = useState("");
    const [panelMode, setPanelMode] = useState<PanelMode>(null);
    const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
    const [thinkingLevels, setThinkingLevels] = useState<string[]>([]);
    const [pickerQuery, setPickerQuery] = useState("");
    // 联动：切换 agent（source）时，模型/思考深度缓存按 source 失效重拉
    useEffect(() => {
        setModelsLoadedFor(null);
        setLevelsLoadedFor(null);
    }, [source]);
    // 可拖拽调整的输入框最大高度，持久化到 localStorage
    const [maxH, setMaxH] = useState(() => {
        const saved = window.localStorage.getItem("aisessions.composerMaxH");
        const n = saved ? Number(saved) : NaN;
        return Number.isFinite(n) && n >= COMPOSER_MIN_H ? n : 190;
    });
    // 模型 / 思考级别的懒加载标记（避免每次开弹层都打 RPC）
    const [modelsLoadedFor, setModelsLoadedFor] = useState<string | null>(null);
    const [levelsLoadedFor, setLevelsLoadedFor] = useState<string | null>(null);
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

    // Paseo-style auto-grow：内容超出当前高度才撑开（只增不缩），拖拽中跳过。
    // 拖高的空框保持高度，想变小就往下拖；避免空框被压回单行、打字时高框突然缩回。
    const draggingRef = useRef(false);
    useEffect(() => {
        const el = inputRef.current;
        if (!el || draggingRef.current) return;
        if (el.scrollHeight > el.clientHeight) {
            el.style.height = `${Math.min(el.scrollHeight, maxH)}px`;
        }
    }, [input, maxH]);

    // 卡片顶边整条可拖拽调高：向上拖变高、向下拖变矮（ponytail: 原生 mouse 事件，无依赖）
    const startResize = useCallback(
        (down: React.MouseEvent) => {
            down.preventDefault();
            draggingRef.current = true;
            const startY = down.clientY;
            // 基准用真实渲染高度而非 maxH：空框单行 ~35px，若从 maxH 起算首帧会跳变
            const startHeight = Math.round(inputRef.current?.getBoundingClientRect().height ?? 35);
            const apply = (h: number) => {
                setMaxH(h);
                const el = inputRef.current;
                if (el) el.style.height = `${h}px`;
            };
            const onMove = (e: MouseEvent) => {
                const delta = startY - e.clientY; // up => taller
                apply(Math.min(Math.max(startHeight + delta, COMPOSER_MIN_H), composerMaxH()));
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
        []
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
            if (cancelled || !res.ok) return;
            // 命令请求同样会带上 session_state 快照：用它兜底填充默认模型/思考级别，
            // 让新会话在用户首次选择前就显示真实的默认值。
            if (res.state) {
                setAgentState(res.state as AgentStateInfo);
            }
            if (!Array.isArray(res.data?.commands)) return;
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

    const chatSources = useMemo(
        () => chatSourcesForAvailability(availableSources),
        [availableSources]
    );
    const sourceAvailable = availableSources.has(source);
    const isRunning = streamStatus === "sending" || streamStatus === "streaming";
    // 停止后 SSE 直接断开，不会再来 turn_end；补发一个合成事件让主列表
    // 刷新正式数据并清掉实时流式块。
    const handleAbort = useCallback(() => {
        onAbort();
        inputRef.current?.focus();
    }, [onAbort]);
    const hasContent = input.trim().length > 0 || images.length > 0;
    // Streaming 状态下允许继续提交：走 steer 队列而不是杀掉在飞的 turn。
    const canSubmit = sourceAvailable && hasContent && (streamStatus === "idle" || streamStatus === "error" || isRunning);

    // 联动：切模型后按新模型刷新思考深度列表（不同模型支持的级别可能不同）
    const refreshThinkingLevels = useCallback(async () => {
        const res = await runChatCommand(endpoint, {
            ...baseBody,
            command: { name: "get_available_thinking_levels" },
        });
        if (res.ok) {
            setThinkingLevels(Array.isArray(res.data?.levels) ? res.data.levels.map(String) : []);
            setLevelsLoadedFor(source);
        }
    }, [endpoint, baseBody, source]);

    const openPicker = useCallback(
        async (mode: "models" | "levels") => {
            setPanelMode(mode);
            setPickerQuery("");
            // 懒加载：按 source（agent）缓存；切换 agent 后失效重拉
            if (mode === "models" && modelsLoadedFor === source) return;
            if (mode === "levels" && levelsLoadedFor === source) return;
            const cmd = mode === "models" ? "get_available_models" : "get_available_thinking_levels";
            const res = await runChatCommand(endpoint, { ...baseBody, command: { name: cmd } });
            if (!res.ok) {
                flashNotice(`✗ ${cmd}: ${res.error ?? "failed"}`);
                setPanelMode(null);
                return;
            }
            if (mode === "models") {
                setModelOptions(Array.isArray(res.data?.models) ? res.data.models : []);
                setModelsLoadedFor(source);
            } else {
                setThinkingLevels(Array.isArray(res.data?.levels) ? res.data.levels.map(String) : []);
                setLevelsLoadedFor(source);
            }
        },
        [endpoint, baseBody, source, modelsLoadedFor, levelsLoadedFor, flashNotice]
    );

    // —— 面板数据：命令过滤 / 模型+思考深度合并选择器 ——
    const slashQuery = parseSlashQuery(input);
    const effectiveMode: PanelMode = panelMode ?? (slashQuery != null ? "commands" : null);
    const allCommands = useMemo(() => mergeSlashItems(dynamicCommands), [dynamicCommands]);
    type PanelRow =
        | { kind: "command"; item: SlashItem }
        | { kind: "model"; item: ModelOption }
        | { kind: "level"; level: string }
        | { kind: "agent"; agent: AvailableChatSourceDef };

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
            return chatSources.filter((a) => !q || a.label.toLowerCase().includes(q)).map((agent) => ({
                kind: "agent" as const,
                agent,
            }));
        }
        return [];
    }, [effectiveMode, slashQuery, allCommands, modelOptions, thinkingLevels, pickerQuery, chatSources]);

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
                void runControl("compact", undefined, "Context compression requested");
            }
        },
        [openPicker, runControl]
    );

    const applyCommandRow = useCallback(
        (row: PanelRow | undefined) => {
            if (row == null) return;
            if (row.kind === "agent") {
                const { agent } = row;
                if (!agent.available) {
                    flashNotice(`✗ ${agent.label} not supported yet`);
                    setPanelMode(null);
                    inputRef.current?.focus();
                    return;
                }
                if (agent.id === source) {
                    flashNotice(`Current agent: ${agent.label}`);
                    setPanelMode(null);
                    inputRef.current?.focus();
                    return;
                }
                if (sessionId) {
                    // 会话创建时即绑定到某一 source，运行期切换 agent 不被后端支持。
                    // ponytail: 若日后支持跨 agent 迁移，这里改调 onSourceChange 并在
                    // session_state 刷新后重新拉取模型/思考级别即可。
                    flashNotice(`This session is bound to ${getChatSource(source).label} — switching agents is not supported`);
                    setPanelMode(null);
                    inputRef.current?.focus();
                    return;
                }
                onSourceChange?.(agent.id);
                flashNotice(`Selected ${agent.label} (new sessions will use this agent)`);
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
                        `Model switched: ${item.name || item.id}`
                    );
                    // 联动：模型变化后刷新思考深度选项（以新模型的可用级别为准）
                    void refreshThinkingLevels();
                } else {
                    flashNotice("✗ Missing provider/id for this model");
                }
                setPanelMode(null);
                inputRef.current?.focus();
                return;
            }
            void runControl("set_thinking_level", { level: row.level }, `Thinking level: ${row.level}`);
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
            onSteer(body);
        } else {
            onSend(body);
        }
        inputRef.current?.focus();
    }, [canSubmit, input, slashQuery, allCommands, applyBuiltin, baseBody, images, isRunning, onSend, onSteer]);

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
                flashNotice("✗ Failed to read image");
            }
        },
        [flashNotice]
    );

    const removeImage = useCallback((id: string) => {
        setImages((prev) => prev.filter((img) => img.id !== id));
    }, []);

    const currentModelLabel = agentState?.model ? agentState.model.name || agentState.model.id : "";
    // 拿到会话状态后就显示真实级别（包括 off，与校选择列表的 off 选项一致），
    // 未拿到状态时保持[思考]占位。
    const currentThinking = agentState?.thinkingLevel?.trim() ? agentState.thinkingLevel : "";
    const panelOpen = effectiveMode != null && panelRows.length > 0;

    // 点击外部自动关闭面板（与 session-menu 同模式）：监听范围包住整张
    // composer 卡片（弹层 + 三个 chip 都在内），点到卡片外才收起。
    const panelRef = useRef<HTMLDivElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!panelOpen) return;
        const handlePointer = (e: PointerEvent) => {
            if (panelRef.current != null && !panelRef.current.contains(e.target as Node)) {
                setPanelMode(null);
            }
        };
        document.addEventListener("pointerdown", handlePointer, true);
        return () => document.removeEventListener("pointerdown", handlePointer, true);
    }, [panelOpen]);

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
                <div ref={cardRef} className="relative">
                    {panelOpen ? (
                        <div ref={panelRef} className="absolute bottom-full left-0 z-40 mb-2 flex max-h-80 w-[22rem] flex-col overflow-hidden rounded-xl border border-border bg-modalbg py-1 shadow-2xl">
                            {effectiveMode === "commands" && slashQuery != null ? (
                                <div className="shrink-0 border-b border-border/50 px-3 py-1 text-[10px] uppercase tracking-wide text-secondary">
                                    Commands · Tab/Enter to complete · Esc to close
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
                                                ? "Search models…"
                                                : effectiveMode === "levels"
                                                  ? "Search thinking level…"
                                                  : "Search agents…"
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
                                                <span className="shrink-0 text-[9px] opacity-60">Not supported yet</span>
                                            ) : source === row.agent.id ? (
                                                <span className="text-[9px] text-accent">Current</span>
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
                                                    Model
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
                                                Thinking depth
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
                                                <span className="text-[9px] text-accent">Current</span>
                                            ) : null}
                                        </button>
                                    </div>
                                );
                            })}
                            {panelRows.length === 0 ? (
                                <div className="px-3 py-3 text-center text-xs text-secondary">
                                    {effectiveMode != null && effectiveMode !== "commands" && pickerQuery.trim()
                                        ? `No match for "${pickerQuery.trim()}"`
                                        : "No options"}
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
                        <GitStatusBar projectPath={projectPath} isRunning={isRunning} />
                        <textarea
                            ref={inputRef}
                            style={{ maxHeight: `${maxH}px` }}
                            className="block w-full resize-none border-none bg-transparent px-2.5 pb-1 pt-2 text-sm leading-relaxed text-primary outline-none placeholder:text-secondary/70 overflow-y-auto"
                            placeholder={
                                !sourceAvailable ? "Current agent doesn't support GUI chat yet" : isRunning ? "Agent running… press Enter to queue a message" : "Message the agent…"
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
                                title="Attach image"
                                aria-label="Attach images"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <i className="fa-sharp fa-solid fa-plus text-[13px]" />
                            </button>
                            <button
                                type="button"
                                className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs text-secondary hover:bg-hover hover:text-primary"
                                title="Select agent"
                                onClick={() => setPanelMode(panelMode === "agents" ? null : "agents")}
                            >
                                <i className="fa-sharp fa-solid fa-robot text-[11px]" />
                                <span className="max-w-24 truncate">{getChatSource(source).label}</span>
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
                                title="Switch model"
                                onClick={() => {
                                    if (panelMode === "models") {
                                        setPanelMode(null);
                                    } else {
                                        void openPicker("models");
                                    }
                                }}
                            >
                                <span className="max-w-40 truncate">{currentModelLabel || "Select model"}</span>
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
                                    currentThinking && currentThinking !== "off" ? "text-accent" : "text-secondary hover:text-primary"
                                )}
                                title="Thinking level"
                                onClick={() => {
                                    if (panelMode === "levels") {
                                        setPanelMode(null);
                                    } else {
                                        void openPicker("levels");
                                    }
                                }}
                            >
                                <i className="fa-sharp fa-solid fa-brain text-[11px]" />
                                <span>{currentThinking || "Thinking"}</span>
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
                                    className="ml-auto flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent text-white hover:bg-accent/85"
                                    title="Stop"
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
                                    title="Send (Enter)"
                                    aria-label="Send message"
                                    disabled={!canSubmit}
                                    onClick={handleSubmit}
                                >
                                    <i className="fa-sharp fa-solid fa-arrow-up text-[13px]" />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export const ChatComposer = memo(ChatComposerInner);
