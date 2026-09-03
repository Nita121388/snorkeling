// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export const MinimizedBlocksMetaKey = "layout:minimizedblocks";
export const MinimizedGroupsMetaKey = "layout:minimizedgroups";

// ── Block ID helpers ──

export function normalizeMinimizedBlockIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set<string>();
    const blockIds: string[] = [];
    value.forEach((item) => {
        if (typeof item !== "string" || item === "" || seen.has(item)) {
            return;
        }
        seen.add(item);
        blockIds.push(item);
    });
    return blockIds;
}

export function getMinimizedBlockIdsFromTab(tab: Tab | null | undefined): string[] {
    const tabBlockIds = new Set(tab?.blockids ?? []);
    return normalizeMinimizedBlockIds((tab?.meta as Record<string, unknown>)?.[MinimizedBlocksMetaKey]).filter(
        (blockId) => tabBlockIds.has(blockId)
    );
}

// ── Group helpers ──

export type MinimizedGroups = Record<string, string[]>;

export function getMinimizedGroupsFromTab(tab: Tab | null | undefined): MinimizedGroups {
    const raw = (tab?.meta as Record<string, unknown>)?.[MinimizedGroupsMetaKey];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    const result: MinimizedGroups = {};
    const validBlockIds = new Set(tab?.blockids ?? []);
    for (const [groupId, blockIds] of Object.entries(raw)) {
        if (!Array.isArray(blockIds) || groupId === "") {
            continue;
        }
        const normalized = blockIds.filter(
            (id): id is string => typeof id === "string" && id !== "" && validBlockIds.has(id)
        );
        if (normalized.length > 0) {
            result[groupId] = normalized;
        }
    }
    return result;
}

/**
 * Given the group map, find which groupId (if any) a blockId belongs to.
 */
export function findGroupForBlock(groups: MinimizedGroups, blockId: string): string | null {
    for (const [groupId, memberIds] of Object.entries(groups)) {
        if (memberIds.includes(blockId)) {
            return groupId;
        }
    }
    return null;
}

/**
 * Check whether a blockId is the "root" of a group (i.e. the first member).
 * Used to decide which blockId renders the group icon in the sidebar.
 */
export function isGroupRoot(groups: MinimizedGroups, blockId: string): boolean {
    for (const memberIds of Object.values(groups)) {
        if (memberIds.length > 0 && memberIds[0] === blockId) {
            return true;
        }
    }
    return false;
}
