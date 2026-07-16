// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import "i18next";
import type common from "./locales/en/common.json";
import type onboarding from "./locales/en/onboarding.json";
import type sessionOverview from "./locales/en/session-overview.json";
import type tab from "./locales/en/tab.json";

/**
 * Type-safe i18next keys. Keys are derived from the bundled English resources
 * (single source of truth); use `i18next-cli` (see `frontend/i18n/i18next-cli.config.ts`)
 * to keep resources and TS types in sync.
 *
 * Namespace keys are written as string literals (rather than identifiers) so
 * that hyphenated namespace names like `session-overview` can be registered
 * one-to-one with the runtime namespace and used directly via
 * `useTranslation("session-overview")` and `t("session-overview:key...")`.
 */
declare module "i18next" {
    interface CustomTypeOptions {
        defaultNS: "common";
        resources: {
            common: typeof common;
            onboarding: typeof onboarding;
            "session-overview": typeof sessionOverview;
            tab: typeof tab;
        };
    }
}
