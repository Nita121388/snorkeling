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

/**
 * 类型筛选项。只存 `labelKey`（不在加载期冻结文案）：渲染期用 `i18n.t(option.labelKey)`
 * 取值，切语言才能即时生效（Pattern C）。`as const` 保住 key 的字面量类型。
 */
export const VcsFileTypeFilterOptions = [
    { value: "all", labelKey: "vcs:fileType.all" },
    { value: "modified", labelKey: "vcs:fileType.modified" },
    { value: "added", labelKey: "vcs:fileType.added" },
    { value: "deleted", labelKey: "vcs:fileType.deleted" },
    { value: "renamed", labelKey: "vcs:fileType.renamed" },
    { value: "untracked", labelKey: "vcs:fileType.untracked" },
    { value: "staged", labelKey: "vcs:fileType.staged" },
    { value: "unstaged", labelKey: "vcs:fileType.unstaged" },
] as const satisfies readonly { value: VcsFileTypeFilter; labelKey: string }[];

function normalizeVcsStatusCode(status: VcsFileStatus): string {
    return (status?.code ?? "").trim().toUpperCase();
}

function normalizeExtensionFilters(extensionFilter: string): string[] {
    return (extensionFilter ?? "")
        .toLowerCase()
        .split(/[,\s;]+/)
        .map((extension) => extension.trim())
        .filter((extension) => extension !== "")
        .map((extension) => (extension.startsWith(".") ? extension : `.${extension}`))
        .filter((extension) => extension.length > 1);
}

export function vcsFileStatusMatchesExtension(status: VcsFileStatus, extensionFilter: string): boolean {
    const extensions = normalizeExtensionFilters(extensionFilter);
    if (extensions.length === 0) {
        return true;
    }
    const path = (status?.path ?? "").replace(/\\/g, "/").toLowerCase();
    const fileName = path.split("/").filter(Boolean).pop() ?? path;
    return extensions.some((extension) => fileName.endsWith(extension));
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
    typeFilter: VcsFileTypeFilter,
    extensionFilter: string = ""
): VcsFileStatus[] {
    const searchText = (search ?? "").trim().toLowerCase();
    return (statuses ?? []).filter((status) => {
        if (!vcsFileStatusMatchesType(status, typeFilter)) {
            return false;
        }
        if (!vcsFileStatusMatchesExtension(status, extensionFilter)) {
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
