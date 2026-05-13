// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

type TermCommandMeta = Record<string, unknown>;

type AgentSessionIdSource = "agent:sessionid" | "cmd" | "shell:lastcmd" | "none";
type AgentSessionProvider = "codex" | "claude" | "";

type AgentCommandResolution = {
    sessionId: string;
    provider: AgentSessionProvider;
    executable: string;
    reason: string;
    tokenCount: number;
    segmentCount: number;
};

type AgentSessionIdResolution = {
    sessionId: string;
    source: AgentSessionIdSource;
    provider: AgentSessionProvider;
    reason: string;
    startupCommand: AgentCommandResolution;
    shellLastCommand: AgentCommandResolution;
};

function stringValue(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function stringListValue(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item): item is string => typeof item === "string");
}

function splitCommandText(commandText: string): string[] {
    const tokens = commandText.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
    return tokens.map((token) => {
        if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
            return token.slice(1, -1);
        }
        return token;
    });
}

function splitCommandSegments(commandText: string): string[] {
    const segments: string[] = [];
    let current = "";
    let quote: "'" | '"' | null = null;
    let escaped = false;

    for (let idx = 0; idx < commandText.length; idx++) {
        const char = commandText[idx];
        if (escaped) {
            current += char;
            escaped = false;
            continue;
        }
        if (char === "\\" && quote !== "'") {
            current += char;
            escaped = true;
            continue;
        }
        if (quote != null) {
            current += char;
            if (char === quote) {
                quote = null;
            }
            continue;
        }
        if (char === "'" || char === '"') {
            current += char;
            quote = char;
            continue;
        }
        if (char === "\n" || char === ";" || char === "|" || char === "&") {
            const segment = current.trim();
            if (segment !== "") {
                segments.push(segment);
            }
            current = "";
            if ((char === "|" || char === "&") && commandText[idx + 1] === char) {
                idx++;
            }
            continue;
        }
        current += char;
    }

    const segment = current.trim();
    if (segment !== "") {
        segments.push(segment);
    }
    return segments;
}

function commandBaseName(command: string): string {
    const normalized = command.replace(/\\/g, "/");
    const slashIdx = normalized.lastIndexOf("/");
    const baseName = slashIdx === -1 ? normalized : normalized.slice(slashIdx + 1);
    return baseName.toLowerCase().replace(/\.exe$/, "");
}

