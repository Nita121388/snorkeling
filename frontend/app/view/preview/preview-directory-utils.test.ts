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

async function loadDirectoryMenuUtils(repositories: VcsRepositoryInfo[], repositoryError?: Error) {
    vi.resetModules();
    const createBlock = vi.fn(async () => "block-id");
    const remoteVcsRepositories = vi.fn(async () => {
        if (repositoryError != null) {
            throw repositoryError;
        }
        return { repositories };
    });
    const remoteVcsSync = vi.fn(async () => ({ success: true }));
    const fileCopy = vi.fn(async () => undefined);

    vi.doMock("@/app/store/global", () => ({
        createBlock,
    }));
    vi.doMock("@/app/store/wshrpcutil", () => ({
        TabRpcClient: {},
    }));
    vi.doMock("@/util/previewutil", () => ({
        addOpenMenuItems: vi.fn(),
    }));

    const utils = await import("./preview-directory-utils");
    const model = {
        env: {
            rpc: {
                RemoteVcsRepositoriesCommand: remoteVcsRepositories,
                RemoteVcsSyncCommand: remoteVcsSync,
                FileCopyCommand: fileCopy,
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
        model,
        remoteVcsRepositories,
        remoteVcsSync,
        fileCopy,
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

describe("directory VCS context menus", () => {
    it("shows file-scoped Git actions and opens the VCS block for the selected file", async () => {
        const { makeDirectoryEntryMenuItems, createBlock, model } = await loadDirectoryMenuUtils([makeRepo("git")]);
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

    it("shows folder-scoped SVN actions without file diff and runs update", async () => {
        const { makeDirectoryEntryMenuItems, model, remoteVcsSync } = await loadDirectoryMenuUtils([makeRepo("svn")]);
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
            }
        );

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

    it("shows only repository-level actions in the background menu", async () => {
        const { makeDirectoryBackgroundMenuItems, createBlock, model } = await loadDirectoryMenuUtils([
            makeRepo("git"),
        ]);
        const menu = await makeDirectoryBackgroundMenuItems(
            model as any,
            "local",
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

    it("reports repository listing failures without using the old resolve-path command", async () => {
        const { makeDirectoryEntryMenuItems, model } = await loadDirectoryMenuUtils(
            [],
            new Error('command not implemented "remotevcsrepositories"')
        );
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

        getMenuItem(menu, "Copy Full File Names").click?.();
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

        getMenuItem(menu, "Copy Full File Name").click?.();
        await Promise.resolve();

        expect(writeText).toHaveBeenCalledWith("/repo/package.json");
    });
});
