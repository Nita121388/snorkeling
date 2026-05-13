// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { AgentCommandResolution, AgentSessionIdResolution } from "./agent-session";

type TerminalSessionDebugInput = {
    blockId: string;
    tabId: string;
    workspaceId: string;
    routeId: string;
    blockData: Block | null;
    meta: Record<string, unknown>;
    agentSessionResolution: AgentSessionIdResolution;
    shellLastCommand: string | null;
    blockJobStatus: BlockJobStatusData | null;
    shellProcStatus: string | null;
    shellProcFullStatus: BlockControllerRuntimeStatus | null;
    shellIntegrationStatus: string | null;
    terminal: {
        hasTermWrap: boolean;
        rows?: number;
        cols?: number;
        renderer?: string;
        hasSelection?: boolean;
    };
};

function redactSensitiveText(value: string): string {
    return value
        .replace(
            /\b([A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD)[A-Za-z0-9_]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
            "$1$2<redacted>"
        )
        .replace(/\b(authkey|auth_key|apikey|api_key)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1$2<redacted>")
        .replace(/\b(codex\s+resume\s+)(?:"[^"]*"|'[^']*'|\S+)/gi, "$1<session>")
        .replace(/(--resume|--session-id)(=)(?:"[^"]*"|'[^']*'|\S+)/gi, "$1$2<session>")
        .replace(/(--resume|--session-id|-r)(\s+)(?:"[^"]*"|'[^']*'|\S+)/gi, "$1$2<session>");
}

function debugPreview(value: unknown, maxLength = 240): string {
    if (typeof value !== "string") {
        return "";
    }
    const redacted = redactSensitiveText(value.trim());
    return redacted.length > maxLength ? `${redacted.slice(0, maxLength - 3)}...` : redacted;
}

function stringValue(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function commandDebug(resolution: AgentCommandResolution): Record<string, unknown> {
    return {
        provider: resolution.provider,
        executable: resolution.executable,
        reason: resolution.reason,
        hasSessionId: resolution.sessionId !== "",
        sessionIdLength: resolution.sessionId.length,
        tokenCount: resolution.tokenCount,
        segmentCount: resolution.segmentCount,
    };
}

function blockJobStatusDebug(jobStatus: BlockJobStatusData | null): Record<string, unknown> | null {
    if (jobStatus == null) {
        return null;
    }
    return {
        blockid: jobStatus.blockid,
        jobid: stringValue(jobStatus.jobid),
        status: jobStatus.status ?? null,
        versionts: jobStatus.versionts,
        donereason: jobStatus.donereason ?? null,
        startuperror: debugPreview(jobStatus.startuperror),
        cmdexitts: jobStatus.cmdexitts ?? null,
        cmdexitcode: jobStatus.cmdexitcode ?? null,
        cmdexitsignal: jobStatus.cmdexitsignal ?? null,
    };
}

function shellProcFullStatusDebug(status: BlockControllerRuntimeStatus | null): Record<string, unknown> | null {
    if (status == null) {
        return null;
    }
    return {
        blockid: status.blockid,
        version: status.version,
        shellprocstatus: status.shellprocstatus ?? null,
        shellprocconnname: status.shellprocconnname ?? null,
        shellprocexitcode: status.shellprocexitcode,
        tsunamiport: status.tsunamiport ?? null,
    };
}

function cmdArgsDebug(value: unknown): Record<string, unknown> {
    if (!Array.isArray(value)) {
        return {
            count: 0,
            preview: [],
        };
    }
    const stringArgs = value.filter((item): item is string => typeof item === "string");
    return {
        count: stringArgs.length,
        preview: stringArgs.slice(0, 12).map((item) => debugPreview(item, 120)),
        truncated: stringArgs.length > 12,
    };
}

function makeTerminalSessionDebugInfo(input: TerminalSessionDebugInput): Record<string, unknown> {
    const agentSessionId = input.agentSessionResolution.sessionId;
    const jobId = stringValue(input.blockJobStatus?.jobid) || stringValue(input.blockData?.jobid);
    const meta = input.meta ?? {};
    return {
        generatedAt: new Date().toISOString(),
        route: {
            block: input.routeId,
            tab: input.tabId ? `tab:${input.tabId}` : "",
        },
        context: {
            blockId: input.blockId,
            tabId: input.tabId,
            workspaceId: input.workspaceId,
            blockORef: `block:${input.blockId}`,
        },
        block: {
            view: meta.view ?? null,
            controller: meta.controller ?? null,
            termMode: meta["term:mode"] ?? null,
            connection: meta.connection ?? null,
            cwd: meta["cmd:cwd"] ?? null,
            cmd: debugPreview(meta.cmd),
            cmdArgs: cmdArgsDebug(meta["cmd:args"]),
            blockJobId: stringValue(input.blockData?.jobid),
        },
        session: {
            agentSessionId,
            hasAgentSessionId: agentSessionId !== "",
            agentSessionIdLength: agentSessionId.length,
            source: input.agentSessionResolution.source,
            provider: input.agentSessionResolution.provider,
            reason: input.agentSessionResolution.reason,
            jobId,
            hasJobId: jobId !== "",
            jobIdLength: jobId.length,
        },
        agentResolution: {
            startupCommand: commandDebug(input.agentSessionResolution.startupCommand),
            shellLastCommand: commandDebug(input.agentSessionResolution.shellLastCommand),
            shellLastCommandPreview: debugPreview(input.shellLastCommand),
        },
        runtime: {
            shellProcStatus: input.shellProcStatus ?? null,
            shellProcFullStatus: shellProcFullStatusDebug(input.shellProcFullStatus),
            shellIntegrationStatus: input.shellIntegrationStatus ?? null,
            blockJobStatus: blockJobStatusDebug(input.blockJobStatus),
            terminal: input.terminal,
        },
    };
}

function formatTerminalSessionDebugInfo(input: TerminalSessionDebugInput): string {
    return JSON.stringify(makeTerminalSessionDebugInfo(input), null, 2);
}

export {
    formatTerminalSessionDebugInfo,
    makeTerminalSessionDebugInfo,
    commandDebug as sessionCopyCommandDebug,
    debugPreview as sessionCopyDebugPreview,
};
export type { TerminalSessionDebugInput };
