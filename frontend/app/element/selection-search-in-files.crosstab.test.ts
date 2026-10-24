// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Cross-tab target collection / scoring / routing for "Search In Files".
// file-link-navigation is mocked on purpose: its own openPathInPreview routing is covered
// by file-link-navigation.test.ts; here we only assert which tab this module asks for.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectPreviewTargets, resolvePreviewTarget, searchSelectionInFiles } from "./selection-search-in-files";

const mockState = vi.hoisted(() => {
    const atoms = {
        staticTabId: { __atom: "staticTabId" },
        settingsAtom: { __atom: "settingsAtom" },
        workspace: { __atom: "workspace" },
    };
    return {
        atoms,
        staticTabId: "tab-a",
        focusedBlockId: null as string | null,
        workspaceTabIds: [] as string[],
        settings: {} as any,
        tabs: {} as Record<string, any>,
        blocks: {} as Record<string, any>,
        bcms: [] as any[],
        files: {} as Record<string, any>,
        fileContents: {} as Record<string, string>,
        opened: [] as { path: string; options: any }[],
        menus: [] as any[][],
        feedback: [] as { msg: string; kind: string }[],
    };
});

vi.mock("@/app/store/global", () => {
    const getFromAtom = (atom: any) => {
        if (atom == null) {
            return null;
        }
        if (typeof atom.then === "function") {
            return atom;
        }
        if (atom === mockState.atoms.staticTabId) {
            return mockState.staticTabId;
        }
        if (atom === mockState.atoms.settingsAtom) {
            return mockState.settings;
        }
        if (atom === mockState.atoms.workspace) {
            return { oid: "ws-1", tabids: mockState.workspaceTabIds };
        }
        if (atom.__metaFilePath != null) {
            return atom.__metaFilePath;
        }
        const oref: string | undefined = atom.__oref;
        if (oref?.startsWith("tab:")) {
            return mockState.tabs[oref.slice("tab:".length)] ?? null;
        }
        if (oref?.startsWith("block:")) {
            return mockState.blocks[oref.slice("block:".length)] ?? null;
        }
        return null;
    };
    return {
        atoms: mockState.atoms,
        globalStore: { get: getFromAtom },
        WOS: {
            makeORef: (otype: string, oid: string) => `${otype}:${oid}`,
            getWaveObjectAtom: (oref: string) => ({ __oref: oref }),
            loadAndPinWaveObject: async (oref: string) => {
                if (oref.startsWith("tab:")) {
                    return mockState.tabs[oref.slice("tab:".length)] ?? null;
                }
                if (oref.startsWith("block:")) {
                    return mockState.blocks[oref.slice("block:".length)] ?? null;
                }
                return null;
            },
        },
        getAllBlockComponentModels: () => mockState.bcms,
        getFocusedBlockId: () => mockState.focusedBlockId,
    };
});

vi.mock("@/app/store/contextmenu", () => ({
    ContextMenuModel: {
        getInstance: () => ({
            showContextMenu: (menu: any[]) => {
                mockState.menus.push(menu);
            },
        }),
    },
}));

vi.mock("@/app/view/preview/file-link-navigation", () => {
    const normalizeConnection = (connection: unknown): string => {
        const value = typeof connection === "string" ? connection.trim() : "";
        return value === "" || value === "local" || value.startsWith("local:") ? "local" : value;
    };
    return {
        normalizeConnection,
        isTreeDisplayPreviewBlock: (block: any) => {
            if (block?.meta?.view !== "preview" || block.meta.edit === true) {
                return false;
            }
            return (block.meta?.["preview:directory-display"] ?? "tree") === "tree";
        },
        isPathWithinRoot: (targetPath: string, rootPath: string) => {
            const target = targetPath.replace(/\\/g, "/").toLowerCase();
            const root = rootPath.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
            return target === root || target.startsWith(`${root}/`);
        },
        openPathInPreview: async (path: string, options: any) => {
            mockState.opened.push({ path, options });
        },
    };
});

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        FileInfoCommand: async (_client: unknown, args: { info: { path: string } }) => {
            return mockState.files[args.info.path] ?? null;
        },
        FileReadCommand: async (_client: unknown, args: { info: { path: string } }) => {
            const content = mockState.fileContents[args.info.path];
            return { data64: content == null ? "" : Buffer.from(content, "utf-8").toString("base64") };
        },
    },
}));

vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

vi.mock("@/util/waveutil", () => ({
    formatRemoteUri: (path: string, connection: string) => `${connection ?? "local"}|${path}`,
}));

