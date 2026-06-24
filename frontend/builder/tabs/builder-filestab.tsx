// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { formatFileSize } from "@/app/aipanel/ai-utils";
import { Modal } from "@/app/modals/modal";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atoms, createBlock } from "@/store/global";
import { arrayToBase64, fireAndForget, isBlank, makeConnRoute, naturalStringCompare } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useRef, useState } from "react";

const MaxFileSize = 5 * 1024 * 1024; // 5MB
const ReadOnlyFileNames = ["static/tw.css"];

type FileEntry = {
    name: string;
    size: number;
    modified: string;
    isReadOnly: boolean;
};

type SupportedVcsRepoType = "git" | "svn";
type BuilderVcsMenuScope = "file" | "background";

type BuilderVcsResolveResult =
    | { kind: "none" }
    | { kind: "repos"; repos: VcsRepositoryInfo[] }
    | { kind: "error"; error: string };
type BuilderVcsResolveCacheEntry =
    | { state: "pending"; promise: Promise<void> }
    | { state: "ready"; result: BuilderVcsResolveResult };

// ponytail: Builder files are local-only today; invalidate this cache when Builder gets live repo mutation events.
const builderVcsResolveCache = new Map<string, BuilderVcsResolveCacheEntry>();

function getSupportedRepoType(repo: VcsRepositoryInfo): SupportedVcsRepoType | null {
    const repoType = repo.repotype?.trim().toLowerCase();
    if (repoType === "git" || repoType === "svn") {
        return repoType;
    }
    return null;
}

function makeRepoMenuLabel(repo: VcsRepositoryInfo): string {
    return getSupportedRepoType(repo) === "svn" ? "SVN" : "Git";
}

function makeRepoSyncLabel(repo: VcsRepositoryInfo): string {
    return getSupportedRepoType(repo) === "svn" ? "Update" : "Pull";
}

function joinAppFilePath(appPath: string, fileName: string): string {
    if (isBlank(appPath) || isBlank(fileName)) {
        return "";
    }
    const separator = appPath.includes("\\") ? "\\" : "/";
    const basePath = appPath.replace(/[\\/]+$/, "");
    const relativePath = fileName.replace(/^[\\/]+/, "").replace(/[\\/]+/g, separator);
    return `${basePath}${separator}${relativePath}`;
}

async function resolveRepoForPath(targetPath: string): Promise<BuilderVcsResolveResult> {
    if (isBlank(targetPath)) {
        return { kind: "none" };
    }
    const route = makeConnRoute("local");
    try {
        const repositoriesResponse = await RpcApi.RemoteVcsRepositoriesCommand(
            TabRpcClient,
            {
                path: targetPath,
                statuslimit: 1,
                scandepth: 1,
                includeparent: true,
            },
            { route }
        );
        const repositories = (repositoriesResponse.repositories ?? []).filter(
            (repo) => getSupportedRepoType(repo) != null && !isBlank(repo.rootpath)
        );
        if (repositories.length > 0) {
            return { kind: "repos", repos: repositories };
        }
        return { kind: "none" };
    } catch (e) {
        const errorText = `${e}`;
        console.warn(`[vcsrepositories] exception for ${targetPath}: ${errorText}`);
        return { kind: "error", error: errorText };
    }
}

async function openHistoryBlock(repo: VcsRepositoryInfo, targetPath: string): Promise<void> {
    await createBlock({
        meta: {
            view: "vcshistory",
            connection: "local",
            "vcshistory:repotype": repo.repotype,
            "vcshistory:repopath": repo.rootpath,
            "vcshistory:filepath": targetPath,
            "vcshistory:title": `History: ${targetPath}`,
        } as any,
    });
}

async function openDiffBlock(repo: VcsRepositoryInfo, targetPath: string): Promise<void> {
    await createBlock({
        meta: {
            view: "vcsdiff",
            connection: "local",
            "vcsdiff:repotype": repo.repotype,
            "vcsdiff:repopath": repo.rootpath,
            "vcsdiff:filepath": targetPath,
            "vcsdiff:revision": "",
            "vcsdiff:mode": "side-by-side",
            "vcsdiff:title": `${targetPath} (working tree)`,
        } as any,
    });
}

