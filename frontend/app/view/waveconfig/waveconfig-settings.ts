// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const SettingsFilePath = "settings.json";

export const visibleSettingsDefaults: Partial<SettingsType> = {
    "preview:defaultdirectorydisplay": "tree",
    "preview:defaultopentarget": "right",
};

export function applyVisibleSettingsDefaults(filePath: string, content: string): { content: string; changed: boolean } {
    if (filePath !== SettingsFilePath) {
        return { content, changed: false };
    }
    const trimmed = content.trim();
    let parsed: unknown;
    if (trimmed === "") {
        parsed = {};
    } else {
        try {
            parsed = JSON.parse(content);
        } catch {
            return { content, changed: false };
        }
    }
    if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
        return { content, changed: false };
    }
    const settings = parsed as Record<string, unknown>;
    let changed = false;
    for (const [key, value] of Object.entries(visibleSettingsDefaults)) {
        if (settings[key] == null) {
            settings[key] = value;
            changed = true;
        }
    }
    if (!changed) {
        return { content, changed: false };
    }
    return { content: JSON.stringify(settings, null, 2), changed: true };
}