function resetMockState() {
    mockState.staticTabId = "tab-a";
    mockState.focusedBlockId = null;
    mockState.workspaceTabIds = [];
    mockState.settings = {};
    mockState.tabs = {};
    mockState.blocks = {};
    mockState.bcms = [];
    mockState.files = {};
    mockState.fileContents = {};
    mockState.opened = [];
    mockState.menus = [];
    mockState.feedback = [];
}

function addTab(tabId: string, name: string, blockIds: string[]) {
    mockState.tabs[tabId] = { oid: tabId, name, blockids: blockIds };
    mockState.workspaceTabIds.push(tabId);
}

function addDirectory(connection: string, path: string) {
    mockState.files[`${connection}|${path}`] = { path, isdir: true, mimetype: "directory" };
}

function addFile(connection: string, path: string, content = "") {
    mockState.files[`${connection}|${path}`] = { path, isdir: false, mimetype: "text/plain" };
    mockState.fileContents[`${connection}|${path}`] = content;
}

function addTreeBlock(blockId: string, rootPath: string, connection = "local", extraMeta: Record<string, any> = {}) {
    mockState.blocks[blockId] = {
        oid: blockId,
        meta: { view: "preview", file: rootPath, connection, ...extraMeta },
    };
    addDirectory(connection, rootPath);
}

// Minimal stand-in for a mounted PreviewModel (only the surface this module touches).
function addMountedTree(blockId: string, rootPath: string, connection = "local") {
    const shared = { path: rootPath, isdir: true, mimetype: "directory" };
    mockState.bcms.push({
        viewModel: {
            viewType: "preview",
            blockId,
            metaFilePath: { __metaFilePath: rootPath },
            connection: Promise.resolve(connection),
            statFile: Promise.resolve(shared),
            formatRemoteUri: async (path: string) => path,
            env: {
                rpc: {
                    FileInfoCommand: async (_client: unknown, args: { info: { path: string } }) =>
                        mockState.files[`${connection}|${args.info.path}`] ?? null,
                    FileReadCommand: async (_client: unknown, args: { info: { path: string } }) => ({
                        data64: Buffer.from(mockState.fileContents[`${connection}|${args.info.path}`] ?? "").toString(
                            "base64"
                        ),
                    }),
                },
            },
        },
    });
    addDirectory(connection, rootPath);
}

describe("collectPreviewTargets", () => {
    beforeEach(resetMockState);

    it("collects mounted current-tab trees plus object-store trees from other tabs", async () => {
        addTab("tab-a", "Tab A", ["mounted-tree"]);
        addTreeBlock("mounted-tree", "E:/code/snorkeling");
        addMountedTree("mounted-tree", "E:/code/snorkeling");
        addTab("tab-b", "Tab B", ["other-tree"]);
        addTreeBlock("other-tree", "E:/code/snorkeling/docs");

        const targets = await collectPreviewTargets();

        expect(targets).toHaveLength(2);
        expect(targets[0]).toMatchObject({ tabId: "tab-a", isCurrentTab: true, rootPath: "E:/code/snorkeling" });
        expect(targets[1]).toMatchObject({ tabId: "tab-b", isCurrentTab: false, rootPath: "E:/code/snorkeling/docs" });
        expect(targets[1].tabName).toBe("Tab B");
    });

    it("skips edit-mode and non-tree preview blocks", async () => {
        addTab("tab-a", "Tab A", []);
        addTab("tab-b", "Tab B", ["edit-block", "list-block", "tree-block"]);
        addTreeBlock("edit-block", "E:/code/a", "local", { edit: true });
        addTreeBlock("list-block", "E:/code/b", "local", { "preview:directory-display": "list" });
        addTreeBlock("tree-block", "E:/code/c");

        const targets = await collectPreviewTargets();

        expect(targets.map((target) => target.blockId)).toEqual(["tree-block"]);
    });

    it("does not depend on a tab ever being mounted", async () => {
        addTab("tab-a", "Tab A", []);
        addTab("tab-b", "Tab B", ["lazy-tree"]);
        addTreeBlock("lazy-tree", "/home/nita/project", "ssh-remote");

        const targets = await collectPreviewTargets("ssh-remote");

        expect(targets).toHaveLength(1);
        expect(targets[0]).toMatchObject({ tabId: "tab-b", connection: "ssh-remote", rootPath: "/home/nita/project" });
    });

    it("only collects tabs on the initiator connection (R1.4)", async () => {
        addTab("tab-a", "Tab A", []);
        addTab("tab-local", "Local", ["local-tree"]);
        addTreeBlock("local-tree", "E:/code/snorkeling", "local");
        addTab("tab-remote", "Remote", ["remote-tree"]);
        addTreeBlock("remote-tree", "/home/nita/snorkeling", "ssh-remote");

        const localTargets = await collectPreviewTargets("local");
        expect(localTargets).toHaveLength(1);
        expect(localTargets[0]).toMatchObject({ tabId: "tab-local", connection: "local" });

        const remoteTargets = await collectPreviewTargets("ssh-remote");
        expect(remoteTargets).toHaveLength(1);
        expect(remoteTargets[0]).toMatchObject({ tabId: "tab-remote", connection: "ssh-remote" });
    });
});

