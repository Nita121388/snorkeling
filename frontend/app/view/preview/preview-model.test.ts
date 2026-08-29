// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { describe, expect, it, vi } from "vitest";

vi.mock("./preview", () => ({
    PreviewView: vi.fn(),
}));

vi.mock("@/layout/index", () => ({
    NavigateDirection: {
        Left: "left",
        Right: "right",
        Up: "up",
        Down: "down",
    },
    getLayoutModelForStaticTab: () => ({
        findBlockIdsInDirection: () => [],
        getNodeModel: () => null,
    }),
}));

// 测试环境不跑 initGlobalAtoms，补最小 atoms stub 供 getSettingsMenuItems 的
// override 配置链（fullConfig/settings）读取。
vi.mock("@/app/store/global-atoms", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/app/store/global-atoms")>();
    return {
        ...actual,
        atoms: {
            ...(actual.atoms ?? {}),
            // fullConfig 需要是对象而非 null：getConnConfigKeyAtom 会读 .connections
            fullConfigAtom: atom({}),
            settingsAtom: atom({}),
        },
    };
});

import { PreviewModel } from "./preview-model";

function flattenHeaderTitles(elems: HeaderElem[]): string[] {
    return elems.flatMap((elem) => {
        if (elem.elemtype === "div") {
            return flattenHeaderTitles(elem.children);
        }
        return elem.title ? [elem.title] : [];
    });
}

function makePreviewModel(connection: string): PreviewModel {
    const blockAtom = atom({
        meta: {
            file: "E:\\vault\\note.md",
            connection,
        },
    } as Block);
    const settingsAtom = atom(true);
    const model = new PreviewModel({
        blockId: "block-test",
        nodeModel: {} as any,
        tabModel: { tabAtom: atom({ blockids: [] }) } as any,
        waveEnv: {
            getSettingsKeyAtom: () => settingsAtom,
            wos: {
                getWaveObjectAtom: () => blockAtom,
            },
            getConnStatusAtom: () => atom({ status: "connected" }),
        } as any,
    });

    model.connStatus = atom({ status: "connected" } as ConnStatus);
    model.connectionImmediate = atom(connection);
    model.metaFilePath = atom("E:\\vault\\note.md");
    model.fileMimeTypeLoadable = atom({ state: "hasData", data: "text/markdown" } as any);
    model.loadableSpecializedView = atom({ state: "hasData", data: { specializedView: "preview" } } as any);
    model.loadableFileInfo = atom({
        state: "hasData",
        data: {
            path: "E:\\vault\\note.md",
            name: "note.md",
            dir: "E:\\vault",
            isdir: false,
            mimetype: "text/markdown",
        },
    } as any);
    model.newFileContent = atom(null) as any;
    model.directoryDisplayMode = atom("list") as any;
    model.liveSourceFilePath = atom(null);

    return model;
}

describe("PreviewModel Obsidian header actions", () => {
    it("puts Open in Obsidian in hover-only end icons for local markdown files", () => {
        const model = makePreviewModel("local");

        const endButtons = globalStore.get(model.endIconButtons);
        const viewText = globalStore.get(model.viewText) as HeaderElem[];

        expect(endButtons?.some((button) => button.title === "Open in Obsidian")).toBe(true);
        expect(flattenHeaderTitles(viewText)).not.toContain("Open in Obsidian");
    });

    it("omits Open in Obsidian for remote markdown files", () => {
        const model = makePreviewModel("ssh://host-a");

        const endButtons = globalStore.get(model.endIconButtons);
        const viewText = globalStore.get(model.viewText) as HeaderElem[];

        expect(endButtons?.some((button) => button.title === "Open in Obsidian")).toBe(false);
        expect(flattenHeaderTitles(viewText)).not.toContain("Open in Obsidian");
    });
});

describe("PreviewModel path-jump modal", () => {
    it("toggleOpenFileModal opens and closes the address modal", () => {
        const model = makePreviewModel("local");

        expect(globalStore.get(model.openFileModal)).toBe(false);
        model.toggleOpenFileModal();
        expect(globalStore.get(model.openFileModal)).toBe(true);
        model.toggleOpenFileModal();
        expect(globalStore.get(model.openFileModal)).toBe(false);
    });

    it("toggle respects the reopen delay after close", () => {
        vi.useFakeTimers();
        try {
            const model = makePreviewModel("local");
            model.toggleOpenFileModal();
            model.toggleOpenFileModal(); // close → arms 200ms reopen delay
            model.toggleOpenFileModal(); // inside delay window → ignored
            expect(globalStore.get(model.openFileModal)).toBe(false);
            vi.advanceTimersByTime(250);
            model.toggleOpenFileModal();
            expect(globalStore.get(model.openFileModal)).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it("exposes path-jump entries: header hover icon + settings menu item", () => {
        const model = makePreviewModel("local");

        const viewText = globalStore.get(model.viewText) as HeaderElem[];
        // hover 放大镜按钮嵌在 preview-filename-shell div 内层，递归按 title 找
        expect(flattenHeaderTitles(viewText)).toContain("Go to Path");

        const menuItems = model.getSettingsMenuItems();
        expect(menuItems.some((item) => item.label === "Go to Path...")).toBe(true);
        // 复制入口保留，与跳转共存
        expect(menuItems.some((item) => item.label === "Copy Full Path")).toBe(true);
    });
});
