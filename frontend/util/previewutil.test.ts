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
            })),
        }));
        vi.doMock("@/app/workspace/agent-launch", () => ({
            createDefaultAgentBlockDef: vi.fn(() => ({ meta: {} })),
        }));

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
});
