// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    AGENT_AUTORESUME_META_KEY,
    AGENT_PROVIDER_META_KEY,
    AGENT_SESSION_ID_META_KEY,
    buildSplitBlockDef,
    isAgentBlockMeta,
    resolveAgentProvider,
    stripAgentResumeArgs,
} from "./agent-split";

describe("isAgentBlockMeta", () => {
    it("detects agent blocks by any of the three markers", () => {
        expect(isAgentBlockMeta({ [AGENT_AUTORESUME_META_KEY]: true })).toBe(true);
        expect(isAgentBlockMeta({ [AGENT_PROVIDER_META_KEY]: "codex" })).toBe(true);
        expect(isAgentBlockMeta({ [AGENT_SESSION_ID_META_KEY]: "sess-1" })).toBe(true);
    });

    it("rejects non agent blocks", () => {
        expect(isAgentBlockMeta(undefined)).toBe(false);
        expect(isAgentBlockMeta(null)).toBe(false);
        expect(isAgentBlockMeta({})).toBe(false);
        expect(isAgentBlockMeta({ view: "term", controller: "shell" })).toBe(false);
        expect(isAgentBlockMeta({ [AGENT_PROVIDER_META_KEY]: "   " })).toBe(false);
        expect(isAgentBlockMeta({ [AGENT_AUTORESUME_META_KEY]: "true" })).toBe(false);
    });
});

describe("resolveAgentProvider", () => {
    it("prefers the agent:provider meta", () => {
        expect(resolveAgentProvider({ [AGENT_PROVIDER_META_KEY]: " Claude ", cmd: "codex" })).toBe("claude");
    });

    it("falls back to the cmd basename", () => {
        expect(resolveAgentProvider({ cmd: "codex" })).toBe("codex");
        expect(resolveAgentProvider({ cmd: "C:\\tools\\Claude.exe" })).toBe("claude");
        expect(resolveAgentProvider({ cmd: "/usr/local/bin/opencode" })).toBe("opencode");
        expect(resolveAgentProvider({ cmd: "pi.cmd" })).toBe("pi");
        expect(resolveAgentProvider({ cmd: "/opt/pi.sh" })).toBe("pi.sh");
    });

    it("returns empty when nothing identifies the provider", () => {
        expect(resolveAgentProvider({})).toBe("");
        expect(resolveAgentProvider(undefined)).toBe("");
    });
});

describe("stripAgentResumeArgs", () => {
    it("strips codex resume subcommands", () => {
        expect(stripAgentResumeArgs("codex", ["resume", "abc"])).toEqual([]);
        expect(stripAgentResumeArgs("codex", ["--model", "gpt-5", "resume", "--cd", "/tmp", "abc"])).toEqual([
            "--model",
            "gpt-5",
            "--cd",
            "/tmp",
        ]);
        expect(stripAgentResumeArgs("codex", ["--last", "--model", "gpt-5"])).toEqual(["--model", "gpt-5"]);
    });

    it("strips claude session flags", () => {
        expect(stripAgentResumeArgs("claude", ["--resume", "abc"])).toEqual([]);
        expect(stripAgentResumeArgs("claude", ["-r", "abc"])).toEqual([]);
        expect(stripAgentResumeArgs("claude", ["--session-id", "abc"])).toEqual([]);
        expect(stripAgentResumeArgs("claude", ["--resume=abc"])).toEqual([]);
        expect(stripAgentResumeArgs("claude", ["--session-id=abc"])).toEqual([]);
        expect(stripAgentResumeArgs("claude", ["--continue"])).toEqual([]);
        expect(stripAgentResumeArgs("claude", ["-c"])).toEqual([]);
        expect(stripAgentResumeArgs("claude", ["--fork-session"])).toEqual([]);
        expect(stripAgentResumeArgs("claude", ["--model", "sonnet", "--resume", "abc"])).toEqual(["--model", "sonnet"]);
    });

    it("strips opencode session flags", () => {
        expect(stripAgentResumeArgs("opencode", ["--session", "abc"])).toEqual([]);
        expect(stripAgentResumeArgs("opencode", ["--session=abc"])).toEqual([]);
        expect(stripAgentResumeArgs("opencode", ["--model", "x", "--session", "abc"])).toEqual(["--model", "x"]);
    });

    it("strips pi session flags", () => {
        expect(stripAgentResumeArgs("pi", ["--session-id", "abc"])).toEqual([]);
        expect(stripAgentResumeArgs("pi", ["--session", "abc"])).toEqual([]);
        expect(stripAgentResumeArgs("pi", ["--resume", "abc"])).toEqual([]);
        expect(stripAgentResumeArgs("pi", ["-r", "abc"])).toEqual([]);
        expect(stripAgentResumeArgs("pi", ["--fork", "abc"])).toEqual([]);
        expect(stripAgentResumeArgs("pi", ["--model", "x"])).toEqual(["--model", "x"]);
    });

    it("falls back to a conservative generic strip for unknown providers", () => {
        expect(stripAgentResumeArgs("gemini", ["--resume", "abc"])).toEqual([]);
        expect(stripAgentResumeArgs("gemini", ["-r", "abc"])).toEqual([]);
        expect(stripAgentResumeArgs("gemini", ["--session", "abc"])).toEqual([]);
        expect(stripAgentResumeArgs("gemini", ["--session-id=abc"])).toEqual([]);
        expect(stripAgentResumeArgs("gemini", ["resume", "abc"])).toEqual([]);
        expect(stripAgentResumeArgs("", ["--resume", "abc"])).toEqual([]);
        expect(stripAgentResumeArgs("gemini", ["--model", "x"])).toEqual(["--model", "x"]);
    });

    it("never mutates the input array", () => {
        const args = ["--resume", "abc", "--model", "x"];
        const copy = [...args];
        stripAgentResumeArgs("claude", args);
        expect(args).toEqual(copy);
    });
});

