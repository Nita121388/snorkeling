// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { applyVisibleSettingsDefaults } from "@/app/view/waveconfig/waveconfig-settings";
import { describe, expect, it } from "vitest";

describe("wave config visible settings defaults", () => {
    it("shows Files defaults in user settings without overwriting existing values", () => {
        const result = applyVisibleSettingsDefaults(
            "settings.json",
            JSON.stringify(
                {
                    "app:tabbar": "top",
                    "preview:defaultopentarget": "off",
                },
                null,
                2
            )
        );

        expect(result.changed).toBe(true);
        expect(JSON.parse(result.content)).toEqual({
            "app:tabbar": "top",
            "preview:defaultopentarget": "off",
            "preview:defaultdirectorydisplay": "tree",
        });
    });

    it("does not change non-settings config files", () => {
        const content = `{"widgets": true}`;
        expect(applyVisibleSettingsDefaults("widgets.json", content)).toEqual({
            content,
            changed: false,
        });
    });

    it("does not change invalid JSON", () => {
        const content = `{"app:tabbar":}`;
        expect(applyVisibleSettingsDefaults("settings.json", content)).toEqual({
            content,
            changed: false,
        });
    });
});
