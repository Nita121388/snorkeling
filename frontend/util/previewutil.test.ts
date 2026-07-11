import { describe, expect, it, vi } from "vitest";

describe("addOpenMenuItems", () => {
    it("adds and runs the current-block action when provided", async () => {
        vi.resetModules();
        vi.doMock("@/app/store/global", () => ({
            createBlock: vi.fn(),
            getApi: vi.fn(() => ({
                downloadFile: vi.fn(),
                openInVSCode: vi.fn(),
                openNativePath: vi.fn(),
                revealNativePath: vi.fn(),
            })),
        }));
        vi.doMock("@/app/workspace/agent-launch", () => ({
            createDefaultAgentBlockDef: vi.fn(() => ({ meta: {} })),
        }));
        vi.doMock("./platformutil", async () => {
            const actual = await vi.importActual<typeof import("./platformutil")>("./platformutil");
            return {
                ...actual,
                isWindows: () => true,
                makeNativeLabel: actual.makeNativeLabel,
            };
        });

        const { addOpenMenuItems } = await import("./previewutil");
        const openInCurrentBlock = vi.fn();
        const menu: ContextMenuItem[] = [];

        addOpenMenuItems(
            menu,
            "ssh://host-a",
            {
                path: "/srv/repo/README.md",
                dir: "/srv/repo",
                isdir: false,
                name: "README.md",
            } as FileInfo,
            { openInCurrentBlock }
        );

        const openInThisBlockItem = menu.find((item) => item.label === "Open in This Block");
        const openInNewBlockItem = menu.find((item) => item.label === "Open Preview in New Block");

        expect(openInThisBlockItem).toBeDefined();
        expect(menu.indexOf(openInThisBlockItem!)).toBeLessThan(menu.indexOf(openInNewBlockItem!));

        openInThisBlockItem?.click?.();

        expect(openInCurrentBlock).toHaveBeenCalledTimes(1);
    });

    it("omits the current-block action when no callback is provided", async () => {
        vi.resetModules();
        vi.doMock("@/app/store/global", () => ({
            createBlock: vi.fn(),
            getApi: vi.fn(() => ({
                downloadFile: vi.fn(),
                openInVSCode: vi.fn(),
                openNativePath: vi.fn(),
                revealNativePath: vi.fn(),
            })),
        }));
        vi.doMock("@/app/workspace/agent-launch", () => ({
            createDefaultAgentBlockDef: vi.fn(() => ({ meta: {} })),
        }));

        const { addOpenMenuItems } = await import("./previewutil");
        const menu: ContextMenuItem[] = [];

        addOpenMenuItems(menu, "ssh://host-a", {
            path: "/srv/repo/README.md",
            dir: "/srv/repo",
            isdir: false,
            name: "README.md",
        } as FileInfo);

        expect(menu.some((item) => item.label === "Open in This Block")).toBe(false);
    });

    it("reveals local entries by their full path", async () => {
        vi.resetModules();
        const revealNativePath = vi.fn();
        const openNativePath = vi.fn();
        vi.doMock("@/app/store/global", () => ({
            createBlock: vi.fn(),
            getApi: vi.fn(() => ({
                downloadFile: vi.fn(),
                openInVSCode: vi.fn(),
                openNativePath,
                revealNativePath,
            })),
        }));
        vi.doMock("@/app/workspace/agent-launch", () => ({
            createDefaultAgentBlockDef: vi.fn(() => ({ meta: {} })),
        }));

        const { addOpenMenuItems } = await import("./previewutil");
        const menu: ContextMenuItem[] = [];

        addOpenMenuItems(menu, "local", {
            path: "E:\\Code\\AD\\docs\\model.md",
            dir: "E:\\Code\\AD\\docs",
            isdir: false,
            name: "model.md",
        } as FileInfo);

        const revealItem = menu.find((item) => item.label?.startsWith("Reveal in "));
        const openFileItem = menu.find((item) => item.label === "Open File in Default Application");

        revealItem?.click?.();
        openFileItem?.click?.();

        expect(revealNativePath).toHaveBeenCalledWith("E:\\Code\\AD\\docs\\model.md");
        expect(openNativePath).toHaveBeenCalledWith("E:\\Code\\AD\\docs\\model.md");
    });

    it("adds a default-app action for any local non-directory file", async () => {
        vi.resetModules();
        const openNativePath = vi.fn();
        vi.doMock("@/app/store/global", () => ({
            createBlock: vi.fn(),
            getApi: vi.fn(() => ({
                downloadFile: vi.fn(),
                openInVSCode: vi.fn(),
                openNativePath,
                revealNativePath: vi.fn(),
            })),
        }));
        vi.doMock("@/app/workspace/agent-launch", () => ({
            createDefaultAgentBlockDef: vi.fn(() => ({ meta: {} })),
        }));

        const { addOpenMenuItems } = await import("./previewutil");
        const menu: ContextMenuItem[] = [];

        addOpenMenuItems(menu, "local", {
            path: "C:\\Users\\nita\\.ssh\\config",
            dir: "C:\\Users\\nita\\.ssh",
            isdir: false,
            name: "config",
            mimetype: "",
            size: 128,
        } as FileInfo);

        const openFileItem = menu.find((item) => item.label === "Open File in Default Application");
        expect(openFileItem).toBeDefined();
        openFileItem?.click?.();
        expect(openNativePath).toHaveBeenCalledWith("C:\\Users\\nita\\.ssh\\config");
    });

    it("adds 'Open in Obsidian' for a local markdown file and runs the picker flow on click", async () => {
        vi.resetModules();
        const obsidianLoadMock = vi.fn(async () => []);
        const obsidianPickerMock = vi.fn(async (): Promise<"obsidian" | "fallback_to_picker" | "no_button"> => "obsidian");
        vi.doMock("@/app/view/preview/obsidian", () => ({
            loadObsidianVaults: obsidianLoadMock,
            openInObsidianWithPicker: obsidianPickerMock,
            isOpenableForObsidian: (path: string, _mime?: string | null) => path.endsWith(".md"),
        }));
        vi.doMock("@/app/store/global", () => ({
            createBlock: vi.fn(),
            getApi: vi.fn(() => ({
                downloadFile: vi.fn(),
                openInVSCode: vi.fn(),
                openNativePath: vi.fn(),
                revealNativePath: vi.fn(),
            })),
        }));
        vi.doMock("@/app/workspace/agent-launch", () => ({
            createDefaultAgentBlockDef: vi.fn(() => ({ meta: {} })),
        }));

        const { addOpenMenuItems } = await import("./previewutil");
        const menu: ContextMenuItem[] = [];

        addOpenMenuItems(menu, "local", {
            path: "E:\\vault\\note.md",
            dir: "E:\\vault",
            isdir: false,
            name: "note.md",
            mimetype: "text/markdown",
        } as FileInfo);

        const obsidianItem = menu.find((item) => item.label === "Open in Obsidian");
        expect(obsidianItem).toBeDefined();
        await obsidianItem?.click?.();
        expect(obsidianLoadMock).toHaveBeenCalledTimes(1);
        expect(obsidianPickerMock).toHaveBeenCalledWith({ absPath: "E:\\vault\\note.md" });
    });

    it("omits 'Open in Obsidian' for markdown files on remote connections", async () => {
        vi.resetModules();
        vi.doMock("@/app/view/preview/obsidian", () => ({
            loadObsidianVaults: vi.fn(async () => []),
            openInObsidianWithPicker: vi.fn(async () => "obsidian"),
            isOpenableForObsidian: (_path: string, _mime?: string | null) => true,
        }));
        vi.doMock("@/app/store/global", () => ({
            createBlock: vi.fn(),
            getApi: vi.fn(() => ({
                downloadFile: vi.fn(),
                openInVSCode: vi.fn(),
                openNativePath: vi.fn(),
                revealNativePath: vi.fn(),
            })),
        }));
        vi.doMock("@/app/workspace/agent-launch", () => ({
            createDefaultAgentBlockDef: vi.fn(() => ({ meta: {} })),
        }));

        const { addOpenMenuItems } = await import("./previewutil");
        const menu: ContextMenuItem[] = [];

        addOpenMenuItems(menu, "ssh://host-a", {
            path: "/srv/repo/README.md",
            dir: "/srv/repo",
            isdir: false,
            name: "README.md",
            mimetype: "text/markdown",
        } as FileInfo);

        expect(menu.some((item) => item.label === "Open in Obsidian")).toBe(false);
    });
});
