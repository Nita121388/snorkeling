// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/** Global setting persisted through settings.json (registered in SettingsType). */
export const TabAgentStatusModeConfigKey = "tab:agent-status-mode";

export type TabAgentStatusMode = "avatars" | "rail" | "hybrid";

export const DefaultTabAgentStatusMode: TabAgentStatusMode = "hybrid";

/** Unknown / legacy values fall back to the recommended hybrid mode. */
export function normalizeTabAgentStatusMode(value: unknown): TabAgentStatusMode {
    return value === "avatars" || value === "rail" || value === "hybrid" ? value : DefaultTabAgentStatusMode;
}