describe("resolvePreviewTarget", () => {
    beforeEach(resetMockState);

    it("prefers the current tab when the scores tie", async () => {
        addTab("tab-a", "Tab A", ["mounted-tree"]);
        addTreeBlock("mounted-tree", "E:/code/snorkeling");
        addMountedTree("mounted-tree", "E:/code/snorkeling");
        addTab("tab-b", "Tab B", ["other-tree"]);
        addTreeBlock("other-tree", "E:/code/snorkeling");
        addFile("local", "E:/code/snorkeling/pkg/remote/client.go");

        const targets = await collectPreviewTargets();
        const result = await resolvePreviewTarget(
            { rawText: "pkg/remote/client.go:42", filePath: "pkg/remote/client.go", lineNumber: 42 },
            targets
        );

        expect(result.status).toBe("resolved");
        if (result.status !== "resolved") {
            return;
        }
        expect(result.target.tabId).toBe("tab-a");
        expect(result.target.filePath).toBe("E:/code/snorkeling/pkg/remote/client.go");
    });

    it("reports ambiguity when two tabs resolve the same relative path", async () => {
        addTab("tab-a", "Tab A", []);
        addTab("tab-b", "Tab B", ["tree-b"]);
        addTreeBlock("tree-b", "E:/code/snorkeling");
        addTab("tab-c", "Tab C", ["tree-c"]);
        addTreeBlock("tree-c", "E:/code/snorkeling");
        addFile("local", "E:/code/snorkeling/pkg/remote/client.go");

        const targets = await collectPreviewTargets();
        const result = await resolvePreviewTarget(
            { rawText: "pkg/remote/client.go", filePath: "pkg/remote/client.go" },
            targets
        );

        expect(result.status).toBe("ambiguous");
        if (result.status !== "ambiguous") {
            return;
        }
        expect(result.matches.map((match) => match.tabId).sort()).toEqual(["tab-b", "tab-c"]);
    });

    it("does not report ambiguity for duplicate blocks inside one tab", async () => {
        addTab("tab-a", "Tab A", []);
        addTab("tab-b", "Tab B", ["tree-1", "tree-2"]);
        addTreeBlock("tree-1", "E:/code/snorkeling");
        addTreeBlock("tree-2", "E:/code/snorkeling");
        addFile("local", "E:/code/snorkeling/pkg/remote/client.go");

        const targets = await collectPreviewTargets();
        const result = await resolvePreviewTarget(
            { rawText: "pkg/remote/client.go", filePath: "pkg/remote/client.go" },
            targets
        );

        expect(result.status).toBe("resolved");
    });

    it("keeps local and remote connections isolated", async () => {
        addTab("tab-a", "Tab A", []);
        addTab("tab-local", "Local", ["local-tree"]);
        addTreeBlock("local-tree", "E:/code/snorkeling", "local");
        addTab("tab-remote", "Remote", ["remote-tree"]);
        addTreeBlock("remote-tree", "/home/nita/snorkeling", "ssh-remote");
        // same relative path exists on both connections, but only the remote one exists as a file
        addFile("local", "E:/code/snorkeling/pkg/remote/client.go");
        mockState.files["ssh-remote|/home/nita/snorkeling/pkg/remote/client.go"] = null;

        const remoteResult = await resolvePreviewTarget(
            {
                rawText: "/home/nita/snorkeling/pkg/remote/client.go",
                filePath: "/home/nita/snorkeling/pkg/remote/client.go",
            },
            await collectPreviewTargets("ssh-remote")
        );
        expect(remoteResult.status).toBe("notfound");

        addFile("ssh-remote", "/home/nita/snorkeling/pkg/remote/client.go");
        const remoteResolved = await resolvePreviewTarget(
            {
                rawText: "/home/nita/snorkeling/pkg/remote/client.go",
                filePath: "/home/nita/snorkeling/pkg/remote/client.go",
            },
            await collectPreviewTargets("ssh-remote")
        );
        expect(remoteResolved.status).toBe("resolved");
        if (remoteResolved.status === "resolved") {
            expect(remoteResolved.target.connection).toBe("ssh-remote");
            expect(remoteResolved.target.tabId).toBe("tab-remote");
        }
    });
});

