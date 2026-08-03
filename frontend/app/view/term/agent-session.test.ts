import { describe, expect, it } from "vitest";

import {
    extractAgentCommandFromTerminalText,
    resolveAgentCommandBinding,
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

    it("parses codex resume commands from Windows shim executables", () => {
        expect(resolveAgentSessionIdFromMeta({ cmd: "codex.ps1 resume codex-ps1-session" })).toBe(
            "codex-ps1-session"
        );
        expect(resolveAgentSessionIdFromMeta({ cmd: "codex.cmd resume codex-cmd-session" })).toBe(
            "codex-cmd-session"
        );
        expect(
            resolveAgentSessionIdFromMeta({
                cmd: "C:\\Users\\chemclin\\AppData\\Roaming\\npm\\codex.ps1 resume codex-path-session",
            })
        ).toBe("codex-path-session");
    });

    it("parses codex resume commands from cmd args", () => {
        expect(resolveAgentSessionIdFromMeta({ cmd: "codex", "cmd:args": ["resume", "codex-args-session"] })).toBe(
            "codex-args-session"
        );
    });

    it("parses codex resume session ids around options", () => {
        expect(resolveAgentSessionIdFromMeta({ cmd: "codex --model gpt-5 resume codex-after-global-option" })).toBe(
            "codex-after-global-option"
        );
        expect(resolveAgentSessionIdFromMeta({ cmd: "codex resume --model gpt-5 codex-after-resume-option" })).toBe(
            "codex-after-resume-option"
        );
        expect(
            resolveAgentSessionIdFromMeta({
                cmd: "codex",
                "cmd:args": ["--model", "gpt-5", "resume", "--cd", "/tmp/project", "codex-args-option-session"],
            })
        ).toBe("codex-args-option-session");
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

    it("parses opencode resume commands from cmd text and args", () => {
        expect(resolveAgentSessionIdFromMeta({ cmd: "opencode resume opencode-session" })).toBe("opencode-session");
        expect(
            resolveAgentSessionIdFromMeta({ cmd: "opencode", "cmd:args": ["resume", "opencode-args-session"] })
        ).toBe("opencode-args-session");
    });

    it("parses pi resume commands from cmd text and args", () => {
        expect(resolveAgentSessionIdFromMeta({ cmd: "pi resume pi-session" })).toBe("pi-session");
        expect(resolveAgentSessionIdFromMeta({ cmd: "pi", "cmd:args": ["resume", "pi-args-session"] })).toBe(
            "pi-args-session"
        );
    });

    it("parses opencode and pi resume commands from Windows shim executables", () => {
        expect(resolveAgentSessionIdFromMeta({ cmd: "opencode.ps1 resume opencode-ps1-session" })).toBe(
            "opencode-ps1-session"
        );
        expect(resolveAgentSessionIdFromMeta({ cmd: "opencode.cmd resume opencode-cmd-session" })).toBe(
            "opencode-cmd-session"
        );
        expect(resolveAgentSessionIdFromMeta({ cmd: "pi.exe resume pi-exe-session" })).toBe("pi-exe-session");
    });

    it("parses opencode and pi resume session ids around options", () => {
        expect(resolveAgentSessionIdFromMeta({ cmd: "opencode --model gpt-5 resume opencode-after-global-option" })).toBe(
            "opencode-after-global-option"
        );
        expect(resolveAgentSessionIdFromMeta({ cmd: "opencode resume --model gpt-5 opencode-after-resume-option" })).toBe(
            "opencode-after-resume-option"
        );
        expect(resolveAgentSessionIdFromMeta({ cmd: "pi --model gpt-5 resume pi-after-global-option" })).toBe(
            "pi-after-global-option"
        );
        expect(resolveAgentSessionIdFromMeta({ cmd: "pi resume --model gpt-5 pi-after-resume-option" })).toBe(
            "pi-after-resume-option"
        );
    });

    it("parses agent resume commands wrapped with env assignments", () => {
        expect(resolveAgentSessionIdFromMeta({ cmd: "env CODEX_HOME=/tmp/codex codex resume env-codex" })).toBe(
            "env-codex"
        );
        expect(resolveAgentSessionIdFromMeta({ cmd: 'ANTHROPIC_API_KEY="test" claude -r env-claude' })).toBe(
            "env-claude"
        );
        expect(
            resolveAgentSessionIdFromMeta({ cmd: "OPENCODE_HOME=/tmp/oc opencode resume env-opencode" })
        ).toBe("env-opencode");
        expect(resolveAgentSessionIdFromMeta({ cmd: 'PI_CODING_AGENT_SESSION_DIR="/tmp/pi" pi resume env-pi' })).toBe(
            "env-pi"
        );
    });

    it("returns an empty string when no agent session id is available", () => {
        expect(resolveAgentSessionIdFromMeta({ cmd: "codex" })).toBe("");
        expect(resolveAgentSessionIdFromMeta({ cmd: "claude --model sonnet" })).toBe("");
        expect(resolveAgentSessionIdFromMeta({ cmd: "opencode" })).toBe("");
        expect(resolveAgentSessionIdFromMeta({ cmd: "pi" })).toBe("");
        expect(resolveAgentSessionIdFromMeta({ cmd: "echo opencode resume nope" })).toBe("");
        expect(resolveAgentSessionIdFromMeta({ cmd: "codex resume --last" })).toBe("");
        expect(resolveAgentSessionIdFromMeta({ cmd: "opencode resume --last" })).toBe("");
        expect(resolveAgentSessionIdFromMeta({ cmd: "pi resume --last" })).toBe("");
    });
});

describe("resolveAgentSessionIdFromCommand", () => {
    it("parses agent resume ids from shell command text", () => {
        expect(resolveAgentSessionIdFromCommand("codex resume shell-codex")).toBe("shell-codex");
        expect(resolveAgentSessionIdFromCommand("codex --model gpt-5 resume shell-codex-global-option")).toBe(
            "shell-codex-global-option"
        );
        expect(resolveAgentSessionIdFromCommand("codex resume --model gpt-5 shell-codex-resume-option")).toBe(
            "shell-codex-resume-option"
        );
        expect(resolveAgentSessionIdFromCommand("claude --resume shell-claude")).toBe("shell-claude");
        expect(resolveAgentSessionIdFromCommand("claude -r shell-claude-short")).toBe("shell-claude-short");
        expect(resolveAgentSessionIdFromCommand("claude --session-id shell-claude-session")).toBe(
            "shell-claude-session"
        );
        expect(resolveAgentSessionIdFromCommand("opencode resume shell-opencode")).toBe("shell-opencode");
        expect(resolveAgentSessionIdFromCommand("opencode --model gpt-5 resume shell-opencode-global-option")).toBe(
            "shell-opencode-global-option"
        );
        expect(resolveAgentSessionIdFromCommand("opencode resume --model gpt-5 shell-opencode-resume-option")).toBe(
            "shell-opencode-resume-option"
        );
        expect(resolveAgentSessionIdFromCommand("pi resume shell-pi")).toBe("shell-pi");
        expect(resolveAgentSessionIdFromCommand("pi --model gpt-5 resume shell-pi-global-option")).toBe(
            "shell-pi-global-option"
        );
        expect(resolveAgentSessionIdFromCommand("pi resume --model gpt-5 shell-pi-resume-option")).toBe(
            "shell-pi-resume-option"
        );
    });

    it("parses agent resume ids from shell command segments", () => {
        expect(resolveAgentSessionIdFromCommand("cd /tmp && codex resume shell-segment-codex")).toBe(
            "shell-segment-codex"
        );
        expect(resolveAgentSessionIdFromCommand("export FOO=bar; claude --resume=shell-segment-claude")).toBe(
            "shell-segment-claude"
        );
        expect(resolveAgentSessionIdFromCommand("cd /tmp && opencode resume shell-segment-opencode")).toBe(
            "shell-segment-opencode"
        );
        expect(resolveAgentSessionIdFromCommand("export FOO=bar; pi resume shell-segment-pi")).toBe(
            "shell-segment-pi"
        );
    });

    it("parses env-wrapped shell commands", () => {
        expect(resolveAgentSessionIdFromCommand("env CODEX_HOME=/tmp/codex codex resume env-shell-codex")).toBe(
            "env-shell-codex"
        );
        expect(resolveAgentSessionIdFromCommand('ANTHROPIC_API_KEY="test" claude -r env-shell-claude')).toBe(
            "env-shell-claude"
        );
        expect(resolveAgentSessionIdFromCommand("OPENCODE_HOME=/tmp/oc opencode resume env-shell-opencode")).toBe(
            "env-shell-opencode"
        );
        expect(resolveAgentSessionIdFromCommand('PI_CODING_AGENT_SESSION_DIR="/tmp/pi" pi resume env-shell-pi')).toBe(
            "env-shell-pi"
        );
    });

    it("does not parse commands that only mention resume syntax as arguments", () => {
        expect(resolveAgentSessionIdFromCommand("echo codex resume nope")).toBe("");
        expect(resolveAgentSessionIdFromCommand("printf 'claude --resume nope'")).toBe("");
        expect(resolveAgentSessionIdFromCommand("codex resume --last")).toBe("");
        expect(resolveAgentSessionIdFromCommand("claude --resume --model sonnet")).toBe("");
        expect(resolveAgentSessionIdFromCommand("echo opencode resume nope")).toBe("");
        expect(resolveAgentSessionIdFromCommand("printf 'pi resume nope'")).toBe("");
        expect(resolveAgentSessionIdFromCommand("opencode resume --last")).toBe("");
        expect(resolveAgentSessionIdFromCommand("pi resume --last")).toBe("");
    });
});

describe("resolveAgentCommandBinding", () => {
    it("binds resume commands with session ids", () => {
        expect(resolveAgentCommandBinding("codex resume codex-session")).toEqual({
            provider: "codex",
            sessionId: "codex-session",
        });
        expect(resolveAgentCommandBinding("codex.ps1 resume codex-ps1-session")).toEqual({
            provider: "codex",
            sessionId: "codex-ps1-session",
        });
        expect(resolveAgentCommandBinding("codex.cmd resume codex-cmd-session")).toEqual({
            provider: "codex",
            sessionId: "codex-cmd-session",
        });
        expect(resolveAgentCommandBinding("codex resume --model gpt-5 codex-option-session")).toEqual({
            provider: "codex",
            sessionId: "codex-option-session",
        });
        expect(resolveAgentCommandBinding("claude --session-id claude-session")).toEqual({
            provider: "claude",
            sessionId: "claude-session",
        });
        expect(resolveAgentCommandBinding("opencode resume opencode-session")).toEqual({
            provider: "opencode",
            sessionId: "opencode-session",
        });
        expect(resolveAgentCommandBinding("opencode resume --model gpt-5 opencode-option-session")).toEqual({
            provider: "opencode",
            sessionId: "opencode-option-session",
        });
        expect(resolveAgentCommandBinding("pi resume pi-session")).toEqual({
            provider: "pi",
            sessionId: "pi-session",
        });
        expect(resolveAgentCommandBinding("pi resume --model gpt-5 pi-option-session")).toEqual({
            provider: "pi",
            sessionId: "pi-option-session",
        });
    });

    it("binds new agent commands without session ids", () => {
        expect(resolveAgentCommandBinding("codex")).toEqual({
            provider: "codex",
            sessionId: "",
        });
        expect(resolveAgentCommandBinding("claude --model sonnet")).toEqual({
            provider: "claude",
            sessionId: "",
        });
        expect(resolveAgentCommandBinding("opencode")).toEqual({
            provider: "opencode",
            sessionId: "",
        });
        expect(resolveAgentCommandBinding("pi")).toEqual({
            provider: "pi",
            sessionId: "",
        });
        expect(resolveAgentCommandBinding("cd repo && codex")).toEqual({
            provider: "codex",
            sessionId: "",
        });
    });

    it("ignores non-agent commands", () => {
        expect(resolveAgentCommandBinding("echo codex")).toBeNull();
    });
});

describe("extractAgentCommandFromTerminalText", () => {
    it("finds agent resume commands in terminal scrollback prompts", () => {
        expect(
            extractAgentCommandFromTerminalText(
                [
                    "Microsoft Windows [Version 10.0.22631.0000]",
                    "PS E:\\File\\NitaFile\\Obsidians\\Obsidian> codex resume session-from-pwsh",
                    "Welcome to Codex",
                ].join("\n")
            )
        ).toBe("codex resume session-from-pwsh");
        expect(
            extractAgentCommandFromTerminalText(
                [
                    "Microsoft Windows [Version 10.0.22631.0000]",
                    "PS E:\\code\\snorkeling> codex.ps1 resume session-from-pwsh-shim",
                    "Welcome to Codex",
                ].join("\n")
            )
        ).toBe("codex.ps1 resume session-from-pwsh-shim");
        expect(
            extractAgentCommandFromTerminalText(
                [
                    "nita@host ~/repo",
                    "$ env CODEX_HOME=/tmp/codex codex resume session-from-posix",
                    "Welcome to Codex",
                ].join("\n")
            )
        ).toBe("env CODEX_HOME=/tmp/codex codex resume session-from-posix");
    });

    it("ignores terminal lines that only mention resume syntax as output", () => {
        expect(extractAgentCommandFromTerminalText("echo codex resume nope\ncodex resume --last")).toBe("");
    });
});

describe("resolveAgentSessionId", () => {
    it("marks resume commands as agent sessions without persisted agent metadata", () => {
        expect(resolveAgentSessionId({ cmd: "codex resume codex-session" })).toMatchObject({
            isAgent: true,
            provider: "codex",
            sessionId: "codex-session",
        });
        expect(resolveAgentSessionId({ cmd: "claude", "cmd:args": ["--resume", "claude-session"] })).toMatchObject({
            isAgent: true,
            provider: "claude",
            sessionId: "claude-session",
        });
        expect(resolveAgentSessionId({ cmd: "opencode resume opencode-session" })).toMatchObject({
            isAgent: true,
            provider: "opencode",
            sessionId: "opencode-session",
        });
        expect(resolveAgentSessionId({ cmd: "pi resume pi-session" })).toMatchObject({
            isAgent: true,
            provider: "pi",
            sessionId: "pi-session",
        });
    });

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