function isEnvAssignment(token: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function executableTokenIndex(tokens: string[]): number {
    let idx = 0;
    if (tokens[idx] === "env") {
        idx++;
    }
    while (idx < tokens.length && isEnvAssignment(tokens[idx])) {
        idx++;
    }
    return idx;
}

function commandTokensFromMeta(meta: TermCommandMeta): string[] {
    const cmd = stringValue(meta.cmd);
    if (cmd === "") {
        return [];
    }
    const cmdTokens = splitCommandText(cmd);
    const args = stringListValue(meta["cmd:args"]);
    return [...cmdTokens, ...args].filter((token) => token.trim() !== "");
}

function emptyCommandResolution(reason: string, overrides?: Partial<AgentCommandResolution>): AgentCommandResolution {
    return {
        sessionId: "",
        provider: "",
        executable: "",
        reason,
        tokenCount: 0,
        segmentCount: 0,
        ...overrides,
    };
}

function cleanSessionId(value: unknown): string {
    const sessionId = stringValue(value);
    if (sessionId === "" || sessionId.startsWith("-")) {
        return "";
    }
    return sessionId;
}

function parseCodexSessionId(tokens: string[]): AgentCommandResolution {
    const codexIdx = executableTokenIndex(tokens);
    const executable = commandBaseName(tokens[codexIdx] ?? "");
    if (executable !== "codex") {
        return emptyCommandResolution("unsupported-executable", {
            executable,
            tokenCount: tokens.length,
            segmentCount: 1,
        });
    }
    const resumeIdx = codexIdx + 1;
    if (tokens[resumeIdx] !== "resume") {
        return emptyCommandResolution("missing-codex-resume", {
            provider: "codex",
            executable,
            tokenCount: tokens.length,
            segmentCount: 1,
        });
    }
    const sessionId = cleanSessionId(tokens[resumeIdx + 1]);
    if (sessionId === "") {
        return emptyCommandResolution("missing-codex-session-id", {
            provider: "codex",
            executable,
            tokenCount: tokens.length,
            segmentCount: 1,
        });
    }
    return {
        sessionId,
        provider: "codex",
        executable,
        reason: "matched-codex-resume",
        tokenCount: tokens.length,
        segmentCount: 1,
    };
}

function parseFlagValue(tokens: string[], flags: Set<string>): { value: string; matched: boolean } {
    for (let idx = 0; idx < tokens.length; idx++) {
        const token = tokens[idx];
        if (flags.has(token)) {
            return { value: cleanSessionId(tokens[idx + 1]), matched: true };
        }
        const eqIdx = token.indexOf("=");
        if (eqIdx === -1) {
            continue;
        }
        const flag = token.slice(0, eqIdx);
        if (flags.has(flag)) {
            return { value: cleanSessionId(token.slice(eqIdx + 1)), matched: true };
        }
    }
    return { value: "", matched: false };
}

function parseClaudeSessionId(tokens: string[]): AgentCommandResolution {
    const claudeIdx = executableTokenIndex(tokens);
    const executable = commandBaseName(tokens[claudeIdx] ?? "");
    if (executable !== "claude") {
        return emptyCommandResolution("unsupported-executable", {
            executable,
            tokenCount: tokens.length,
            segmentCount: 1,
        });
    }
    const flagValue = parseFlagValue(tokens.slice(claudeIdx + 1), new Set(["--resume", "-r", "--session-id"]));
    if (!flagValue.matched) {
        return emptyCommandResolution("missing-claude-session-flag", {
            provider: "claude",
            executable,
            tokenCount: tokens.length,
            segmentCount: 1,
        });
    }
    if (flagValue.value === "") {
        return emptyCommandResolution("missing-claude-session-id", {
            provider: "claude",
            executable,
            tokenCount: tokens.length,
            segmentCount: 1,
        });
    }
    return {
        sessionId: flagValue.value,
        provider: "claude",
        executable,
        reason: "matched-claude-session-flag",
        tokenCount: tokens.length,
        segmentCount: 1,
    };
}

function resolveAgentSessionIdFromTokens(tokens: string[], segmentCount: number): AgentCommandResolution {
    if (tokens.length === 0) {
        return emptyCommandResolution("empty-command", { segmentCount });
    }
    const executable = commandBaseName(tokens[executableTokenIndex(tokens)] ?? "");
    if (executable === "codex") {
        return { ...parseCodexSessionId(tokens), segmentCount };
    }
    if (executable === "claude") {
        return { ...parseClaudeSessionId(tokens), segmentCount };
    }
    return emptyCommandResolution("unsupported-executable", {
        executable,
        tokenCount: tokens.length,
        segmentCount,
    });
}

function resolveAgentCommand(commandText: unknown): AgentCommandResolution {
    const command = stringValue(commandText);
    if (command === "") {
        return emptyCommandResolution("empty-command");
    }

    const segments = splitCommandSegments(command);
    if (segments.length === 0) {
        return emptyCommandResolution("empty-command");
    }

    let firstResolution: AgentCommandResolution | null = null;
    for (const segment of segments) {
        const resolution = resolveAgentSessionIdFromTokens(splitCommandText(segment), segments.length);
        if (resolution.sessionId !== "") {
            return resolution;
        }
        firstResolution ??= resolution;
    }
    return firstResolution ?? emptyCommandResolution("empty-command", { segmentCount: segments.length });
}

function resolveAgentCommandFromMeta(meta: TermCommandMeta): AgentCommandResolution {
    const tokens = commandTokensFromMeta(meta);
    if (tokens.length === 0) {
        return emptyCommandResolution("empty-command");
    }
    const args = stringListValue(meta["cmd:args"]);
    if (args.length === 0) {
        return resolveAgentCommand(meta.cmd);
    }
    return resolveAgentSessionIdFromTokens(tokens, 1);
}

function providerFromMeta(meta: TermCommandMeta): AgentSessionProvider {
    const provider = stringValue(meta["agent:provider"]).toLowerCase();
    return provider === "codex" || provider === "claude" ? provider : "";
}

function isAgentAutoResume(meta: TermCommandMeta): boolean {
    return meta["agent:autoresume"] === true;
}

function unresolvedAgentReason(meta: TermCommandMeta, startupCommand: AgentCommandResolution): string {
    const provider = providerFromMeta(meta) || startupCommand.provider;
    if (isAgentAutoResume(meta) && provider === "codex" && startupCommand.reason === "missing-codex-resume") {
        return "new-codex-session-unbound";
    }
    return startupCommand.reason;
}

function resolveAgentSessionId(meta: TermCommandMeta, shellLastCommand?: unknown): AgentSessionIdResolution {
    const startupCommand = resolveAgentCommandFromMeta(meta);
    const lastCommand = resolveAgentCommand(shellLastCommand);
    const persistedSessionId = stringValue(meta["agent:sessionid"]);
    if (persistedSessionId !== "") {
        return {
            sessionId: persistedSessionId,
            source: "agent:sessionid",
            provider: providerFromMeta(meta) || startupCommand.provider,
            reason: "matched-persisted-session-id",
            startupCommand,
            shellLastCommand: lastCommand,
        };
    }
    if (startupCommand.sessionId !== "") {
        return {
            sessionId: startupCommand.sessionId,
            source: "cmd",
            provider: startupCommand.provider,
            reason: startupCommand.reason,
            startupCommand,
            shellLastCommand: lastCommand,
        };
    }
    if (lastCommand.sessionId !== "") {
        return {
            sessionId: lastCommand.sessionId,
            source: "shell:lastcmd",
            provider: lastCommand.provider,
            reason: lastCommand.reason,
            startupCommand,
            shellLastCommand: lastCommand,
        };
    }
    return {
        sessionId: "",
        source: "none",
        provider: startupCommand.provider || lastCommand.provider,
        reason:
            lastCommand.reason !== "empty-command" ? lastCommand.reason : unresolvedAgentReason(meta, startupCommand),
        startupCommand,
        shellLastCommand: lastCommand,
    };
}

function resolveAgentSessionIdFromCommand(commandText: unknown): string {
    return resolveAgentCommand(commandText).sessionId;
}

function resolveAgentSessionIdFromMeta(meta: TermCommandMeta): string {
    return resolveAgentSessionId(meta).sessionId;
}

export { resolveAgentSessionId, resolveAgentSessionIdFromCommand, resolveAgentSessionIdFromMeta };
export type { AgentCommandResolution, AgentSessionIdResolution };
