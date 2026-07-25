// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export function agentHookStatusLabel(status: HookStatus): string {
    if (!status.supported) return "CLI not detected";
    if (status.current) return "Current";
    if (!status.installed) return "Not installed";
    if ((status.installedVersion ?? 0) < (status.requiredVersion ?? 0)) return "Update available";
    return "Repair required";
}

export function agentHookActionLabel(status: HookStatus): string | null {
    if (!status.supported || !status.needsInstall) return null;
    if (!status.installed) return "Install";
    if ((status.installedVersion ?? 0) < (status.requiredVersion ?? 0)) return "Update";
    return "Repair";
}

export function vendorIsolationStateLabel(state: string): string {
    switch (state) {
        case "ready":
            return "Ready";
        case "global":
            return "Global configuration";
        case "missing":
            return "Configuration missing";
        default:
            return "Unavailable";
    }
}
