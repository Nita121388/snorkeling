// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import i18n from "i18next";
export { i18n };
import HttpBackend from "i18next-http-backend";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import enCommon from "./locales/en/common.json";
import zhCommon from "./locales/zh/common.json";

export const SUPPORTED_LOCALES = ["en", "zh"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const FALLBACK_LOCALE: Locale = "en";
export const NS = ["common"] as const;

/**
 * Initialize i18next.
 *
 * Bundled English resources so the first paint is never blocked on a
 * network fetch; other languages are loaded on demand via HttpBackend.
 * In Electron we ship locales as static assets and the backend reads them
 * from the bundled location (no external network dependency).
 *
 * @param initialLocale - explicit locale (from Wave `ui:locale` config); falls back
 *   to LanguageDetector (browser) then DEFAULT_LOCALE.
 */
export async function initI18n(initialLocale?: Locale): Promise<typeof i18n> {
    const language: Locale = initialLocale ?? DEFAULT_LOCALE;
    await i18n
        .use(HttpBackend)
        .use(LanguageDetector)
        .use(initReactI18next)
        .init({
            lng: language,
            fallbackLng: FALLBACK_LOCALE,
            supportedLngs: [...SUPPORTED_LOCALES],
            ns: [...NS],
            defaultNS: "common",
            partialBundledLanguages: true,
            resources: {
                en: { common: enCommon },
                zh: { common: zhCommon },
            },
            backend: {
                loadPath: "i18n/locales/{{lng}}/{{ns}}.json",
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
