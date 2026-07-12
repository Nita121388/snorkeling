// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AISessionsServiceType } from "@/app/store/services";
import type { AgentCommandResolution, AgentSessionIdResolution } from "./agent-session";

type AISessionsRpcProbe = {
    summary: {
        requested: boolean;
        ok: boolean;
        error: string | null;
        // presence-only fields so we never leak session contents into a copied debug blob
        hasSummary: boolean;
        id: string | null;
        idMatches: boolean | null;
        source: string | null;
        key: string | null;
        title: string | null;
        titleSource: string | null;
        projectPath: string | null;
        messageCount: number | null;
        missing: boolean | null;
        filePath: string | null;
    };
    outline: {
        requested: boolean;
        ok: boolean;
        error: string | null;
        userMessageCount: number | null;
        returnedMessageCount: number | null;
        summaryTitle: string | null;
        summaryId: string | null;
    };
};

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
    rpcProbe?: AISessionsRpcProbe;
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
            cmdShell: meta["cmd:shell"] ?? null,
            cmdRunOnStart: meta["cmd:runonstart"] ?? null,
            agentAutoResume: meta["agent:autoresume"] ?? null,
            agentProvider: meta["agent:provider"] ?? null,
            hasPersistedAgentSessionId: stringValue(meta["agent:sessionid"]) !== "",
            persistedAgentSessionIdLength: stringValue(meta["agent:sessionid"]).length,
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
        rpcProbe: input.rpcProbe ?? null,
    };
}

function formatTerminalSessionDebugInfo(input: TerminalSessionDebugInput): string {
    return JSON.stringify(makeTerminalSessionDebugInfo(input), null, 2);
}

/**
 * Run the same AISessions RPCs the TermSessionNoteEditor and TermSessionUserOutlineOverlay fire at mount,
 * capturing whether they resolve/reject and what shape the returned payload has (presence-only — no
 * snippet/text contents leaked into the copied debug blob). Mirrors the TermSessionTopBar wiring so the
 * probe exercises the real code path used to render the note/outline widgets.
 */
export async function runAISessionsRpcProbe(
    sessionId: string,
    connection: string | null | undefined
): Promise<AISessionsRpcProbe> {
    const result: AISessionsRpcProbe = {
        summary: {
            requested: false,
            ok: false,
            error: null,
            hasSummary: false,
            id: null,
            idMatches: null,
            source: null,
            key: null,
            title: null,
            titleSource: null,
            projectPath: null,
            messageCount: null,
            missing: null,
            filePath: null,
        },
        outline: {
            requested: false,
            ok: false,
            error: null,
            userMessageCount: null,
            returnedMessageCount: null,
            summaryTitle: null,
            summaryId: null,
        },
    };
    if (sessionId === "") {
        return result;
    }
    const service = new AISessionsServiceType();
    const connArg: string | undefined = typeof connection === "string" && connection !== "" ? connection : undefined;
    result.summary.requested = true;
    try {
        const s = await service.Summary({ id: sessionId, connection: connArg });
        result.summary.ok = true;
        result.summary.hasSummary = s != null;
        result.summary.id = typeof s?.id === "string" ? s.id : null;
        result.summary.idMatches = typeof s?.id === "string" ? s.id === sessionId : null;
        result.summary.source = typeof s?.source === "string" ? s.source : null;
        result.summary.key = typeof s?.key === "string" ? s.key : null;
        result.summary.title = typeof s?.title === "string" ? debugPreview(s.title, 80) : null;
        result.summary.titleSource = typeof s?.titleSource === "string" ? s.titleSource : null;
        result.summary.projectPath = typeof s?.projectPath === "string" ? debugPreview(s.projectPath, 200) : null;
        result.summary.messageCount = typeof s?.messageCount === "number" ? s.messageCount : null;
        result.summary.missing = typeof s?.missing === "boolean" ? s.missing : null;
        result.summary.filePath = typeof s?.filePath === "string" ? debugPreview(s.filePath, 200) : null;
    } catch (e) {
        result.summary.ok = false;
        result.summary.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
    result.outline.requested = true;
    try {
        const u = await service.UserOutline({ id: sessionId, connection: connArg, limit: 20, refresh: false });
        result.outline.ok = true;
        result.outline.userMessageCount = typeof u?.userMessageCount === "number" ? u.userMessageCount : null;
        result.outline.returnedMessageCount = Array.isArray(u?.messages) ? u.messages.length : null;
        result.outline.summaryTitle = typeof u?.summary?.title === "string" ? debugPreview(u.summary.title, 80) : null;
        result.outline.summaryId = typeof u?.summary?.id === "string" ? u.summary.id : null;
    } catch (e) {
        result.outline.ok = false;
        result.outline.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
    return result;
}

export {
    formatTerminalSessionDebugInfo,
    makeTerminalSessionDebugInfo,
    commandDebug as sessionCopyCommandDebug,
    debugPreview as sessionCopyDebugPreview,
};
export type { TerminalSessionDebugInput };