async function openRepoLogBlock(repo: VcsRepositoryInfo): Promise<void> {
    const repoType = getSupportedRepoType(repo);
    await createBlock({
        meta: {
            view: "vcscommits",
            connection: "local",
            "vcscommits:repotype": repo.repotype,
            "vcscommits:repopath": repo.rootpath,
            "vcscommits:title": `${repo.name} ${repoType === "svn" ? "Log" : "Commits"}`,
        } as any,
    });
}

async function openVcsBlock(repo: VcsRepositoryInfo, selectedPath: string): Promise<void> {
    const meta: Record<string, any> = {
        view: "vcs",
        connection: "local",
        "vcs:path": repo.rootpath,
    };
    if (!isBlank(selectedPath)) {
        meta["vcs:selectedfile"] = selectedPath;
    }
    await createBlock({ meta } as BlockDef);
}

async function syncRepo(
    repo: VcsRepositoryInfo,
    setError: (error: string) => void,
    refreshFiles: () => Promise<void>
): Promise<void> {
    const syncLabel = makeRepoSyncLabel(repo);
    const route = makeConnRoute("local");
    try {
        const response = await RpcApi.RemoteVcsSyncCommand(
            TabRpcClient,
            {
                repotype: repo.repotype,
                repopath: repo.rootpath,
            },
            { route }
        );
        if (!response.success) {
            setError(response.error || response.output || `${syncLabel} failed.`);
            return;
        }
        await refreshFiles();
    } catch (e) {
        setError(`${syncLabel} failed: ${e}`);
    }
}

function makeResolveFailureMenuItem(targetPath: string, errorText: string): ContextMenuItem {
    const debugText = `path: ${targetPath}\nerror: ${errorText}`;
    return {
        label: "Version Control",
        submenu: [
            {
                label: "Resolve Failed",
                enabled: false,
                sublabel: errorText,
            },
            {
                label: "Copy Debug Info",
                click: () => fireAndForget(() => navigator.clipboard.writeText(debugText)),
            },
        ],
    };
}

function makeBuilderVcsDetectingMenuItem(): ContextMenuItem {
    return {
        label: "Version Control: Detecting...",
        enabled: false,
    };
}

function startBuilderVcsResolve(targetPath: string): void {
    const existingEntry = builderVcsResolveCache.get(targetPath);
    if (existingEntry?.state === "pending") {
        return;
    }
    const promise = (async () => {
        const result = await resolveRepoForPath(targetPath);
        builderVcsResolveCache.set(targetPath, { state: "ready", result });
    })();
    builderVcsResolveCache.set(targetPath, { state: "pending", promise });
    fireAndForget(() => promise);
}

function makeBuilderVcsMenuItems(
    targetPath: string,
    scope: BuilderVcsMenuScope,
    setError: (error: string) => void,
    refreshFiles: () => Promise<void>
): ContextMenuItem[] {
    if (isBlank(targetPath)) {
        return [];
    }
    const cacheEntry = builderVcsResolveCache.get(targetPath);
    if (cacheEntry == null) {
        startBuilderVcsResolve(targetPath);
        return [makeBuilderVcsDetectingMenuItem()];
    }
    if (cacheEntry.state === "pending") {
        return [makeBuilderVcsDetectingMenuItem()];
    }
    const resolveResult = cacheEntry.result;
    if (resolveResult.kind === "none") {
        return [];
    }
    if (resolveResult.kind === "error") {
        return [makeResolveFailureMenuItem(targetPath, resolveResult.error)];
    }
    return resolveResult.repos.map((repo) => {
        const submenu: ContextMenuItem[] = [];
        if (scope === "background") {
            submenu.push({
                label: makeRepoSyncLabel(repo),
                click: () => fireAndForget(() => syncRepo(repo, setError, refreshFiles)),
            });
            submenu.push({
                label: "View History",
                click: () => fireAndForget(() => openRepoLogBlock(repo)),
            });
        } else {
            submenu.push({
                label: "View History",
                click: () => fireAndForget(() => openHistoryBlock(repo, targetPath)),
            });
            submenu.push({
                label: "View Diff",
                click: () => fireAndForget(() => openDiffBlock(repo, targetPath)),
            });
            submenu.push({
                label: "View Repository Log",
                click: () => fireAndForget(() => openRepoLogBlock(repo)),
            });
            submenu.push({
                label: "Open VCS Block",
                click: () => fireAndForget(() => openVcsBlock(repo, targetPath)),
            });
            submenu.push({
                label: makeRepoSyncLabel(repo),
                click: () => fireAndForget(() => syncRepo(repo, setError, refreshFiles)),
            });
        }
        return {
            label: makeRepoMenuLabel(repo),
            submenu,
        };
    });
}

