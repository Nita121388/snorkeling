import { describe, expect, it } from "vitest";

import { resolveAgentSessionId } from "./agent-session";
import { makeTerminalSessionDebugInfo } from "./session-debug";

describe("makeTerminalSessionDebugInfo", () => {
    it("includes useful miss details when no agent session id or job id is available", () => {
        const meta = {
            view: "term",
            controller: "cmd",
            cmd: "codex",
            "cmd:cwd": "/repo",
            connection: "local",
        };
        const info = makeTerminalSessionDebugInfo({
            blockId: "block-1",
            tabId: "tab-1",
            workspaceId: "workspace-1",
            routeId: "feblock:block-1",
            blockData: { meta } as Block,
            meta,
            agentSessionResolution: resolveAgentSessionId(meta, null),
            shellLastCommand: null,
            blockJobStatus: null,
            shellProcStatus: "running",
            shellProcFullStatus: null,
            shellIntegrationStatus: null,
            terminal: { hasTermWrap: false, hasSelection: false },
        });

        expect(info).toMatchObject({
            route: {
                block: "feblock:block-1",
                tab: "tab:tab-1",
            },
            context: {
                blockId: "block-1",
                tabId: "tab-1",
                workspaceId: "workspace-1",
                blockORef: "block:block-1",
            },
            block: {
                view: "term",
                controller: "cmd",
                cmd: "codex",
                cwd: "/repo",
                connection: "local",
            },
            session: {
                agentSessionId: "",
                hasAgentSessionId: false,
                source: "none",
                provider: "codex",
                reason: "missing-codex-resume",
                jobId: "",
                hasJobId: false,
            },
            runtime: {
                shellProcStatus: "running",
                blockJobStatus: null,
                terminal: {
                    hasTermWrap: false,
                    hasSelection: false,
                },
            },
        });
    });

    it("redacts command previews without hiding the resolved ids", () => {
        const meta = {
            view: "term",
            controller: "cmd",
            cmd: 'ANTHROPIC_API_KEY="secret" claude --resume claude-session',
        };
        const info = makeTerminalSessionDebugInfo({
            blockId: "block-2",
            tabId: "tab-2",
            workspaceId: "workspace-2",
            routeId: "feblock:block-2",
            blockData: { jobid: "job-2", meta } as Block,
            meta,
            agentSessionResolution: resolveAgentSessionId(meta, null),
            shellLastCommand: "codex resume codex-session",
            blockJobStatus: {
                blockid: "block-2",
                jobid: "job-2",
                status: "connected",
                versionts: 123,
            },
            shellProcStatus: "running",
            shellProcFullStatus: null,
            shellIntegrationStatus: "running-command",
            terminal: { hasTermWrap: true, rows: 24, cols: 80, renderer: "dom", hasSelection: true },
        });

        expect(info).toMatchObject({
            block: {
                cmd: "ANTHROPIC_API_KEY=<redacted> claude --resume <session>",
                blockJobId: "job-2",
            },
            session: {
                agentSessionId: "claude-session",
                jobId: "job-2",
                hasJobId: true,
            },
            agentResolution: {
                shellLastCommandPreview: "codex resume <session>",
            },
            runtime: {
                blockJobStatus: {
                    jobid: "job-2",
                    status: "connected",
                },
            },
        });
    });
});
