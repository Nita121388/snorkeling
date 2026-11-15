// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { LANE_COLORS } from "./graph-layout";

export type CommitRefType = "head" | "branch" | "tag" | "remote";

export interface CommitRef {
    type: CommitRefType;
    name: string;
}

/** Branches that always get the first palette slots (main line colours). */
const PRIMARY_BRANCHES = ["main", "master", "trunk", "develop"];

function hashString(value: string): number {
    let hash = 0;
    for (const char of value) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 9973;
    return hash;
}

/**
 * Stable colour for a branch name. Primary branches take the first slots so
 * `main` is always the blue lane; everything else is deterministic by name.
 */
export function colorForRefName(name: string): string {
    const primaryIndex = PRIMARY_BRANCHES.indexOf(name);
    if (primaryIndex >= 0) return LANE_COLORS[primaryIndex % LANE_COLORS.length];
    return LANE_COLORS[2 + (hashString(name) % (LANE_COLORS.length - 2))];
}

/**
 * Parse the raw `%D` ref tokens from `git log` (e.g. `HEAD -> main`,
 * `tag: v2.4`, `origin/main`) into badge descriptors.
 */
export function parseGitRefs(rawRefs: string[] | undefined): CommitRef[] {
    const refs: CommitRef[] = [];
    for (const raw of rawRefs ?? []) {
        const token = raw.trim();
        if (token === "") continue;
        if (token === "HEAD") {
            refs.push({ type: "head", name: "HEAD" });
            continue;
        }
        if (token.startsWith("HEAD -> ")) {
            refs.push({ type: "head", name: token.slice("HEAD -> ".length).trim() });
            continue;
        }
        if (token.startsWith("tag: ")) {
            refs.push({ type: "tag", name: token.slice("tag: ".length).trim() });
            continue;
        }
        if (token.includes("/")) {
            refs.push({ type: "remote", name: token });
            continue;
        }
        refs.push({ type: "branch", name: token });
    }
    return refs;
}

/** Lane colour pinning for a commit: its HEAD/branch ref decides the colour. */
export function colorForCommitRefs(refs: string[] | undefined): string | null {
    const parsed = parseGitRefs(refs);
    const ref = parsed.find((entry) => entry.type === "head") ?? parsed.find((entry) => entry.type === "branch");
    return ref ? colorForRefName(ref.name) : null;
}

const AVATAR_COLORS = ["#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#14b8a6", "#eab308", "#ef4444", "#22c55e"];

/** Two-letter initials for the avatar block ("Maya Chen" -> "MC"). */
export function initials(name: string | undefined): string {
    const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function avatarColor(name: string | undefined): string {
    return AVATAR_COLORS[hashString(name ?? "") % AVATAR_COLORS.length];
}
