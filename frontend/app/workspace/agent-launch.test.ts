// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentLaunchTarget } from "./agent-launch";
import {
    collectAgentLaunchTargetsInTab,
    collectTerminalLaunchTargetsInTab,
    createAgentBlockDefForProfile,
    createAgentBlockDefForTarget,
    createDefaultAgentBlockDef,
    createTerminalBlockDefForTarget,
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

function expectHomeLaunchTarget(target: AgentLaunchTarget | undefined) {
    expect(target).toMatchObject({
        blockId: "launch-target:home",
        connection: null,
        cwd: "~",
        filePath: null,
        source: "home",
        isLocal: true,
        label: "local",
        detail: "~",
    });
}

describe("agent launch context", () => {
    it("extracts context only from terminal blocks", () => {
        expect(
            extractTerminalContextMeta(makeBlock("block:preview", { view: "preview", connection: "ssh://a" }))
        ).toBeNull();
        expect(
            extractTerminalContextMeta(
                makeBlock("block:term", { view: "term", connection: "ssh://a", "cmd:cwd": "/tmp" })
            )
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

    it("collects terminal launch targets in tab order when focused block is not Files", () => {
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

        const targets = collectAgentLaunchTargetsInTab(tab, (blockId: string) => blockMap[blockId], null, {
            localHomeDir: "/Users/nita",
        });

        expect(targets).toHaveLength(2);
        expect(targets[0]).toMatchObject({
            blockId: "block:term-local",
            connection: null,
            cwd: "/Users/nita",
            source: "terminal",
            isLocal: true,
            label: "local",
        });
        expect(targets[1]).toMatchObject({
            blockId: "block:term-remote",
            connection: "ssh://server-a",
            cwd: "/srv/app",
            source: "terminal",
            isLocal: false,
            label: "ssh://server-a",
        });
    });

    it("adds focused Files target when no terminal target exists", () => {
        const tab = makeTab(["block:preview"]);
        const blockMap: Record<string, Block> = {
            "block:preview": makeBlock("block:preview", {
                view: "preview",
                connection: "ssh://host-a",
                file: "/srv/repo",
            }),
        };

        const targets = collectAgentLaunchTargetsInTab(tab, (blockId: string) => blockMap[blockId], "block:preview");

        expect(targets).toHaveLength(2);
        expect(targets[0]).toMatchObject({
            blockId: "block:preview",
            connection: "ssh://host-a",
            cwd: "/srv/repo",
            source: "files",
            isLocal: false,
            label: "ssh://host-a",
        });
        expectHomeLaunchTarget(targets[1]);
    });

    it("falls back to Files targets in latest-first order when focused block is unavailable", () => {
        const tab = makeTab(["block:preview-old", "block:preview-new"]);
        const blockMap: Record<string, Block> = {
            "block:preview-old": makeBlock("block:preview-old", {
                view: "preview",
                file: "/Users/nita/Primary",
            }),
            "block:preview-new": makeBlock("block:preview-new", {
                view: "preview",
                file: "/Users/nita/Primary/projects/snorkeling",
            }),
        };

        const targets = collectAgentLaunchTargetsInTab(tab, (blockId: string) => blockMap[blockId], null);

        expect(targets).toHaveLength(3);
        expect(targets[0]).toMatchObject({
            blockId: "block:preview-new",
            source: "files",
            cwd: "/Users/nita/Primary/projects/snorkeling",
        });
        expect(targets[1]).toMatchObject({
            blockId: "block:preview-old",
            source: "files",
            cwd: "/Users/nita/Primary",
        });
        expectHomeLaunchTarget(targets[2]);
    });

    it("includes multiple Files targets when multiple previews are present", () => {
        const tab = makeTab(["block:preview-a", "block:preview-b"]);
        const blockMap: Record<string, Block> = {
            "block:preview-a": makeBlock("block:preview-a", {
                view: "preview",
                file: "/Users/nita/Primary/projects/snorkeling",
            }),
            "block:preview-b": makeBlock("block:preview-b", {
                view: "preview",
                file: "/Users/nita/Primary/obsidians/Obsidian",
            }),
        };

        const targets = collectAgentLaunchTargetsInTab(tab, (blockId: string) => blockMap[blockId], "block:preview-a");

        expect(targets).toHaveLength(3);
        expect(targets[0]).toMatchObject({
            blockId: "block:preview-a",
            source: "files",
            cwd: "/Users/nita/Primary/projects/snorkeling",
        });
        expect(targets[1]).toMatchObject({
            blockId: "block:preview-b",
            source: "files",
            cwd: "/Users/nita/Primary/obsidians/Obsidian",
        });
        expectHomeLaunchTarget(targets[2]);
    });

    it("keeps one target when Files and terminal context share a directory", () => {
        const tab = makeTab(["block:term", "block:preview"]);
        const blockMap: Record<string, Block> = {
            "block:term": makeBlock("block:term", {
                view: "term",
                connection: "ssh://host-a",
                "cmd:cwd": "/srv/repo",
            }),
            "block:preview": makeBlock("block:preview", {
                view: "preview",
                connection: "ssh://host-a",
                file: "/srv/repo/README.md",
            }),
        };

        const targets = collectAgentLaunchTargetsInTab(tab, (blockId: string) => blockMap[blockId], "block:preview");

        expect(targets).toHaveLength(2);
        expect(targets[0]).toMatchObject({
            blockId: "block:preview",
            source: "files",
            connection: "ssh://host-a",
            cwd: "/srv/repo",
        });
        expectHomeLaunchTarget(targets[1]);
    });

    it("shows both Files and Agent directories when they differ", () => {
        const tab = makeTab(["block:preview", "block:agent"]);
        const blockMap: Record<string, Block> = {
            "block:preview": makeBlock("block:preview", {
                view: "preview",
                file: "/Users/nita/Primary/projects",
            }),
            "block:agent": makeBlock("block:agent", {
                view: "term",
                controller: "cmd",
                cmd: "codex",
                "cmd:cwd": "/Users/nita/Primary/obsidians/Obsidian",
                "agent:autoresume": true,
                "agent:provider": "codex",
            }),
        };

        const agentTargets = collectAgentLaunchTargetsInTab(
            tab,
            (blockId: string) => blockMap[blockId],
            "block:preview"
        );
        const terminalTargets = collectTerminalLaunchTargetsInTab(
            tab,
            (blockId: string) => blockMap[blockId],
            "block:preview"
        );

        expect(agentTargets).toHaveLength(3);
        expect(agentTargets[0]).toMatchObject({
            blockId: "block:preview",
            source: "files",
            cwd: "/Users/nita/Primary/projects",
        });
        expect(agentTargets[1]).toMatchObject({
            blockId: "block:agent",
            source: "agent",
            cwd: "/Users/nita/Primary/obsidians/Obsidian",
        });
        expectHomeLaunchTarget(agentTargets[2]);
        expect(terminalTargets).toEqual(agentTargets);
    });

    it("dedupes local tilde and absolute home paths without exposing block ids", () => {
        const tab = makeTab(["block:preview", "block:agent-tilde", "block:agent-absolute"]);
        const blockMap: Record<string, Block> = {
            "block:preview": makeBlock("block:preview", {
                view: "preview",
                file: "/Users/nita/Primary/projects",
            }),
            "block:agent-tilde": makeBlock("block:agent-tilde", {
                view: "term",
                controller: "cmd",
                cmd: "codex",
                "cmd:cwd": "~/Primary/projects/snorkeling",
                "agent:autoresume": true,
                "agent:provider": "codex",
            }),
            "block:agent-absolute": makeBlock("block:agent-absolute", {
                view: "term",
                controller: "cmd",
                cmd: "codex",
                "cmd:cwd": "/Users/nita/Primary/projects/snorkeling",
                "agent:autoresume": true,
                "agent:provider": "codex",
            }),
        };

        const targets = collectTerminalLaunchTargetsInTab(
            tab,
            (blockId: string) => blockMap[blockId],
            "block:preview",
            { localHomeDir: "/Users/nita" }
        );

        expect(targets).toHaveLength(3);
        expect(targets[0]).toMatchObject({
            blockId: "block:preview",
            source: "files",
            cwd: "/Users/nita/Primary/projects",
            detail: "/Users/nita/Primary/projects",
        });
        expect(targets[1]).toMatchObject({
            blockId: "block:agent-tilde",
            source: "agent",
            cwd: "~/Primary/projects/snorkeling",
            detail: "~/Primary/projects/snorkeling",
        });
        expect(targets[1].detail).not.toContain("block");
        expectHomeLaunchTarget(targets[2]);
    });

    it("requires selection when Files and terminal contexts do not match", () => {
        const tab = makeTab(["block:term", "block:preview"]);
        const blockMap: Record<string, Block> = {
            "block:term": makeBlock("block:term", {
                view: "term",
                connection: "ssh://host-a",
                "cmd:cwd": "/srv/repo-a",
            }),
            "block:preview": makeBlock("block:preview", {
                view: "preview",
                connection: "ssh://host-a",
                file: "/srv/repo-b/file.txt",
            }),
        };

        const targets = collectAgentLaunchTargetsInTab(tab, (blockId: string) => blockMap[blockId], "block:preview");

        expect(targets).toHaveLength(3);
        expect(targets[0]).toMatchObject({
            blockId: "block:preview",
            source: "files",
            connection: "ssh://host-a",
        });
        expect(targets[1]).toMatchObject({
            blockId: "block:term",
            source: "terminal",
            connection: "ssh://host-a",
            cwd: "/srv/repo-a",
        });
        expectHomeLaunchTarget(targets[2]);
    });

    it("adds the user's home directory as the default launch target", () => {
        const tab = makeTab([]);

        const agentTargets = collectAgentLaunchTargetsInTab(tab, () => null);
        const terminalTargets = collectTerminalLaunchTargetsInTab(tab, () => null);

        expect(agentTargets).toHaveLength(1);
        expectHomeLaunchTarget(agentTargets[0]);
        expect(terminalTargets).toEqual(agentTargets);
    });

    it("does not duplicate the home target when terminal context is already home", () => {
        const tab = makeTab(["block:term-home"]);
        const blockMap: Record<string, Block> = {
            "block:term-home": makeBlock("block:term-home", { view: "term", "cmd:cwd": "~" }),
        };

        const targets = collectAgentLaunchTargetsInTab(tab, (blockId: string) => blockMap[blockId]);

        expect(targets).toHaveLength(1);
        expect(targets[0]).toMatchObject({
            blockId: "block:term-home",
            source: "terminal",
            cwd: "~",
        });
    });

    it("does not duplicate the home target when local terminal context uses the absolute home path", () => {
        const tab = makeTab(["block:term-home"]);
        const blockMap: Record<string, Block> = {
            "block:term-home": makeBlock("block:term-home", { view: "term", "cmd:cwd": "/Users/nita" }),
        };

        const targets = collectAgentLaunchTargetsInTab(tab, (blockId: string) => blockMap[blockId], null, {
            localHomeDir: "/Users/nita",
        });

        expect(targets).toHaveLength(1);
        expect(targets[0]).toMatchObject({
            blockId: "block:term-home",
            source: "terminal",
            cwd: "/Users/nita",
        });
    });

    it("keeps a remote absolute path separate from the local home target", () => {
        const tab = makeTab(["block:term-remote-home"]);
        const blockMap: Record<string, Block> = {
            "block:term-remote-home": makeBlock("block:term-remote-home", {
                view: "term",
                connection: "ssh://server-a",
                "cmd:cwd": "/Users/nita",
            }),
        };

        const targets = collectAgentLaunchTargetsInTab(tab, (blockId: string) => blockMap[blockId], null, {
            localHomeDir: "/Users/nita",
        });

        expect(targets).toHaveLength(2);
        expect(targets[0]).toMatchObject({
            blockId: "block:term-remote-home",
            source: "terminal",
            connection: "ssh://server-a",
            cwd: "/Users/nita",
        });
        expectHomeLaunchTarget(targets[1]);
    });

    it("builds default codex command block when no profile configured", () => {
        const blockDef = createDefaultAgentBlockDef(undefined, { inheritWorkspaceContext: false });
        expect(blockDef.meta?.cmd).toBe("codex");
        expect(blockDef.meta?.["cmd:args"]).toBeUndefined();
        expect(blockDef.meta?.["cmd:env"]).toBeUndefined();
        expect(blockDef.meta?.["cmd:jwt"]).toBe(true);
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
        expect(blockDef.meta?.["cmd:jwt"]).toBe(true);
        const metaRecord = blockDef.meta as Record<string, unknown>;
        expect(metaRecord["agent:provider"]).toBe("claude");
        expect(metaRecord["agent:autoresume"]).toBe(true);
    });

    it("normalizes Windows shim executables when resolving agent provider", () => {
        const settings = {
            "agent:defaultprofile": "codex",
            "agent:profiles": {
                codex: {
                    cmd: "C:\\Users\\chemclin\\AppData\\Roaming\\npm\\codex.ps1",
                },
            },
        } as SettingsType;

        const blockDef = createDefaultAgentBlockDef(settings, { inheritWorkspaceContext: false });
        expect(blockDef.meta?.cmd).toBe("C:\\Users\\chemclin\\AppData\\Roaming\\npm\\codex.ps1");
        const metaRecord = blockDef.meta as Record<string, unknown>;
        expect(metaRecord["agent:provider"]).toBe("codex");
    });

    it("builds an agent block for an explicit profile without changing the default profile", () => {
        const settings = {
            "agent:defaultprofile": "codex",
            "agent:profiles": {
                claude: {
                    cmd: "claude",
                    model: "sonnet-4",
                },
            },
        } as SettingsType;

        const defaultBlockDef = createDefaultAgentBlockDef(settings, { inheritWorkspaceContext: false });
        expect(defaultBlockDef.meta?.cmd).toBe("codex");

        const claudeBlockDef = createAgentBlockDefForProfile("claude", settings, { inheritWorkspaceContext: false });
        expect(claudeBlockDef.meta?.cmd).toBe("claude");
        expect(claudeBlockDef.meta?.["cmd:args"]).toEqual(["--model", "sonnet-4"]);
        const metaRecord = claudeBlockDef.meta as Record<string, unknown>;
        expect(metaRecord["agent:provider"]).toBe("claude");
        expect(metaRecord["agent:autoresume"]).toBe(true);
        expect(metaRecord["cmd:jwt"]).toBe(true);
    });

    it("applies an explicit profile to a selected launch target", () => {
        const target = {
            blockId: "block:term",
            connection: null,
            cwd: "/Users/nita/project",
            filePath: null,
            source: "terminal",
            isLocal: true,
            label: "local",
            detail: "/Users/nita/project • block block:ter",
        } as const;

        const blockDef = createAgentBlockDefForTarget(undefined, target, "claude");
        expect(blockDef.meta?.cmd).toBe("claude");
        expect(blockDef.meta?.["cmd:cwd"]).toBe("/Users/nita/project");
        const metaRecord = blockDef.meta as Record<string, unknown>;
        expect(metaRecord["agent:provider"]).toBe("claude");
        expect(metaRecord["cmd:jwt"]).toBe(true);
    });

    it("builds a terminal block for a selected launch target", () => {
        const target = {
            blockId: "block:term",
            connection: "ssh://server-a",
            cwd: "/srv/app",
            filePath: null,
            source: "terminal",
            isLocal: false,
            label: "ssh://server-a",
            detail: "/srv/app • block block:ter",
        } as const;

        const blockDef = createTerminalBlockDefForTarget(target);
        expect(blockDef.meta).toMatchObject({
            view: "term",
            controller: "shell",
            connection: "ssh://server-a",
            "cmd:cwd": "/srv/app",
        });
    });

    it("clears inherited connection when building a local terminal target", () => {
        const target = {
            blockId: "block:term",
            connection: null,
            cwd: "/Users/nita/project",
            filePath: null,
            source: "terminal",
            isLocal: true,
            label: "local",
            detail: "/Users/nita/project • block block:ter",
        } as const;
        const baseBlockDef = {
            meta: {
                view: "term",
                controller: "shell",
                connection: "ssh://old-server",
                "cmd:cwd": "/old",
            },
        } as BlockDef;

        const blockDef = createTerminalBlockDefForTarget(target, baseBlockDef);
        expect(blockDef.meta?.connection).toBeUndefined();
        expect(blockDef.meta?.["cmd:cwd"]).toBe("/Users/nita/project");
    });

    it("builds agent and terminal blocks for the default home launch target", () => {
        const tab = makeTab([]);
        const [target] = collectAgentLaunchTargetsInTab(tab, () => null);

        const agentBlockDef = createAgentBlockDefForTarget(undefined, target);
        const terminalBlockDef = createTerminalBlockDefForTarget(target);

        expect(agentBlockDef.meta?.["cmd:cwd"]).toBe("~");
        expect(terminalBlockDef.meta?.["cmd:cwd"]).toBe("~");
        expect(terminalBlockDef.meta?.connection).toBeUndefined();
    });
});
