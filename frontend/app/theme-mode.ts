// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

declare global {
    type AppThemeMode = "system" | "dark" | "light" | "monochrome";
    type ResolvedAppTheme = "dark" | "light" | "monochrome";
}

export function normalizeAppThemeMode(mode: string): AppThemeMode {
    if (mode === "dark" || mode === "light" || mode === "monochrome") {
        return mode;
    }
    return "system";
}

export function getSystemAppTheme(): ResolvedAppTheme {
    return window.matchMedia?.("(prefers-color-scheme: light)")?.matches ? "light" : "dark";
}

export function resolveAppTheme(mode: string, systemTheme: ResolvedAppTheme = getSystemAppTheme()): ResolvedAppTheme {
    const normalizedMode = normalizeAppThemeMode(mode);
    if (normalizedMode !== "system") {
        return normalizedMode;
    }
    return systemTheme;
}

// Binary renderers (Monaco, shiki, mermaid, terminal renderer, transparency) only know
// dark vs light. monochrome is a white-dominant theme, so it shares the light code path.
export function isLightResolvedTheme(theme: ResolvedAppTheme): boolean {
    return theme === "light" || theme === "monochrome";
}

export function applyAppTheme(theme: ResolvedAppTheme) {
    document.documentElement.dataset.theme = theme;
    document.body.dataset.theme = theme;
    document.body.dataset.colorscheme = theme;
    document.documentElement.style.colorScheme = theme;
}
