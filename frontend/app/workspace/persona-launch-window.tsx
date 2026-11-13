// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Persona stage-entry floating window (A3, design §5): hover the 🎭 widget,
// pause >300ms, pick who steps on stage and (optionally) inject today's main
// work directory into the first prompt. The launch semantics live in
// persona-launch.ts (pure); this component only renders and routes.

import type { AgentProfileOption } from "@/app/workspace/agent-launch";
import {
    buildPersonaLaunchBlockDef,
    personaRosterLabel,
    resolvePersonaProfileName,
    type PersonaRoster,
} from "@/app/workspace/persona-launch";
import { isBlank } from "@/util/util";
import {
    autoUpdate,
    flip,
    FloatingPortal,
    offset,
    shift,
    size,
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import clsx from "clsx";
import { memo, useCallback, useEffect, useRef, useState } from "react";

const ProfileColors: Record<string, string> = {
    codex: "#10a37f",
    claude: "#d97757",
    gemini: "#4285f4",
    opencode: "#e2b714",
    pi: "#7c5cff",
};

const ProfileLabels: Record<string, string> = {
    codex: "Codex",
    claude: "Claude",
    gemini: "Gemini",
    opencode: "OpenCode",
    pi: "Pi",
};

// Hover-close twin of the hook in widgets.tsx (not exported there to avoid an
// import cycle widgets.tsx ↔ persona-launch-window.tsx). If a third consumer
// appears, lift both into a shared module.
function useOutsideHoverClose(isOpen: boolean, onClose: () => void, delayMs = 1000) {
    const closeTimerRef = useRef<number | null>(null);
    const clearCloseTimer = useCallback(() => {
        if (closeTimerRef.current != null) {
            window.clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
    }, []);
    useEffect(() => {
        if (!isOpen) {
            clearCloseTimer();
        }
        return clearCloseTimer;
    }, [isOpen, clearCloseTimer]);
    const onPointerEnter = useCallback(() => {
        clearCloseTimer();
    }, [clearCloseTimer]);
    const onPointerLeave = useCallback(() => {
        clearCloseTimer();
        closeTimerRef.current = window.setTimeout(() => {
            closeTimerRef.current = null;
            onClose();
        }, delayMs);
    }, [clearCloseTimer, onClose, delayMs]);
    return { onPointerEnter, onPointerLeave };
}

/** Default work directory offered to the injection toggle (today's main cwd). */
export type PersonaMainWorkdirSource = () => string | null;

export type PersonaLaunchFloatingWindowProps = {
    isOpen: boolean;
    onClose: () => void;
    referenceElement: HTMLElement | null;
    settings?: SettingsType;
    profileOptions: AgentProfileOption[];
    /** Loads the persona roster (backend RPC, TTL-cached). */
    fetchRoster: () => Promise<PersonaRoster>;
    /** Resolves the current main work directory for the injection toggle. */
    getMainWorkdir?: PersonaMainWorkdirSource;
    /** Launch callback: builds the block in the current tab; errors reported by the host. */
    onLaunch: (blockDef: BlockDef) => void;
};

export const PersonaLaunchFloatingWindow = memo(function PersonaLaunchFloatingWindow({
    isOpen,
    onClose,
    referenceElement,
    settings,
    profileOptions,
    fetchRoster,
    getMainWorkdir,
    onLaunch,
}: PersonaLaunchFloatingWindowProps) {
    const [roster, setRoster] = useState<PersonaRoster>({ root: "", personas: [] });
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [selectedIdx, setSelectedIdx] = useState(0);
    // Explicit popup picks. undefined = follow the persona card.
    const [selectedProfileName, setSelectedProfileName] = useState<string | undefined>(undefined);
    const [modelInput, setModelInput] = useState("");
    const [injectWorkdir, setInjectWorkdir] = useState(false);
    const [mainWorkdir, setMainWorkdir] = useState<string | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    // 父组件（widgets.tsx）每次渲染都会新建内联回调。若把它们放进 effect 的依赖，
    // 状态原子一变动就会重拉名册并把用户刚选好的人设/注入开关清零。用 ref 固定住
    // 最新实现，effect 只认「是否打开」这一个意图。
    const fetchRosterRef = useRef(fetchRoster);
    fetchRosterRef.current = fetchRoster;
    const getMainWorkdirRef = useRef(getMainWorkdir);
    getMainWorkdirRef.current = getMainWorkdir;

    const { refs, floatingStyles, context } = useFloating({
        open: isOpen,
        onOpenChange: onClose,
        placement: "left-start",
        middleware: [
            offset(8),
            flip(),
            shift({ padding: 12 }),
            size({
                padding: 12,
                apply({ availableHeight, elements }) {
                    elements.floating.style.maxHeight = `${Math.max(Math.min(availableHeight, 560), 120)}px`;
                    elements.floating.style.overflowY = "auto";
                },
            }),
        ],
        whileElementsMounted: autoUpdate,
        elements: {
            reference: referenceElement ?? undefined,
        },
    });
    const dismiss = useDismiss(context);
    const { getFloatingProps } = useInteractions([dismiss]);
    const { onPointerEnter, onPointerLeave } = useOutsideHoverClose(isOpen, onClose);

    // Reload the roster on every open and reset the picks: a stage entry is a
    // fresh shift, so yesterday's popup picks must not leak into it.
    useEffect(() => {
        if (!isOpen) {
            return;
        }
        setSelectedIdx(0);
        setSelectedProfileName(undefined);
        setModelInput("");
        setInjectWorkdir(false);
        setMainWorkdir(getMainWorkdirRef.current?.() ?? null);
        setLoadError(null);
        setLoading(true);
        let cancelled = false;
        fetchRosterRef
            .current()
            .then((result) => {
                if (!cancelled) {
                    setRoster({ root: result?.root ?? "", personas: result?.personas ?? [] });
                    setSelectedIdx(0);
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    setRoster({ root: "", personas: [] });
                    setLoadError(String(error?.message ?? error));
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [isOpen]);

    const personas = roster.personas;
    const selectedPersona = personas[selectedIdx] ?? null;
    const cardDefaultProfileName = resolvePersonaProfileName(selectedPersona, profileOptions);
    // The chip row shows: every detected profile, with the persona card's pick
    // (or explicit popup pick) highlighted first.
    const effectiveProfileName =
        selectedProfileName ?? cardDefaultProfileName ?? profileOptions.find((p) => p.isDefault)?.name;

    const launch = useCallback(() => {
        if (selectedPersona == null) {
            return;
        }
        const { blockDef } = buildPersonaLaunchBlockDef({
            settings,
            persona: selectedPersona,
            root: roster.root,
            profileName: selectedProfileName ?? cardDefaultProfileName,
            model: isBlank(modelInput) ? undefined : modelInput,
            injectMainWorkdir: injectWorkdir,
            mainWorkdir,
        });
        onLaunch(blockDef);
        onClose();
    }, [
        selectedPersona,
        settings,
        roster.root,
        selectedProfileName,
        cardDefaultProfileName,
        modelInput,
        injectWorkdir,
        mainWorkdir,
        onLaunch,
        onClose,
    ]);

    const onKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (personas.length === 0) {
                return;
            }
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIdx((idx) => Math.min(idx + 1, personas.length - 1));
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIdx((idx) => Math.max(idx - 1, 0));
            } else if (e.key === "Enter") {
                e.preventDefault();
                launch();
            }
        },
        [personas.length, launch]
    );

    if (!isOpen || referenceElement == null) {
        return null;
    }

    return (
        <FloatingPortal>
            <div
                ref={refs.setFloating}
                style={floatingStyles}
                {...getFloatingProps()}
                onPointerEnter={onPointerEnter}
                onPointerLeave={onPointerLeave}
                className="z-50 w-[min(92vw,380px)] rounded-lg border border-border bg-modalbg shadow-xl"
            >
                <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                    <span className="text-sm">🎭</span>
                    <span className="text-sm font-medium text-muted">叫人设登场</span>
                    <span className="ml-auto text-[10px] text-muted/70">↑↓ 选择 · ↵ 登场 · esc 关闭</span>
                </div>

                {/* ① 选 Agent（谁上身） */}
                <div className="px-4 pt-3">
                    <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted/80">Agent</div>
                    {profileOptions.length === 0 ? (
                        <div className="text-xs text-muted">未检测到可用 Agent 命令</div>
                    ) : (
                        <div className="flex flex-wrap gap-1.5">
                            {profileOptions.map((profile) => {
                                const isActive = profile.name === effectiveProfileName;
                                const color = ProfileColors[profile.name] ?? "#888";
                                return (
                                    <button
                                        key={profile.name}
                                        type="button"
                                        className={clsx(
                                            "cursor-pointer rounded border px-2 py-0.5 text-xs transition-colors",
                                            isActive
                                                ? "border-transparent text-white"
                                                : "border-border bg-surface text-secondary hover:text-foreground"
                                        )}
                                        style={isActive ? { backgroundColor: color } : undefined}
                                        onClick={() => {
                                            setSelectedProfileName(profile.name);
                                            if (isBlank(modelInput)) {
                                                setModelInput("");
                                            }
                                        }}
                                        title={profile.cmd}
                                    >
                                        {ProfileLabels[profile.name] ?? profile.name}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    <input
                        type="text"
                        value={modelInput}
                        onChange={(e) => setModelInput(e.target.value)}
                        placeholder={
                            isBlank(selectedPersona?.model) ? "model（可选，默认取人设卡）" : selectedPersona.model
                        }
                        className="mt-2 w-full rounded border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
                    />
                </div>

                {/* ② 选人设（谁登场） */}
                <div className="mt-3 px-4">
                    <div className="mb-1.5 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-muted/80">
                        <span>人设</span>
                        <span className="text-muted/60">{roster.root ? personas.length : ""}</span>
                    </div>
                    <div
                        ref={listRef}
                        tabIndex={0}
                        className="max-h-[min(40vh,280px)] overflow-y-auto overscroll-contain rounded border border-border/60 outline-none"
                        onKeyDown={onKeyDown}
                    >
                        {loading ? (
                            <div className="flex items-center justify-center py-6 text-muted">
                                <i className="fa fa-solid fa-spinner fa-spin mr-2"></i>
                                <span className="text-xs">正在读取人设名册…</span>
                            </div>
                        ) : loadError != null ? (
                            <div className="px-3 py-6 text-center text-xs text-error">名册读取失败：{loadError}</div>
                        ) : personas.length === 0 ? (
                            <div className="px-3 py-6 text-center text-xs text-muted">
                                本机还没有人设。终端运行：
                                <code className="mx-1 rounded bg-surface-soft px-1">
                                    wsh persona create --name &lt;名&gt; --yes
                                </code>
                                创建第一个。
                            </div>
                        ) : (
                            personas.map((persona, idx) => {
                                const isSelected = idx === selectedIdx;
                                return (
                                    <div
                                        key={persona.id}
                                        className={clsx(
                                            "flex cursor-pointer items-center gap-2 px-3 py-2 text-secondary transition-colors hover:bg-hoverbg hover:text-foreground",
                                            isSelected && "bg-accent/10 text-foreground",
                                            idx > 0 && "border-t border-border/40"
                                        )}
                                        onMouseEnter={() => setSelectedIdx(idx)}
                                        onClick={() => setSelectedIdx(idx)}
                                        onDoubleClick={launch}
                                        title={persona.role || persona.id}
                                    >
                                        <span className="w-5 text-center">
                                            {isBlank(persona.emoji) ? "🎭" : persona.emoji}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-sm">
                                            {personaRosterLabel(persona)}
                                        </span>
                                        <span className="min-w-0 max-w-[40%] truncate text-xs text-muted/80">
                                            {persona.role ?? persona.id}
                                        </span>
                                    </div>
                                );
                            })
                        )}
                        <div
                            className="cursor-not-allowed border-t border-border/40 px-3 py-2 text-xs text-muted/50"
                            title="创建向导在 A2 提供"
                        >
                            ＋ 新建人设…
                        </div>
                    </div>
                </div>

                {/* ③ 注入开关 */}
                <div className="mt-3 border-t border-border px-4 py-3">
                    <label
                        className={clsx(
                            "flex items-start gap-2",
                            mainWorkdir == null ? "cursor-not-allowed text-muted/60" : "cursor-pointer"
                        )}
                        title={
                            mainWorkdir == null
                                ? "当前没有可识别的主工作目录"
                                : "首条提示前置「[登场上下文] 本次主工作目录」，不勾 = 纯人设任务"
                        }
                    >
                        <input
                            type="checkbox"
                            checked={injectWorkdir}
                            disabled={mainWorkdir == null}
                            onChange={(e) => setInjectWorkdir(e.target.checked)}
                            className="mt-0.5"
                        />
                        <span className="min-w-0 flex-1 text-xs">
                            注入本次主工作目录
                            <span className="ml-1 break-all text-muted/80">{mainWorkdir ?? "（未识别到）"}</span>
                        </span>
                    </label>
                    <div className="mt-3 flex justify-end gap-2">
                        <button
                            type="button"
                            className="cursor-pointer rounded border border-border bg-surface px-3 py-1 text-xs text-secondary transition-colors hover:text-foreground"
                            onClick={onClose}
                        >
                            取消
                        </button>
                        <button
                            type="button"
                            disabled={selectedPersona == null}
                            className={clsx(
                                "rounded px-3 py-1 text-xs text-white transition-opacity",
                                selectedPersona == null
                                    ? "cursor-not-allowed bg-accent/40"
                                    : "cursor-pointer bg-accent hover:opacity-90"
                            )}
                            onClick={launch}
                        >
                            🎭 登场
                        </button>
                    </div>
                </div>
            </div>
        </FloatingPortal>
    );
});
