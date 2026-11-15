// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Date/number formatting shim for i18n (R6).
 *
 * i18next does not format dates or numbers. The single source of truth for
 * the *locale* is `ui:locale` (resolved via `I18nModel.getActiveLocale()`);
 * the *format pattern* configuration belongs to task 11-02-datetime-format-config.
 * This module only binds the locale to `Intl` — it must not grow its own
 * format-mode settings.
 */

import { I18nModel } from "./i18nmodel";
import type { Locale } from "./config";

function resolveFormatLocale(locale: Locale): string {
    // en is the only non-CJK supported locale today; map it to en-US so the
    // output is stable regardless of the host machine's region.
    return locale === "en" ? "en-US" : "zh-CN";
}

/** Current Intl-ready locale for formatting (reacts to ui:locale). */
export function getFormatLocale(): string {
    return resolveFormatLocale(I18nModel.getActiveLocale());
}

export function formatDate(date: Date | number): string {
    return new Intl.DateTimeFormat(getFormatLocale(), { dateStyle: "medium" }).format(date);
}

export function formatDateTime(date: Date | number): string {
    return new Intl.DateTimeFormat(getFormatLocale(), { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatNumber(value: number): string {
    return new Intl.NumberFormat(getFormatLocale()).format(value);
}

/** Relative time via Intl.RelativeTimeFormat (e.g. "3 minutes ago" / "3 分钟前"). */
export function formatRelative(date: Date | number, now: Date | number = Date.now()): string {
    const diffMs = new Date(date).getTime() - new Date(now).getTime();
    const absSeconds = Math.abs(diffMs) / 1000;
    const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
        ["year", 31536000],
        ["month", 2592000],
        ["day", 86400],
        ["hour", 3600],
        ["minute", 60],
        ["second", 1],
    ];
    for (const [unit, seconds] of units) {
        if (absSeconds >= seconds || unit === "second") {
            const value = Math.round(diffMs / (seconds * 1000));
            return new Intl.RelativeTimeFormat(getFormatLocale(), { numeric: "auto" }).format(value, unit);
        }
    }
    return "";
}
