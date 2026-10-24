// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    applyPreviewOpenOptions,
    findMarkdownHeadingLine,
    isPathWithinRoot,
    isSamePreviewPath,
    normalizeLinkedFilePath,
    makeMarkdownWikiLinkHref,
    parseMarkdownWikiLink,
    parseMarkdownFileLineReference,
    openPathInPreview,
} from "@/app/view/preview/file-link-navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Step 1 regression net: "no tabId passed" must keep the pre-change behavior ──
// openPathInPreview resolves every tab-scoped lookup through atoms.staticTabId by
// default, so these mocks emulate a single mounted tab (the current tab).

const mockState = vi.hoisted(() => {
    const atoms = {
        staticTabId: { __atom: "staticTabId" },
        settingsAtom: { __atom: "settingsAtom" },
    };
    return {
        atoms,
        staticTabId: "tab-current",
        tabs: {} as Record<string, any>,
        blocks: {} as Record<string, any>,
        fileInfo: {} as Record<string, FileInfo | Error>,
        layoutNodes: {} as Record<string, { id: string }>,
        statPaths: [] as string[],
        updateMeta: [] as { oref: string; meta: any }[],
        createdBlocks: [] as any[],
        createdInTab: [] as { tabId: string; blockDef: any }[],
        activeTabs: [] as string[],
        focusedNodes: [] as string[],
        refocused: [] as string[],
        restored: [] as { tabId: string; blockId: string }[],
    };
});

vi.mock("@/app/store/global", () => {
    const getFromAtom = (atom: any) => {
        if (atom === mockState.atoms.staticTabId) {
            return mockState.staticTabId;
        }
        if (atom === mockState.atoms.settingsAtom) {
            return {};
        }
        const oref: string | undefined = atom?.__oref;
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
        getApi: () => ({
            setActiveTab: (tabId: string) => {
                mockState.activeTabs.push(tabId);
            },
        }),
        createBlock: async (blockDef: any) => {
            mockState.createdBlocks.push(blockDef);
            return `created-${mockState.createdBlocks.length}`;
        },
        getFocusedBlockId: () => null,
        refocusNode: (blockId: string) => {
            mockState.refocused.push(blockId);
        },
    };
});

vi.mock("@/app/store/services", () => ({
    ObjectService: {
        UpdateObjectMeta: async (oref: string, meta: any) => {
            mockState.updateMeta.push({ oref, meta });
        },
        CreateBlockInTab: async (tabId: string, blockDef: any) => {
            mockState.createdInTab.push({ tabId, blockDef });
            return `created-in-tab-${mockState.createdInTab.length}`;
        },
    },
}));

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        FileInfoCommand: async (_client: unknown, args: { info: { path: string } }) => {
            const path = args.info.path;
            mockState.statPaths.push(path);
            const result = mockState.fileInfo[path];
            if (result === undefined) {
                throw new Error(`no such file: ${path}`);
            }
            if (result instanceof Error) {
                throw result;
            }
            return result;
        },
    },
}));

vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

vi.mock("@/app/block/block-minimize", () => ({
    restoreMinimizedBlockToLayout: (tabId: string, blockId: string) => {
        mockState.restored.push({ tabId, blockId });
        return false;
    },
}));

vi.mock("@/layout/index", () => ({
    getLayoutModelForStaticTab: () => ({
        getNodeByBlockId: (blockId: string) => mockState.layoutNodes[blockId] ?? null,
    }),
    getLayoutModelForTabById: () => ({
        getNodeByBlockId: (blockId: string) => mockState.layoutNodes[blockId] ?? null,
        focusNode: (nodeId: string) => mockState.focusedNodes.push(nodeId),
    }),
}));

vi.mock("@/util/waveutil", () => ({ formatRemoteUri: (path: string) => path }));

const CURRENT_TAB_ID = "tab-current";
const TREE_ROOT = "E:/code/snorkeling";
const TARGET_FILE = "E:/code/snorkeling/pkg/remote/client.go";

function resetMockState() {
    mockState.staticTabId = CURRENT_TAB_ID;
    mockState.tabs = {};
    mockState.blocks = {};
    mockState.fileInfo = {};
    mockState.layoutNodes = {};
    mockState.statPaths = [];
    mockState.updateMeta = [];
    mockState.createdBlocks = [];
    mockState.createdInTab = [];
    mockState.activeTabs = [];
    mockState.focusedNodes = [];
    mockState.refocused = [];
    mockState.restored = [];
}

