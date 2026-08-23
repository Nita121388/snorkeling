// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure slash-command logic for the chat composer: parsing the trigger query,
// filtering matches, and merging pi's dynamic command registry with the
// GUI-mapped built-ins. Unit-tested in chat-slash.test.ts.

export type SlashItem = {
    name: string;
    description?: string;
    /** extension | prompt | skill (pi registry) or gui (handled by the GUI) */
    source?: string;
};

/**
 * GUI-mapped built-ins. These are NOT sent to the agent as messages — the
 * composer turns them into allowlisted control RPCs (set_model /
 * set_thinking_level / compact). pi's TUI built-ins like /clear are absent on
 * purpose: they do not execute via the RPC prompt path.
 */
export const BUILTIN_SLASH_COMMANDS: SlashItem[] = [
    { name: "model", description: "切换模型", source: "gui" },
    { name: "think", description: "调整思考深度", source: "gui" },
    { name: "compact", description: "压缩对话上下文", source: "gui" },
];

/** Extract the slash query from raw input, or null when no panel should show. */
export function parseSlashQuery(input: string): string | null {
    if (!input.startsWith("/") || input.includes(" ") || input.includes("\n")) return null;
    return input.slice(1);
}

/** Filter items whose name starts with the query (case-insensitive). */
export function filterSlashItems(items: SlashItem[], query: string): SlashItem[] {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.name.toLowerCase().startsWith(q));
}

/** Built-ins first, then the agent's own commands sorted by name. */
export function mergeSlashItems(dynamic: SlashItem[]): SlashItem[] {
    const sorted = [...dynamic].sort((a, b) => a.name.localeCompare(b.name));
    return [...BUILTIN_SLASH_COMMANDS, ...sorted];
}

/** Human label for a command source badge. */
export function slashSourceLabel(source?: string): string {
    switch (source) {
        case "extension":
            return "扩展";
        case "prompt":
            return "模板";
        case "skill":
            return "技能";
        default:
            return "";
    }
}
