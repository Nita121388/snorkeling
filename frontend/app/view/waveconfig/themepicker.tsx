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
// AppThemeMode and ResolvedAppTheme are ambient global types from @/app/theme-mode

interface ThemeCardDef {
    mode: AppThemeMode;
    label: string;
    icon: string;
    // data-theme attribute to scope CSS vars inside the card preview.
    // "system" uses the current resolved theme so the preview reflects what the OS will give.
    previewTheme: ResolvedAppTheme;
    description: string;
}

const CARDS: ThemeCardDef[] = [
    {
        mode: "system",
        label: "System",
        icon: "fa-solid fa-circle-half-stroke",
        previewTheme: "light", // placeholder, dynamically resolved for the System card in render
        description: "Follow OS appearance",
    },
    {
        mode: "light",
        label: "Light",
        icon: "fa-solid fa-sun",
        previewTheme: "light",
        description: "Always light",
    },
    {
        mode: "dark",
        label: "Dark",
        icon: "fa-solid fa-moon",
        previewTheme: "dark",
        description: "Always dark",
    },
    {
        mode: "monochrome",
        label: "Monochrome",
        icon: "fa-solid fa-circle",
        previewTheme: "monochrome",
        description: "Black & white",
    },
];

function MiniTermPreview() {
    // Mini terminal window mock that reads CSS vars from the closest [data-theme] scope.
    return (
        <div className="rounded-md overflow-hidden border border-border/60 shadow-sm">
            <div className="flex items-center gap-1 px-1.5 py-1 bg-[var(--panel-bg-color)]">
                <span className="w-1.5 h-1.5 rounded-full bg-error/80" />
                <span className="w-1.5 h-1.5 rounded-full bg-warning/80" />
                <span className="w-1.5 h-1.5 rounded-full bg-success/80" />
                <div className="ml-1.5 px-1.5 py-0.5 text-[8px] rounded-sm bg-accentbg text-primary font-medium min-w-[24px] text-center">
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
                    <span className="px-1 py-0.5 rounded-sm bg-accent text-[var(--button-text-color)] text-[7px] font-semibold">
                        Run
                    </span>
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
    const resolvedTheme = useAtomValue(atoms.resolvedAppThemeAtom);

    // Cleanup any transient preview override on unmount (so leaving the panel never strands a preview).
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
        // Persisted setter will flow into settingsAtom; clear preview override so
        // resolvedAppThemeAtom reflects the new persisted value (not the transient hover).
        globalStore.set(atoms.previewThemeOverrideAtom, null);
    }, []);

    const normalizeForCompare = (m: string | null): AppThemeMode =>
        m === "light" || m === "dark" || m === "monochrome" ? m : "system";
    const activeMode = normalizeForCompare(persistedTheme);

    return (
        <div className="p-6 h-full overflow-auto">
            <div className="mb-4">
                <h2 className="text-xl font-semibold">App Theme</h2>
                <p className="text-sm text-muted-foreground mt-1">
                    Choose the appearance of the Wave interface. Hover a card to preview, click to apply. Terminal and
                    editor follow automatically.
                </p>
            </div>
            <div className="grid grid-cols-1 @md:grid-cols-3 gap-3">
                {CARDS.map((card) => {
                    const isActive = card.mode === activeMode;
                    const resolvedForSystem = card.mode === "system" ? resolvedTheme : card.previewTheme;
                    return (
                        <div
                            key={card.mode}
                            data-theme={resolvedForSystem}
                            onMouseEnter={() => handleHover(card.mode)}
                            onMouseLeave={handleLeave}
                            onClick={() => handleClick(card.mode)}
                            className={cn(
                                "group relative rounded-lg border p-3 cursor-pointer transition-all",
                                "hover:border-accent hover:shadow-md",
                                isActive ? "border-accent bg-accentbg/30" : "border-border bg-[var(--panel-bg-color)]"
                            )}
                        >
                            {isActive && (
                                <span className="absolute top-2 right-2 text-accent text-xs">
                                    <i className="fa-solid fa-circle-check" />
                                </span>
                            )}
                            <div className="flex items-center gap-2 mb-2">
                                <i className={cn(card.icon, "text-base")} />
                                <span className="font-medium">{card.label}</span>
                                {card.mode === "system" && (
                                    <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-secondary/30">
                                        OS: {resolvedTheme}
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
