// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { createBlock } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { addOpenMenuItems } from "@/util/previewutil";
import { fireAndForget, isBlank, makeConnRoute } from "@/util/util";
import dayjs from "dayjs";
import React from "react";
import { quote as shellQuote } from "shell-quote";
import { type PreviewModel } from "./preview-model";

export const recursiveError = "recursive flag must be set for directory operations";
export const overwriteError = "set overwrite flag to delete the existing file";
export const mergeError = "set overwrite flag to delete the existing contents or set merge flag to merge the contents";

export const displaySuffixes = {
    B: "b",
    kB: "k",
    MB: "m",
    GB: "g",
    TB: "t",
    KiB: "k",
    MiB: "m",
    GiB: "g",
    TiB: "t",
};

export function getBestUnit(bytes: number, si = false, sigfig = 3): string {
    if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "-";
    if (bytes === 0) return "0B";

    const units = si ? ["kB", "MB", "GB", "TB"] : ["KiB", "MiB", "GiB", "TiB"];
    const divisor = si ? 1000 : 1024;

    const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(divisor)), units.length);
    const unit = idx === 0 ? "B" : units[idx - 1];
    const value = bytes / Math.pow(divisor, idx);

    return `${parseFloat(value.toPrecision(sigfig))}${displaySuffixes[unit] ?? unit}`;
}

function padDay(day: number) {
    return String(day).padStart(2, " ");
}

export function getLastModifiedTime(unixMillis: number): string {
    const file = dayjs(unixMillis);
    const now = dayjs();

    const day = padDay(file.date());
    const time = file.format("HH:mm");

    if (now.isSame(file, "year")) {
        return `${file.format("MMM")} ${day} ${time}`;
    }

    return `${file.format("YYYY-MM-DD")}`;
}

const iconRegex = /^[a-z0-9- ]+$/;

export function isIconValid(icon: string): boolean {
    if (isBlank(icon)) {
        return false;
    }
    return icon.match(iconRegex) != null;
}

export function getSortIcon(sortType: string | boolean): React.ReactNode {
    switch (sortType) {
        case "asc":
            return <i className="fa-solid fa-chevron-up dir-table-head-direction"></i>;
        case "desc":
            return <i className="fa-solid fa-chevron-down dir-table-head-direction"></i>;
        default:
            return null;
    }
}

export function cleanMimetype(input: string): string {
    const truncated = input.split(";")[0];
    return truncated.trim();
}

export function handleRename(
    model: PreviewModel,
    path: string,
    newPath: string,
    isDir: boolean,
    setErrorMsg: (msg: ErrorMsg) => void
) {
    fireAndForget(async () => {
        try {
            let srcuri = await model.formatRemoteUri(path, globalStore.get);
            if (isDir) {
                srcuri += "/";
            }
            await model.env.rpc.FileMoveCommand(TabRpcClient, {
                srcuri,
                desturi: await model.formatRemoteUri(newPath, globalStore.get),
            });
        } catch (e) {
            const errorText = `${e}`;
            console.warn(`Rename failed: ${errorText}`);
            const errorMsg: ErrorMsg = {
                status: "Rename Failed",
                text: `${e}`,
            };
            setErrorMsg(errorMsg);
        }
        model.refreshCallback();
    });
}

export function handleFileDelete(
    model: PreviewModel,
    path: string,
    recursive: boolean,
    setErrorMsg: (msg: ErrorMsg) => void
) {
    fireAndForget(async () => {
        const formattedPath = await model.formatRemoteUri(path, globalStore.get);
        try {
            await model.env.rpc.FileDeleteCommand(TabRpcClient, {
                path: formattedPath,
                recursive,
            });
        } catch (e) {
            const errorText = `${e}`;
            console.warn(`Delete failed: ${errorText}`);
            let errorMsg: ErrorMsg;
            if (errorText.includes(recursiveError) && !recursive) {
                errorMsg = {
                    status: "Confirm Delete Directory",
                    text: "Deleting a directory requires the recursive flag. Proceed?",
                    level: "warning",
                    buttons: [
                        {
                            text: "Delete Recursively",
                            onClick: () => handleFileDelete(model, path, true, setErrorMsg),
                        },
                    ],
                };
            } else {
                errorMsg = {
                    status: "Delete Failed",
                    text: `${e}`,
                };
            }
            setErrorMsg(errorMsg);
        }
        model.refreshCallback();
    });
}

