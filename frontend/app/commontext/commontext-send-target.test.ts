// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { i18n, initI18n } from "@/i18n/config";
import { beforeAll, describe, expect, it } from "vitest";
import {
    collectFolderCandidates,
    collectFolderCandidatesForTab,
    cwdEqual,
    defaultSendFolder,
    extractAgentBlockInfo,
    normalizeCwd,
    planSendActivation,
    resolveFolderScopeTabId,
    resolveSendTarget,
    type AgentBlockInfo,
} from "./commontext-send-target";

// i18n 资源为 en 真源：迁移后 label / note 由 i18n.t 产出，先把实例初始化到 en（Pattern I）。
beforeAll(async () => {
    await initI18n("en");
});

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
        expect(r.kind === "create" && r.label).toContain(
            i18n.t("commontext:send.createLabel", { label: "Claude Code", tab: "" }).trim()
        );
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
        expect(r.kind === "create" && r.label).toBe(
            `${i18n.t("commontext:send.createLabel", {
                label: "Pi",
                tab: i18n.t("commontext:send.tabNewTab"),
            })} · /Users/nita/x`
        );
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
        expect(out.map((c) => c.note)).toEqual([
            i18n.t("commontext:send.noteFocusedBlock"),
            i18n.t("commontext:send.noteProject"),
            i18n.t("commontext:send.noteHome"),
        ]);
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

describe("resolveFolderScopeTabId", () => {
    it("current → 当前 Tab id", () => {
        expect(resolveFolderScopeTabId({ kind: "current" }, "tab-1")).toBe("tab-1");
    });

    it("current with blank/absent current tab → null（无块候选）", () => {
        expect(resolveFolderScopeTabId({ kind: "current" }, null)).toBeNull();
        expect(resolveFolderScopeTabId({ kind: "current" }, "   ")).toBeNull();
        expect(resolveFolderScopeTabId({ kind: "current" }, undefined)).toBeNull();
    });

    it("existing → 该 tabId；空 tabId → null", () => {
        expect(resolveFolderScopeTabId({ kind: "existing", tabId: "tab-2" }, "tab-1")).toBe("tab-2");
        expect(resolveFolderScopeTabId({ kind: "existing", tabId: " " }, "tab-1")).toBeNull();
    });

    it("new → null（不读任何块）", () => {
        expect(resolveFolderScopeTabId({ kind: "new" }, "tab-1")).toBeNull();
    });
});

describe("collectFolderCandidatesForTab", () => {
    it("keeps tab block order, then workspace, then home; dedupes by normalized cwd", () => {
        const out = collectFolderCandidatesForTab({
            cwds: [
                { cwd: "~/Primary/projects/snorkeling", source: "agent" },
                { cwd: "~/Primary/projects/snorkeling/", source: "terminal" },
                { cwd: "~/Primary/projects/loop", source: "files" },
                { cwd: "", source: "terminal" },
            ],
            workspaceCwd: "/Users/nita/Primary",
            homeDir: "/Users/nita",
        });
        expect(out.map((c) => c.path)).toEqual([
            "/Users/nita/Primary/projects/snorkeling",
            "/Users/nita/Primary/projects/loop",
            "/Users/nita/Primary",
            "/Users/nita",
        ]);
        expect(out.map((c) => c.note)).toEqual([
            i18n.t("commontext:send.noteTabAgent"),
            i18n.t("commontext:send.noteTabFiles"),
            i18n.t("commontext:send.noteWorkspace"),
            i18n.t("commontext:send.noteHome"),
        ]);
    });

    it("new tab (no block cwds) → only workspace + home", () => {
        const out = collectFolderCandidatesForTab({
            cwds: [],
            workspaceCwd: "/Users/nita/Primary",
            homeDir: "/Users/nita",
        });
        expect(out.map((c) => c.path)).toEqual(["/Users/nita/Primary", "/Users/nita"]);
    });

    it("ignores blanks and tolerates home-only input", () => {
        const out = collectFolderCandidatesForTab({ cwds: [{ cwd: null, source: "agent" }], homeDir: "/Users/nita" });
        expect(out.map((c) => c.path)).toEqual(["/Users/nita"]);
    });
});

describe("resolveSendTarget + folderDefault（目录随 Tab）", () => {
    it("create 路径用 folderDefault 作为 cwd（folder 未显式选择）", () => {
        const r = resolveSendTarget(
            {
                agentProfile: "codex",
                tab: { kind: "existing", tabId: "tab-2" },
                folder: "",
                folderDefault: "~/Primary/projects/loop",
            },
            focusedClaude
        );
        expect(r.kind).toBe("create");
        expect(r.kind === "create" && r.cwd).toBe("~/Primary/projects/loop");
    });

    it("folderDefault 不影响 existing 判定（current + 未显式选目录仍注入聚焦块）", () => {
        const r = resolveSendTarget(
            {
                agentProfile: "claude",
                provider: "claude",
                tab: { kind: "current" },
                folder: "",
                folderDefault: "~/Primary/projects/loop",
            },
            focusedClaude
        );
        expect(r.kind).toBe("existing");
    });

    it("显式 folder 优先于 folderDefault", () => {
        const r = resolveSendTarget(
            {
                agentProfile: "claude",
                tab: { kind: "new" },
                folder: "~/Primary/projects/loop",
                folderDefault: "~/Primary",
            },
            focusedClaude
        );
        expect(r.kind).toBe("create");
        expect(r.kind === "create" && r.cwd).toBe("~/Primary/projects/loop");
    });
});

describe("planSendActivation", () => {
    it("background: never activates the target tab (backend or frontend)", () => {
        expect(planSendActivation(true)).toEqual({ backendActivateExisting: false, frontActivateTab: false });
    });

    it("foreground: keeps the legacy double activation", () => {
        expect(planSendActivation(false)).toEqual({ backendActivateExisting: true, frontActivateTab: true });
    });
});