function addTab(tabId: string, blockIds: string[]) {
    mockState.tabs[tabId] = { oid: tabId, blockids: blockIds };
}

function addBlock(blockId: string, meta: Record<string, any>) {
    mockState.blocks[blockId] = { oid: blockId, meta };
}

function addTreeFilesBlock(blockId: string, rootPath: string, connection = "local") {
    addBlock(blockId, { view: "preview", file: rootPath, connection });
    mockState.fileInfo[rootPath] = { path: rootPath, isdir: true, mimetype: "directory" } as FileInfo;
}

describe("file link navigation helpers", () => {
    it("parses wiki links and preserves aliases and headings", () => {
        expect(parseMarkdownWikiLink("[[终端笔记|打开笔记]]")).toEqual({
            target: "终端笔记.md",
            label: "打开笔记",
            heading: undefined,
        });
        expect(parseMarkdownWikiLink(makeMarkdownWikiLinkHref("终端笔记.md", "TTY 驱动"))).toEqual({
            target: "终端笔记.md",
            label: "终端笔记.md",
            heading: "TTY 驱动",
        });
    });

    it("resolves wiki link headings to source lines", () => {
        expect(findMarkdownHeadingLine("# Overview\n\n## TTY 驱动\n内容", "TTY  驱动")).toBe(3);
        expect(findMarkdownHeadingLine("# Overview", "Missing")).toBeNull();
    });
    it("parses absolute markdown references with source lines", () => {
        expect(
            parseMarkdownFileLineReference(
                "E:/primary/Obsidian/Primary Mission/70-专业知识学习/05-技术基础/终端与OS基元/内核 tty 驱动 - 学习笔记.md:43"
            )
        ).toEqual({
            filePath:
                "E:/primary/Obsidian/Primary Mission/70-专业知识学习/05-技术基础/终端与OS基元/内核 tty 驱动 - 学习笔记.md",
            lineNumber: 43,
        });
        expect(parseMarkdownFileLineReference("E:/notes/readme.md:0")).toBeNull();
    });

    it("recognizes local file paths from markdown links", () => {
        expect(normalizeLinkedFilePath("E:/code/tpot/tpot/__init__.py")).toBe("E:/code/tpot/tpot/__init__.py");
        expect(normalizeLinkedFilePath("E:\\code\\tpot\\tpot\\__init__.py")).toBe("E:/code/tpot/tpot/__init__.py");
        expect(normalizeLinkedFilePath("/Users/nita/project/file.ts")).toBe("/Users/nita/project/file.ts");
        expect(normalizeLinkedFilePath("~/project/file.ts")).toBe("~/project/file.ts");
        expect(normalizeLinkedFilePath("file:///E:/code/tpot/tpot/__init__.py")).toBe("E:/code/tpot/tpot/__init__.py");
    });

    it("ignores web links and heading fragments", () => {
        expect(normalizeLinkedFilePath("https://example.com")).toBeNull();
        expect(normalizeLinkedFilePath("mailto:test@example.com")).toBeNull();
        expect(normalizeLinkedFilePath("#heading")).toBeNull();
        expect(normalizeLinkedFilePath("docs/readme.md")).toBeNull();
    });

    it("resolves relative markdown links against the current file directory", () => {
        expect(
            normalizeLinkedFilePath("docs/dl/README.md", {
                baseDir: "/Users/nita/Primary/projects/ai_learning/ai_interview_note",
            })
        ).toBe("/Users/nita/Primary/projects/ai_learning/ai_interview_note/docs/dl/README.md");
        expect(normalizeLinkedFilePath("../README.md#overview", { baseDir: "/tmp/project/docs" })).toBe(
            "/tmp/project/README.md"
        );
        expect(normalizeLinkedFilePath(".\\guide\\intro.md", { baseDir: "E:/code/project/docs" })).toBe(
            "E:/code/project/docs/guide/intro.md"
        );
    });

    it("checks whether a target path is under a tree root", () => {
        expect(isPathWithinRoot("E:/code/tpot/tpot/__init__.py", "E:/code/tpot")).toBe(true);
        expect(isPathWithinRoot("E:/code/tpot/tpot/__init__.py", "E:/")).toBe(true);
        expect(isPathWithinRoot("E:/code/tpot-other/file.py", "E:/code/tpot")).toBe(false);
        expect(isPathWithinRoot("/tmp/project/src/index.ts", "/tmp/project")).toBe(true);
        expect(isPathWithinRoot("/tmp/project2/index.ts", "/tmp/project")).toBe(false);
    });

    it("compares preview paths using normalized separators and trailing slashes", () => {
        expect(isSamePreviewPath("/tmp/project/src/index.ts", "/tmp/project/src/index.ts")).toBe(true);
        expect(isSamePreviewPath("/tmp/project/src/", "/tmp/project/src")).toBe(true);
        expect(isSamePreviewPath("E:\\code\\tpot\\tpot\\__init__.py", "E:/code/tpot/tpot/__init__.py")).toBe(true);
        expect(isSamePreviewPath("/tmp/project/src/index.ts", "/tmp/project2/src/index.ts")).toBe(false);
        expect(isSamePreviewPath("", "/tmp/project/src/index.ts")).toBe(false);
    });

    it("applies preview open options to newly-created preview block metadata", () => {
        expect(applyPreviewOpenOptions({ view: "preview" }, { lineNumber: 12.8, editMode: true })).toEqual({
            view: "preview",
            "preview:searchline": 12,
            edit: true,
        });
    });
});