const RenameFileModal = memo(
    ({ appId, fileName, onSuccess }: { appId: string; fileName: string; onSuccess: () => void }) => {
        const displayName = fileName.replace("static/", "");
        const [newName, setNewName] = useState(displayName);
        const [error, setError] = useState("");
        const [isRenaming, setIsRenaming] = useState(false);

        const handleRename = async () => {
            const trimmedName = newName.trim();
            if (!trimmedName) {
                setError("File name cannot be empty");
                return;
            }
            if (trimmedName.includes("/") || trimmedName.includes("\\")) {
                setError("File name cannot contain / or \\");
                return;
            }
            if (trimmedName === displayName) {
                modalsModel.popModal();
                return;
            }

            setIsRenaming(true);
            try {
                await RpcApi.RenameAppFileCommand(TabRpcClient, {
                    appid: appId,
                    fromfilename: fileName,
                    tofilename: `static/${trimmedName}`,
                });
                onSuccess();
                modalsModel.popModal();
            } catch (err) {
                console.log("Error renaming file:", err);
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                setIsRenaming(false);
            }
        };

        const handleClose = () => {
            modalsModel.popModal();
        };

        return (
            <Modal
                className="p-4 min-w-[500px]"
                onOk={handleRename}
                onCancel={handleClose}
                onClose={handleClose}
                okLabel="Rename"
                cancelLabel="Cancel"
                okDisabled={isRenaming || !newName.trim()}
            >
                <div className="flex flex-col gap-4 mb-4">
                    <h2 className="text-xl font-semibold">Rename File</h2>
                    <div className="flex flex-col gap-2">
                        <div className="text-sm text-secondary mb-1">
                            Current name: <span className="font-medium text-primary">{displayName}</span>
                        </div>
                        <input
                            type="text"
                            value={newName}
                            onChange={(e) => {
                                setNewName(e.target.value);
                                setError("");
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.nativeEvent.isComposing && newName.trim() && !error) {
                                    handleRename();
                                }
                            }}
                            className="px-3 py-2 bg-panel border border-border rounded focus:outline-none focus:border-accent"
                            autoFocus
                            disabled={isRenaming}
                            spellCheck={false}
                        />
                        {error && <div className="text-sm text-error">{error}</div>}
                    </div>
                </div>
            </Modal>
        );
    }
);

RenameFileModal.displayName = "RenameFileModal";

