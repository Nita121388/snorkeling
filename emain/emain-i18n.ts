// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Main-process i18n (Phase 4 infrastructure).
 *
 * The renderer process uses `frontend/i18n/config.ts` — that instance pulls in
 * `initReactI18next`, `i18next-http-backend`, and `i18next-browser-languagedetector`,
 * none of which belong in the Electron main process (no React, no fetch, no
 * browser). This module builds a *separate* i18next instance for main:
 *
 *   - static JSON imports of the same locale files the renderer uses (single
 *     source of truth — no duplicate translations to maintain)
 *   - `createInstance()` so the main process never accidentally shares state
 *     with the renderer's default `i18n` export
 *   - synchronous init (no async backend), so menu construction in `emain.ts`
 *     can call `t(...)` immediately after `initI18nMain()`
 *
 * Locale synchronization contract (used by Phase 4b/4c):
 *   - On launch, `emain.ts` reads `ui:locale` from `getLaunchSettings()` and
 *     passes it to `initI18nMain()`.
 *   - When the user changes `ui:locale` at runtime, the renderer calls the
 *     `set-locale` IPC channel (exposed via the preload `api.setLocale`),
 *     which calls `setMainLocale()` here. The caller (in `emain-ipc.ts`) is
 *     then responsible for rebuilding any locale-sensitive main-process UI
 *     (e.g. `makeAndSetAppMenu()`) — this module does not import menu code
 *     to keep the dependency graph clean.
 *
 * This phase deliberately ships no translated strings — only the
 * infrastructure. Per-module migration (main-menu, main-window, updater, ...)
 * happens in subsequent phases following Pattern F in `docs/docs/i18n.mdx`.
 */

import { createInstance, type i18n as I18nInstance } from "i18next";

// Reuse the renderer's locale files verbatim — same JSON, same keys, same types.
import enCommon from "../frontend/i18n/locales/en/common.json";
import zhCommon from "../frontend/i18n/locales/zh/common.json";
import enOnboarding from "../frontend/i18n/locales/en/onboarding.json";
import zhOnboarding from "../frontend/i18n/locales/zh/onboarding.json";
import enSessionOverview from "../frontend/i18n/locales/en/session-overview.json";
import zhSessionOverview from "../frontend/i18n/locales/zh/session-overview.json";
import enTab from "../frontend/i18n/locales/en/tab.json";
import zhTab from "../frontend/i18n/locales/zh/tab.json";

export const SUPPORTED_LOCALES = ["en", "zh"] as const;
export type MainLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: MainLocale = "en";
export const FALLBACK_LOCALE: MainLocale = "en";
export const MAIN_NS = [
    "common",
    "onboarding",
    "session-overview",
    "tab",
] as const;

/** Normalize an arbitrary settings value into a supported locale. */
export function coerceLocale(value: unknown): MainLocale {
    if (typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value)) {
        return value as MainLocale;
    }
    return DEFAULT_LOCALE;
}

let i18nMain: I18nInstance | null = null;

const RESOURCES: Record<MainLocale, Record<string, unknown>> = {
    en: {
        common: enCommon,
        onboarding: enOnboarding,
        "session-overview": enSessionOverview,
        tab: enTab,
    },
    zh: {
        common: zhCommon,
        onboarding: zhOnboarding,
        "session-overview": zhSessionOverview,
        tab: zhTab,
    },
};

/**
 * Initialize the main-process i18next instance. Idempotent — repeat calls
 * with a new locale call `changeLanguage` instead of re-`init`-ing (i18next
 * rejects a second `init` on the same instance).
 *
 * Synchronous because main uses static resources only (no HttpBackend).
 *
 * @param initialLocale - raw value from Wave `ui:locale` setting (string or
 *   undefined). `coerceLocale` normalizes non-supported values to
 *   `DEFAULT_LOCALE` so callers can pass `launchSettings["ui:locale"]`
 *   verbatim without a runtime branch.
 */
export function initI18nMain(initialLocale?: string): I18nInstance {
    const lng = coerceLocale(initialLocale);
    if (i18nMain != null) {
        // Already initialized — just switch language.
        if (i18nMain.language !== lng) {
            i18nMain.changeLanguage(lng).catch((err) => {
                // main has no console.error context awareness; use log() if available
                // but avoid circular import with emain-log here.
                // eslint-disable-next-line no-console
                console.error("[i18n:main] changeLanguage failed", err);
            });
        }
        return i18nMain;
    }
    const instance = createInstance();
    instance.init({
        lng: lng,
        fallbackLng: FALLBACK_LOCALE,
        supportedLngs: [...SUPPORTED_LOCALES],
        ns: [...MAIN_NS],
        defaultNS: "common",
        resources: RESOURCES as any,
        interpolation: {
            escapeValue: false,
        },
        // No react, no backend, no language detector — main process.
        initImmediate: false,
    } as any);
    i18nMain = instance;
    return i18nMain;
}

/**
 * Switch the main-process locale at runtime (called from the `set-locale`
 * IPC handler when the renderer pushes a `ui:locale` change). Returns a
 * promise so the caller may await before rebuilding menu/window text.
 *
 * If `initI18nMain` was never called, this initializes first with the
 * given locale (defensive — main startup is expected to init explicitly).
 */
export async function setMainLocale(locale: MainLocale): Promise<I18nInstance> {
    const lng = coerceLocale(locale);
    if (i18nMain == null) {
        return initI18nMain(lng);
    }
    await i18nMain.changeLanguage(lng);
    return i18nMain;
}

/**
 * Read the shared main-process i18next instance. Throws if `initI18nMain`
 * has not been called yet — main-process code is expected to init during
 * startup (see `emain.ts`), so reaching this throw is a wiring bug, not
 * a runtime race.
 */
export function getI18nMain(): I18nInstance {
    if (i18nMain == null) {
        throw new Error("[i18n:main] getI18nMain() called before initI18nMain()");
    }
    return i18nMain;
}

/**
 * Convenience: translate using the main-process instance without explicitly
 * fetching it. Mirrors the `useTranslation` ergonomics from the renderer
 * for sites that don't want to thread the instance through.
 *
 * Always returns a string (i18next's `t` returns `string` when no
 * `returnObjects` is set, which we never set in main).
 */
export function tmew(key: string, options?: Record<string, unknown>): string {
    return getI18nMain().t(key, options as any) as string;
}
