import { i18n, initI18n } from "@/i18n/config";
import { beforeAll, describe, expect, it } from "vitest";
import { agentHookActionLabel, agentHookStatusLabel, vendorIsolationStateLabel } from "./agentsettings-utils";

beforeAll(async () => {
    // Pattern I: labels come from `i18n.t(...)`, so expectations are recomputed.
    await initI18n("en");
});

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
        expect(agentHookStatusLabel(status)).toBe(i18n.t("modals:agentHookSettings.statusCurrent"));
        expect(agentHookActionLabel(status)).toBeNull();
    });

    it("offers updates for older hook versions", () => {
        const status = makeStatus({ current: false, needsInstall: true, installedVersion: 17 });
        expect(agentHookStatusLabel(status)).toBe(i18n.t("modals:agentHookSettings.statusUpdateAvailable"));
        expect(agentHookActionLabel(status)).toBe(i18n.t("modals:agentHookSettings.actionUpdate"));
    });

    it("offers installation when no hook is installed", () => {
        const status = makeStatus({ installed: false, current: false, needsInstall: true, installedVersion: 0 });
        expect(agentHookStatusLabel(status)).toBe(i18n.t("modals:agentHookSettings.statusNotInstalled"));
        expect(agentHookActionLabel(status)).toBe(i18n.t("modals:agentHookSettings.actionInstall"));
    });

    it("does not offer an action when the agent CLI is unavailable", () => {
        const status = makeStatus({ supported: false, installed: false, current: false, needsInstall: true });
        expect(agentHookStatusLabel(status)).toBe(i18n.t("modals:agentHookSettings.statusCliMissing"));
        expect(agentHookActionLabel(status)).toBeNull();
    });

    it("offers repair when the installed version is current but configuration is incomplete", () => {
        const status = makeStatus({ current: false, needsInstall: true, reason: "hook commands are missing" });
        expect(agentHookStatusLabel(status)).toBe(i18n.t("modals:agentHookSettings.statusRepairRequired"));
        expect(agentHookActionLabel(status)).toBe(i18n.t("modals:agentHookSettings.actionRepair"));
    });

    it("labels vendor isolation diagnostic states", () => {
        expect(vendorIsolationStateLabel("ready")).toBe(i18n.t("modals:agentHookSettings.stateReady"));
        expect(vendorIsolationStateLabel("global")).toBe(i18n.t("modals:agentHookSettings.stateGlobal"));
        expect(vendorIsolationStateLabel("missing")).toBe(i18n.t("modals:agentHookSettings.stateMissing"));
        expect(vendorIsolationStateLabel("unknown")).toBe(i18n.t("modals:agentHookSettings.stateUnavailable"));
    });
});
