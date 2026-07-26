// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, useSettingsKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect } from "react";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";

interface ThemeCardDef {
    mode: AppThemeMode;
    label: string;
    icon: string;
    description: string;
}

const CARDS: ThemeCardDef[] = [
    { mode: "system", label: "System", icon: "fa-solid fa-circle-half-stroke", description: "Follow OS appearance" },
    { mode: "light", label: "Light", icon: "fa-solid fa-sun", description: "Always light" },
    { mode: "dark", label: "Dark", icon: "fa-solid fa-moon", description: "Always dark" },
    { mode: "monochrome", label: "Monochrome", icon: "fa-solid fa-circle", description: "Black & white" },
];

function MiniTermPreview() {
    // Mini terminal mock that reads CSS vars from the closest [data-theme] scope.
    // Deliberately cross-platform: no macOS traffic-light chrome, just a prompt.
    return (
        <div className="rounded-md overflow-hidden border border-border/60 shadow-sm">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-[var(--panel-bg-color)]">
                <div className="px-1.5 py-0.5 text-[8px] rounded-sm border border-actionsoftborder bg-actionsoft text-actionsofttext font-medium min-w-[24px] text-center">
                    tab
                </div>
                <div className="px-1.5 py-0.5 text-[8px] text-muted-foreground">tab</div>
            </div>
            <div className="px-2 py-1.5 font-mono text-[8px] leading-tight space-y-0.5">
                <div>
                    <span className="text-accent">❯</span> <span className="text-primary">run build</span>
                </div>
                <div className="text-secondary">✓ done in 1.4s</div>
                <div className="flex gap-1 pt-0.5">
                    <span className="px-1 py-0.5 rounded-sm bg-action text-actiontext text-[7px] font-semibold">Run</span>
                    <span className="px-1 py-0.5 rounded-sm border border-border text-muted-foreground text-[7px]">
                        Cancel
                    </span>
                </div>
            </div>
        </div>
    );
}

const ThemePickerContent = memo(({ model: _model }: { model: WaveConfigViewModel }) => {
    void _model;
    const persistedTheme = useSettingsKeyAtom("app:theme") as AppThemeMode | null;
    // resolvedAppThemeAtom already folds in previewThemeOverrideAtom, so this single value
    // drives both the outer app (via AppSettingsUpdater in app.tsx) and the card mini-previews.
    const resolvedTheme = useAtomValue(atoms.resolvedAppThemeAtom);
    const systemTheme = useAtomValue(atoms.systemAppThemeAtom);

    // On unmount, clear any transient hover preview so leaving the panel never strands a preview state.
    useEffect(() => {
        return () => {
            globalStore.set(atoms.previewThemeOverrideAtom, null);
        };
    }, []);

    const handleHover = useCallback((mode: AppThemeMode) => {
        globalStore.set(atoms.previewThemeOverrideAtom, mode);
    }, []);
    const handleLeave = useCallback(() => {
        globalStore.set(atoms.previewThemeOverrideAtom, null);
    }, []);
    const handleClick = useCallback((mode: AppThemeMode) => {
        fireAndForget(() =>
            RpcApi.SetConfigCommand(TabRpcClient, {
                "app:theme": mode,
            } as SettingsType)
        );
        // Persisted setter flows into settingsAtom; clear override so resolvedAppThemeAtom tracks the new
        // persisted value rather than the transient hover.
        globalStore.set(atoms.previewThemeOverrideAtom, null);
    }, []);

    const normalizeForCompare = (m: string | null): AppThemeMode =>
        m === "light" || m === "dark" || m === "monochrome" ? m : "system";
    const activeMode = normalizeForCompare(persistedTheme);

    // The effective theme each card represents: under hover it's the hovered mode resolved through
    // the system theme; otherwise it's the card's own mode resolved the same way. This drives the
    // local [data-theme] for the mini-preview so its coloring matches the app-wide switch.
    const cardResolvedTheme = (mode: AppThemeMode): ResolvedAppTheme => {
        if (mode === "system") return systemTheme;
        return mode;
    };

    return (
        <div className="p-6 h-full overflow-auto">
            <div className="grid grid-cols-1 @md:grid-cols-3 gap-3">
                {CARDS.map((card) => {
                    const isActive = card.mode === activeMode;
                    const previewTheme = cardResolvedTheme(card.mode);
                    return (
                        <div
                            key={card.mode}
                            data-theme={previewTheme}
                            onMouseEnter={() => handleHover(card.mode)}
                            onMouseLeave={handleLeave}
                            onClick={() => handleClick(card.mode)}
                            className={cn(
                                "group relative rounded-lg border p-3 cursor-pointer transition-all",
                                "hover:border-foreground/40 hover:shadow-md",
                                isActive
                                    ? "border-border bg-[var(--main-bg-color)] ring-1 ring-inset ring-foreground/25"
                                    : "border-border bg-[var(--main-bg-color)]",
                            )}
                        >
                            {isActive && (
                                <span className="absolute top-2 right-2 text-foreground/70 text-xs">
                                    <i className="fa-solid fa-circle-check" />
                                </span>
                            )}
                            <div className="flex items-center gap-2 mb-2">
                                <i className={cn(card.icon, "text-base")} />
                                <span className="font-medium">{card.label}</span>
                                {card.mode === "system" && (
                                    <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-secondary/30">
                                        OS: {systemTheme}
                                    </span>
                                )}
                            </div>
                            <MiniTermPreview />
                            <div className="text-xs text-muted-foreground mt-2">{card.description}</div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
});

ThemePickerContent.displayName = "ThemePickerContent";

export { ThemePickerContent };