export function makeDirectoryDefaultMenuItems(model: PreviewModel): ContextMenuItem[] {
    const defaultSort = globalStore.get(model.env.getSettingsKeyAtom("preview:defaultsort")) ?? "name";
    const showHiddenFiles = globalStore.get(model.showHiddenFiles) ?? true;
    return [
        {
            label: "Directory Sort Order",
            submenu: [
                {
                    label: "Name",
                    type: "checkbox",
                    checked: defaultSort === "name",
                    click: () =>
                        fireAndForget(() =>
                            model.env.rpc.SetConfigCommand(TabRpcClient, { "preview:defaultsort": "name" })
                        ),
                },
                {
                    label: "Last Modified",
                    type: "checkbox",
                    checked: defaultSort === "modtime",
                    click: () =>
                        fireAndForget(() =>
                            model.env.rpc.SetConfigCommand(TabRpcClient, { "preview:defaultsort": "modtime" })
                        ),
                },
            ],
        },
        {
            label: "Show Hidden Files",
            submenu: [
                {
                    label: "On",
                    type: "checkbox",
                    checked: showHiddenFiles,
                    click: () => {
                        globalStore.set(model.showHiddenFiles, true);
                        fireAndForget(() =>
                            model.env.rpc.SetConfigCommand(TabRpcClient, { "preview:showhiddenfiles": true })
                        );
                    },
                },
                {
                    label: "Off",
                    type: "checkbox",
                    checked: !showHiddenFiles,
                    click: () => {
                        globalStore.set(model.showHiddenFiles, false);
                        fireAndForget(() =>
                            model.env.rpc.SetConfigCommand(TabRpcClient, { "preview:showhiddenfiles": false })
                        );
                    },
                },
            ],
        },
    ];
}

type DirectoryEntryMenuActions = {
    newFile: () => void;
    newDirectory: () => void;
    rename: () => void;
};

type DirectoryBackgroundMenuActions = {
    newFile: () => void;
    newDirectory: () => void;
};

type DirectoryVcsMenuScope = "file" | "directory" | "background";

type DirectoryVcsResolveResult =
    | { kind: "none" }
    | { kind: "repo"; repo: VcsRepositoryInfo }
    | { kind: "error"; error: string };

function makeRepoMenuLabel(repo: VcsRepositoryInfo): string {
    return repo.repotype === "svn" ? "SVN" : "Git";
}

async function resolveRepoForPath(
    model: PreviewModel,
    conn: string,
    targetPath: string
): Promise<DirectoryVcsResolveResult> {
    if (isBlank(targetPath)) {
        return { kind: "none" };
    }
    const route = isBlank(conn) ? null : makeConnRoute(conn);
    try {
        const response = await model.env.rpc.RemoteVcsResolvePathCommand(
            TabRpcClient,
            {
                path: targetPath,
            },
            { route }
        );
        if (!isBlank(response.error)) {
            console.warn(`[vcsresolve] failed for ${targetPath}: ${response.error}`);
            return { kind: "error", error: response.error };
        }
        if (!response.matched || isBlank(response.repotype) || isBlank(response.repopath)) {
            return { kind: "none" };
        }
        return {
            kind: "repo",
            repo: {
                repoid: response.repoid ?? `${response.repotype}:${response.repopath}`,
                repotype: response.repotype,
                rootpath: response.repopath,
                name: response.reponame ?? response.repopath,
            },
        };
    } catch (e) {
        const errorText = `${e}`;
        console.warn(`[vcsresolve] exception for ${targetPath}: ${errorText}`);
        return { kind: "error", error: errorText };
    }
}

function makeRepoSyncLabel(repo: VcsRepositoryInfo): string {
    return repo.repotype === "svn" ? "Update" : "Pull";
}

function makeRepoCommitsLabel(repo: VcsRepositoryInfo): string {
    return repo.repotype === "svn" ? "View Repository Log" : "View Repository Commits";
}

async function openHistoryBlock(conn: string, repo: VcsRepositoryInfo, targetPath: string): Promise<void> {
    const blockDef: BlockDef = {
        meta: {
            view: "vcshistory",
            connection: conn,
            "vcshistory:repotype": repo.repotype,
            "vcshistory:repopath": repo.rootpath,
            "vcshistory:filepath": targetPath,
            "vcshistory:title": `History: ${targetPath}`,
        } as any,
    };
    await createBlock(blockDef);
}

async function openDiffBlock(conn: string, repo: VcsRepositoryInfo, targetPath: string): Promise<void> {
    const blockDef: BlockDef = {
        meta: {
            view: "vcsdiff",
            connection: conn,
            "vcsdiff:repotype": repo.repotype,
            "vcsdiff:repopath": repo.rootpath,
            "vcsdiff:filepath": targetPath,
            "vcsdiff:revision": "",
            "vcsdiff:mode": "side-by-side",
            "vcsdiff:title": `${targetPath} (working tree)`,
        } as any,
    };
    await createBlock(blockDef);
}

async function openCommitsBlock(conn: string, repo: VcsRepositoryInfo): Promise<void> {
    const blockDef: BlockDef = {
        meta: {
            view: "vcscommits",
            connection: conn,
            "vcscommits:repotype": repo.repotype,
            "vcscommits:repopath": repo.rootpath,
            "vcscommits:title": `${repo.name} ${repo.repotype === "svn" ? "Log" : "Commits"}`,
        } as any,
    };
    await createBlock(blockDef);
}

