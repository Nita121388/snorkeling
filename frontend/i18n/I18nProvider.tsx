// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getSettingsKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";

import { initI18n, DEFAULT_LOCALE, type Locale } from "./config";

/**
 * App-level i18n provider.
 *
 * Resolves the initial locale from Wave config `ui:locale` and initializes
 * i18next exactly once. Children render only after i18next is ready
 * (simple ready flag instead of Suspense to keep error surfaces small).
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
    const localeConfig = useAtomValue(getSettingsKeyAtom("ui:locale")) as Locale | undefined;
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let cancelled = false;
        initI18n(localeConfig ?? DEFAULT_LOCALE)
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
    }, [localeConfig]);

    if (!ready) return null;
    return <>{children}</>;
}
