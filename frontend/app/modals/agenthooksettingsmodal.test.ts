import { describe, expect, it } from "vitest";
import { agentHookActionLabel, agentHookStatusLabel } from "./agenthooksettingsmodal";

function makeStatus(overrides: Partial<HookStatus>): HookStatus {
    return {
        provider: "codex",
        supported: true,
        installed: true,
        current: true,
        needsInstall: false,
        installedVersion: 18,
        requiredVersion: 18,
        ...overrides,
    };
}

describe("agent hook settings status", () => {
    it("labels current hooks without an action", () => {
        const status = makeStatus({});
        expect(agentHookStatusLabel(status)).toBe("Current");
        expect(agentHookActionLabel(status)).toBeNull();
    });

    it("offers updates for older hook versions", () => {
        const status = makeStatus({ current: false, needsInstall: true, installedVersion: 17 });
        expect(agentHookStatusLabel(status)).toBe("Update available");
        expect(agentHookActionLabel(status)).toBe("Update");
    });

    it("offers installation when no hook is installed", () => {
        const status = makeStatus({ installed: false, current: false, needsInstall: true, installedVersion: 0 });
        expect(agentHookStatusLabel(status)).toBe("Not installed");
        expect(agentHookActionLabel(status)).toBe("Install");
    });

    it("does not offer an action when the agent CLI is unavailable", () => {
        const status = makeStatus({ supported: false, installed: false, current: false, needsInstall: true });
        expect(agentHookStatusLabel(status)).toBe("CLI not detected");
        expect(agentHookActionLabel(status)).toBeNull();
    });

    it("offers repair when the installed version is current but configuration is incomplete", () => {
        const status = makeStatus({ current: false, needsInstall: true, reason: "hook commands are missing" });
        expect(agentHookStatusLabel(status)).toBe("Repair required");
        expect(agentHookActionLabel(status)).toBe("Repair");
    });
});
