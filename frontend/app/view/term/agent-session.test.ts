import { describe, expect, it } from "vitest";

import {
    resolveAgentSessionId,
    resolveAgentSessionIdFromCommand,
    resolveAgentSessionIdFromMeta,
} from "./agent-session";

describe("resolveAgentSessionIdFromMeta", () => {
    it("prefers persisted agent session ids", () => {
        expect(
            resolveAgentSessionIdFromMeta({
                "agent:sessionid": " persisted-session ",
                cmd: "codex resume command-session",
            })
        ).toBe("persisted-session");
    });

    it("parses codex resume commands from cmd text", () => {
        expect(resolveAgentSessionIdFromMeta({ cmd: "codex resume codex-session" })).toBe("codex-session");
    });

    it("parses codex resume commands from cmd args", () => {
        expect(resolveAgentSessionIdFromMeta({ cmd: "codex", "cmd:args": ["resume", "codex-args-session"] })).toBe(
            "codex-args-session"
        );
    });

    it("parses claude resume flags from cmd args", () => {
        expect(resolveAgentSessionIdFromMeta({ cmd: "claude", "cmd:args": ["--resume", "claude-session"] })).toBe(
            "claude-session"
        );
        expect(resolveAgentSessionIdFromMeta({ cmd: "claude", "cmd:args": ["-r", "claude-short-session"] })).toBe(
            "claude-short-session"
        );
    });

    it("parses claude resume and session-id equals flags", () => {
        expect(resolveAgentSessionIdFromMeta({ cmd: "claude --resume=claude-resume-eq" })).toBe("claude-resume-eq");
        expect(resolveAgentSessionIdFromMeta({ cmd: "claude --session-id=claude-session-eq" })).toBe(
            "claude-session-eq"
        );
    });

    it("parses agent resume commands wrapped with env assignments", () => {
        expect(resolveAgentSessionIdFromMeta({ cmd: "env CODEX_HOME=/tmp/codex codex resume env-codex" })).toBe(
            "env-codex"
        );
        expect(resolveAgentSessionIdFromMeta({ cmd: 'ANTHROPIC_API_KEY="test" claude -r env-claude' })).toBe(
            "env-claude"
        );
    });

    it("returns an empty string when no agent session id is available", () => {
        expect(resolveAgentSessionIdFromMeta({ cmd: "codex" })).toBe("");
        expect(resolveAgentSessionIdFromMeta({ cmd: "claude --model sonnet" })).toBe("");
        expect(resolveAgentSessionIdFromMeta({ cmd: "echo codex resume nope" })).toBe("");
    });
});

describe("resolveAgentSessionIdFromCommand", () => {
    it("parses agent resume ids from shell command text", () => {
        expect(resolveAgentSessionIdFromCommand("codex resume shell-codex")).toBe("shell-codex");
        expect(resolveAgentSessionIdFromCommand("claude --resume shell-claude")).toBe("shell-claude");
        expect(resolveAgentSessionIdFromCommand("claude -r shell-claude-short")).toBe("shell-claude-short");
        expect(resolveAgentSessionIdFromCommand("claude --session-id shell-claude-session")).toBe(
            "shell-claude-session"
        );
    });

    it("parses agent resume ids from shell command segments", () => {
        expect(resolveAgentSessionIdFromCommand("cd /tmp && codex resume shell-segment-codex")).toBe(
            "shell-segment-codex"
        );
        expect(resolveAgentSessionIdFromCommand("export FOO=bar; claude --resume=shell-segment-claude")).toBe(
            "shell-segment-claude"
        );
    });

    it("parses env-wrapped shell commands", () => {
        expect(resolveAgentSessionIdFromCommand("env CODEX_HOME=/tmp/codex codex resume env-shell-codex")).toBe(
            "env-shell-codex"
        );
        expect(resolveAgentSessionIdFromCommand('ANTHROPIC_API_KEY="test" claude -r env-shell-claude')).toBe(
            "env-shell-claude"
        );
    });

    it("does not parse commands that only mention resume syntax as arguments", () => {
        expect(resolveAgentSessionIdFromCommand("echo codex resume nope")).toBe("");
        expect(resolveAgentSessionIdFromCommand("printf 'claude --resume nope'")).toBe("");
        expect(resolveAgentSessionIdFromCommand("codex resume --last")).toBe("");
        expect(resolveAgentSessionIdFromCommand("claude --resume --model sonnet")).toBe("");
    });
});

describe("resolveAgentSessionId", () => {
    it("prefers persisted ids, then startup commands, then shell last commands", () => {
        expect(
            resolveAgentSessionId({ "agent:sessionid": "persisted", cmd: "codex resume startup" }, "codex resume shell")
        ).toMatchObject({
            sessionId: "persisted",
            source: "agent:sessionid",
        });
        expect(resolveAgentSessionId({ cmd: "codex resume startup" }, "codex resume shell")).toMatchObject({
            sessionId: "startup",
            source: "cmd",
        });
        expect(resolveAgentSessionId({ cmd: "zsh" }, "claude --resume shell")).toMatchObject({
            sessionId: "shell",
            source: "shell:lastcmd",
        });
    });

    it("returns debug details for misses", () => {
        expect(resolveAgentSessionId({ cmd: "zsh" }, "echo codex resume nope")).toMatchObject({
            sessionId: "",
            source: "none",
            startupCommand: {
                executable: "zsh",
                reason: "unsupported-executable",
            },
            shellLastCommand: {
                executable: "echo",
                reason: "unsupported-executable",
            },
        });
    });

    it("distinguishes new codex sessions waiting for persisted ids from missing resume commands", () => {
        expect(
            resolveAgentSessionId({ cmd: "codex", "agent:autoresume": true, "agent:provider": "codex" })
        ).toMatchObject({
            sessionId: "",
            source: "none",
            provider: "codex",
            reason: "new-codex-session-unbound",
            startupCommand: {
                executable: "codex",
                reason: "missing-codex-resume",
            },
        });
    });
});
