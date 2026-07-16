// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { PrimitiveAtom } from "jotai";
import { atom, useAtomValue } from "jotai";

import { globalStore } from "@/app/store/jotaiStore";
import { i18n } from "./config";
import { DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES } from "./config";

/**
 * Jotai-friendly singleton model around i18next.
 *
 * Mirrors snorkeling's other model singletons (`GlobalModel`, `TabModel`):
 * `getInstance()` constructor, simple atoms for state, explicit mutators
 * that talk to the global store directly (no hooks inside model methods).
 *
 * The single source of truth for the *persisted* locale is Wave config
 * `ui:locale`; this model mirrors it into a UI-local atom for fast reactivity
 * and applies it to i18next.
 */
export class I18nModel {
    private static instance: I18nModel;
    /** UI-facing reactive locale. Synchronized from Wave config `ui:locale`. */
    readonly activeLocaleAtom: PrimitiveAtom<Locale>;

    private constructor() {
        this.activeLocaleAtom = atom<Locale>(DEFAULT_LOCALE);
        this.activeLocaleAtom.debugLabel = "i18n:activeLocale";

        // Kept passive: the I18nProvider / AppSettingsUpdater drives locale
        // changes whenever Wave config `ui:locale` changes; this model merely
        // applies them to i18next and mirrors into the local atom.
    }

    static getInstance(): I18nModel {
        if (!I18nModel.instance) I18nModel.instance = new I18nModel();
        return I18nModel.instance;
    }

    static getActiveLocale(): Locale {
        return globalStore.get(I18nModel.getInstance().activeLocaleAtom);
    }

    setActiveLocale(locale: Locale): void {
        if (!SUPPORTED_LOCALES.includes(locale as Locale)) return;
        globalStore.set(this.activeLocaleAtom, locale);
        i18n.changeLanguage(locale).catch((err) => {
            console.error("[i18n] changeLanguage failed", err);
        });
    }
}

/** Convenience hook for components. */
export function useActiveLocale(): Locale {
    return useAtomValue(I18nModel.getInstance().activeLocaleAtom);
}
