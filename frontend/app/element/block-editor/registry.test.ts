// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, test } from "vitest";
import { builtinTurnIntoActions, TURN_INTO_DEFS } from "./commands/turn-into";
import {
    filterSlashCommands,
    isBlockActionEnabled,
    listBlockActions,
    listSlashCommands,
    registerBlockAction,
    registerSlashCommand,
    resetBlockActionsForTests,
    resetRegistriesForTests,
    runBlockAction,
    type BlockActionSpec,
    type BlockCtx,
    type SlashCommandSpec,
} from "./registry";

const ctxFor = (over: Partial<BlockCtx>): BlockCtx => ({
    text: "hello",
    line: 1,
    endLine: 1,
    kind: "text",
    ...over,
});

describe("block-action registry", () => {
    afterEach(() => resetBlockActionsForTests());

    test("register → list → dispose", () => {
        const spec: BlockActionSpec = { id: "x", label: "X", when: () => true };
        const dispose = registerBlockAction(spec);
        expect(listBlockActions().map((a) => a.id)).toEqual(["x"]);
        dispose();
        expect(listBlockActions()).toEqual([]);
    });

    test("runBlockAction dispatches targetKind actions to transformBlockType", () => {
        const action = builtinTurnIntoActions().find((a) => a.id === "turn-into-heading1")!;
        expect(runBlockAction(action, ctxFor({}))?.text).toBe("# hello");
        const numbered = builtinTurnIntoActions().find((a) => a.id === "turn-into-numbered")!;
        expect(runBlockAction(numbered, ctxFor({ text: "- a" }))?.text).toBe("1. a");
    });
});

describe("turn-into availability matrix (方案 02 §2.4)", () => {
    const actions = builtinTurnIntoActions();
    const enabledIds = (ctx: BlockCtx) =>
        actions.filter((a) => isBlockActionEnabled(a, ctx)).map((a) => a.id);

    test("plain paragraph: everything available", () => {
        expect(enabledIds(ctxFor({}))).toEqual(TURN_INTO_DEFS.map((d) => `turn-into-${d.kind}`));
    });

    test("code block: nothing available (menu itself renders disabled)", () => {
        expect(enabledIds(ctxFor({ kind: "code", text: "```\nx\n```" }))).toEqual([]);
    });

    test("table: only Text (row-level conversion)", () => {
        expect(enabledIds(ctxFor({ kind: "table", text: "| a |\n| --- |" }))).toEqual(["turn-into-text"]);
    });

    test("nested list item: only list-family kinds", () => {
        const ids = enabledIds(ctxFor({ kind: "bulleted", nested: true, text: "  - a" }));
        expect(ids.sort()).toEqual(["turn-into-bulleted", "turn-into-numbered", "turn-into-todo"]);
    });
});

describe("slash command registry (M2)", () => {
    afterEach(() => resetRegistriesForTests());

    test("register, list with when-filtering, dispose", () => {
        const cmd: SlashCommandSpec = {
            id: "demo",
            label: "Demo",
            group: "text",
            when: (ctx) => ctx.kind === "text",
            run: (ctx) => ({ text: ctx.text }),
        };
        const dispose = registerSlashCommand(cmd);
        expect(listSlashCommands(ctxFor({})).map((c) => c.id)).toEqual(["demo"]);
        expect(listSlashCommands(ctxFor({ kind: "code" }))).toEqual([]);
        dispose();
        expect(listSlashCommands(ctxFor({}))).toEqual([]);
    });

    test("filterSlashCommands: prefix beats substring, stable order, case-insensitive", () => {
        const cmds: SlashCommandSpec[] = [
            { id: "code-block", label: "Code Block", group: "text", run: () => null },
            { id: "callout-note", label: "Callout: Note", keywords: ["co"], group: "text", run: () => null },
            { id: "table", label: "Table", keywords: ["code blocks? no"], group: "text", run: () => null },
        ];
        const got = filterSlashCommands(cmds, "co").map((c) => c.id);
        expect(got[0]).toBe("code-block"); // label prefix
        expect(got).toContain("callout-note"); // keyword prefix
        expect(got).toContain("table"); // keyword substring
    });

    test("filterSlashCommands matches Chinese keywords verbatim", () => {
        const cmds: SlashCommandSpec[] = [
            { id: "quote", label: "Quote", keywords: ["引用", "yinyong"], group: "text", run: () => null },
        ];
        expect(filterSlashCommands(cmds, "引用").map((c) => c.id)).toEqual(["quote"]);
    });

    test("empty query returns everything, untrimmed query still filters", () => {
        const cmds: SlashCommandSpec[] = [
            { id: "a", label: "Alpha", group: "text", run: () => null },
            { id: "b", label: "Beta", group: "text", run: () => null },
        ];
        expect(filterSlashCommands(cmds, "")).toHaveLength(2);
        expect(filterSlashCommands(cmds, "  alp ").map((c) => c.id)).toEqual(["a"]);
    });
});
