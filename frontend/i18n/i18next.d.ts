// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import "i18next";
import type common from "./locales/en/common.json";
import type onboarding from "./locales/en/onboarding.json";
import type tab from "./locales/en/tab.json";
import type aipanel from "./locales/en/aipanel.json";
import type sessionOverview from "./locales/en/session-overview.json";
import type commontext from "./locales/en/commontext.json";

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
        };
    }
}
