import { describe, expect, it } from "vitest";
import {
    agentStatusHookProvidersForBlocks,
    agentStatusHookProvidersForInstall,
    agentStatusHookStatusesNeedingInstall,
} from "./session-overview-agent-status";

describe("agentStatusHookProvidersForInstall", () => {
    it("checks every supported provider in install order", () => {
        expect(agentStatusHookProvidersForInstall()).toEqual(["codex", "claude"]);
    });
});

describe("agentStatusHookProvidersForBlocks", () => {
    it("includes Claude agent blocks", () => {
        expect(
            agentStatusHookProvidersForBlocks([
                { isAgentLike: true, agentProvider: "claude" },
                { isAgentLike: false, agentProvider: "codex" },
            ])
        ).toEqual(["claude"]);
    });

    it("keeps supported providers in install order", () => {
        expect(
            agentStatusHookProvidersForBlocks([
                { isAgentLike: true, agentProvider: "Claude" },
                { isAgentLike: true, agentProvider: "codex" },
                { isAgentLike: true, agentProvider: "gemini" },
            ])
        ).toEqual(["codex", "claude"]);
    });
});

describe("agentStatusHookStatusesNeedingInstall", () => {
    it("returns every supported pending provider in provider order", () => {
        const statuses: HookStatus[] = [
            { provider: "claude", supported: true, installed: true, current: false, needsInstall: true },
            { provider: "codex", supported: true, installed: true, current: false, needsInstall: true },
            { provider: "gemini", supported: true, installed: false, current: false, needsInstall: true },
        ];

        expect(agentStatusHookStatusesNeedingInstall(["codex", "claude"], statuses)).toEqual([
            statuses[1],
            statuses[0],
        ]);
    });
});
