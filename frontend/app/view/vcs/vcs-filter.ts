// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type VcsFileTypeFilter =
    | "all"
    | "modified"
    | "added"
    | "deleted"
    | "renamed"
    | "untracked"
    | "staged"
    | "unstaged";

export const VcsFileTypeFilterOptions: { value: VcsFileTypeFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "modified", label: "Modified" },
    { value: "added", label: "Added" },
    { value: "deleted", label: "Deleted" },
    { value: "renamed", label: "Renamed" },
    { value: "untracked", label: "Untracked" },
    { value: "staged", label: "Staged" },
    { value: "unstaged", label: "Unstaged" },
];

function normalizeVcsStatusCode(status: VcsFileStatus): string {
    return (status?.code ?? "").trim().toUpperCase();
}

export function vcsFileStatusMatchesType(status: VcsFileStatus, typeFilter: VcsFileTypeFilter): boolean {
    if (typeFilter === "all") {
        return true;
    }
    const code = normalizeVcsStatusCode(status);
    switch (typeFilter) {
        case "modified":
            return code.includes("M");
        case "added":
            return code.includes("A");
        case "deleted":
            return code.includes("D") || code.includes("!");
        case "renamed":
            return code.includes("R");
        case "untracked":
            return !!status?.untracked || code.includes("?");
        case "staged":
            return !!status?.staged;
        case "unstaged":
            return !status?.staged && !status?.untracked;
        default:
            return true;
    }
}

export function filterVcsFileStatuses(
    statuses: VcsFileStatus[],
    search: string,
    typeFilter: VcsFileTypeFilter
): VcsFileStatus[] {
    const searchText = (search ?? "").trim().toLowerCase();
    return (statuses ?? []).filter((status) => {
        if (!vcsFileStatusMatchesType(status, typeFilter)) {
            return false;
        }
        if (searchText === "") {
            return true;
        }
        const path = (status?.path ?? "").toLowerCase();
        const code = normalizeVcsStatusCode(status).toLowerCase();
        return path.includes(searchText) || code.includes(searchText);
    });
}
