// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    collectFolderCandidates,
    cwdEqual,
    defaultSendFolder,
    extractAgentBlockInfo,
    normalizeCwd,
    resolveSendTarget,
    type AgentBlockInfo,
} from "./commontext-send-target";

function makeBlock(meta: Record<string, unknown>, oid = "b1"): { oid: string; meta: Record<string, unknown> } {
    return { oid, meta };
}

const focusedClaude: AgentBlockInfo = {
    blockId: "b1",
    provider: "claude",
    model: "opus-4.6",
    cwd: "~/Primary/projects/snorkeling",
    connection: null,
    title: null,
};

describe("extractAgentBlockInfo", () => {
    it("accepts a term block with agent:provider", () => {
        const info = extractAgentBlockInfo(makeBlock({ view: "term", "agent:provider": "claude", "cmd:cwd": "/a/b" }));
        expect(info).not.toBeNull();
        expect(info!.provider).toBe("claude");
        expect(info!.cwd).toBe("/a/b");
        expect(info!.blockId).toBe("b1");
    });

    it("accepts a term block with agent:sessionid or autoresume only", () => {
        expect(extractAgentBlockInfo(makeBlock({ view: "term", "agent:sessionid": "s1" }))).not.toBeNull();
        expect(extractAgentBlockInfo(makeBlock({ view: "term", "agent:autoresume": true }))).not.toBeNull();
    });

    it("rejects plain terminals and GUI agent view blocks", () => {
        expect(extractAgentBlockInfo(makeBlock({ view: "term" }))).toBeNull();
        expect(extractAgentBlockInfo(makeBlock({ view: "agent", "agent:provider": "pi" }))).toBeNull();
        expect(extractAgentBlockInfo(makeBlock({}))).toBeNull();
        expect(extractAgentBlockInfo(null)).toBeNull();
    });

    it("falls back to cmd basename as provider when agent:provider is missing", () => {
        const info = extractAgentBlockInfo(
            makeBlock({ view: "term", "agent:autoresume": true, cmd: "/usr/local/bin/Claude.EXE" })
        );
        expect(info!.provider).toBe("claude");
    });

    it("reads model/connection/title fields", () => {
        const info = extractAgentBlockInfo(
            makeBlock({
                view: "term",
                "agent:provider": "codex",
                "agent:requestedmodel": "gpt-5.1",
                connection: "ssh://host",
                "frame:title": "My Codex",
                "cmd:cwd": "/x",
            })
        );
        expect(info!.model).toBe("gpt-5.1");
        expect(info!.connection).toBe("ssh://host");
        expect(info!.title).toBe("My Codex");
    });
});

describe("normalizeCwd / cwdEqual", () => {
    it("expands ~ with the given home dir", () => {
        expect(normalizeCwd("~", "/Users/nita")).toBe("/Users/nita");
        expect(normalizeCwd("~/x/y", "/Users/nita")).toBe("/Users/nita/x/y");
        expect(normalizeCwd("~\\x", "/Users/nita")).toBe("/Users/nita/x");
    });

    it("keeps absolute paths, normalizes backslashes and trailing slashes", () => {
        expect(normalizeCwd("/a/b\\c")).toBe("/a/b/c");
        expect(normalizeCwd("  /a/b  ")).toBe("/a/b");
        expect(normalizeCwd("/a/b/")).toBe("/a/b");
        expect(normalizeCwd(null)).toBe("");
        expect(normalizeCwd("~", "/Users/nita/")).toBe("/Users/nita");
    });

    it("cwdEqual ignores trailing slashes and tilde spelling", () => {
        expect(cwdEqual("~/p/", "/Users/nita/p", "/Users/nita")).toBe(true);
        expect(cwdEqual("/a/b/", "/a/b")).toBe(true);
        expect(cwdEqual("/a/b", "/a/c")).toBe(false);
        expect(cwdEqual("", "/a")).toBe(false);
    });
});

