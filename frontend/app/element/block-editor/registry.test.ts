// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, test } from "vitest";
import { builtinTurnIntoActions, TURN_INTO_DEFS } from "./commands/turn-into";
import {
    isBlockActionEnabled,
    listBlockActions,
    registerBlockAction,
    resetBlockActionsForTests,
    runBlockAction,
    type BlockActionSpec,
    type BlockCtx,
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
