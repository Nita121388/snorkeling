// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    collectAgentLaunchTargetsInTab,
    createDefaultAgentBlockDef,
    extractTerminalContextMeta,
    resolveWorkspaceAgentContextMeta,
} from "./agent-launch";

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

        expect(context).toEqual({ connection: "ssh://preview" });
    });

    it("falls back to tab connection when focused block has no usable connection", () => {
        const tab = makeTab(["block:preview"], { connection: "ssh://session-default" });
        const context = resolveWorkspaceAgentContextMeta({
            focusedBlock: makeBlock("block:preview", { view: "preview", connection: "" }),
            tab,
            getBlockById: () => null,
        });

        expect(context).toEqual({ connection: "ssh://session-default" });
    });

    it("collects only terminal launch targets in tab order", () => {
        const tab = makeTab(["block:preview", "block:term-local", "block:web", "block:term-remote"]);
        const blockMap: Record<string, Block> = {
            "block:preview": makeBlock("block:preview", { view: "preview", connection: "ssh://preview" }),
            "block:term-local": makeBlock("block:term-local", { view: "term", "cmd:cwd": "/Users/nita" }),
            "block:web": makeBlock("block:web", { view: "web", url: "https://example.com" }),
            "block:term-remote": makeBlock("block:term-remote", {
                view: "term",
                connection: "ssh://server-a",
                "cmd:cwd": "/srv/app",
            }),
        };

        const targets = collectAgentLaunchTargetsInTab(tab, (blockId: string) => blockMap[blockId]);

        expect(targets).toHaveLength(2);
        expect(targets[0]).toMatchObject({
            blockId: "block:term-local",
            connection: null,
            cwd: "/Users/nita",
            isLocal: true,
            label: "local",
        });
        expect(targets[1]).toMatchObject({
            blockId: "block:term-remote",
            connection: "ssh://server-a",
            cwd: "/srv/app",
            isLocal: false,
            label: "ssh://server-a",
        });
    });

    it("builds default codex command block when no profile configured", () => {
        const blockDef = createDefaultAgentBlockDef(undefined, { inheritWorkspaceContext: false });
        expect(blockDef.meta?.cmd).toBe("codex");
        expect(blockDef.meta?.["cmd:args"]).toBeUndefined();
        expect(blockDef.meta?.["cmd:env"]).toBeUndefined();
        const metaRecord = blockDef.meta as Record<string, unknown>;
        expect(metaRecord["agent:autoresume"]).toBe(true);
        expect(metaRecord["agent:provider"]).toBe("codex");
    });

    it("applies configured agent profile cmd/model/env", () => {
        const settings = {
            "agent:defaultprofile": "claude",
            "agent:profiles": {
                claude: {
                    cmd: "claude",
                    model: "sonnet-4",
                    modelflag: "--model",
                    args: ["--dangerously-skip-permissions"],
                    env: {
                        ANTHROPIC_API_KEY: "$ENV:ANTHROPIC_API_KEY",
                    },
                },
            },
        } as SettingsType;

        const blockDef = createDefaultAgentBlockDef(settings, { inheritWorkspaceContext: false });
        expect(blockDef.meta?.cmd).toBe("claude");
        expect(blockDef.meta?.["cmd:args"]).toEqual(["--dangerously-skip-permissions", "--model", "sonnet-4"]);
        expect(blockDef.meta?.["cmd:env"]).toEqual({ ANTHROPIC_API_KEY: "$ENV:ANTHROPIC_API_KEY" });
        const metaRecord = blockDef.meta as Record<string, unknown>;
        expect(metaRecord["agent:provider"]).toBe("claude");
        expect(metaRecord["agent:autoresume"]).toBe(true);
    });
});
