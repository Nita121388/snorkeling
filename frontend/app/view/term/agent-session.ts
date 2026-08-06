// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

type TermCommandMeta = Record<string, unknown>;

type AgentSessionIdSource = "agent:sessionid" | "cmd" | "shell:lastcmd" | "none";
type AgentSessionProvider = "codex" | "claude" | "opencode" | "pi" | "";

type AgentCommandResolution = {
    sessionId: string;
    provider: AgentSessionProvider;
    executable: string;
    reason: string;
    tokenCount: number;
    segmentCount: number;
};

type AgentSessionIdResolution = {
    isAgent: boolean;
    sessionId: string;
    source: AgentSessionIdSource;
    provider: AgentSessionProvider;
    reason: string;
    startupCommand: AgentCommandResolution;
    shellLastCommand: AgentCommandResolution;
};

type AgentCommandBinding = {
    provider: AgentSessionProvider;
    sessionId: string;
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
    return baseName.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, "");
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

const CodexOptionValueFlags = new Set([
    "-a",
    "--add-dir",
    "--ask-for-approval",
    "-c",
    "--cd",
    "--config",
    "--disable",
    "--enable",
    "-i",
    "--image",
    "--local-provider",
    "-m",
    "--model",
    "-p",
    "--profile",
    "--profile-v2",
    "--remote",
    "--remote-auth-token-env",
    "-s",
    "--sandbox",
]);

const CodexOptionOnlyFlags = new Set([
    "--all",
    "--dangerously-bypass-approvals-and-sandbox",
    "--dangerously-bypass-hook-trust",
    "-h",
    "--help",
    "--include-non-interactive",
    "--last",
    "--no-alt-screen",
    "--oss",
    "--search",
    "--strict-config",
    "-V",
    "--version",
]);

function skipCodexOption(tokens: string[], idx: number): number {
    const token = tokens[idx] ?? "";
    if (token === "") {
        return idx;
    }
    if (token === "--") {
        return idx + 1;
    }
    const eqIdx = token.indexOf("=");
    const flag = eqIdx === -1 ? token : token.slice(0, eqIdx);
    if (CodexOptionValueFlags.has(flag)) {
        return eqIdx === -1 ? Math.min(tokens.length, idx + 2) : idx + 1;
    }
    if (CodexOptionOnlyFlags.has(flag)) {
        return idx + 1;
    }
    if (token.startsWith("-")) {
        return idx + 1;
    }
    return idx;
}

function findCodexResumeIndex(tokens: string[], codexIdx: number): number {
    let idx = codexIdx + 1;
    while (idx < tokens.length) {
        if (tokens[idx] === "resume") {
            return idx;
        }
        const nextIdx = skipCodexOption(tokens, idx);
        if (nextIdx === idx) {
            return -1;
        }
        idx = nextIdx;
    }
    return -1;
}

