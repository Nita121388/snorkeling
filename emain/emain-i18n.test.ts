// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, test } from "vitest";

import {
    coerceLocale,
    getI18nMain,
    initI18nMain,
    MAIN_DEFAULT_LOCALE,
    MAIN_SUPPORTED_LOCALES,
    resetI18nMainForTest,
    resolveMainLocale,
    setMainLocale,
    tmew,
} from "./emain-i18n";

beforeEach(() => {
    resetI18nMainForTest();
});

describe("resolveMainLocale / coerceLocale", () => {
    test("explicit supported locale passes through", () => {
        expect(resolveMainLocale("en", "zh-CN")).toBe("en");
        expect(resolveMainLocale("zh", "en-US")).toBe("zh");
    });

    test("auto resolves from the system locale", () => {
        expect(resolveMainLocale("auto", "zh-CN")).toBe("zh");
        expect(resolveMainLocale("auto", "en-US")).toBe("en");
        expect(resolveMainLocale(undefined, "zh")).toBe("zh");
    });

    test("unresolvable values fall back to default", () => {
        expect(resolveMainLocale("auto", "fr-FR")).toBe(MAIN_DEFAULT_LOCALE);
        expect(resolveMainLocale("auto", undefined)).toBe(MAIN_DEFAULT_LOCALE);
        expect(coerceLocale("klingon")).toBe(MAIN_DEFAULT_LOCALE);
        expect(coerceLocale(undefined)).toBe(MAIN_DEFAULT_LOCALE);
    });
});

describe("initI18nMain", () => {
    test("init is synchronous and ready to translate immediately", () => {
        const instance = initI18nMain("en");
        expect(instance.isInitialized).toBe(true);
        expect(instance.t("common:common.cancel")).toBe("Cancel");
    });

    test("repeated init with a different locale switches language, never re-inits", () => {
        const first = initI18nMain("en");
        const second = initI18nMain("zh");
        expect(second).toBe(first);
        expect(getI18nMain().language).toBe("zh");
        expect(getI18nMain().t("common:common.cancel")).toBe("取消");
    });

    test("setMainLocale switches translations", async () => {
        initI18nMain("en");
        expect(tmew("common:common.cancel")).toBe("Cancel");
        await setMainLocale("zh");
        expect(tmew("common:common.cancel")).toBe("取消");
        expect(MAIN_SUPPORTED_LOCALES).toContain(getI18nMain().language);
    });

    test("getI18nMain before init throws (wiring bug, not a race)", () => {
        expect(() => getI18nMain()).toThrow(/initI18nMain/);
    });
});
