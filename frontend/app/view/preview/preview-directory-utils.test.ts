// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atom } from "jotai";
import { describe, expect, it, vi } from "vitest";

function makeRepo(repotype: string): VcsRepositoryInfo {
    return {
        repoid: `${repotype}:/repo`,
        repotype,
        rootpath: "/repo",
        name: "repo",
    };
}

async function loadDirectoryMenuUtils(
    repositories: VcsRepositoryInfo[],
    repositoryError?: Error,
    fileMoveError?: Error
) {
    vi.resetModules();
    const createBlock = vi.fn(async () => "block-id");
    const addOpenMenuItems = vi.fn((menu: ContextMenuItem[], _conn: string, _finfo: FileInfo) => {
        menu.push({ label: "Open Terminal Here" });
        menu.push({ label: "Run Agent Here" });
        return menu;
    });
    const remoteVcsRepositories = vi.fn(async () => {
        if (repositoryError != null) {
            throw repositoryError;
        }
        return { repositories };
    });
    const remoteVcsSync = vi.fn(async () => ({ success: true }));
    const fileCopy = vi.fn(async () => undefined);
    const fileMove = vi.fn(async () => {
        if (fileMoveError != null) {
            throw fileMoveError;
        }
    });

    vi.doMock("@/app/store/global", () => ({
        createBlock,
    }));
    vi.doMock("@/app/store/wshrpcutil", () => ({
        TabRpcClient: {},
    }));
    vi.doMock("@/util/previewutil", () => ({
        addOpenMenuItems,
    }));

    const utils = await import("./preview-directory-utils");
    const model = {
        env: {
            rpc: {
                RemoteVcsRepositoriesCommand: remoteVcsRepositories,
                RemoteVcsSyncCommand: remoteVcsSync,
                FileCopyCommand: fileCopy,
                FileMoveCommand: fileMove,
            },
            getSettingsKeyAtom: () => atom("name"),
        },
        formatRemoteUri: vi.fn(async (path: string) => `local:${path}`),
        showHiddenFiles: atom(true),
        refresh: vi.fn(),
    };

    return {
        ...utils,
        createBlock,
        addOpenMenuItems,
        model,
        remoteVcsRepositories,
        remoteVcsSync,
        fileCopy,
        fileMove,
    };
}

function getSubmenu(menu: ContextMenuItem[], label: string): ContextMenuItem[] {
    const item = menu.find((menuItem) => menuItem.label === label);
    expect(item).toBeDefined();
    return item?.submenu ?? [];
}

function labels(menu: ContextMenuItem[]): string[] {
    return menu.map((item) => item.label).filter((label): label is string => label != null);
}

function getMenuItem(menu: ContextMenuItem[], label: string): ContextMenuItem {
    const item = menu.find((menuItem) => menuItem.label === label);
    expect(item).toBeDefined();
    return item!;
}

