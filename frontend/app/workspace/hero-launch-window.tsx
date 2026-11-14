// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Hero stage-entry floating window (A3, design §5): hover the 🎭 widget,
// pause >300ms, pick who steps on stage and (optionally) inject today's main
// work directory into the first prompt. The launch semantics live in
// hero-launch.ts (pure); this component only renders and routes.

import { useAgentPersonas } from "@/app/agent-persona/use-agent-personas";
import { openHeroCreateWizard } from "@/app/view/hero/hero-create-wizard";
import { getAgentIcon } from "@/app/view/term/agent-logo";
import type { AgentProfileOption } from "@/app/workspace/agent-launch";
import {
    buildHeroLaunchBlockDef,
    heroRosterLabel,
    resolveHeroProfileName,
    type HeroRoster,
} from "@/app/workspace/hero-launch";
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

const ProfileLabels: Record<string, string> = {
    codex: "Codex",
    claude: "Claude",
    gemini: "Gemini",
    opencode: "OpenCode",
    pi: "Pi",
};

// Hover-close twin of the hook in widgets.tsx (not exported there to avoid an
// import cycle widgets.tsx ↔ hero-launch-window.tsx). If a third consumer
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
export type HeroMainWorkdirSource = () => string | null;

export type HeroLaunchFloatingWindowProps = {
    isOpen: boolean;
    onClose: () => void;
    referenceElement: HTMLElement | null;
    settings?: SettingsType;
    profileOptions: AgentProfileOption[];
    /** Loads the hero roster (backend RPC, TTL-cached). */
    fetchRoster: () => Promise<HeroRoster>;
    /** Resolves the current main work directory for the injection toggle. */
    getMainWorkdir?: HeroMainWorkdirSource;
    /** Launch callback: builds the block in the current tab; errors reported by the host. */
    onLaunch: (blockDef: BlockDef) => void;
};