describe("searchSelectionInFiles cross-tab routing", () => {
    beforeEach(resetMockState);

    function collectFeedback() {
        return (msg: string, kind: string) => {
            mockState.feedback.push({ msg, kind });
        };
    }

    it("opens the file in the other tab and reports the tab name", async () => {
        addTab("tab-a", "Tab A", []);
        addTab("tab-b", "Tab B", ["tree-b"]);
        addTreeBlock("tree-b", "E:/code/snorkeling/docs");
        addFile("local", "E:/code/snorkeling/docs/pkg/remote/client.go", "line1\nline2\nline3");

        await searchSelectionInFiles(
            { rawText: "./pkg/remote/client.go:3", filePath: "pkg/remote/client.go", lineNumber: 3 },
            { onFeedback: collectFeedback() }
        );

        expect(mockState.opened).toHaveLength(1);
        expect(mockState.opened[0].options.tabId).toBe("tab-b");
        expect(mockState.opened[0].options.lineNumber).toBe(3);
        expect(mockState.feedback).toEqual([{ msg: 'Opened in Tab "Tab B"', kind: "success" }]);
    });

    it("opens in the current tab when the file is outside the matched tree root", async () => {
        addTab("tab-a", "Tab A", []);
        addTab("tab-b", "Tab B", ["tree-b"]);
        addTreeBlock("tree-b", "E:/code/snorkeling/docs");
        addFile("local", "E:/code/elsewhere/notes.md");

        await searchSelectionInFiles(
            { rawText: "E:/code/elsewhere/notes.md", filePath: "E:/code/elsewhere/notes.md" },
            { onFeedback: collectFeedback() }
        );

        expect(mockState.opened).toHaveLength(1);
        expect(mockState.opened[0].options.tabId).toBe("tab-a");
        expect(mockState.feedback).toHaveLength(0);
    });

    it("shows a tab + relative path candidate menu on ambiguity", async () => {
        addTab("tab-a", "Tab A", []);
        addTab("tab-b", "Tab B", ["tree-b"]);
        addTreeBlock("tree-b", "E:/code/snorkeling");
        addTab("tab-c", "Tab C", ["tree-c"]);
        addTreeBlock("tree-c", "E:/code/snorkeling");
        addFile("local", "E:/code/snorkeling/pkg/remote/client.go");

        await searchSelectionInFiles(
            { rawText: "pkg/remote/client.go", filePath: "pkg/remote/client.go" },
            { onFeedback: collectFeedback() }
        );

        expect(mockState.opened).toHaveLength(0);
        expect(mockState.menus).toHaveLength(1);
        expect(mockState.menus[0].map((item) => item.label)).toEqual([
            "Tab B — pkg/remote/client.go",
            "Tab C — pkg/remote/client.go",
        ]);
    });

    it("reports a diagnostic message when no Files tree exists", async () => {
        addTab("tab-a", "Tab A", []);

        await searchSelectionInFiles(
            { rawText: "pkg/remote/client.go", filePath: "pkg/remote/client.go" },
            { onFeedback: collectFeedback() }
        );

        expect(mockState.opened).toHaveLength(0);
        expect(mockState.feedback).toHaveLength(1);
        expect(mockState.feedback[0].kind).toBe("warn");
        expect(mockState.feedback[0].msg).toContain("No Files tree");
    });

    it("only searches the initiator block's connection (R1.4)", async () => {
        addTab("tab-a", "Tab A", []);
        addTab("tab-local", "Local", ["local-tree"]);
        addTreeBlock("local-tree", "E:/code/snorkeling", "local");
        addTab("tab-remote", "Remote", ["remote-tree"]);
        addTreeBlock("remote-tree", "/home/nita/snorkeling", "ssh-remote");
        addFile("local", "E:/code/snorkeling/pkg/remote/client.go");
        addFile("ssh-remote", "/home/nita/snorkeling/pkg/remote/client.go");
        mockState.focusedBlockId = "initiator-remote";
        mockState.blocks["initiator-remote"] = {
            oid: "initiator-remote",
            meta: { view: "term", connection: "ssh-remote" },
        };

        await searchSelectionInFiles(
            { rawText: "pkg/remote/client.go", filePath: "pkg/remote/client.go" },
            { onFeedback: collectFeedback() }
        );

        expect(mockState.opened).toHaveLength(1);
        expect(mockState.opened[0].path).toBe("/home/nita/snorkeling/pkg/remote/client.go");
        expect(mockState.opened[0].options.tabId).toBe("tab-remote");
        expect(mockState.opened[0].options.connection).toBe("ssh-remote");
    });

    it("defaults the initiator connection to local when no block is focused", async () => {
        addTab("tab-a", "Tab A", []);
        addTab("tab-local", "Local", ["local-tree"]);
        addTreeBlock("local-tree", "E:/code/snorkeling", "local");
        addTab("tab-remote", "Remote", ["remote-tree"]);
        addTreeBlock("remote-tree", "/home/nita/snorkeling", "ssh-remote");
        addFile("local", "E:/code/snorkeling/pkg/remote/client.go");
        addFile("ssh-remote", "/home/nita/snorkeling/pkg/remote/client.go");

        await searchSelectionInFiles(
            { rawText: "pkg/remote/client.go", filePath: "pkg/remote/client.go" },
            { onFeedback: collectFeedback() }
        );

        expect(mockState.opened).toHaveLength(1);
        expect(mockState.opened[0].path).toBe("E:/code/snorkeling/pkg/remote/client.go");
        expect(mockState.opened[0].options.connection).toBe("local");
    });
});

