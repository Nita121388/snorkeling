// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { extractTerminalContextMeta, resolveWorkspaceAgentContextMeta } from "./agent-launch";

function makeBlock(blockId: string, meta?: Record<string, unknown>): Block {
    return {
        oid: blockId,
        otype: "block",
        version: 1,
        meta: (meta ?? {}) as MetaType,
    } as Block;
}

function makeTab(blockids: string[], meta?: Record<string, unknown>): Tab {
    return {
        oid: "tab:test-agent-context",
        otype: "tab",
        version: 1,
        name: "test",
        layoutstate: "",
        blockids,
        meta: (meta ?? {}) as MetaType,
    } as Tab;
}

describe("agent launch context", () => {
    it("extracts context only from terminal blocks", () => {
        expect(extractTerminalContextMeta(makeBlock("block:preview", { view: "preview", connection: "ssh://a" }))).toBeNull();
        expect(
            extractTerminalContextMeta(makeBlock("block:term", { view: "term", connection: "ssh://a", "cmd:cwd": "/tmp" }))
        ).toEqual({ connection: "ssh://a", "cmd:cwd": "/tmp" });
    });

    it("uses focused terminal context first", () => {
        const tab = makeTab(["block:old-term"]);
        const oldTerm = makeBlock("block:old-term", { view: "term", connection: "ssh://old", "cmd:cwd": "/old" });
        const focusedTerm = makeBlock("block:focused-term", {
            view: "term",
            connection: "ssh://focused",
            "cmd:cwd": "/focused",
        });

        const context = resolveWorkspaceAgentContextMeta({
            focusedBlock: focusedTerm,
            tab,
            getBlockById: (blockId: string) => (blockId === oldTerm.oid ? oldTerm : null),
        });

        expect(context).toEqual({ connection: "ssh://focused", "cmd:cwd": "/focused" });
    });

    it("falls back to the latest terminal context in tab when focused block is not terminal", () => {
        const tab = makeTab(["block:term-1", "block:preview", "block:term-2"]);
        const blockMap: Record<string, Block> = {
            "block:term-1": makeBlock("block:term-1", { view: "term", connection: "ssh://old", "cmd:cwd": "/old" }),
            "block:preview": makeBlock("block:preview", { view: "preview", connection: "ssh://preview" }),
            "block:term-2": makeBlock("block:term-2", { view: "term", connection: "ssh://new", "cmd:cwd": "/new" }),
        };

        const context = resolveWorkspaceAgentContextMeta({
            focusedBlock: blockMap["block:preview"],
            tab,
            getBlockById: (blockId: string) => blockMap[blockId],
        });

        expect(context).toEqual({ connection: "ssh://new", "cmd:cwd": "/new" });
    });

    it("falls back to tab connection when no terminal context exists", () => {
        const tab = makeTab(["block:preview"], { connection: "ssh://session-default" });
        const context = resolveWorkspaceAgentContextMeta({
            focusedBlock: makeBlock("block:preview", { view: "preview", connection: "ssh://preview" }),
            tab,
            getBlockById: () => null,
        });

        expect(context).toEqual({ connection: "ssh://session-default" });
    });
});