describe("resolveSendTarget", () => {
    const currentSel = { agentProfile: "claude", tab: { kind: "current" as const }, folder: "" };

    it("resolves to existing when profile, tab and folder all match the focused block", () => {
        const r = resolveSendTarget(currentSel, focusedClaude, { profileLabel: "Claude Code" });
        expect(r.kind).toBe("existing");
        expect(r.kind === "existing" && r.block.blockId).toBe("b1");
    });

    // 2026-11-11：面板「新建 Agent Block」显式选项 → forceCreate。
    // 场景：聚焦块与所选 agent 同款（三项全等），旧逻辑只能落 existing，用户无法切到「新建」。
    it("forceCreate wins over a perfect three-way match (explicit 新建 mode)", () => {
        const r = resolveSendTarget({ ...currentSel, forceCreate: true }, focusedClaude, {
            profileLabel: "Claude Code",
        });
        expect(r.kind).toBe("create");
        expect(r.kind === "create" && r.cwd).toBe(focusedClaude.cwd);
        expect(r.kind === "create" && r.label).toContain("新建 Claude Code");
    });

    it("forceCreate=false keeps the existing judgement", () => {
        const r = resolveSendTarget({ ...currentSel, forceCreate: false }, focusedClaude, {
            profileLabel: "Claude Code",
        });
        expect(r.kind).toBe("existing");
    });

    it("resolves to create when the focused block is not an agent block", () => {
        expect(resolveSendTarget(currentSel, null).kind).toBe("create");
    });

    it("resolves to create when profile differs", () => {
        const r = resolveSendTarget({ ...currentSel, agentProfile: "codex" }, focusedClaude);
        expect(r.kind).toBe("create");
        expect(r.kind === "create" && r.cwd).toBe(focusedClaude.cwd);
    });

    it("resolves to create when tab is not current", () => {
        const r = resolveSendTarget(
            { ...currentSel, tab: { kind: "existing", tabId: "t2", tabName: "files" } },
            focusedClaude
        );
        expect(r.kind).toBe("create");
        expect(r.kind === "create" && r.label).toContain("files");
    });

    it("resolves to create when folder differs from the focused cwd", () => {
        const r = resolveSendTarget({ ...currentSel, folder: "~/Primary/projects/loop" }, focusedClaude, {
            homeDir: "/Users/nita",
        });
        expect(r.kind).toBe("create");
        expect(r.kind === "create" && r.cwd).toBe("~/Primary/projects/loop");
    });

    it("create with new tab and explicit cwd carries both in the label", () => {
        const r = resolveSendTarget(
            {
                agentProfile: "pi",
                tab: { kind: "new" },
                folder: "/Users/nita/x",
            },
            null,
            { profileLabel: "Pi" }
        );
        expect(r.kind).toBe("create");
        expect(r.kind === "create" && r.label).toBe("新建 Pi · 新 Tab · /Users/nita/x");
    });

    it("uses provider override when provided (anthropic≈claude alias)", () => {
        const r = resolveSendTarget(
            { agentProfile: "claude", provider: "Claude", tab: { kind: "current" }, folder: "" },
            focusedClaude
        );
        expect(r.kind).toBe("existing");
    });
});

describe("collectFolderCandidates / defaultSendFolder", () => {
    it("dedupes and orders focused cwd first", () => {
        const out = collectFolderCandidates({
            focusedAgent: focusedClaude,
            blocks: [
                {
                    blockId: "b2",
                    info: { ...focusedClaude, blockId: "b2", cwd: "~/Primary/projects/snorkeling/" },
                },
                { blockId: "b3", info: { ...focusedClaude, blockId: "b3", cwd: "~/Primary/projects/loop" } },
            ],
            workspaceCwd: "/Users/nita/Primary/projects/snorkeling",
            homeDir: "/Users/nita",
        });
        expect(out.map((c) => c.note)).toEqual(["聚焦块目录", "项目", "主目录"]);
        expect(out[0].path).toBe("/Users/nita/Primary/projects/snorkeling");
    });

    it("falls back to workspace cwd without a focused agent", () => {
        const out = collectFolderCandidates({
            focusedAgent: null,
            blocks: [],
            workspaceCwd: "/Users/nita/Primary",
            homeDir: "/Users/nita",
        });
        expect(out.map((c) => c.path)).toEqual(["/Users/nita/Primary", "/Users/nita"]);
        expect(defaultSendFolder(null, "/Users/nita/Primary")).toBe("/Users/nita/Primary");
        expect(defaultSendFolder(focusedClaude, "/ws")).toBe("~/Primary/projects/snorkeling");
    });
});
