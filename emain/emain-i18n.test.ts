// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

describe("main-process copy registered in common", () => {
    test("menu / dialog / updater keys translate in both locales", async () => {
        initI18nMain("en");
        expect(tmew("common:menu.view.reloadTab")).toBe("Reload Tab");
        expect(tmew("common:menu.workspace.label")).toBe("Workspace");
        await setMainLocale("zh");
        expect(tmew("common:menu.view.reloadTab")).toBe("重新加载标签页");
        expect(tmew("common:dialog.confirmQuit.quit")).toBe("退出");
        expect(tmew("common:updater.manualReady.message", { version: "1.2.3" })).toBe("Snorkeling 1.2.3 已就绪。");
        expect(tmew("common:osNotify.summaryDoneBody", { count: 9 })).toBe("9 个 Agent 已完成。点击返回应用。");
    });

    test("every common key referenced from emain/*.ts resolves in en and zh", async () => {
        // Typos in tmew("common:...") literals would silently render the raw key at runtime.
        // Guard them here: any key used by main-process code must exist in both locales.
        const here = fileURLToPath(new URL(".", import.meta.url));
        const keyRe = /tmew\(\s*"common:([A-Za-z0-9_.]+)"/g;
        const keys = new Set<string>();
        for (const name of readdirSync(here)) {
            if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
            const text = readFileSync(join(here, name), "utf8");
            for (const m of text.matchAll(keyRe)) keys.add(m[1]);
        }
        expect(keys.size).toBeGreaterThan(20);
        for (const locale of MAIN_SUPPORTED_LOCALES) {
            initI18nMain(locale);
            for (const key of keys) {
                // Base key of a plural family has no direct value; check the plural forms.
                const exists = getI18nMain().exists(`common:${key}`) || getI18nMain().exists(`common:${key}_other`);
                expect({ locale, key, exists }).toEqual({ locale, key, exists: true });
            }
        }
    });
});
