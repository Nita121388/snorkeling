// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import i18n from "i18next";
export { i18n };
import { initReactI18next } from "react-i18next";

import enCommon from "./locales/en/common.json";
import zhCommon from "./locales/zh/common.json";

export const SUPPORTED_LOCALES = ["en", "zh"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
/** What the `ui:locale` setting accepts. "auto" follows the system locale. */
export type LocaleSetting = Locale | "auto";
export const DEFAULT_LOCALE: Locale = "en";
export const FALLBACK_LOCALE: Locale = "en";
export const NS = ["common"] as const;

/**
 * Normalize a `ui:locale` setting value ("auto" | "en" | "zh") into a concrete
 * locale. "auto" (and unknown values) resolve against the system locale
 * (`navigator.language` in the renderer unless `systemLocale` is provided).
 * Never throws: anything unresolvable falls back to DEFAULT_LOCALE ("en").
 */
export function resolveLocale(setting: unknown, systemLocale?: string | null): Locale {
    if (typeof setting === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(setting)) {
        return setting as Locale;
    }
    // "auto" (the default) or an unknown value: follow the system locale.
    const candidates = [systemLocale, typeof navigator !== "undefined" ? navigator.language : null];
    for (const candidate of candidates) {
        if (!candidate) continue;
        const lower = candidate.toLowerCase();
        for (const locale of SUPPORTED_LOCALES) {
            if (lower === locale || lower.startsWith(`${locale}-`)) return locale;
        }
    }
    return DEFAULT_LOCALE;
}

/**
 * Initialize the renderer i18next instance. All resources are statically
 * bundled (no HttpBackend, no language detector) — in Electron the locale
 * files ship with the app, so there is no async loading path at all.
 * Idempotent: a repeat call with a different locale switches language
 * instead of re-initializing (i18next rejects a second `init`).
 *
 * @param initialLocale - resolved locale (from Wave `ui:locale`, see
 *   `resolveLocale`); falls back to DEFAULT_LOCALE.
 */
export async function initI18n(initialLocale?: Locale): Promise<typeof i18n> {
    const language: Locale = initialLocale ?? DEFAULT_LOCALE;
    if (i18n.isInitialized) {
        if (i18n.language !== language) {
            await i18n.changeLanguage(language);
        }
        return i18n;
    }
    await i18n.use(initReactI18next).init({
        lng: language,
        fallbackLng: FALLBACK_LOCALE,
        supportedLngs: [...SUPPORTED_LOCALES],
        ns: [...NS],
        defaultNS: "common",
        resources: {
            en: { common: enCommon },
            zh: { common: zhCommon },
        },
        interpolation: {
            escapeValue: false,
        },
        react: {
            useSuspense: false,
        },
    });
    return i18n;
}
