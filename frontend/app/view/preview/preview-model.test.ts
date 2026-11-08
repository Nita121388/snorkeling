// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { makeIconClass } from "@/util/util";
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

describe("PreviewModel header icon 契约（icon 必须能被渲染出来）", () => {
    // 回归背景：方向符号是文本/emoji（←→↑↓🧭），不是 FontAwesome 类名。
    // IconButton 对字符串 icon 走 makeIconClass()，它只认 FA 名，认不出就返回 null，
    // 于是渲染出一个 24px 宽、能点能 hover、但完全没有字形的空白按钮 ——
    // 用户看到的是 header 里一处莫名的「空缺」。
    //
    // 所以这里锁住：每个 header icon 要么是 React 元素节点（自己负责画），
    // 要么是 makeIconClass 能解析的 FA 类名字符串。绝不允许「会静默变空白」的值。
    /** 目录视图夹具：方向按钮 / 列表树切换只在这种视图出现。 */
    function makeDirectoryModel(): PreviewModel {
        const m = makePreviewModel("local");
        m.loadableSpecializedView = atom({ state: "hasData", data: { specializedView: "directory" } } as any);
        m.loadableFileInfo = atom({
            state: "hasData",
            data: { path: "E:\vault", name: "vault", dir: "E:\\", isdir: true, mimetype: "directory" },
        } as any);
        m.fileMimeTypeLoadable = atom({ state: "hasData", data: "directory" } as any);
        return m;
    }

    // 两种视图都要覆盖：只测 markdown 会漏掉只在目录视图出现的图标
    // （方向按钮就在那儿，正是它曾经渲染成空白）。
    const fixtures: { name: string; make: () => PreviewModel }[] = [
        { name: "markdown 视图", make: () => makePreviewModel("local") },
        { name: "目录视图", make: makeDirectoryModel },
    ];
    const groups: { name: string; pick: (m: PreviewModel) => IconButtonDecl[] | null }[] = [
        { name: "startIconButtons", pick: (m) => globalStore.get(m.startIconButtons) },
        { name: "endIconButtons", pick: (m) => globalStore.get(m.endIconButtons) },
    ];

    for (const f of fixtures) {
        for (const g of groups) {
            it(`${f.name} · ${g.name}: 每个 icon 都可渲染（元素节点 或 FA 类名）`, () => {
                const buttons = g.pick(f.make()) ?? [];
                const broken = buttons
                    .filter((b) => typeof b.icon === "string")
                    .filter((b) => makeIconClass(b.icon as string, true) == null)
                    .map((b) => `${b.title ?? "?"} → ${JSON.stringify(b.icon)}`);
                expect(broken).toEqual([]);
            });
        }
    }

    it("方向图标走元素节点（不是裸 emoji 字符串）", () => {
        const model = makeDirectoryModel();
        const buttons = globalStore.get(model.startIconButtons) ?? [];
        const target = buttons.find((b) => (b.title ?? "").startsWith("Open in directional block"));
        expect(target).toBeDefined();
        // 裸字符串 "🧭"/"←" 会被 makeIconClass 判为无效 → 空白按钮
        expect(typeof target.icon).not.toBe("string");
        expect(makeIconClass("🧭", true)).toBeNull(); // 记录这条约束为什么存在
    });
});
