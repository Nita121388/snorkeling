// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeAll, describe, expect, it } from "vitest";
import { initI18n, i18n } from "@/i18n/config";
import { formatAbsoluteTime, formatRelativeTime } from "./vcs-time";

const NOW = Date.parse("2026-11-09T14:21:05+08:00");

// Pattern I：不断言文案字面量。期望值用 `i18n.t(...)` 复算（en 是真源；zh 换语言也不会假红）。
beforeAll(async () => {
    await initI18n("en");
});

describe("formatRelativeTime", () => {
    it("returns empty string for null/undefined/blank", () => {
        expect(formatRelativeTime(undefined, NOW)).toBe("");
        expect(formatRelativeTime(null, NOW)).toBe("");
        expect(formatRelativeTime("  ", NOW)).toBe("");
    });

    it("returns input as-is when unparseable", () => {
        expect(formatRelativeTime("not-a-date", NOW)).toBe("not-a-date");
    });

    it("just now under a minute", () => {
        expect(formatRelativeTime("2026-11-09T14:20:40+08:00", NOW)).toBe(i18n.t("vcs:relative.justNow"));
    });

    it("minutes ago under an hour", () => {
        expect(formatRelativeTime("2026-11-09T13:56:05+08:00", NOW)).toBe(
            i18n.t("vcs:relative.minutes", { count: 25 })
        );
    });

    it("hours ago under a day", () => {
        expect(formatRelativeTime("2026-11-09T11:21:05+08:00", NOW)).toBe(i18n.t("vcs:relative.hours", { count: 3 }));
    });

    it("days ago under a week", () => {
        expect(formatRelativeTime("2026-11-07T14:21:05+08:00", NOW)).toBe(i18n.t("vcs:relative.days", { count: 2 }));
    });

    it("MM-DD beyond a week", () => {
        expect(formatRelativeTime("2026-10-09T14:21:05+08:00", NOW)).toBe("10-09");
    });

    it("future timestamps fall back to just now", () => {
        expect(formatRelativeTime("2026-11-09T14:22:05+08:00", NOW)).toBe(i18n.t("vcs:relative.justNow"));
    });
});

describe("formatAbsoluteTime", () => {
    it("formats YYYY-MM-DD HH:mm", () => {
        expect(formatAbsoluteTime("2026-11-09T14:21:05+08:00")).toBe(
            new Date("2026-11-09T14:21:05+08:00").getFullYear() + "-11-09 14:21"
        );
    });

    it("returns input as-is when unparseable", () => {
        expect(formatAbsoluteTime("nope")).toBe("nope");
    });

    it("returns empty string for blank", () => {
        expect(formatAbsoluteTime("")).toBe("");
    });
});
