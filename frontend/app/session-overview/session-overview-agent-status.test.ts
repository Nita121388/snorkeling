import { describe, expect, it } from "vitest";
import { agentStatusHookProvidersForBlocks } from "./session-overview-agent-status";

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
