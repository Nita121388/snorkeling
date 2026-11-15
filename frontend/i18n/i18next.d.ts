// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import "i18next";
import type aiaudit from "./locales/en/aiaudit.json";
import type aifilediff from "./locales/en/aifilediff.json";
import type aipanel from "./locales/en/aipanel.json";
import type aisessions from "./locales/en/aisessions.json";
import type blockEditor from "./locales/en/block-editor.json";
import type block from "./locales/en/block.json";
import type common from "./locales/en/common.json";
import type commontext from "./locales/en/commontext.json";
import type element from "./locales/en/element.json";
import type hero from "./locales/en/hero.json";
import type launcher from "./locales/en/launcher.json";
import type onboarding from "./locales/en/onboarding.json";
import type preview from "./locales/en/preview.json";
import type processviewer from "./locales/en/processviewer.json";
import type scheduledtasks from "./locales/en/scheduledtasks.json";
import type sessionOverview from "./locales/en/session-overview.json";
import type tab from "./locales/en/tab.json";
import type term from "./locales/en/term.json";
import type tsunami from "./locales/en/tsunami.json";
import type vcs from "./locales/en/vcs.json";
import type waveai from "./locales/en/waveai.json";
import type waveconfig from "./locales/en/waveconfig.json";
import type webview from "./locales/en/webview.json";

/**
 * Type-safe i18next keys. Keys are derived from the bundled English resources
 * (single source of truth); keep resources and TS types in sync with
 * `i18next-cli` (see `frontend/i18n/i18next-cli.config.ts`).
 *
 * Every new namespace must be registered here so `t("ns:key...")` keys are
 * type-checked against the bundled English JSON. Namespace keys are written as
 * string literals (not identifiers) so hyphenated names register one-to-one
 * with the runtime namespace.
 */
declare module "i18next" {
    interface CustomTypeOptions {
        defaultNS: "common";
        resources: {
            common: typeof common;
            onboarding: typeof onboarding;
            tab: typeof tab;
            aipanel: typeof aipanel;
            "session-overview": typeof sessionOverview;
            commontext: typeof commontext;
            block: typeof block;
            element: typeof element;
            "block-editor": typeof blockEditor;
            waveconfig: typeof waveconfig;
            term: typeof term;
            preview: typeof preview;
            aisessions: typeof aisessions;
            vcs: typeof vcs;
            aiaudit: typeof aiaudit;
            hero: typeof hero;
            scheduledtasks: typeof scheduledtasks;
            processviewer: typeof processviewer;
            webview: typeof webview;
            launcher: typeof launcher;
            tsunami: typeof tsunami;
            waveai: typeof waveai;
            aifilediff: typeof aifilediff;
        };
    }
}