const DeleteFileModal = memo(
    ({ appId, fileName, onSuccess }: { appId: string; fileName: string; onSuccess: () => void }) => {
        const [isDeleting, setIsDeleting] = useState(false);
        const [error, setError] = useState("");

        const handleDelete = async () => {
            setIsDeleting(true);
            setError("");
            try {
                await RpcApi.DeleteAppFileCommand(TabRpcClient, {
                    appid: appId,
                    filename: fileName,
                });
                onSuccess();
                modalsModel.popModal();
            } catch (err) {
                console.log("Error deleting file:", err);
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                setIsDeleting(false);
            }
        };

        const handleClose = () => {
            modalsModel.popModal();
        };

        useEffect(() => {
            const handleKeyDown = (e: KeyboardEvent) => {
                if (e.key === "Enter" && !isDeleting) {
                    e.preventDefault();
                    handleDelete();
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    handleClose();
                }
            };

            document.addEventListener("keydown", handleKeyDown);
            return () => document.removeEventListener("keydown", handleKeyDown);
        }, [isDeleting]);

        return (
            <Modal
                className="p-4 min-w-[500px]"
                onOk={handleDelete}
                onCancel={handleClose}
                onClose={handleClose}
                okLabel="Delete"
                cancelLabel="Cancel"
                okDisabled={isDeleting}
            >
                <div className="flex flex-col gap-4 mb-4">
                    <h2 className="text-xl font-semibold">Delete File</h2>
                    <p>
                        Are you sure you want to delete <strong>{fileName.replace("static/", "")}</strong>?
                    </p>
                    <p className="text-sm text-secondary">This action cannot be undone.</p>
                    {error && <div className="text-sm text-error">{error}</div>}
                </div>
            </Modal>
        );
    }
);

DeleteFileModal.displayName = "DeleteFileModal";