async function flushVcsResolve(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe("directory VCS context menus", () => {
    it("shows a disabled VCS placeholder before the background resolve completes", async () => {
        const { makeDirectoryEntryMenuItems, model, remoteVcsRepositories } = await loadDirectoryMenuUtils([
            makeRepo("git"),
        ]);
        const menu = await makeDirectoryEntryMenuItems(
            model as any,
            {
                path: "/repo/src/index.ts",
                dir: "/repo/src",
                name: "index.ts",
                isdir: false,
            } as FileInfo,
            "local",
            vi.fn(),
            {
                newFile: vi.fn(),
                newDirectory: vi.fn(),
                rename: vi.fn(),
            }
        );

        const detectingItem = getMenuItem(menu, "Version Control: Detecting...");
        expect(detectingItem.enabled).toBe(false);
        expect(remoteVcsRepositories).toHaveBeenCalledTimes(1);
    });

    it("shows file-scoped Git actions from the resolve cache and opens the VCS block for the selected file", async () => {
        const { makeDirectoryEntryMenuItems, createBlock, model } = await loadDirectoryMenuUtils([makeRepo("git")]);
        const finfo = {
            path: "/repo/src/index.ts",
            dir: "/repo/src",
            name: "index.ts",
            isdir: false,
        } as FileInfo;
        await makeDirectoryEntryMenuItems(model as any, finfo, "local", vi.fn(), {
            newFile: vi.fn(),
            newDirectory: vi.fn(),
            rename: vi.fn(),
        });
        await flushVcsResolve();

        const menu = await makeDirectoryEntryMenuItems(model as any, finfo, "local", vi.fn(), {
            newFile: vi.fn(),
            newDirectory: vi.fn(),
            rename: vi.fn(),
        });
        const gitMenu = getSubmenu(menu, "Git");
        expect(labels(gitMenu)).toEqual(["View History", "View Diff", "View Repository Log", "Open VCS Block", "Pull"]);

        gitMenu.find((item) => item.label === "Open VCS Block")?.click?.();
        await Promise.resolve();

        expect(createBlock).toHaveBeenCalledWith({
            meta: expect.objectContaining({
                view: "vcs",
                connection: "local",
                "vcs:path": "/repo",
                "vcs:selectedfile": "/repo/src/index.ts",
            }),
        });
    });

    it("shows folder-scoped SVN actions from the resolve cache without file diff and runs update", async () => {
        const { makeDirectoryEntryMenuItems, model, remoteVcsSync } = await loadDirectoryMenuUtils([makeRepo("svn")]);
        const finfo = {
            path: "/repo/src",
            dir: "/repo",
            name: "src",
            isdir: true,
        } as FileInfo;
        await makeDirectoryEntryMenuItems(model as any, finfo, "local", vi.fn(), {
            newFile: vi.fn(),
            newDirectory: vi.fn(),
            rename: vi.fn(),
        });
        await flushVcsResolve();

        const menu = await makeDirectoryEntryMenuItems(model as any, finfo, "local", vi.fn(), {
            newFile: vi.fn(),
            newDirectory: vi.fn(),
            rename: vi.fn(),
        });
        const svnMenu = getSubmenu(menu, "SVN");
        expect(labels(svnMenu)).toEqual(["View History", "View Repository Log", "Open VCS Block", "Update"]);

        svnMenu.find((item) => item.label === "Update")?.click?.();
        await Promise.resolve();

        expect(remoteVcsSync).toHaveBeenCalledWith(
            expect.anything(),
            {
                repotype: "svn",
                repopath: "/repo",
            },
            expect.anything()
        );
    });

    it("shows only repository-level actions in the background menu from the resolve cache", async () => {
        const { makeDirectoryBackgroundMenuItems, createBlock, model } = await loadDirectoryMenuUtils([
            makeRepo("git"),
        ]);
        const finfo = {
            path: "/repo",
            dir: "/repo",
            name: "repo",
            isdir: true,
        } as FileInfo;
        await makeDirectoryBackgroundMenuItems(model as any, "local", finfo, vi.fn(), {
            newFile: vi.fn(),
            newDirectory: vi.fn(),
        });
        await flushVcsResolve();

        const menu = await makeDirectoryBackgroundMenuItems(model as any, "local", finfo, vi.fn(), {
            newFile: vi.fn(),
            newDirectory: vi.fn(),
        });
        const gitMenu = getSubmenu(menu, "Git");
        expect(labels(gitMenu)).toEqual(["Pull", "View History"]);

        gitMenu.find((item) => item.label === "View History")?.click?.();
        await Promise.resolve();

        expect(createBlock).toHaveBeenCalledWith({
            meta: expect.objectContaining({
                view: "vcscommits",
                connection: "local",
                "vcscommits:repotype": "git",
                "vcscommits:repopath": "/repo",
            }),
        });
    });

    it("routes blank preview connections through the local connection route", async () => {
        const { makeDirectoryBackgroundMenuItems, model, remoteVcsRepositories } = await loadDirectoryMenuUtils([
            makeRepo("git"),
        ]);
        await makeDirectoryBackgroundMenuItems(
            model as any,
            "",
            {
                path: "/repo",
                dir: "/repo",
                name: "repo",
                isdir: true,
            } as FileInfo,
            vi.fn(),
            {
                newFile: vi.fn(),
                newDirectory: vi.fn(),
            }
        );

        expect(remoteVcsRepositories).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                path: "/repo",
            }),
            expect.objectContaining({
                route: "conn:local",
            })
        );
    });

    it("reports repository listing failures after the background resolve completes", async () => {
        const { makeDirectoryEntryMenuItems, model } = await loadDirectoryMenuUtils(
            [],
            new Error('command not implemented "remotevcsrepositories"')
        );
        const finfo = {
            path: "/repo/src/index.ts",
            dir: "/repo/src",
            name: "index.ts",
            isdir: false,
        } as FileInfo;
        await makeDirectoryEntryMenuItems(model as any, finfo, "local", vi.fn(), {
            newFile: vi.fn(),
            newDirectory: vi.fn(),
            rename: vi.fn(),
        });
        await flushVcsResolve();

        const menu = await makeDirectoryEntryMenuItems(model as any, finfo, "local", vi.fn(), {
            newFile: vi.fn(),
            newDirectory: vi.fn(),
            rename: vi.fn(),
        });
        const vcsMenu = getSubmenu(menu, "Version Control");
        expect(labels(vcsMenu)).toEqual(["Resolve Failed", "Copy Debug Info"]);
        expect(vcsMenu[0].sublabel).toContain("remotevcsrepositories");
    });

    it("copies all selected full paths when the context file is selected", async () => {
        const writeText = vi.fn(async () => undefined);
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        const { makeDirectoryEntryMenuItems, model } = await loadDirectoryMenuUtils([]);
        const menu = await makeDirectoryEntryMenuItems(
            model as any,
            {
                path: "/repo/src/index.ts",
                dir: "/repo/src",
                name: "index.ts",
                isdir: false,
            } as FileInfo,
            "local",
            vi.fn(),
            {
                newFile: vi.fn(),
                newDirectory: vi.fn(),
                rename: vi.fn(),
            },
            {
                relativePathRoot: "/repo",
                selectedFileInfos: [
                    {
                        path: "/repo/src/index.ts",
                        dir: "/repo/src",
                        name: "index.ts",
                        isdir: false,
                    } as FileInfo,
                    {
                        path: "/repo/README.md",
                        dir: "/repo",
                        name: "README.md",
                        isdir: false,
                    } as FileInfo,
                ],
            }
        );

        getMenuItem(menu, "Copy Full Paths").click?.();
        await Promise.resolve();

        expect(writeText).toHaveBeenCalledWith("/repo/src/index.ts\n/repo/README.md");
    });

    it("sets the Files clipboard when Copy is selected for multiple files", async () => {
        const { makeDirectoryEntryMenuItems, model } = await loadDirectoryMenuUtils([]);
        const utils = await import("./preview-file-clipboard");
        vi.stubGlobal("window", {
            api: {
                writeClipboardText: vi.fn(async () => true),
                writeClipboardFiles: vi.fn(async () => false),
            },
        });
        const menu = await makeDirectoryEntryMenuItems(
            model as any,
            {
                path: "/repo/src/index.ts",
                dir: "/repo/src",
                name: "index.ts",
                isdir: false,
            } as FileInfo,
            "local",
            vi.fn(),
            {
                newFile: vi.fn(),
                newDirectory: vi.fn(),
                rename: vi.fn(),
            },
            {
                selectedFileInfos: [
                    {
                        path: "/repo/src/index.ts",
                        dir: "/repo/src",
                        name: "index.ts",
                        isdir: false,
                    } as FileInfo,
                    {
                        path: "/repo/README.md",
                        dir: "/repo",
                        name: "README.md",
                        isdir: false,
                    } as FileInfo,
                ],
            }
        );

        getMenuItem(menu, "Copy 2 Items").click?.();

        const { globalStore } = await import("@/app/store/jotaiStore");
        const clipboard = globalStore.get(utils.previewFileClipboardAtom);
        expect(clipboard?.items.map((item) => item.path)).toEqual(["/repo/src/index.ts", "/repo/README.md"]);
        expect((window as any).api.writeClipboardText).toHaveBeenCalledWith("/repo/src/index.ts\n/repo/README.md");
    });

    it("uses the latest Files clipboard when building a new background menu after Copy", async () => {
        const { makeDirectoryEntryMenuItems, makeDirectoryBackgroundMenuItems, model } = await loadDirectoryMenuUtils(
            []
        );
        vi.stubGlobal("window", {
            api: {
                writeClipboardText: vi.fn(async () => true),
                writeClipboardFiles: vi.fn(async () => false),
            },
        });
        const sourceMenu = await makeDirectoryEntryMenuItems(
            model as any,
            {
                path: "/repo/README.md",
                dir: "/repo",
                name: "README.md",
                isdir: false,
            } as FileInfo,
            "local",
            vi.fn(),
            {
                newFile: vi.fn(),
                newDirectory: vi.fn(),
                rename: vi.fn(),
            }
        );

        getMenuItem(sourceMenu, "Copy").click?.();
        const targetMenu = await makeDirectoryBackgroundMenuItems(
            model as any,
            "local",
            {
                path: "/repo/src",
                dir: "/repo",
                name: "src",
                isdir: true,
            } as FileInfo,
            vi.fn(),
            {
                newFile: vi.fn(),
                newDirectory: vi.fn(),
            }
        );

        expect(getMenuItem(targetMenu, "Paste").enabled).toBe(true);
    });

    it("enables Paste in the background menu and copies clipboard files to the current directory", async () => {
        const { makeDirectoryBackgroundMenuItems, model, fileCopy } = await loadDirectoryMenuUtils([]);
        const clipboard = {
            mode: "copy",
            createdAt: 1,
            items: [
                {
                    path: "/repo/README.md",
                    name: "README.md",
                    isdir: false,
                    conn: "local",
                },
            ],
        };
        const menu = await makeDirectoryBackgroundMenuItems(
            model as any,
            "local",
            {
                path: "/repo/src",
                dir: "/repo",
                name: "src",
                isdir: true,
            } as FileInfo,
            vi.fn(),
            {
                newFile: vi.fn(),
                newDirectory: vi.fn(),
            },
            {
                clipboard: clipboard as any,
            }
        );

        const pasteItem = getMenuItem(menu, "Paste");
        expect(pasteItem.enabled).toBe(true);
        pasteItem.click?.();
        await Promise.resolve();
        await Promise.resolve();

        expect(fileCopy).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                srcuri: "wsh://local//repo/README.md",
                desturi: "wsh://local//repo/src",
            }),
            expect.objectContaining({
                timeout: 31536000000,
            })
        );
        expect(model.refresh).toHaveBeenCalled();
    });

    it("pastes into a folder from the folder entry context menu", async () => {
        const { makeDirectoryEntryMenuItems, model, fileCopy } = await loadDirectoryMenuUtils([]);
        const clipboard = {
            mode: "copy",
            createdAt: 1,
            items: [
                {
                    path: "/repo/README.md",
                    name: "README.md",
                    isdir: false,
                    conn: "local",
                },
            ],
        };
        const menu = await makeDirectoryEntryMenuItems(
            model as any,
            {
                path: "/repo/src",
                dir: "/repo",
                name: "src",
                isdir: true,
            } as FileInfo,
            "local",
            vi.fn(),
            {
                newFile: vi.fn(),
                newDirectory: vi.fn(),
                rename: vi.fn(),
            },
            {
                clipboard: clipboard as any,
            }
        );

        const pasteItem = getMenuItem(menu, "Paste Into Folder");
        expect(pasteItem.enabled).toBe(true);
        pasteItem.click?.();
        await Promise.resolve();
        await Promise.resolve();

        expect(fileCopy).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                srcuri: "wsh://local//repo/README.md",
                desturi: "wsh://local//repo/src",
            }),
            expect.objectContaining({
                timeout: 31536000000,
            })
        );
    });

    it("pastes into the parent directory from a file entry context menu", async () => {
        const { makeDirectoryEntryMenuItems, model, fileCopy } = await loadDirectoryMenuUtils([]);
        const clipboard = {
            mode: "copy",
            createdAt: 1,
            items: [
                {
                    path: "/repo/README.md",
                    name: "README.md",
                    isdir: false,
                    conn: "local",
                },
            ],
        };
        const menu = await makeDirectoryEntryMenuItems(
            model as any,
            {
                path: "/repo/src/index.ts",
                dir: "/repo/src",
                name: "index.ts",
                isdir: false,
            } as FileInfo,
            "local",
            vi.fn(),
            {
                newFile: vi.fn(),
                newDirectory: vi.fn(),
                rename: vi.fn(),
            },
            {
                clipboard: clipboard as any,
            }
        );

        const pasteItem = getMenuItem(menu, "Paste Here");
        expect(pasteItem.enabled).toBe(true);
        pasteItem.click?.();
        await Promise.resolve();
        await Promise.resolve();

        expect(fileCopy).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                srcuri: "wsh://local//repo/README.md",
                desturi: "wsh://local//repo/src",
            }),
            expect.objectContaining({
                timeout: 31536000000,
            })
        );
    });

    it("disables Paste in the background menu when the Files clipboard is empty", async () => {
        const { makeDirectoryBackgroundMenuItems, model } = await loadDirectoryMenuUtils([]);
        const menu = await makeDirectoryBackgroundMenuItems(
            model as any,
            "local",
            {
                path: "/repo/src",
                dir: "/repo",
                name: "src",
                isdir: true,
            } as FileInfo,
            vi.fn(),
            {
                newFile: vi.fn(),
                newDirectory: vi.fn(),
            }
        );

        expect(getMenuItem(menu, "Paste").enabled).toBe(false);
    });

    it("copies only the context file when right-clicking outside the current selection", async () => {
        const writeText = vi.fn(async () => undefined);
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        const { makeDirectoryEntryMenuItems, model } = await loadDirectoryMenuUtils([]);
        const menu = await makeDirectoryEntryMenuItems(
            model as any,
            {
                path: "/repo/package.json",
                dir: "/repo",
                name: "package.json",
                isdir: false,
            } as FileInfo,
            "local",
            vi.fn(),
            {
                newFile: vi.fn(),
                newDirectory: vi.fn(),
                rename: vi.fn(),
            },
            {
                selectedFileInfos: [
                    {
                        path: "/repo/src/index.ts",
                        dir: "/repo/src",
                        name: "index.ts",
                        isdir: false,
                    } as FileInfo,
                    {
                        path: "/repo/README.md",
                        dir: "/repo",
                        name: "README.md",
                        isdir: false,
                    } as FileInfo,
                ],
            }
        );

        getMenuItem(menu, "Copy Full Path").click?.();
        await Promise.resolve();

        expect(writeText).toHaveBeenCalledWith("/repo/package.json");
    });

    it("keeps open actions for Windows drive entries but hides rename and delete", async () => {
        const { makeDirectoryEntryMenuItems, addOpenMenuItems, model } = await loadDirectoryMenuUtils([]);
        const menu = await makeDirectoryEntryMenuItems(
            model as any,
            {
                path: "D:/",
                dir: "/__wave_windows_drives__",
                name: "D:",
                isdir: true,
                mimetype: "directory",
            } as FileInfo,
            "local",
            vi.fn(),
            {
                newFile: vi.fn(),
                newDirectory: vi.fn(),
                rename: vi.fn(),
            }
        );

        const menuLabels = labels(menu);
        expect(menuLabels).toContain("New File");
        expect(menuLabels).toContain("New Folder");
        expect(menuLabels).toContain("Paste Into Folder");
        expect(menuLabels).not.toContain("Rename");
        expect(menuLabels).not.toContain("Delete");
        expect(menuLabels).toContain("Open Terminal Here");
        expect(menuLabels).toContain("Run Agent Here");
        expect(addOpenMenuItems).toHaveBeenCalledWith(
            expect.any(Array),
            "local",
            expect.objectContaining({ path: "D:/" }),
            {
                openInCurrentBlock: undefined,
            }
        );
    });

    it("hides real directory actions on the virtual Windows drives root", async () => {
        const { makeDirectoryBackgroundMenuItems, addOpenMenuItems, model } = await loadDirectoryMenuUtils([]);
        const menu = await makeDirectoryBackgroundMenuItems(
            model as any,
            "local",
            {
                path: "/__wave_windows_drives__",
                dir: "/__wave_windows_drives__",
                name: "This PC",
                isdir: true,
                mimetype: "directory",
                supportsmkdir: false,
            } as FileInfo,
            vi.fn(),
            {
                newFile: vi.fn(),
                newDirectory: vi.fn(),
            }
        );

        expect(labels(menu)).toEqual([]);
        expect(addOpenMenuItems).not.toHaveBeenCalled();
    });
});