describe("buildSplitBlockDef", () => {
    it("leaves non agent blocks untouched", () => {
        const meta = { view: "term", controller: "shell", "cmd:cwd": "/tmp", "cmd:args": ["--foo"] };
        const blockDef: BlockDef = { meta };
        const result = buildSplitBlockDef(blockDef);
        expect(result.meta).toEqual(meta);
        expect(result.meta).not.toBe(meta);
    });

    it("leaves preview and session detail blocks untouched", () => {
        const previewDef: BlockDef = { meta: { view: "preview", file: "/tmp/x" } };
        expect(buildSplitBlockDef(previewDef).meta).toEqual({ view: "preview", file: "/tmp/x" });

        const detailDef: BlockDef = {
            meta: { view: "aisessions", "aisessions:sessionid": "sess-1" } as MetaType & Record<string, unknown>,
        };
        expect(buildSplitBlockDef(detailDef).meta).toEqual({
            view: "aisessions",
            "aisessions:sessionid": "sess-1",
        });
    });

    it("drops the session id for agent blocks and keeps the rest of the meta", () => {
        const meta = {
            view: "term",
            controller: "cmd",
            cmd: "claude",
            "cmd:args": ["--resume", "old-session", "--model", "sonnet"],
            "cmd:env": { CLAUDE_CONFIG_DIR: "/cfg" },
            "cmd:cwd": "/work",
            "cmd:jwt": true,
            "cmd:runonstart": true,
            connection: "ssh-remote",
            [AGENT_AUTORESUME_META_KEY]: true,
            [AGENT_PROVIDER_META_KEY]: "claude",
            [AGENT_SESSION_ID_META_KEY]: "old-session",
            "agent:claudevendorid": "vendor-1",
            "agent:claudevendorname": "Vendor One",
            "agent:requestedmodel": "sonnet",
        } as MetaType & Record<string, unknown>;

        const result = buildSplitBlockDef({ meta });
        const out = result.meta as MetaType & Record<string, unknown>;

        expect(out[AGENT_SESSION_ID_META_KEY]).toBeUndefined();
        expect(out[AGENT_AUTORESUME_META_KEY]).toBe(true);
        expect(out[AGENT_PROVIDER_META_KEY]).toBe("claude");
        expect(out.cmd).toBe("claude");
        expect(out["cmd:args"]).toEqual(["--model", "sonnet"]);
        expect(out["cmd:env"]).toEqual({ CLAUDE_CONFIG_DIR: "/cfg" });
        expect(out["cmd:cwd"]).toBe("/work");
        expect(out["cmd:jwt"]).toBe(true);
        expect(out["cmd:runonstart"]).toBe(true);
        expect(out.connection).toBe("ssh-remote");
        expect(out["agent:claudevendorid"]).toBe("vendor-1");
        expect(out["agent:claudevendorname"]).toBe("Vendor One");
        expect(out["agent:requestedmodel"]).toBe("sonnet");
    });

    it("removes cmd:args entirely when every argument is stripped", () => {
        const meta = {
            cmd: "codex",
            "cmd:args": ["resume", "old-session"],
            [AGENT_AUTORESUME_META_KEY]: true,
            [AGENT_PROVIDER_META_KEY]: "codex",
            [AGENT_SESSION_ID_META_KEY]: "old-session",
        } as MetaType & Record<string, unknown>;

        const out = buildSplitBlockDef({ meta }).meta as MetaType & Record<string, unknown>;
        expect("cmd:args" in out).toBe(false);
        expect(out[AGENT_SESSION_ID_META_KEY]).toBeUndefined();
        expect(out[AGENT_PROVIDER_META_KEY]).toBe("codex");
    });

    it("treats a block with only agent:sessionid as an agent block", () => {
        const meta = {
            cmd: "pi",
            "cmd:args": ["--session-id", "old-session"],
            [AGENT_SESSION_ID_META_KEY]: "old-session",
        } as MetaType & Record<string, unknown>;

        const out = buildSplitBlockDef({ meta }).meta as MetaType & Record<string, unknown>;
        expect(out[AGENT_SESSION_ID_META_KEY]).toBeUndefined();
        expect(out["cmd:args"]).toBeUndefined();
    });

    it("resolves the provider from cmd when agent:provider is missing", () => {
        const meta = {
            cmd: "opencode",
            "cmd:args": ["--session", "old-session"],
            [AGENT_AUTORESUME_META_KEY]: true,
        } as MetaType & Record<string, unknown>;

        const out = buildSplitBlockDef({ meta }).meta as MetaType & Record<string, unknown>;
        expect(out["cmd:args"]).toBeUndefined();
        expect(out[AGENT_AUTORESUME_META_KEY]).toBe(true);
    });

    it("does not mutate the source blockDef, meta or args array", () => {
        const args = ["--resume", "old-session"];
        const meta = {
            cmd: "claude",
            "cmd:args": args,
            [AGENT_AUTORESUME_META_KEY]: true,
            [AGENT_SESSION_ID_META_KEY]: "old-session",
        } as MetaType & Record<string, unknown>;
        const blockDef: BlockDef = { meta };

        buildSplitBlockDef(blockDef);

        expect(meta[AGENT_SESSION_ID_META_KEY]).toBe("old-session");
        expect(meta["cmd:args"]).toBe(args);
        expect(args).toEqual(["--resume", "old-session"]);
        expect(blockDef.meta).toBe(meta);
    });
});