const BuilderFilesTab = memo(() => {
    const builderAppId = useAtomValue(atoms.builderAppId);
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [appAbsolutePath, setAppAbsolutePath] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [isDragging, setIsDragging] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; fileName: string } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadFiles = useCallback(async () => {
        if (!builderAppId) return;

        setLoading(true);
        setError("");
        try {
            const result = await RpcApi.ListAllAppFilesCommand(TabRpcClient, { appid: builderAppId });
            setAppAbsolutePath(result.absolutepath ?? "");
            const fileEntries: FileEntry[] = result.entries
                .filter((entry) => !entry.dir && entry.name.startsWith("static/"))
                .map((entry) => ({
                    name: entry.name,
                    size: entry.size || 0,
                    modified: entry.modified,
                    isReadOnly: ReadOnlyFileNames.includes(entry.name),
                }))
                .sort((a, b) => naturalStringCompare(a.name, b.name));
            setFiles(fileEntries);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [builderAppId]);

    const handleRefresh = useCallback(async () => {
        // Clear files and add delay so UX shows the refresh is happening
        setFiles([]);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await loadFiles();
    }, [loadFiles]);

    useEffect(() => {
        loadFiles();
    }, [loadFiles]);

    useEffect(() => {
        const handleClickOutside = () => setContextMenu(null);
        if (contextMenu) {
            document.addEventListener("click", handleClickOutside);
            return () => document.removeEventListener("click", handleClickOutside);
        }
    }, [contextMenu]);

    const handleFileUpload = async (fileList: FileList) => {
        if (!builderAppId || fileList.length === 0) return;

        const file = fileList[0];
        if (file.size > MaxFileSize) {
            setError(`File size exceeds maximum allowed size of ${formatFileSize(MaxFileSize)}`);
            return;
        }

        setError("");
        setLoading(true);

        try {
            const arrayBuffer = await file.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            const base64Encoded = arrayToBase64(uint8Array);

            await RpcApi.WriteAppFileCommand(TabRpcClient, {
                appid: builderAppId,
                filename: `static/${file.name}`,
                data64: base64Encoded,
            });

            await loadFiles();
        } catch (err) {
            console.error("Error uploading file:", err);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        handleFileUpload(e.dataTransfer.files);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            handleFileUpload(e.target.files);
        }
    };

    const handleContextMenu = (e: React.MouseEvent, file: FileEntry) => {
        e.preventDefault();
        e.stopPropagation();

        const menu: ContextMenuItem[] = [];
        if (!file.isReadOnly) {
            menu.push(
                {
                    label: "Rename File",
                    click: () => {
                        modalsModel.pushModal("RenameFileModal", {
                            appId: builderAppId,
                            fileName: file.name,
                            onSuccess: loadFiles,
                        });
                    },
                },
                {
                    type: "separator",
                },
                {
                    label: "Delete File",
                    click: () => {
                        modalsModel.pushModal("DeleteFileModal", {
                            appId: builderAppId,
                            fileName: file.name,
                            onSuccess: loadFiles,
                        });
                    },
                }
            );
        }

        const vcsMenuItems = makeBuilderVcsMenuItems(
            joinAppFilePath(appAbsolutePath, file.name),
            "file",
            setError,
            loadFiles
        );
        if (vcsMenuItems.length > 0) {
            if (menu.length > 0) {
                menu.push({ type: "separator" });
            }
            menu.push(...vcsMenuItems);
        }
        if (menu.length === 0) {
            return;
        }

        ContextMenuModel.getInstance().showContextMenu(menu, e);
    };

    const handleBackgroundContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const menu = makeBuilderVcsMenuItems(appAbsolutePath, "background", setError, loadFiles);
        if (menu.length === 0) {
            return;
        }
        ContextMenuModel.getInstance().showContextMenu(menu, e);
    };

    return (
        <div
            className={`w-full h-full flex flex-col p-4 border-2 border-dashed transition-colors ${
                isDragging ? "bg-accent/5 border-accent" : "border-transparent"
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onContextMenu={handleBackgroundContextMenu}
        >
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Static Files</h2>
                <div className="flex gap-2">
                    <button
                        className="px-3 py-1 text-sm font-medium rounded bg-panel border border-border hover:bg-hover transition-colors cursor-pointer"
                        onClick={handleRefresh}
                        disabled={loading}
                        title="Refresh file list"
                    >
                        <i className="fa fa-refresh" />
                    </button>
                    <button
                        className="px-3 py-1 text-sm font-medium rounded bg-accent/80 text-primary hover:bg-accent transition-colors cursor-pointer"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={loading}
                    >
                        <i className="fa fa-plus mr-2" />
                        Add File
                    </button>
                </div>
                <input ref={fileInputRef} type="file" onChange={handleFileInputChange} className="hidden" />
            </div>

            {error && (
                <div className="mb-4 p-3 bg-error/10 border border-error/30 rounded text-sm text-error flex items-center gap-2">
                    <i className="fa fa-triangle-exclamation" />
                    <span>{error}</span>
                </div>
            )}

            <div className="mb-3 p-2 bg-blue-500/10 border border-blue-500/30 rounded text-sm text-secondary">
                Drag and drop files here or click "Add File". Maximum file size: {formatFileSize(MaxFileSize)}
            </div>

            <div className="flex-1 overflow-auto">
                {loading && files.length === 0 ? (
                    <div className="text-center text-secondary py-8">Loading files...</div>
                ) : files.length === 0 ? (
                    <div className="text-center text-secondary py-12">
                        <i className="fa fa-file text-4xl mb-3 opacity-50" />
                        <p>No files yet. Drag and drop files here or click "Add File" to get started.</p>
                    </div>
                ) : (
                    <div className="space-y-1">
                        {files.map((file) => (
                            <div
                                key={file.name}
                                className="flex items-center gap-3 p-2 bg-panel hover:bg-hover border border-border rounded transition-colors"
                                onContextMenu={(e) => handleContextMenu(e, file)}
                            >
                                <i className="fa fa-file text-secondary" />
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium truncate">{file.name.replace("static/", "")}</div>
                                    <div className="text-xs text-secondary">
                                        {formatFileSize(file.size)}
                                        {file.isReadOnly && (
                                            <span className="ml-2 text-warning">
                                                <i className="fa fa-lock mr-1" />
                                                Generated by framework (read-only)
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="text-xs text-secondary">{file.modified}</div>
                                {!file.isReadOnly && (
                                    <button
                                        className="px-2 py-1 hover:bg-hover rounded transition-colors cursor-pointer"
                                        onClick={(e) => handleContextMenu(e, file)}
                                        title="File options"
                                    >
                                        <i className="fa fa-ellipsis-vertical" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
});

BuilderFilesTab.displayName = "BuilderFilesTab";

export { BuilderFilesTab, DeleteFileModal, RenameFileModal };
