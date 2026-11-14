// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// CommonText 弹窗交互回归锁（jsdom 组件级）。
//
// 锁定的两条交互：
//   A. Editor 显式收起通道 —— 多行草稿在失焦折叠判定里永远保持展开（valueHasNewline），
//      过去没有任何手动收缩手段，下半部列表/详情被持续挤压。这里断言：
//      聚焦 → 展开；拖高（inline height）后点收起 → 必须折回单行（inline 高度被盖掉）且
//      正文不丢；收起态下再聚焦不自动弹开；再点按钮 → 恢复多行且 inline 高度已清。
//   B. 详情属性区默认折叠 —— 默认只渲染一行 icon 摘要（4 个 key），完整 5 行网格
//      按需展开；锚点 data-commontext-properties 在 collapsed / expanded 之间切换。
//
// 真机验证台 commontext-source-notion 覆盖同一批断言，但该台依赖 Electron 启动器，
// 2026-11-13 本机启动器故障（连 newtab-empty 都无法启动），故这里用 jsdom 兜住
// 行为断言的机器判定，真机像素证据待环境修复后补跑。

// @vitest-environment jsdom

import { Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./commontext-page-icon", () => ({
    PageIconSlot: () => null,
}));

vi.mock("./commontext-send-button", () => ({
    CommontextSendButton: () => null,
}));

import { atoms, initGlobalAtoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { CommonTextComposeModal } from "./commontext-compose-modal";
import { OpenCommonTextSearchEvent } from "./commontext-events";

// jsdom 没有 ResizeObserver / matchMedia：initGlobalAtoms 会直接调 matchMedia（非可选链）。
if (typeof (globalThis as any).ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
}
if (typeof window.matchMedia !== "function") {
    (window as any).matchMedia = (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    });
}
// jsdom 的 Element 也没有 scrollTo / scrollIntoView：列表滚动 effect 会直接调。
if (typeof Element.prototype.scrollTo !== "function") {
    (Element.prototype as any).scrollTo = () => {};
}
if (typeof Element.prototype.scrollIntoView !== "function") {
    (Element.prototype as any).scrollIntoView = () => {};
}

// React 19 + jsdom：act() 需要显式声明 act 环境，否则每次 act 都报 stderr 警告。
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const now = Date.now();
const seedItems = [
    {
        id: "ct-alpha",
        title: "Alpha standup",
        text: "Alpha standup notes",
        createdat: now - 86_400_000,
        updatedat: now - 3_600_000,
        lastusedat: now - 600_000,
        usagecount: 5,
        createdby: { kind: "human", name: "nita" },
        origin: { deviceid: "dev-1", devicename: "Workstation", platform: "win32" },
    },
    {
        id: "ct-bravo",
        title: "Bravo refund",
        text: "Bravo refund policy",
        createdat: now - 172_800_000,
        updatedat: now - 7_200_000,
        lastusedat: now - 1_200_000,
        usagecount: 2,
        createdby: { kind: "agent", name: "pi" },
        origin: { deviceid: "dev-1", devicename: "Workstation", platform: "win32" },
    },
];

let container: HTMLDivElement;
let modalHost: HTMLDivElement;
let root: Root;

beforeEach(() => {
    // atoms 懒初始化：应用里由 initGlobal 调，测试里直接调 initGlobalAtoms
    // （不碰 getApi 的部分）。
    initGlobalAtoms({
        windowId: "w-test",
        clientId: "c-test",
        platform: "win32",
        environment: "renderer",
    } as any);
    modalHost = document.createElement("div");
    modalHost.id = "main";
    document.body.appendChild(modalHost);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    globalStore.set(atoms.fullConfigAtom, {
        settings: { "commontext:items": seedItems },
    } as any);
});

afterEach(async () => {
    if (root != null) {
        await act(async () => root.unmount());
    }
    container.remove();
    modalHost.remove();
    document.body.innerHTML = "";
    globalStore.set(atoms.fullConfigAtom, null as any);
});

async function openModal(detail: Record<string, unknown> = {}): Promise<void> {
    // 先挂载（effect 里才注册 open-search 监听），再派发事件——同一个 act 里连做会撞上
    // 「监听器还没装事件就发完了」的时序。
    await act(async () => {
        // 应用里根节点包着 <Provider store={globalStore}>，测试必须一致：
        // 否则 globalStore.set 的 settings 对 useAtomValue 不可见。
        root.render(
            <Provider store={globalStore}>
                <CommonTextComposeModal />
            </Provider>
        );
    });
    await act(async () => {
        window.dispatchEvent(new CustomEvent(OpenCommonTextSearchEvent, { detail }));
    });
}

