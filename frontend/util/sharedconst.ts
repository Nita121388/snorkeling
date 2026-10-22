// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export const CHORD_TIMEOUT = 2000;

// Agent OS toast settings (agentstatus:osnotify*).
//
// The defaults live here, not in the Go settings struct: the Go fields are *bool / *int64 and
// must keep "unset" distinct from "false" / "0". The electron main process
// (emain/os-notify.ts) and the Wave Config panel
// (frontend/app/view/waveconfig/agentnotifysettings.tsx) both read them from here so the
// effective behavior and the displayed values can never drift apart.
export const AGENT_OS_NOTIFY_DEFAULTS = {
    masterEnabled: true,
    doneEnabled: true,
    blockedEnabled: true,
    notifyWhenFocused: false,
    blockedMinIntervalMs: 0,
    idleMinMs: 30000,
    cooldownMs: 60000,
} as const;

export const AGENT_OS_NOTIFY_SETTING_KEYS = {
    masterEnabled: "agentstatus:osnotify",
    doneEnabled: "agentstatus:osnotifydone",
    blockedEnabled: "agentstatus:osnotifyblocked",
    notifyWhenFocused: "agentstatus:osnotifywhenfocused",
    blockedMinIntervalMs: "agentstatus:osnotifyblockedminms",
    idleMinMs: "agentstatus:osnotifyidleminms",
    cooldownMs: "agentstatus:osnotifycooldownms",
} as const;
