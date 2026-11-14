// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import "i18next";
import type common from "./locales/en/common.json";

/**
 * Type-safe i18next keys. Keys are derived from the bundled English resources
 * (single source of truth); keep resources and TS types in sync with
 * `i18next-cli` (see `frontend/i18n/i18next-cli.config.ts`).
 *
 * Every new namespace must be registered here so `t("ns:key...")` keys are
 * type-checked against the bundled English JSON.
 */
declare module "i18next" {
    interface CustomTypeOptions {
        defaultNS: "common";
        resources: {
            common: typeof common;
        };
    }
}
