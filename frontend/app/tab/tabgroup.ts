// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Tab grouping — pure model layer.
//
// No React, no RPC, no jotai here. Just the data shape + immutable transforms + the
// render-segment derivation the tab bar consumes. Keeping this pure makes it unit-testable
// (see tabgroup.test.ts) and lets both the horizontal TabBar and vertical VTabBar share one
// source of truth, the same way tab-pinned-order.ts is shared.

export type TabGroupId = string;

export interface TabGroup {
    id: TabGroupId;
    name: string;
    /** Hex color (same palette space as tab:flagcolor). */
    color: string;
    collapsed: boolean;
    /** Member tab ids, in display order. */
    tabIds: string[];
}

/**
 * A render unit the tab bar loops over. Either a plain tab, or a group anchor.
 * When a group is expanded its member tabs are emitted as separate "tab" segments
 * immediately after the group segment, so the bar can render [pill][tab][tab]… inline.
 */
export type RenderSegment =
    | { kind: "tab"; tabId: string }
    | { kind: "group"; groupId: TabGroupId; expanded: boolean };

/** Color palette reused for groups (mirrors FlagColors in tabcontextmenu.ts). */
export const TabGroupColorPalette: { label: string; value: string }[] = [
    { label: "Green", value: "#58C142" },
    { label: "Teal", value: "#00FFDB" },
    { label: "Blue", value: "#429DFF" },
    { label: "Purple", value: "#BF55EC" },
    { label: "Red", value: "#FF453A" },
    { label: "Orange", value: "#FF9500" },
    { label: "Yellow", value: "#FFE900" },
];

export function defaultGroupColor(): string {
    return TabGroupColorPalette[0].value;
}

// ---- normalization -------------------------------------------------------

/**
 * Defensive parse of the raw workspace meta value into a clean TabGroup[].
 * Drops malformed entries, de-dupes member ids, and guarantees stable ordering.
 */
export function buildTabGroups(raw: unknown): TabGroup[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const seenIds = new Set<string>();
    const groups: TabGroup[] = [];
    for (const entry of raw) {
        if (entry == null || typeof entry !== "object") {
            continue;
        }
        const e = entry as Record<string, unknown>;
        const id = typeof e.id === "string" ? e.id : "";
        if (id === "" || seenIds.has(id)) {
            continue;
        }
        const memberIds = Array.isArray(e.tabIds)
            ? (e.tabIds.filter((t) => typeof t === "string") as string[]).filter(
                  (t, i, arr) => arr.indexOf(t) === i
              )
            : [];
        if (memberIds.length === 0) {
            // Empty groups carry no information — skip so storage stays lean.
            continue;
        }
        seenIds.add(id);
        groups.push({
            id,
            name: typeof e.name === "string" ? e.name : "",
            color: typeof e.color === "string" ? e.color : defaultGroupColor(),
            collapsed: e.collapsed === true,
            tabIds: memberIds,
        });
    }
    return groups;
}

export function getGroupOfTab(groups: TabGroup[], tabId: string): TabGroup | null {
    for (const g of groups) {
        if (g.tabIds.includes(tabId)) {
            return g;
        }
    }
    return null;
}

// ---- render derivation ---------------------------------------------------

/**
 * Fold an ordered tab id list into render segments, collapsing each group into a single
 * anchor segment (plus its expanded member tabs). Order follows workspace.tabids; a group's
 * block is placed at the position of its first member.
 */
export function buildRenderSegments(orderedTabIds: string[], groups: TabGroup[]): RenderSegment[] {
    const renderedGroups = new Set<TabGroupId>();
    const segments: RenderSegment[] = [];
    for (const tabId of orderedTabIds) {
        const group = getGroupOfTab(groups, tabId);
        if (group == null) {
            segments.push({ kind: "tab", tabId });
            continue;
        }
        if (renderedGroups.has(group.id)) {
            // Already emitted as part of this group's block.
            continue;
        }
        renderedGroups.add(group.id);
        segments.push({ kind: "group", groupId: group.id, expanded: !group.collapsed });
        if (!group.collapsed) {
            for (const memberId of group.tabIds) {
                if (orderedTabIds.includes(memberId)) {
                    segments.push({ kind: "tab", tabId: memberId });
                }
            }
        }
    }
    return segments;
}

// ---- immutable transforms (return new arrays) -----------------------------

export function createGroup(
    groups: TabGroup[],
    opts: { name: string; color?: string; tabIds?: string[]; id?: string }
): { groups: TabGroup[]; groupId: TabGroupId } {
    const id = opts.id ?? crypto.randomUUID();
    const group: TabGroup = {
        id,
        name: opts.name,
        color: opts.color ?? defaultGroupColor(),
        collapsed: false,
        tabIds: (opts.tabIds ?? []).filter((t, i, arr) => arr.indexOf(t) === i),
    };
    return { groups: [...groups, group], groupId: id };
}

/** Move tabId into targetGroupId, removing it from any other group first. */
export function addTabToGroup(groups: TabGroup[], groupId: TabGroupId, tabId: string): TabGroup[] {
    const cleaned = groups
        .map((g) => ({ ...g, tabIds: g.tabIds.filter((t) => t !== tabId) }))
        .filter((g) => g.tabIds.length > 0);
    const target = cleaned.find((g) => g.id === groupId);
    if (target == null) {
        return cleaned;
    }
    return cleaned.map((g) =>
        g.id === groupId ? { ...g, tabIds: [...g.tabIds, tabId] } : g
    );
}

/** Remove tabId from whatever group it belongs to. Drops now-empty groups. */
export function removeTabFromGroup(groups: TabGroup[], tabId: string): TabGroup[] {
    return groups
        .map((g) => ({ ...g, tabIds: g.tabIds.filter((t) => t !== tabId) }))
        .filter((g) => g.tabIds.length > 0);
}

export function toggleGroupCollapsed(groups: TabGroup[], groupId: TabGroupId): TabGroup[] {
    return groups.map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g));
}

export function renameGroup(groups: TabGroup[], groupId: TabGroupId, name: string): TabGroup[] {
    return groups.map((g) => (g.id === groupId ? { ...g, name } : g));
}

export function setGroupColor(groups: TabGroup[], groupId: TabGroupId, color: string): TabGroup[] {
    return groups.map((g) => (g.id === groupId ? { ...g, color } : g));
}
