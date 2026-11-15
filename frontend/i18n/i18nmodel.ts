// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Atom, PrimitiveAtom } from "jotai";
import { atom, useAtomValue } from "jotai";

import { globalStore } from "@/app/store/jotaiStore";
import { DEFAULT_LOCALE, i18n, type Locale, SUPPORTED_LOCALES } from "./config";

/**
 * Jotai-friendly singleton model around i18next.
 *
 * Mirrors snorkeling's other model singletons (`GlobalModel`, `TabModel`):
 * `getInstance()` constructor, simple atoms for state, explicit mutators
 * that talk to the global store directly (no hooks inside model methods).
 *
 * The single source of truth for the *persisted* locale is Wave config
 * `ui:locale`; this model mirrors it into a UI-local atom for fast
 * reactivity and applies it to i18next.
 */
export class I18nModel {
    private static instance: I18nModel;
    /** UI-facing reactive locale. Synchronized from Wave config `ui:locale`. */
    readonly activeLocaleAtom: PrimitiveAtom<Locale>;

    private constructor() {
        this.activeLocaleAtom = atom<Locale>(DEFAULT_LOCALE);
        this.activeLocaleAtom.debugLabel = "i18n:activeLocale";

        // Kept passive: the I18nProvider drives locale changes whenever the
        // Wave config `ui:locale` changes; this model merely applies them to
        // i18next and mirrors them into the local atom.
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
        // Push the change to the Electron main process so its i18n instance and
        // native (application/dock) menus follow. Best-effort: the preload `api`
        // is only present in the real Electron environment (not in vite preview
        // or a node test environment, where `window` itself is undefined).
        if (typeof window === "undefined") return;
        try {
            (window as any).api?.setLocale?.(locale);
        } catch (err) {
            console.error("[i18n] main locale sync failed", err);
        }
    }
}

/** Convenience hook for components. */
export function useActiveLocale(): Locale {
    return useAtomValue(I18nModel.getInstance().activeLocaleAtom);
}

/**
 * Locale-reactive atom for one fixed UI string.
 *
 * View models expose `viewName: Atom<string>`, and a model is constructed once
 * per block — so `atom(i18n.t(key))` would **freeze** whatever locale was
 * active at construction time (switching `ui:locale` afterwards would leave the
 * old language in every already-open block header). Reading
 * `activeLocaleAtom` inside the atom makes it recompute — and notify its
 * subscribers — whenever the locale changes.
 *
 * Only for strings whose value depends on nothing but the locale; dynamic
 * names (session titles, app meta) belong in their own derived atom.
 *
 * `compute` is a thunk (`() => i18n.t("ns:key")`) rather than a raw key so the
 * literal still goes through i18next's typed `t()` overloads — i18next's
 * `ParseKeys` helper resolves to `never` under this project's
 * `CustomTypeOptions`, so a `key: ParseKeys` parameter would lose checking.
 */
export function localeTextAtom(compute: () => string): Atom<string> {
    return atom((get) => {
        get(I18nModel.getInstance().activeLocaleAtom);
        return compute();
    });
}