describe("openPathInPreview without tabId (default current-tab routing)", () => {
    beforeEach(() => {
        resetMockState();
    });

    it("reveals the target in the current tab's Files tree block", async () => {
        addTab(CURRENT_TAB_ID, ["tree-block"]);
        addTreeFilesBlock("tree-block", TREE_ROOT);
        mockState.fileInfo[TARGET_FILE] = { path: TARGET_FILE, isdir: false, mimetype: "text/x-go" } as FileInfo;
        mockState.layoutNodes["tree-block"] = { id: "node-tree" };

        await openPathInPreview(TARGET_FILE);

        const revealUpdate = mockState.updateMeta.find((call) => call.oref === "block:tree-block");
        expect(revealUpdate).toBeDefined();
        expect(revealUpdate.meta["preview:revealpath"]).toBe(TARGET_FILE);
        expect(typeof revealUpdate.meta["preview:revealseq"]).toBe("number");
        expect(mockState.refocused).toContain("tree-block");
        expect(mockState.createdBlocks).toHaveLength(1);
        expect(mockState.createdBlocks[0].meta.file).toBe(TARGET_FILE);
    });

    it("reuses an existing non-edit preview block for the same path", async () => {
        addTab(CURRENT_TAB_ID, ["tree-block", "preview-block"]);
        addTreeFilesBlock("tree-block", TREE_ROOT);
        addBlock("preview-block", { view: "preview", file: TARGET_FILE, connection: "local" });
        mockState.fileInfo[TARGET_FILE] = { path: TARGET_FILE, isdir: false, mimetype: "text/x-go" } as FileInfo;
        mockState.layoutNodes["tree-block"] = { id: "node-tree" };
        mockState.layoutNodes["preview-block"] = { id: "node-preview" };

        await openPathInPreview(TARGET_FILE, { lineNumber: 42 });

        expect(mockState.createdBlocks).toHaveLength(0);
        expect(mockState.refocused).toContain("preview-block");
        const lineUpdate = mockState.updateMeta.find((call) => call.oref === "block:preview-block");
        expect(lineUpdate).toBeDefined();
        expect(lineUpdate.meta["preview:searchline"]).toBe(42);
    });

    it("creates a new preview block when no Files tree covers the path", async () => {
        addTab(CURRENT_TAB_ID, []);
        mockState.fileInfo[TARGET_FILE] = { path: TARGET_FILE, isdir: false, mimetype: "text/x-go" } as FileInfo;

        await openPathInPreview(TARGET_FILE);

        expect(mockState.updateMeta).toHaveLength(0);
        expect(mockState.createdBlocks).toHaveLength(1);
        expect(mockState.createdBlocks[0].meta).toMatchObject({
            view: "preview",
            file: TARGET_FILE,
            connection: "local",
            "preview:pathisdir": false,
        });
    });

    it("reveals a directory inside an existing Files tree without opening a nested tree", async () => {
        const targetDir = "E:/code/snorkeling/frontend";
        addTab(CURRENT_TAB_ID, ["tree-block"]);
        addTreeFilesBlock("tree-block", TREE_ROOT);
        mockState.fileInfo[targetDir] = { path: targetDir, isdir: true, mimetype: "directory" } as FileInfo;
        mockState.layoutNodes["tree-block"] = { id: "node-tree" };

        await openPathInPreview(targetDir);

        const revealUpdate = mockState.updateMeta.find((call) => call.oref === "block:tree-block");
        expect(revealUpdate?.meta["preview:revealpath"]).toBe(targetDir);
        expect(mockState.refocused).toContain("tree-block");
        expect(mockState.createdBlocks).toHaveLength(0);
    });

    it("creates a new tree block rooted at a directory no Files tree covers", async () => {
        const targetDir = "E:/code/other";
        addTab(CURRENT_TAB_ID, ["tree-block"]);
        addTreeFilesBlock("tree-block", TREE_ROOT);
        mockState.fileInfo[targetDir] = { path: targetDir, isdir: true, mimetype: "directory" } as FileInfo;
        mockState.layoutNodes["tree-block"] = { id: "node-tree" };

        await openPathInPreview(targetDir);

        expect(mockState.createdBlocks).toHaveLength(1);
        expect(mockState.createdBlocks[0].meta).toMatchObject({
            view: "preview",
            file: targetDir,
            "preview:directory-display": "tree",
            "preview:explorer-root": targetDir,
            "preview:pathisdir": true,
        });
    });
});

