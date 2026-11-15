// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Registry label keys contract (i18n B5).
//
// The block-editor registries are plain data evaluated at module load, so they carry
// `labelKey` and the render sites resolve it (see registry.ts helpers). That makes a
// typo'd key invisible to tsc — at runtime i18next just echoes the key back. This test
// pins the whole builtin surface to the bundled `block-editor` resources:
//   - every builtin item has a labelKey that resolves (label !== raw key),
//   - the en value is the canonical English label the spec still carries,
//   - the zh mirror resolves too (zh is a mirror, en stays the source of truth).

import { beforeAll, describe, expect, it } from "vitest";

import { i18n, initI18n } from "@/i18n/config";
import { builtinInlineStyles } from "./commands/styles";
import { builtinSlashCommands } from "./commands/slash";
import { builtinTurnIntoActions } from "./commands/turn-into";
import { blockActionLabel, inlineStyleLabel, slashCommandLabel } from "./registry";

beforeAll(async () => {
    await initI18n("en");
});

describe("block-editor registry label keys", () => {
    it("every builtin slash command labelKey resolves to its English label", () => {
        const cmds = builtinSlashCommands();
        expect(cmds.length).toBeGreaterThan(0);
        for (const cmd of cmds) {
            expect(cmd.labelKey, `missing labelKey for slash command ${cmd.id}`).toBeTruthy();
            expect(slashCommandLabel(cmd), `unresolved key for ${cmd.id}`).toBe(cmd.label);
        }
    });

    it("every builtin turn-into action labelKey resolves to its English label", () => {
        const actions = builtinTurnIntoActions();
        expect(actions.length).toBeGreaterThan(0);
        for (const action of actions) {
            expect(action.labelKey, `missing labelKey for ${action.id}`).toBeTruthy();
            expect(blockActionLabel(action), `unresolved key for ${action.id}`).toBe(action.label);
        }
    });

    it("every builtin inline style labelKey resolves to its English label", () => {
        const styles = builtinInlineStyles();
        expect(styles.length).toBeGreaterThan(0);
        for (const style of styles) {
            expect(style.labelKey, `missing labelKey for ${style.id}`).toBeTruthy();
            expect(inlineStyleLabel(style), `unresolved key for ${style.id}`).toBe(style.label);
        }
    });

    it("zh mirror resolves for the same keys", async () => {
        await i18n.changeLanguage("zh");
        try {
            const heading = builtinSlashCommands().find((c) => c.id === "heading-1");
            expect(heading).toBeTruthy();
            expect(slashCommandLabel(heading!)).toBe("标题 1");
            const style = builtinInlineStyles().find((s) => s.id === "bold");
            expect(inlineStyleLabel(style!)).toBe("加粗");
        } finally {
            await i18n.changeLanguage("en");
        }
    });
});
