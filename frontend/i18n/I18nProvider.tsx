// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getSettingsKeyAtom } from "@/app/store/global";
import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";

import { initI18n, resolveLocale, type Locale } from "./config";
import { I18nModel } from "./i18nmodel";

/**
 * App-level i18n provider.
 *
 * Resolves the locale from Wave config `ui:locale` ("auto" follows the
 * system locale) and initializes i18next exactly once. Children render only
 * after i18next is ready (simple ready flag instead of Suspense to keep
 * error surfaces small). Runtime `ui:locale` changes are pushed through
 * `I18nModel.setActiveLocale`, which also forwards them to the Electron
 * main process so native menus follow.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
    const localeSetting = useAtomValue(getSettingsKeyAtom("ui:locale"));
    const resolvedLocale: Locale = resolveLocale(localeSetting);
    const [ready, setReady] = useState(false);
    const appliedLocaleRef = useRef<Locale | null>(null);

    // Initial init (idempotent) — runs once for the first resolved locale.
    useEffect(() => {
        let cancelled = false;
        initI18n(resolvedLocale)
            .then(() => {
                if (!cancelled) setReady(true);
            })
            .catch((err) => {
                console.error("[i18n] init failed", err);
                if (!cancelled) setReady(true); // proceed with fallback strings
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Runtime locale changes: mirror into the model (i18next + main process).
    // The first run (mount) is skipped — initI18n already applied it, and the
    // main process booted with the launch-settings locale anyway.
    useEffect(() => {
        if (!ready) return;
        if (appliedLocaleRef.current === resolvedLocale) return;
        appliedLocaleRef.current = resolvedLocale;
        I18nModel.getInstance().setActiveLocale(resolvedLocale);
    }, [ready, resolvedLocale]);

    if (!ready) return null;
    return <>{children}</>;
}