function composer(): HTMLTextAreaElement {
    const el = document.querySelector("[data-commontext-composer]") as HTMLTextAreaElement | null;
    expect(el).not.toBeNull();
    return el!;
}

async function typeIntoComposer(value: string): Promise<void> {
    const el = composer();
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
        setter.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

async function focusComposer(): Promise<void> {
    await act(async () => {
        composer().dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
}

async function click(el: Element | null): Promise<void> {
    expect(el).not.toBeNull();
    await act(async () => {
        el!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
}

function editorToggle(): Element | null {
    return document.querySelector("[data-commontext-editor-toggle]");
}

function isCollapsed(): boolean {
    const cls = composer().className;
    return cls.includes("h-9") && !cls.includes("min-h-[120px]");
}

describe("CommonTextComposeModal — editor collapse", () => {
    it("collapses a multi-line draft on demand and does not auto-expand again on focus", async () => {
        await openModal();
        expect(isCollapsed()).toBe(true);

        // 多行草稿 + 聚焦 → 展开（既有行为不变）
        await typeIntoComposer("line one\nline two");
        await focusComposer();
        expect(composer().className).toContain("min-h-[120px]");

        // 用户拖高（resize-y 会在元素上留下浏览器写入的 inline height）后收起：
        // inline 高度必须被显式盖掉，否则 h-9 被压住、收不回一行
        await act(async () => {
            composer().style.height = "300px";
        });
        await click(editorToggle());
        expect(isCollapsed()).toBe(true);
        expect(composer().style.height).toBe("36px");

        // 再展开：inline 高度被移除，回到 CSS 展开态（保持展开，接上后续断言）
        await click(editorToggle());
        expect(composer().style.height).toBe("");
        expect(composer().className).toContain("min-h-[120px]");

        // 点收起 → 折回单行，正文不丢
        await click(editorToggle());
        expect(isCollapsed()).toBe(true);
        expect(composer().value).toBe("line one\nline two");

        // 手动收起态下再聚焦不自动弹开
        await focusComposer();
        expect(isCollapsed()).toBe(true);

        // 再点一次 → 恢复展开，正文仍在
        await click(editorToggle());
        expect(composer().className).toContain("min-h-[120px]");
        expect(composer().value).toBe("line one\nline two");
    });
});

describe("CommonTextComposeModal — detail properties fold", () => {
    it("shows a one-line icon summary by default and expands the full grid on demand", async () => {
        await openModal({ query: "Bravo" });
        const props = document.querySelector("[data-commontext-properties]");
        expect(props).not.toBeNull();
        expect(props!.getAttribute("data-commontext-properties")).toBe("collapsed");

        const summary = [...document.querySelectorAll("[data-commontext-properties-summary]")];
        expect(summary.map((s) => s.getAttribute("data-commontext-properties-summary"))).toEqual([
            "creator",
            "computer",
            "updated",
            "used",
        ]);
        // 摘要必须有真实值（不是空壳占位）
        for (const el of summary) {
            expect((el.textContent ?? "").trim()).not.toBe("");
        }
        // 折叠态不渲染网格行
        expect(document.querySelectorAll("[data-commontext-property]").length).toBe(0);

        // 展开 → 完整 5 行网格
        await click(document.querySelector("[data-commontext-properties-toggle]"));
        expect(document.querySelector("[data-commontext-properties]")!.getAttribute("data-commontext-properties")).toBe(
            "expanded"
        );
        const rows = [...document.querySelectorAll("[data-commontext-property]")];
        expect(rows.map((r) => r.getAttribute("data-commontext-property"))).toEqual([
            "Created by",
            "Computer",
            "Created",
            "Updated",
            "Used",
        ]);

        // 再点 → 收回折叠态
        await click(document.querySelector("[data-commontext-properties-toggle]"));
        expect(document.querySelector("[data-commontext-properties]")!.getAttribute("data-commontext-properties")).toBe(
            "collapsed"
        );
        expect(document.querySelectorAll("[data-commontext-property]").length).toBe(0);
    });
});