async function syncRepo(
    model: PreviewModel,
    conn: string,
    repo: VcsRepositoryInfo,
    setErrorMsg: (msg: ErrorMsg) => void
): Promise<void> {
    const route = isBlank(conn) ? null : makeConnRoute(conn);
    const syncLabel = makeRepoSyncLabel(repo);
    try {
        const response = await model.env.rpc.RemoteVcsSyncCommand(
            TabRpcClient,
            {
                repotype: repo.repotype,
                repopath: repo.rootpath,
            },
            { route }
        );
        if (!response.success) {
            setErrorMsg({
                status: `${syncLabel} Failed`,
                text: response.error || response.output || `${syncLabel} failed.`,
            });
        }
    } catch (e) {
        setErrorMsg({
            status: `${syncLabel} Failed`,
            text: `${e}`,
        });
    } finally {
        model.refreshCallback?.();
    }
}

function makeResolveFailureMenuItem(targetPath: string, errorText: string): ContextMenuItem {
    return {
        label: "Version Control",
        submenu: [
            {
                label: "Resolve Failed",
                enabled: false,
                sublabel: "See waveapp.log for details",
            },
            {
                label: "Copy Debug Info",
                click: () =>
                    fireAndForget(() =>
                        navigator.clipboard.writeText(`path: ${targetPath}\nerror: ${errorText}`)
                    ),
            },
        ],
    };
}

async function makeDirectoryVcsMenuItem(
    model: PreviewModel,
    conn: string,
    targetPath: string,
    scope: DirectoryVcsMenuScope,
    setErrorMsg: (msg: ErrorMsg) => void
): Promise<ContextMenuItem | null> {
    const resolveResult = await resolveRepoForPath(model, conn, targetPath);
    if (resolveResult.kind === "none") {
        return null;
    }
    if (resolveResult.kind === "error") {
        return makeResolveFailureMenuItem(targetPath, resolveResult.error);
    }
    const { repo } = resolveResult;
    const submenu: ContextMenuItem[] = [];
    if (scope === "background") {
        submenu.push({
            label: makeRepoCommitsLabel(repo),
            click: () => fireAndForget(() => openCommitsBlock(conn, repo)),
        });
    } else {
        submenu.push({
            label: "View History",
            click: () => fireAndForget(() => openHistoryBlock(conn, repo, targetPath)),
        });
        if (scope === "file") {
            submenu.push({
                label: "View Diff",
                click: () => fireAndForget(() => openDiffBlock(conn, repo, targetPath)),
            });
        }
    }
    submenu.push({
        label: makeRepoSyncLabel(repo),
        click: () => fireAndForget(() => syncRepo(model, conn, repo, setErrorMsg)),
    });
    return {
        label: makeRepoMenuLabel(repo),
        submenu,
    };
}

export async function makeDirectoryEntryMenuItems(
    model: PreviewModel,
    finfo: FileInfo,
    conn: string,
    setErrorMsg: (msg: ErrorMsg) => void,
    actions: DirectoryEntryMenuActions
): Promise<ContextMenuItem[]> {
    const fileName = finfo.path.split(/[\\/]/).pop() ?? finfo.name ?? finfo.path;
    const menu: ContextMenuItem[] = [
        {
            label: "New File",
            click: actions.newFile,
        },
        {
            label: "New Folder",
            click: actions.newDirectory,
        },
        {
            label: "Rename",
            click: actions.rename,
        },
        {
            type: "separator",
        },
        {
            label: "Copy File Name",
            click: () => fireAndForget(() => navigator.clipboard.writeText(fileName)),
        },
        {
            label: "Copy Full File Name",
            click: () => fireAndForget(() => navigator.clipboard.writeText(finfo.path)),
        },
        {
            label: "Copy File Name (Shell Quoted)",
            click: () => fireAndForget(() => navigator.clipboard.writeText(shellQuote([fileName]))),
        },
        {
            label: "Copy Full File Name (Shell Quoted)",
            click: () => fireAndForget(() => navigator.clipboard.writeText(shellQuote([finfo.path]))),
        },
    ];
    addOpenMenuItems(menu, conn, finfo);
    const vcsMenuItem = await makeDirectoryVcsMenuItem(
        model,
        conn,
        finfo.path,
        finfo.isdir ? "directory" : "file",
        setErrorMsg
    );
    if (vcsMenuItem) {
        menu.push({ type: "separator" }, vcsMenuItem);
    }
    menu.push(
        {
            type: "separator",
        },
        {
            label: "Default Settings",
            submenu: makeDirectoryDefaultMenuItems(model),
        },
        {
            type: "separator",
        },
        {
            label: "Delete",
            click: () => handleFileDelete(model, finfo.path, false, setErrorMsg),
        }
    );
    return menu;
}

export async function makeDirectoryBackgroundMenuItems(
    model: PreviewModel,
    conn: string,
    finfo: FileInfo,
    setErrorMsg: (msg: ErrorMsg) => void,
    actions: DirectoryBackgroundMenuActions
): Promise<ContextMenuItem[]> {
    const menu: ContextMenuItem[] = [
        {
            label: "New File",
            click: actions.newFile,
        },
        {
            label: "New Folder",
            click: actions.newDirectory,
        },
        {
            type: "separator",
        },
    ];
    addOpenMenuItems(menu, conn, finfo);
    const vcsMenuItem = await makeDirectoryVcsMenuItem(model, conn, finfo.path, "background", setErrorMsg);
    if (vcsMenuItem) {
        menu.push({ type: "separator" }, vcsMenuItem);
    }
    return menu;
}