function parseCodexResumeSessionId(tokens: string[], resumeIdx: number): string {
    let idx = resumeIdx + 1;
    while (idx < tokens.length) {
        const nextIdx = skipCodexOption(tokens, idx);
        if (nextIdx !== idx) {
            idx = nextIdx;
            continue;
        }
        return cleanSessionId(tokens[idx]);
    }
    return "";
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
    const resumeIdx = findCodexResumeIndex(tokens, codexIdx);
    if (resumeIdx === -1) {
        return emptyCommandResolution("missing-codex-resume", {
            provider: "codex",
            executable,
            tokenCount: tokens.length,
            segmentCount: 1,
        });
    }
    const sessionId = parseCodexResumeSessionId(tokens, resumeIdx);
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

// findResumeTokenIndex scans after the executable index for the literal `resume`
// subcommand, skipping over unknown leading options (any token starting with `-`).
// For bare `--flag` tokens (no `=`), the following value token is also skipped.
// Returns -1 when `resume` is not found.
function findResumeTokenIndex(tokens: string[], exeIdx: number): number {
    let idx = exeIdx + 1;
    while (idx < tokens.length) {
        if (tokens[idx] === "resume") {
            return idx;
        }
        if (tokens[idx] === "--") {
            return tokens[idx + 1] === "resume" ? idx + 1 : -1;
        }
        if (tokens[idx].startsWith("-")) {
            if (!tokens[idx].includes("=")) {
                idx++;
            }
            idx++;
            continue;
        }
        return -1;
    }
    return -1;
}

// parseResumeSessionId scans after the `resume` token for the first non-option
// positional argument and treats it as the session id. Recognized value-flags
// (any token starting with `-`) are skipped along with their following token when
// they look like `--flag value`, and consumed inline when `--flag=value`.
function parseResumeSessionId(tokens: string[], resumeIdx: number): string {
    let idx = resumeIdx + 1;
    while (idx < tokens.length) {
        const token = tokens[idx];
        if (token === "--") {
            return cleanSessionId(tokens[idx + 1]);
        }
        if (token.startsWith("-")) {
            const eqIdx = token.indexOf("=");
            if (eqIdx !== -1) {
                idx++;
                continue;
            }
            idx += 2;
            continue;
        }
        return cleanSessionId(token);
    }
    return "";
}

// parseResumeCommandSessionId handles the `resume <session-id>` subcommand pattern
// shared by OpenCode and Pi (and Codex, though codex keeps its own richer
// option-aware path). `provider` is one of "opencode" / "pi" and is echoed back
// on the resolution; the match reason is `matched-<provider>-resume`.
function parseResumeCommandSessionId(
    tokens: string[],
    provider: "opencode" | "pi"
): AgentCommandResolution {
    const exeIdx = executableTokenIndex(tokens);
    const executable = commandBaseName(tokens[exeIdx] ?? "");
    if (executable !== provider) {
        return emptyCommandResolution("unsupported-executable", {
            executable,
            tokenCount: tokens.length,
            segmentCount: 1,
        });
    }
    // Real CLIs resume with value flags (opencode --session <id>, pi
    // --session-id <id>); prefer that shape over the legacy `resume <id>`
    // subcommand fallback below.
    const flagValue = parseFlagValue(
        tokens.slice(exeIdx + 1),
        provider === "pi" ? new Set(["--session-id", "--session"]) : new Set(["--session"])
    );
    if (flagValue.matched && flagValue.value !== "") {
        return {
            sessionId: flagValue.value,
            provider,
            executable,
            reason: `matched-${provider}-session-flag`,
            tokenCount: tokens.length,
            segmentCount: 1,
        };
    }
    const resumeIdx = findResumeTokenIndex(tokens, exeIdx);
    if (resumeIdx === -1) {
        return emptyCommandResolution(`missing-${provider}-resume`, {
            provider,
            executable,
            tokenCount: tokens.length,
            segmentCount: 1,
        });
    }
    const sessionId = parseResumeSessionId(tokens, resumeIdx);
    if (sessionId === "") {
        return emptyCommandResolution(`missing-${provider}-session-id`, {
            provider,
            executable,
            tokenCount: tokens.length,
            segmentCount: 1,
        });
    }
    return {
        sessionId,
        provider,
        executable,
        reason: `matched-${provider}-resume`,
        tokenCount: tokens.length,
        segmentCount: 1,
    };
}

function parseOpenCodeSessionId(tokens: string[]): AgentCommandResolution {
    return parseResumeCommandSessionId(tokens, "opencode");
}

function parsePiSessionId(tokens: string[]): AgentCommandResolution {
    return parseResumeCommandSessionId(tokens, "pi");
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
    if (executable === "opencode") {
        return { ...parseOpenCodeSessionId(tokens), segmentCount };
    }
    if (executable === "pi") {
        return { ...parsePiSessionId(tokens), segmentCount };
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

function resolveAgentCommandBinding(commandText: unknown): AgentCommandBinding | null {
    const command = stringValue(commandText);
    if (command === "") {
        return null;
    }
    const segments = splitCommandSegments(command);
    let firstAgentBinding: AgentCommandBinding | null = null;
    for (const segment of segments) {
        const resolution = resolveAgentSessionIdFromTokens(splitCommandText(segment), segments.length);
        if (resolution.provider === "") {
            continue;
        }
        const binding = {
            provider: resolution.provider,
            sessionId: resolution.sessionId,
        };
        if (binding.sessionId !== "") {
            return binding;
        }
        firstAgentBinding ??= binding;
    }
    return firstAgentBinding;
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
    if (provider === "codex" || provider === "claude" || provider === "opencode" || provider === "pi") {
        return provider;
    }
    return "";
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
    const isAgent =
        persistedSessionId !== "" ||
        stringValue(meta["agent:provider"]) !== "" ||
        isAgentAutoResume(meta) ||
        startupCommand.provider !== "" ||
        lastCommand.provider !== "";
    if (persistedSessionId !== "") {
        return {
            isAgent,
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
            isAgent,
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
            isAgent,
            sessionId: lastCommand.sessionId,
            source: "shell:lastcmd",
            provider: lastCommand.provider,
            reason: lastCommand.reason,
            startupCommand,
            shellLastCommand: lastCommand,
        };
    }
    return {
        isAgent,
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

function stripAnsiControlCodes(value: string): string {
    return value.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, "g"), "");
}

function commandCandidatesFromTerminalLine(line: string): string[] {
    const trimmed = stripAnsiControlCodes(line).trim();
    if (trimmed === "") {
        return [];
    }
    const candidates = [trimmed];
    const psMatch = trimmed.match(/^PS\s+.+?>\s*(.+)$/i);
    if (psMatch?.[1]) {
        candidates.push(psMatch[1].trim());
    }
    const windowsCmdMatch = trimmed.match(/^[A-Za-z]:[\\/].*?>\s*(.+)$/);
    if (windowsCmdMatch?.[1]) {
        candidates.push(windowsCmdMatch[1].trim());
    }
    for (const marker of ["$ ", "# ", "> ", "% ", "❯ ", "➜ "]) {
        const idx = trimmed.lastIndexOf(marker);
        if (idx !== -1 && idx + marker.length < trimmed.length) {
            candidates.push(trimmed.slice(idx + marker.length).trim());
        }
    }
    return candidates;
}

function extractAgentCommandFromTerminalText(text: unknown): string {
    if (typeof text !== "string" || text.trim() === "") {
        return "";
    }
    const lines = text.split(/\r?\n/);
    const startIdx = Math.max(0, lines.length - 200);
    for (let idx = lines.length - 1; idx >= startIdx; idx--) {
        for (const candidate of commandCandidatesFromTerminalLine(lines[idx])) {
            if (resolveAgentCommand(candidate).sessionId !== "") {
                return candidate;
            }
        }
    }
    return "";
}

function resolveAgentSessionIdFromMeta(meta: TermCommandMeta): string {
    return resolveAgentSessionId(meta).sessionId;
}

export {
    extractAgentCommandFromTerminalText,
    resolveAgentCommandBinding,
    resolveAgentSessionId,
    resolveAgentSessionIdFromCommand,
    resolveAgentSessionIdFromMeta,
};
export type { AgentCommandBinding, AgentCommandResolution, AgentSessionIdResolution };
