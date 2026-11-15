// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Main-process i18n.
 *
 * The renderer uses `frontend/i18n/config.ts` (that instance pulls in
 * `initReactI18next` and React). This module builds a *separate* i18next
 * instance for the Electron main process:
 *
 *   - static JSON imports of the same locale files the renderer uses (single
 *     source of truth — no duplicate translations to maintain)
 *   - `createInstance()` so main never shares state with the renderer
 *   - synchronous init (no async backend), so menu construction in `emain.ts`
 *     can call `t(...)` immediately after `initI18nMain()`
 *
 * Locale sync contract (push, not pull):
 *   - On launch `emain.ts` reads `ui:locale` from the launch settings and
 *     passes it to `initI18nMain()` (resolved via `resolveMainLocale`).
 *   - When the user changes `ui:locale` at runtime, the renderer calls the
 *     `set-locale` IPC channel (preload `api.setLocale`), whose handler calls
 *     `setMainLocale()` and then rebuilds locale-sensitive menus
 *     (`makeAndSetAppMenu()`). This module deliberately does not import menu
 *     code, to keep the dependency graph clean.
 *
 * This module must stay electron-free so it is unit-testable under vitest;
 * locale resolution for "auto" takes the system locale as a parameter.
 */

import { createInstance, type i18n as I18nInstance } from "i18next";

// Reuse the renderer's locale files verbatim — same JSON, same keys, same types.
import enCommon from "../frontend/i18n/locales/en/common.json";
import zhCommon from "../frontend/i18n/locales/zh/common.json";

export const MAIN_SUPPORTED_LOCALES = ["en", "zh"] as const;
export type MainLocale = (typeof MAIN_SUPPORTED_LOCALES)[number];
export const MAIN_DEFAULT_LOCALE: MainLocale = "en";
export const MAIN_FALLBACK_LOCALE: MainLocale = "en";
export const MAIN_NS = ["common"] as const;

/** Normalize a raw `ui:locale` value into a supported locale ("en" fallback). */
export function coerceLocale(value: unknown): MainLocale {
    if (typeof value === "string" && (MAIN_SUPPORTED_LOCALES as readonly string[]).includes(value)) {
        return value as MainLocale;
    }
    return MAIN_DEFAULT_LOCALE;
}

/**
 * Resolve a raw `ui:locale` setting ("auto" | "en" | "zh") into a concrete
 * locale, using `systemLocale` (from `electronApp.getLocale()`) for "auto".
 */
export function resolveMainLocale(setting: unknown, systemLocale?: string | null): MainLocale {
    if (typeof setting === "string" && (MAIN_SUPPORTED_LOCALES as readonly string[]).includes(setting)) {
        return setting as MainLocale;
    }
    if (systemLocale) {
        const lower = systemLocale.toLowerCase();
        for (const locale of MAIN_SUPPORTED_LOCALES) {
            if (lower === locale || lower.startsWith(`${locale}-`)) return locale;
        }
    }
    return MAIN_DEFAULT_LOCALE;
}

let i18nMain: I18nInstance | null = null;

const RESOURCES: Record<MainLocale, Record<string, unknown>> = {
    en: { common: enCommon },
    zh: { common: zhCommon },
};

/**
 * Initialize the main-process i18next instance. Idempotent — repeat calls
 * with a new locale call `changeLanguage` instead of re-`init`-ing (i18next
 * rejects a second `init` on the same instance).
 *
 * Synchronous because main uses static resources only.
 *
 * @param initialLocale - resolved locale (see `resolveMainLocale`).
 */
export function initI18nMain(initialLocale?: MainLocale): I18nInstance {
    const lng = coerceLocale(initialLocale);
    if (i18nMain != null) {
        if (i18nMain.language !== lng) {
            // eslint-disable-next-line no-console
            i18nMain.changeLanguage(lng).catch((err) => console.error("[i18n:main] changeLanguage failed", err));
        }
        return i18nMain;
    }
    const instance = createInstance();
    instance.init({
        lng,
        fallbackLng: MAIN_FALLBACK_LOCALE,
        supportedLngs: [...MAIN_SUPPORTED_LOCALES],
        ns: [...MAIN_NS],
        defaultNS: "common",
        resources: RESOURCES as any,
        interpolation: { escapeValue: false },
        initImmediate: false,
    } as any);
    i18nMain = instance;
    return instance;
}

/** Switch the main-process locale at runtime. Initializes first if needed. */
export async function setMainLocale(locale: MainLocale): Promise<I18nInstance> {
    const lng = coerceLocale(locale);
    if (i18nMain == null) return initI18nMain(lng);
    await i18nMain.changeLanguage(lng);
    return i18nMain;
}

/**
 * Read the shared main-process i18next instance. Throws if `initI18nMain`
 * has not been called yet — reaching this throw is a wiring bug, not a race.
 */
export function getI18nMain(): I18nInstance {
    if (i18nMain == null) {
        throw new Error("[i18n:main] getI18nMain() called before initI18nMain()");
    }
    return i18nMain;
}

/** Convenience: translate with the main-process instance. */
export function tmew(key: string, options?: Record<string, unknown>): string {
    return getI18nMain().t(key, options as any) as string;
}

/** Test-only: reset the singleton between test cases. */
export function resetI18nMainForTest(): void {
    i18nMain = null;
}
