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
            },
            getSettingsKeyAtom: () => atom("name"),
        },
        showHiddenFiles: atom(true),
        refreshCallback: vi.fn(),
    };

    return {
        ...utils,
        createBlock,
        model,
        remoteVcsRepositories,
        remoteVcsSync,
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
});
