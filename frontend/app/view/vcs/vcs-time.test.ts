// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { formatAbsoluteTime, formatRelativeTime } from "./vcs-time";

const NOW = Date.parse("2026-11-09T14:21:05+08:00");

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
        expect(formatRelativeTime("2026-11-09T14:20:40+08:00", NOW)).toBe("just now");
    });

    it("minutes ago under an hour", () => {
        expect(formatRelativeTime("2026-11-09T13:56:05+08:00", NOW)).toBe("25m ago");
    });

    it("hours ago under a day", () => {
        expect(formatRelativeTime("2026-11-09T11:21:05+08:00", NOW)).toBe("3h ago");
    });

    it("days ago under a week", () => {
        expect(formatRelativeTime("2026-11-07T14:21:05+08:00", NOW)).toBe("2d ago");
    });

    it("MM-DD beyond a week", () => {
        expect(formatRelativeTime("2026-10-09T14:21:05+08:00", NOW)).toBe("10-09");
    });

    it("future timestamps fall back to just now", () => {
        expect(formatRelativeTime("2026-11-09T14:22:05+08:00", NOW)).toBe("just now");
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
