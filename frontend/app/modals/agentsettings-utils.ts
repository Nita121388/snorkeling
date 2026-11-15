// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { i18n } from "@/i18n/config";

export function agentHookStatusLabel(status: HookStatus): string {
    if (!status.supported) return i18n.t("modals:agentHookSettings.statusCliMissing");
    if (status.current) return i18n.t("modals:agentHookSettings.statusCurrent");
    if (!status.installed) return i18n.t("modals:agentHookSettings.statusNotInstalled");
    if ((status.installedVersion ?? 0) < (status.requiredVersion ?? 0))
        return i18n.t("modals:agentHookSettings.statusUpdateAvailable");
    return i18n.t("modals:agentHookSettings.statusRepairRequired");
}

export function agentHookActionLabel(status: HookStatus): string | null {
    if (!status.supported || !status.needsInstall) return null;
    if (!status.installed) return i18n.t("modals:agentHookSettings.actionInstall");
    if ((status.installedVersion ?? 0) < (status.requiredVersion ?? 0))
        return i18n.t("modals:agentHookSettings.actionUpdate");
    return i18n.t("modals:agentHookSettings.actionRepair");
}

export function vendorIsolationStateLabel(state: string): string {
    switch (state) {
        case "ready":
            return i18n.t("modals:agentHookSettings.stateReady");
        case "global":
            return i18n.t("modals:agentHookSettings.stateGlobal");
        case "missing":
            return i18n.t("modals:agentHookSettings.stateMissing");
        default:
            return i18n.t("modals:agentHookSettings.stateUnavailable");
    }
}