describe("openPathInPreview with an explicit tabId", () => {
    beforeEach(() => {
        resetMockState();
    });

    it("routes tree reveal and focus to the requested tab", async () => {
        addTab(CURRENT_TAB_ID, []);
        addTab("tab-other", ["other-tree-block"]);
        addTreeFilesBlock("other-tree-block", TREE_ROOT);
        mockState.fileInfo[TARGET_FILE] = { path: TARGET_FILE, isdir: false, mimetype: "text/x-go" } as FileInfo;
        mockState.layoutNodes["other-tree-block"] = { id: "node-other-tree" };

        await openPathInPreview(TARGET_FILE, { tabId: "tab-other" });

        const revealUpdate = mockState.updateMeta.find((call) => call.oref === "block:other-tree-block");
        expect(revealUpdate).toBeDefined();
        expect(revealUpdate.meta["preview:revealpath"]).toBe(TARGET_FILE);
        // Cross-tab focus must not go through refocusNode (hard-wired to the static tab).
        expect(mockState.refocused).toHaveLength(0);
        expect(mockState.focusedNodes).toContain("node-other-tree");
        expect(mockState.activeTabs).toEqual(["tab-other"]);
    });

    it("restores a minimized block into the requested tab's layout", async () => {
        addTab(CURRENT_TAB_ID, []);
        addTab("tab-other", ["other-preview-block"]);
        addBlock("other-preview-block", { view: "preview", file: TARGET_FILE, connection: "local" });
        mockState.fileInfo[TARGET_FILE] = { path: TARGET_FILE, isdir: false, mimetype: "text/x-go" } as FileInfo;

        await openPathInPreview(TARGET_FILE, { tabId: "tab-other" });

        expect(mockState.createdBlocks).toHaveLength(0);
        expect(mockState.createdInTab).toHaveLength(0);
        expect(mockState.restored).toContainEqual({ tabId: "tab-other", blockId: "other-preview-block" });
    });

    it("creates the preview block in the target tab through the object service", async () => {
        addTab(CURRENT_TAB_ID, []);
        addTab("tab-other", []);
        mockState.fileInfo[TARGET_FILE] = { path: TARGET_FILE, isdir: false, mimetype: "text/x-go" } as FileInfo;

        await openPathInPreview(TARGET_FILE, { tabId: "tab-other", lineNumber: 42 });

        expect(mockState.createdBlocks).toHaveLength(0);
        expect(mockState.createdInTab).toHaveLength(1);
        expect(mockState.createdInTab[0].tabId).toBe("tab-other");
        expect(mockState.createdInTab[0].blockDef.meta).toMatchObject({
            view: "preview",
            file: TARGET_FILE,
            "preview:searchline": 42,
        });
        expect(mockState.activeTabs).toEqual(["tab-other"]);
    });

    it("keeps the default current-tab path free of setActiveTab", async () => {
        addTab(CURRENT_TAB_ID, ["tree-block"]);
        addTreeFilesBlock("tree-block", TREE_ROOT);
        mockState.fileInfo[TARGET_FILE] = { path: TARGET_FILE, isdir: false, mimetype: "text/x-go" } as FileInfo;
        mockState.layoutNodes["tree-block"] = { id: "node-tree" };

        await openPathInPreview(TARGET_FILE, { tabId: CURRENT_TAB_ID });

        expect(mockState.activeTabs).toHaveLength(0);
        expect(mockState.refocused).toContain("tree-block");
    });
});