describe("directory move operations", () => {
    function fileInfo(path: string, name: string, isdir: boolean, dir?: string): FileInfo {
        return {
            path,
            dir: dir ?? path.substring(0, path.lastIndexOf("/")),
            name,
            isdir,
        } as FileInfo;
    }

    function makeMoveClipboard(paths: string[]): any {
        return {
            mode: "move",
            createdAt: 1,
            items: paths.map((path) => ({
                path,
                name: path.split("/").pop() ?? path,
                isdir: false,
                conn: "local",
            })),
        };
    }

    const baseActions = {
        newFile: vi.fn(),
        newDirectory: vi.fn(),
        rename: vi.fn(),
    };

    it("stages the Files clipboard in move mode when Cut is selected and shows a hint", async () => {
        const { makeDirectoryEntryMenuItems, model } = await loadDirectoryMenuUtils([]);
        vi.stubGlobal("window", {
            api: {
                writeClipboardText: vi.fn(async () => true),
                writeClipboardFiles: vi.fn(async () => false),
            },
        });
        const setErrorMsg = vi.fn();
        const menu = await makeDirectoryEntryMenuItems(
            model as any,
            fileInfo("/repo/README.md", "README.md", false),
            "local",
            setErrorMsg,
            baseActions
        );

        getMenuItem(menu, "Cut").click?.();

        const { globalStore } = await import("@/app/store/jotaiStore");
        const utils = await import("./preview-file-clipboard");
        const clipboard = globalStore.get(utils.previewFileClipboardAtom);
        expect(clipboard?.mode).toBe("move");
        expect(clipboard?.items.map((item) => item.path)).toEqual(["/repo/README.md"]);
        expect(setErrorMsg).toHaveBeenCalledWith(
            expect.objectContaining({ status: "Staged for Move", showDismiss: true })
        );
    });

    it("labels the paste target by the clipboard move mode", async () => {
        const { makeDirectoryEntryMenuItems, makeDirectoryBackgroundMenuItems, model } = await loadDirectoryMenuUtils(
            []
        );
        const clipboard = makeMoveClipboard(["/repo/README.md"]);
        const multiClipboard = makeMoveClipboard(["/repo/README.md", "/repo/package.json"]);

        const folderMenu = await makeDirectoryEntryMenuItems(
            model as any,
            fileInfo("/repo/src", "src", true),
            "local",
            vi.fn(),
            baseActions,
            { clipboard }
        );
        expect(getMenuItem(folderMenu, "Move Into Folder").enabled).toBe(true);

        const fileMenu = await makeDirectoryEntryMenuItems(
            model as any,
            fileInfo("/repo/src/index.ts", "index.ts", false),
            "local",
            vi.fn(),
            baseActions,
            { clipboard }
        );
        expect(getMenuItem(fileMenu, "Move Here").enabled).toBe(true);

        const multiFolderMenu = await makeDirectoryEntryMenuItems(
            model as any,
            fileInfo("/repo/src", "src", true),
            "local",
            vi.fn(),
            baseActions,
            { clipboard: multiClipboard }
        );
        expect(getMenuItem(multiFolderMenu, "Move 2 Items Into Folder").enabled).toBe(true);

        const bgMenu = await makeDirectoryBackgroundMenuItems(
            model as any,
            "local",
            fileInfo("/repo/src", "src", true),
            vi.fn(),
            { newFile: vi.fn(), newDirectory: vi.fn() },
            { clipboard }
        );
        expect(getMenuItem(bgMenu, "Move").enabled).toBe(true);
    });

    it("moves clipboard files to the destination via FileMoveCommand and clears the staged move", async () => {
        const { makeDirectoryBackgroundMenuItems, model, fileCopy, fileMove } = await loadDirectoryMenuUtils([]);
        const menu = await makeDirectoryBackgroundMenuItems(
            model as any,
            "local",
            fileInfo("/repo/src", "src", true),
            vi.fn(),
            { newFile: vi.fn(), newDirectory: vi.fn() },
            { clipboard: makeMoveClipboard(["/repo/README.md"]) }
        );

        getMenuItem(menu, "Move").click?.();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(fileMove).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                srcuri: "wsh://local//repo/README.md",
                desturi: "wsh://local//repo/src",
            }),
            expect.objectContaining({ timeout: 31536000000 })
        );
        expect(fileCopy).not.toHaveBeenCalled();
        expect(model.refresh).toHaveBeenCalled();
        const { globalStore } = await import("@/app/store/jotaiStore");
        const utils = await import("./preview-file-clipboard");
        expect(globalStore.get(utils.previewFileClipboardAtom)).toBeNull();
    });

    it("moves into a folder from the folder entry context menu", async () => {
        const { makeDirectoryEntryMenuItems, model, fileMove } = await loadDirectoryMenuUtils([]);
        const menu = await makeDirectoryEntryMenuItems(
            model as any,
            fileInfo("/repo/src", "src", true),
            "local",
            vi.fn(),
            baseActions,
            { clipboard: makeMoveClipboard(["/repo/README.md"]) }
        );

        getMenuItem(menu, "Move Into Folder").click?.();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(fileMove).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                srcuri: "wsh://local//repo/README.md",
                desturi: "wsh://local//repo/src",
            }),
            expect.objectContaining({ timeout: 31536000000 })
        );
    });

    it("reports Move Failed without an overwrite retry when the destination exists", async () => {
        const { makeDirectoryBackgroundMenuItems, model } = await loadDirectoryMenuUtils(
            [],
            undefined,
            new Error('destination "/repo/src" already exists')
        );
        const setErrorMsg = vi.fn();
        const menu = await makeDirectoryBackgroundMenuItems(
            model as any,
            "local",
            fileInfo("/repo/src", "src", true),
            setErrorMsg,
            { newFile: vi.fn(), newDirectory: vi.fn() },
            { clipboard: makeMoveClipboard(["/repo/README.md"]) }
        );

        getMenuItem(menu, "Move").click?.();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(setErrorMsg).toHaveBeenCalledWith(
            expect.objectContaining({ status: "Move Failed", text: expect.stringContaining("already exists") })
        );
        expect(setErrorMsg.mock.calls[0]?.[0]?.buttons).toBeUndefined();
        expect(model.refresh).toHaveBeenCalled();
    });

    it("shows Move to... for a single file and defers to the moveTo action", async () => {
        const { makeDirectoryEntryMenuItems, model } = await loadDirectoryMenuUtils([]);
        const moveTo = vi.fn();
        const menu = await makeDirectoryEntryMenuItems(
            model as any,
            fileInfo("/repo/src/index.ts", "index.ts", false),
            "local",
            vi.fn(),
            { ...baseActions, moveTo }
        );

        expect(labels(menu)).toContain("Move to...");
        getMenuItem(menu, "Move to...").click?.();
        expect(moveTo).toHaveBeenCalled();
    });

    it("hides Move to... for Windows drive entries and shows it for multi-selections", async () => {
        const { makeDirectoryEntryMenuItems, model } = await loadDirectoryMenuUtils([]);
        const driveMenu = await makeDirectoryEntryMenuItems(
            model as any,
            {
                path: "D:/",
                dir: "/__wave_windows_drives__",
                name: "D:",
                isdir: true,
                mimetype: "directory",
            } as FileInfo,
            "local",
            vi.fn(),
            { ...baseActions, moveTo: vi.fn() }
        );
        expect(labels(driveMenu)).not.toContain("Move to...");

        const multiMenu = await makeDirectoryEntryMenuItems(
            model as any,
            fileInfo("/repo/src/index.ts", "index.ts", false),
            "local",
            vi.fn(),
            { ...baseActions, moveTo: vi.fn() },
            {
                selectedFileInfos: [
                    fileInfo("/repo/src/index.ts", "index.ts", false),
                    fileInfo("/repo/README.md", "README.md", false),
                    fileInfo("/repo/package.json", "package.json", false),
                ],
            }
        );
        expect(labels(multiMenu)).toContain("Move to...");
        expect(labels(multiMenu)).toContain("Cut 3 Items");
        expect(labels(multiMenu)).not.toContain("Move 3 Items");
    });

    it("moves a single entry into a destination folder keeping its name via handleMoveTo", async () => {
        const { handleMoveTo, model, fileMove } = await loadDirectoryMenuUtils([]);
        const setErrorMsg = vi.fn();

        handleMoveTo(model as any, [fileInfo("/repo/src/index.ts", "index.ts", false)], "/repo/lib", setErrorMsg);
        await vi.waitFor(() => expect(fileMove).toHaveBeenCalled());

        expect(fileMove).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                srcuri: "local:/repo/src/index.ts",
                desturi: "local:/repo/lib/index.ts",
            })
        );
        expect(model.refresh).toHaveBeenCalled();
        expect(setErrorMsg).not.toHaveBeenCalled();
    });

    it("moves multiple entries keeping names and trailing-slash dirs on success", async () => {
        const { handleMoveTo, model, fileMove } = await loadDirectoryMenuUtils([]);
        const setErrorMsg = vi.fn();

        handleMoveTo(
            model as any,
            [fileInfo("/repo/src", "src", true), fileInfo("/repo/a.md", "a.md", false)],
            "/repo/dst/",
            setErrorMsg
        );
        await vi.waitFor(() => expect(fileMove).toHaveBeenCalledTimes(2));

        expect(fileMove).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                srcuri: "local:/repo/src/",
                desturi: "local:/repo/dst/src",
            })
        );
        expect(fileMove).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                srcuri: "local:/repo/a.md",
                desturi: "local:/repo/dst/a.md",
            })
        );
        expect(setErrorMsg).not.toHaveBeenCalled();
        expect(model.refresh).toHaveBeenCalled();
    });

    it("aborts the move on the first failing entry and reports Move Failed", async () => {
        const { handleMoveTo, model, fileMove } = await loadDirectoryMenuUtils([], undefined, new Error("move failed"));
        const setErrorMsg = vi.fn();

        handleMoveTo(
            model as any,
            [fileInfo("/repo/src", "src", true), fileInfo("/repo/a.md", "a.md", false)],
            "/repo/dst/",
            setErrorMsg
        );
        await vi.waitFor(() => expect(setErrorMsg).toHaveBeenCalled());

        expect(fileMove).toHaveBeenCalledTimes(1);
        expect(fileMove).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                srcuri: "local:/repo/src/",
                desturi: "local:/repo/dst/src",
            })
        );
        expect(setErrorMsg).toHaveBeenCalledWith(expect.objectContaining({ status: "Move Failed" }));
        expect(model.refresh).toHaveBeenCalled();
    });
});