describe("directory references", () => {
    beforeEach(resetMockState);

    function collectFeedback() {
        return (msg: string, kind: string) => {
            mockState.feedback.push({ msg, kind });
        };
    }

    it("resolves an absolute directory inside a covered tree (no ambiguity, no line)", async () => {
        addTab("tab-a", "Tab A", []);
        addTab("tab-b", "Tab B", ["tree-b"]);
        addTreeBlock("tree-b", "E:/code/snorkeling");
        addDirectory("local", "E:/code/snorkeling/frontend");

        await searchSelectionInFiles(
            {
                rawText: "E:/code/snorkeling/frontend",
                filePath: "E:/code/snorkeling/frontend",
                isDirectory: true,
                lineNumber: 42,
            },
            { onFeedback: collectFeedback() }
        );

        expect(mockState.opened).toHaveLength(1);
        expect(mockState.opened[0].path).toBe("E:/code/snorkeling/frontend");
        expect(mockState.opened[0].options.tabId).toBe("tab-b");
        // directory hits skip line targeting entirely
        expect(mockState.opened[0].options.lineNumber).toBeUndefined();
        expect(mockState.feedback).toEqual([{ msg: 'Opened in Tab "Tab B"', kind: "success" }]);
    });

    it("opens a directory outside every tree root in the current tab", async () => {
        addTab("tab-a", "Tab A", []);
        addTab("tab-b", "Tab B", ["tree-b"]);
        addTreeBlock("tree-b", "E:/code/snorkeling");
        addDirectory("local", "E:/code/other");

        await searchSelectionInFiles(
            { rawText: "E:/code/other", filePath: "E:/code/other", isDirectory: true },
            { onFeedback: collectFeedback() }
        );

        expect(mockState.opened).toHaveLength(1);
        expect(mockState.opened[0].path).toBe("E:/code/other");
        expect(mockState.opened[0].options.tabId).toBe("tab-a");
        expect(mockState.feedback).toHaveLength(0);
    });

    it("still skips directory hits for non-directory references", async () => {
        addTab("tab-a", "Tab A", ["tree-a"]);
        addTreeBlock("tree-a", "E:/code/snorkeling");
        addDirectory("local", "E:/code/snorkeling/frontend");

        const result = await resolvePreviewTarget(
            { rawText: "frontend", filePath: "frontend" },
            await collectPreviewTargets()
        );

        expect(result.status).toBe("notfound");
    });

    it("resolves the same path as a directory when the reference is marked as one", async () => {
        addTab("tab-a", "Tab A", ["tree-a"]);
        addTreeBlock("tree-a", "E:/code/snorkeling");
        addDirectory("local", "E:/code/snorkeling/frontend");

        const result = await resolvePreviewTarget(
            { rawText: "frontend", filePath: "frontend", isDirectory: true },
            await collectPreviewTargets()
        );

        expect(result.status).toBe("resolved");
        if (result.status === "resolved") {
            expect(result.target.filePath).toBe("E:/code/snorkeling/frontend");
        }
    });
});
