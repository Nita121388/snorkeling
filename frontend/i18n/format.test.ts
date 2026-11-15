// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// R6 契约断言：日期/数字格式的 locale 跟随 ui:locale（格式模式归 11-02 任务）。
import { beforeEach, describe, expect, test } from "vitest";

import { initI18n } from "./config";
import { getFormatLocale, formatDate, formatDateTime, formatNumber, formatRelative } from "./format";
import { I18nModel } from "./i18nmodel";

beforeEach(async () => {
    await initI18n("en");
    I18nModel.getInstance().setActiveLocale("en");
});

describe("i18n format shim", () => {
    test("format locale follows the active ui:locale", () => {
        expect(getFormatLocale()).toBe("en-US");
        I18nModel.getInstance().setActiveLocale("zh");
        expect(getFormatLocale()).toBe("zh-CN");
    });

    test("dates use Intl with the active locale (not the host locale)", () => {
        const d = new Date("2026-03-04T05:06:00Z");
        const en = formatDateTime(d);
        I18nModel.getInstance().setActiveLocale("zh");
        const zh = formatDateTime(d);
        expect(en).not.toBe(zh);
        // zh-CN 输出含「年/月/日」分隔字样；en-US 用 / 或 ,
        expect(zh).toMatch(/年|月|\//);
        expect(formatDate(d)).toBeTruthy();
    });

    test("numbers group according to the active locale", () => {
        expect(formatNumber(1234567)).toBe("1,234,567");
    });

    test("relative time localizes", () => {
        const now = new Date("2026-03-04T12:00:00Z");
        const past = new Date("2026-03-04T11:57:00Z");
        expect(formatRelative(past, now)).toBe("3 minutes ago");
        I18nModel.getInstance().setActiveLocale("zh");
        expect(formatRelative(past, now)).toBe("3分钟前");
    });

    test("switching locale back restores en formatting", () => {
        I18nModel.getInstance().setActiveLocale("zh");
        I18nModel.getInstance().setActiveLocale("en");
        const past = new Date(Date.now() - 3 * 60_000);
        expect(formatRelative(past)).toBe("3 minutes ago");
    });
});
