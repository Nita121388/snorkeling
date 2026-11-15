// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// localeTextAtom 契约（P2 B7c，视图显示名注册表）：
//
//   1. atom 值在 `ui:locale` 切换后必须跟着变 —— 不允许把启动时的 locale
//      冻结进 `atom(i18n.t(...))` / `atom("literal")`。
//   2. 切换路径走 `I18nModel.setActiveLocale`（globalStore 的 activeLocaleAtom
//      + i18n.changeLanguage），atom 通过 `get(activeLocaleAtom)` 订阅到它。
//   3. 重复调用不重 init（initI18n 幂等语义，见 i18n-config.test.ts）。

import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, describe, expect, test } from "vitest";
import { i18n, initI18n } from "./config";
import { I18nModel, localeTextAtom } from "./i18nmodel";

describe("localeTextAtom", () => {
    afterEach(async () => {
        // 不把 zh 泄漏给同 worker 里的其他测试文件。
        I18nModel.getInstance().setActiveLocale("en");
        await initI18n("en");
    });

    test("follows ui:locale switches instead of freezing the startup locale", async () => {
        await initI18n("en");
        const termName = localeTextAtom(() => i18n.t("block:viewName.term"));
        const tasksName = localeTextAtom(() => i18n.t("scheduledtasks:viewName"));

        expect(globalStore.get(termName)).toBe("Terminal");
        expect(globalStore.get(tasksName)).toBe("Scheduled Tasks");

        I18nModel.getInstance().setActiveLocale("zh");
        await i18n.changeLanguage("zh");

        expect(globalStore.get(termName)).toBe("终端");
        expect(globalStore.get(tasksName)).toBe("定时任务");
    });
});