export const HeroLaunchFloatingWindow = memo(function HeroLaunchFloatingWindow({
    isOpen,
    onClose,
    referenceElement,
    settings,
    profileOptions,
    fetchRoster,
    getMainWorkdir,
    onLaunch,
}: HeroLaunchFloatingWindowProps) {
    const agentPersonas = useAgentPersonas();
    const [roster, setRoster] = useState<HeroRoster>({ root: "", heroes: [] });
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [selectedIdx, setSelectedIdx] = useState(0);
    // Explicit popup picks. undefined = follow the hero card.
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
                    setRoster({ root: result?.root ?? "", heroes: result?.heroes ?? [] });
                    setSelectedIdx(0);
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    setRoster({ root: "", heroes: [] });
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

    const heroes = roster.heroes;
    const selectedHero = heroes[selectedIdx] ?? null;
    const cardDefaultProfileName = resolveHeroProfileName(selectedHero, profileOptions);
    // The chip row shows: every detected profile, with the hero card's pick
    // (or explicit popup pick) highlighted first.
    const effectiveProfileName =
        selectedProfileName ?? cardDefaultProfileName ?? profileOptions.find((p) => p.isDefault)?.name;

    const launch = useCallback(() => {
        if (selectedHero == null) {
            return;
        }
        const { blockDef } = buildHeroLaunchBlockDef({
            settings,
            hero: selectedHero,
            root: roster.root,
            profileName: selectedProfileName ?? cardDefaultProfileName,
            model: isBlank(modelInput) ? undefined : modelInput,
            injectMainWorkdir: injectWorkdir,
            mainWorkdir,
        });
        onLaunch(blockDef);
        onClose();
    }, [
        selectedHero,
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
            if (heroes.length === 0) {
                return;
            }
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIdx((idx) => Math.min(idx + 1, heroes.length - 1));
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIdx((idx) => Math.max(idx - 1, 0));
            } else if (e.key === "Enter") {
                e.preventDefault();
                launch();
            }
        },
        [heroes.length, launch]
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
                className="z-50 w-[min(92vw,400px)] rounded-xl border border-border/70 bg-modalbg/80 shadow-2xl backdrop-blur-2xl flex flex-col overflow-hidden"
            >
                {/* header：与 New Agent 弹窗同一套 chrome（标题 + 右侧关闭 ×） */}
                <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-2 text-sm font-medium text-foreground">
                    <span>Select Hero</span>
                    <button
                        type="button"
                        className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted transition-colors hover:bg-hoverbg hover:text-foreground"
                        aria-label="Close"
                        title="Close (esc)"
                        onClick={onClose}
                    >
                        <i className="fa fa-solid fa-xmark" />
                    </button>
                </div>

                {/* ① 选 Agent（与 New Agent 弹窗同款 chip 行：左侧 accent 条 + 图标 + 名字） */}
                <div className="shrink-0 border-b border-border/60 px-3 pb-1.5 pt-2">
                    <div className="mb-1.5 text-xxs text-muted">Select an agent type</div>
                    {profileOptions.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted">No detected agents</div>
                    ) : (
                        <div className="flex flex-wrap gap-0.5">
                            {profileOptions.map((profile) => {
                                const isSelected = profile.name === effectiveProfileName;
                                return (
                                    <div
                                        key={profile.name}
                                        className={clsx(
                                            "group inline-flex h-[30px] cursor-pointer items-center rounded-md transition-colors",
                                            isSelected ? "relative bg-accent/12" : "hover:bg-surface-soft"
                                        )}
                                    >
                                        {isSelected && (
                                            <span className="absolute bottom-1 left-0 top-1 w-[2px] rounded-full bg-accent" />
                                        )}
                                        <button
                                            type="button"
                                            className="inline-flex h-full cursor-pointer items-center gap-1.5 rounded-l-md border-none bg-transparent pl-2.5 pr-2 text-xs font-medium"
                                            onClick={() => setSelectedProfileName(profile.name)}
                                            title={profile.cmd}
                                        >
                                            {(() => {
                                                const spec = getAgentIcon(profile.name, { personas: agentPersonas });
                                                if (spec == null) {
                                                    return null;
                                                }
                                                return spec.kind === "emoji" ? (
                                                    <span className="agent-emoji-icon">{spec.emoji}</span>
                                                ) : (
                                                    <span className="text-secondary">{spec.icon}</span>
                                                );
                                            })()}
                                            {ProfileLabels[profile.name] ?? profile.name}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    <input
                        type="text"
                        value={modelInput}
                        onChange={(e) => setModelInput(e.target.value)}
                        placeholder={
                            isBlank(selectedHero?.model)
                                ? "model (optional, defaults to the hero card)"
                                : selectedHero.model
                        }
                        className="mt-2 h-[28px] w-full rounded border border-border/70 bg-surface px-2 text-xs outline-none focus:border-accent"
                    />
                </div>

                {/* ② 选 hero（谁登场） */}
                <div className="shrink-0 px-3 pb-1.5 pt-2">
                    <div className="mb-1.5 flex items-center gap-2 text-xxs text-muted">
                        <span>Select a hero</span>
                        {roster.root && heroes.length > 0 ? (
                            <span className="text-muted/60">({heroes.length})</span>
                        ) : null}
                    </div>
                    <div
                        ref={listRef}
                        tabIndex={0}
                        className="max-h-[min(40vh,280px)] overflow-y-auto overscroll-contain rounded-md border border-border/70 outline-none"
                        onKeyDown={onKeyDown}
                    >
                        {loading ? (
                            <div className="flex items-center justify-center py-6 text-muted">
                                <i className="fa fa-solid fa-spinner fa-spin mr-2"></i>
                                <span className="text-xs">Loading heroes…</span>
                            </div>
                        ) : loadError != null ? (
                            <div className="px-3 py-6 text-center text-xs text-error">
                                Failed to load heroes: {loadError}
                            </div>
                        ) : heroes.length === 0 ? (
                            <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-soft text-lg text-muted/80">
                                    🦸
                                </div>
                                <div className="text-xs font-medium text-secondary">No heroes yet</div>
                                <div className="max-w-[280px] text-[11px] leading-relaxed text-muted">
                                    A hero is a persistent role with a home base and memory. Create the first one in a
                                    terminal:
                                </div>
                                <code
                                    className="cursor-pointer select-all rounded border border-border/70 bg-surface px-2 py-1 font-mono text-[11px] text-accent transition-colors hover:border-accent"
                                    onClick={() =>
                                        void navigator.clipboard
                                            .writeText("wsh hero create --name <name> --yes")
                                            .catch(() => undefined)
                                    }
                                    title="Click to copy"
                                >
                                    wsh hero create --name &lt;name&gt; --yes
                                </code>
                                <button
                                    type="button"
                                    className="cursor-pointer rounded border border-border/70 bg-surface px-3 py-1 text-xs text-secondary transition-colors hover:border-accent hover:text-accent"
                                    onClick={() => openHeroCreateWizard({ source: "hero-picker" })}
                                >
                                    ＋ Or open the create wizard
                                </button>
                            </div>
                        ) : (
                            heroes.map((hero, idx) => {
                                const isSelected = idx === selectedIdx;
                                return (
                                    <div
                                        key={hero.id}
                                        className={clsx(
                                            "flex cursor-pointer items-center gap-2 px-3 py-2 text-secondary transition-colors hover:bg-hoverbg hover:text-foreground",
                                            isSelected && "bg-accent/10 text-foreground",
                                            idx > 0 && "border-t border-border/40"
                                        )}
                                        onMouseEnter={() => setSelectedIdx(idx)}
                                        onClick={() => setSelectedIdx(idx)}
                                        onDoubleClick={launch}
                                        title={hero.role || hero.id}
                                    >
                                        <span className="w-5 text-center">
                                            {isBlank(hero.emoji) ? "🦸" : hero.emoji}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-sm">{heroRosterLabel(hero)}</span>
                                        <span className="min-w-0 max-w-[40%] truncate text-xs text-muted/80">
                                            {hero.role ?? hero.id}
                                        </span>
                                    </div>
                                );
                            })
                        )}
                        <button
                            type="button"
                            className="w-full cursor-pointer border-t border-border/40 px-3 py-2 text-left text-xs text-secondary transition-colors hover:bg-hoverbg hover:text-foreground"
                            onClick={() => openHeroCreateWizard({ source: "hero-picker" })}
                        >
                            ＋ New hero…
                        </button>
                    </div>
                </div>

                {/* ③ 注入开关 */}
                <div className="shrink-0 border-t border-border/60 px-3 py-2.5">
                    <label
                        className={clsx(
                            "flex items-start gap-2",
                            mainWorkdir == null ? "cursor-not-allowed text-muted/60" : "cursor-pointer"
                        )}
                        title={
                            mainWorkdir == null
                                ? "No main working directory detected"
                                : "Prepend the main working directory to the first prompt; unchecked = pure hero task"
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
                            Inject main working directory
                            <span className="ml-1 break-all text-muted/80">{mainWorkdir ?? "(none detected)"}</span>
                        </span>
                    </label>
                    <div className="mt-3 flex justify-end gap-2">
                        <button
                            type="button"
                            className="cursor-pointer rounded border border-border/70 bg-surface px-3 py-1 text-xs text-secondary transition-colors hover:border-accent hover:text-accent"
                            onClick={onClose}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            disabled={selectedHero == null}
                            className={clsx(
                                "rounded px-3 py-1 text-xs text-white transition-opacity",
                                selectedHero == null
                                    ? "cursor-not-allowed bg-accent/40"
                                    : "cursor-pointer bg-accent hover:opacity-90"
                            )}
                            onClick={launch}
                        >
                            Confirm
                        </button>
                    </div>
                </div>
            </div>
        </FloatingPortal>
    );
});
