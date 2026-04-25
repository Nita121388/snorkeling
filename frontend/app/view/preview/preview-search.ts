// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { naturalStringCompare } from "@/util/util";

export type GroupedContentSearchMatch = {
    path: string;
    relPath: string;
    matches: FileSearchMatch[];
};

export const FileNameSearchSkipDirNames = new Set([
    ".cache",
    ".git",
    ".next",
    ".svn",
    ".turbo",
    ".venv",
    "build",
    "dist",
    "node_modules",
    "out",
    "target",
    "vendor",
]);

export function groupContentSearchMatches(matches: FileSearchMatch[]): GroupedContentSearchMatch[] {
    const groups = new Map<string, GroupedContentSearchMatch>();
    for (const match of matches) {
        const current = groups.get(match.path);
        if (current) {
            current.matches.push(match);
            continue;
        }
        groups.set(match.path, {
            path: match.path,
            relPath: match.relpath ?? match.path,
            matches: [match],
        });
    }
    return Array.from(groups.values());
}

export function sortFileNameMatches(matches: FileNameSearchMatch[]): FileNameSearchMatch[] {
    return [...matches].sort((left, right) => {
        const leftDir = left.isdir ? 0 : 1;
        const rightDir = right.isdir ? 0 : 1;
        if (leftDir !== rightDir) {
            return leftDir - rightDir;
        }
        const leftLabel = (left.relpath ?? left.path).toLocaleLowerCase();
        const rightLabel = (right.relpath ?? right.path).toLocaleLowerCase();
        if (leftLabel !== rightLabel) {
            return naturalStringCompare(leftLabel, rightLabel);
        }
        return naturalStringCompare(left.path, right.path);
    });
}

export function matchesFileNameSearchQuery(label: string, query: string): boolean {
    const hasUppercaseLetters = /[A-Z]/.test(query);
    if (hasUppercaseLetters) {
        return label.includes(query);
    }
    return label.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

export function shouldFallbackFileNameSearch(error: unknown): boolean {
    const message = `${error}`.toLocaleLowerCase();
    return (
        message.includes("remotefilenamesearchstream") &&
        (message.includes("not found") || message.includes("not implemented"))
    );
}
