// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, test, vi } from "vitest";

import { DEFAULT_LOCALE, resolveLocale, SUPPORTED_LOCALES } from "./config";

// jsdom's navigator.language follows the host machine (zh-CN here, en-US
// elsewhere), so every "auto" case must pin it instead of inheriting the
// developer's locale. A test that only passes on one host is a phantom red.
const originalLanguage = Object.getOwnPropertyDescriptor(Navigator.prototype, "language");
afterEach(() => {
    if (originalLanguage) Object.defineProperty(Navigator.prototype, "language", originalLanguage);
});

function setNavigatorLanguage(value: string) {
    Object.defineProperty(Navigator.prototype, "language", { value, configurable: true });
}

describe("resolveLocale", () => {
    test("explicit supported locale passes through", () => {
        expect(resolveLocale("en")).toBe("en");
        expect(resolveLocale("zh")).toBe("zh");
    });

    test("auto resolves from the explicit systemLocale argument first", () => {
        setNavigatorLanguage("en-US");
        expect(resolveLocale("auto", "zh-CN")).toBe("zh");
        expect(resolveLocale("auto", "en-US")).toBe("en");
    });

    test("auto without systemLocale falls back to navigator.language", () => {
        setNavigatorLanguage("zh-CN");
        expect(resolveLocale("auto")).toBe("zh");
        setNavigatorLanguage("en-US");
        expect(resolveLocale("auto")).toBe("en");
    });

    test("case-insensitive and region-matched system locales", () => {
        expect(resolveLocale(undefined, "ZH-CN")).toBe("zh");
        expect(resolveLocale("auto", "zh-Hans-SG")).toBe("zh");
        expect(resolveLocale("auto", "en-GB")).toBe("en");
    });

    test("unresolvable values fall back to the default locale", () => {
        setNavigatorLanguage("fr-FR");
        expect(resolveLocale("auto", "fr-FR")).toBe(DEFAULT_LOCALE);
        expect(resolveLocale("auto", undefined)).toBe(DEFAULT_LOCALE);
        expect(resolveLocale(42 as any, "fr-FR")).toBe(DEFAULT_LOCALE);
        expect(resolveLocale(null as any, "fr-FR")).toBe(DEFAULT_LOCALE);
        expect(resolveLocale("")).toBe(DEFAULT_LOCALE);
    });

    test("invalid setting types still honor the system locale when it is supported", () => {
        // Missing/invalid setting means "auto": system locale still wins.
        expect(resolveLocale(undefined, "zh")).toBe("zh");
        expect(SUPPORTED_LOCALES).toContain(resolveLocale(undefined));
    });
});
