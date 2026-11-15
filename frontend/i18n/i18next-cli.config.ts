// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "i18next-cli";

export default defineConfig({
    locales: ["en", "zh"],
    extract: {
        input: ["frontend/app/**/*.{ts,tsx}", "frontend/i18n/**/*.{ts,tsx}"],
        output: "frontend/i18n/locales/{{language}}/{{namespace}}.json",
        defaultNS: "common",
        functions: ["t", "i18n.t", "$t"],
        transComponents: ["Trans", "Translation"],
        sort: true,
    },
    // Generate type-safe keys declaration from the bundled English resources
    types: {
        input: ["frontend/i18n/locales/en/*.json"],
        output: "frontend/i18n/i18next.d.ts",
    },
});
