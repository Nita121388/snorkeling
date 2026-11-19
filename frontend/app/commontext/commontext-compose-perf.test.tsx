// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// CommonText 弹窗性能探针（jsdom 组件级，CI 固定 120 条种子，避免本机 OOM）。
//
// 可判定计数（不做绝对值 benchmark）：
//   A. 窗口化：120 条数据下 DOM 行数被限到可视区 + overscan（≤40），行保留绝对
//      data-common-text-index，容器暴露 data-commontext-total / data-commontext-window；
//      键盘下走 20 步后窗口滑动仍覆盖当前选中行，容器 scrollTop 按行号换算推进。
//   B. 计算次数：spy searchCommonTextComposeItemsFromBase —— 打字只排 80ms 防抖，
//      不逐键重算；防抖到点恰好重算一次（R1/R4 输入快照 + baseItems 缓存的机器证据）。
//   C. 关闭态刷新（R5）：关闭弹窗后收到配置推送，重新打开能看到新条目，
//      说明关闭态不缓存旧的列表派生数据。
//
// 不跑真机；行高/像素由 scripts/verify/commontext-meta-sort 台子负责。

// @vitest-environment jsdom

import { initI18n } from "@/i18n/config";
import { Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./commontext-page-icon", () => ({
    PageIconSlot: () => null,
}));

vi.mock("./commontext-send-button", () => ({
    CommontextSendButton: () => null,
}));

// 只包一层计数 spy：排序/搜索真实现不动，计算次数可判定。
vi.mock("./commontext-model", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./commontext-model")>();
    return {
        ...actual,
        searchCommonTextComposeItemsFromBase: vi.fn((...args: unknown[]) =>
            (actual.searchCommonTextComposeItemsFromBase as (...a: unknown[]) => unknown)(...args)
        ),
    };
});

import { atoms, initGlobalAtoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { CommonTextComposeModal } from "./commontext-compose-modal";
import { OpenCommonTextSearchEvent } from "./commontext-events";
import { searchCommonTextComposeItemsFromBase } from "./commontext-model";

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
if (typeof Element.prototype.scrollTo !== "function") {
    (Element.prototype as any).scrollTo = () => {};
}
if (typeof Element.prototype.scrollIntoView !== "function") {
    (Element.prototype as any).scrollIntoView = () => {};
}

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(async () => {
    await initI18n("en");
});

const now = Date.now();
function makeItem(i: number) {
    return {
        id: `ct-perf-${i}`,
        title: `Perf item ${String(i).padStart(3, "0")}`,
        text: `Perf item ${i} body text`,
        createdat: now - (200 - i) * 86_400_000,
        updatedat: now - (200 - i) * 3_600_000,
        // i 越小越新：lastused-desc 下第 0 行是 Perf item 000。
        lastusedat: now - i * 60_000,
        usagecount: i,
        createdby: { kind: "human", name: "nita" },
        origin: { deviceid: "dev-1", devicename: "Workstation", platform: "win32" },
    };
}
const seedItems = Array.from({ length: 120 }, (_, i) => makeItem(i));

let container: HTMLDivElement;
let modalHost: HTMLDivElement;
let root: Root;

beforeEach(() => {
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
    vi.mocked(searchCommonTextComposeItemsFromBase).mockClear();
});

afterEach(async () => {
    vi.useRealTimers();
    if (root != null) {
        await act(async () => root.unmount());
    }
    container.remove();
    modalHost.remove();
    document.body.innerHTML = "";
    globalStore.set(atoms.fullConfigAtom, null as any);
    localStorage.clear();
});

async function openModal(detail: Record<string, unknown> = {}): Promise<void> {
    await act(async () => {
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

async function typeIntoComposer(value: string): Promise<void> {
    const el = document.querySelector("[data-commontext-composer]") as HTMLTextAreaElement | null;
    expect(el).not.toBeNull();
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
        setter.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

function listBox(): HTMLElement {
    const el = document.querySelector("[data-commontext-total]") as HTMLElement | null;
    expect(el).not.toBeNull();
    return el!;
}

describe("CommonTextComposeModal — perf probes (120 items)", () => {
    it("windows the list to a bounded DOM slice and keeps absolute row indices", async () => {
        await openModal();
        const list = listBox();
        // 容器锚点：总数 = 全量 120，窗口区间 = 当前渲染范围。
        expect(list.getAttribute("data-commontext-total")).toBe("120");
        const rows = [...list.querySelectorAll("[data-common-text-index]")];
        expect(rows.length).toBeGreaterThan(0);
        // 窗口化：120 条只渲染可视区 + overscan（≠ 全量 map）。
        expect(rows.length).toBeLessThan(120);
        expect(rows.length).toBeLessThanOrEqual(40);
        // 绝对索引连续递增且从 0 开始（初始窗口）。
        const indexes = rows.map((r) => Number(r.getAttribute("data-common-text-index")));
        expect(indexes[0]).toBe(0);
        expect(indexes).toEqual(indexes.map((_, k) => k));
        const [wStart, wEnd] = `${list.getAttribute("data-commontext-window") ?? "-"}`.split("-").map(Number);
        expect(wStart).toBe(0);
        expect(wEnd).toBe(rows.length);
        // 首行 = 最近使用（lastused-desc），行标题锚点可用。
        expect(rows[0].getAttribute("data-commontext-title")).toBe("Perf item 000");

        // 键盘走下 20 步：窗口必须滑到覆盖当前选中行，且 scrollTop 按行号换算推进
        // （不再依赖离屏 DOM 节点，键盘/验证台共用同一换算）。
        for (let step = 0; step < 20; step++) {
            await act(async () => {
                list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
            });
        }
        const [s2, e2] = `${list.getAttribute("data-commontext-window") ?? "-"}`.split("-").map(Number);
        expect(s2).toBeLessThanOrEqual(20);
        expect(e2).toBeGreaterThan(20);
        const row20 = list.querySelector('[data-common-text-index="20"]');
        expect(row20).not.toBeNull();
        expect(row20?.getAttribute("data-commontext-title")).toBe("Perf item 020");
        expect(list.scrollTop).toBeGreaterThan(0);
    });

    it("recomputes the filtered list once per committed search, not per keystroke", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        await openModal();
        const before = vi.mocked(searchCommonTextComposeItemsFromBase).mock.calls.length;
        // 连续打字：只更新 editor + 排 80ms 防抖，搜索快照未提交 → 不触发重算。
        await typeIntoComposer("hel");
        await typeIntoComposer("hello");
        await typeIntoComposer("hello world");
        expect(vi.mocked(searchCommonTextComposeItemsFromBase).mock.calls.length).toBe(before);
        // 防抖到点：恰好提交一次 → 恰好重算一次（不逐键 ×3）。
        await act(async () => {
            vi.advanceTimersByTime(100);
        });
        expect(vi.mocked(searchCommonTextComposeItemsFromBase).mock.calls.length).toBe(before + 1);
    });

    it("refreshes derived data pushed while the modal is closed (closed-state guard)", async () => {
        await openModal();
        expect(listBox().getAttribute("data-commontext-total")).toBe("120");
        // 关闭弹窗（header 关闭按钮）：外壳保留事件监听，body 卸载。
        await act(async () => {
            (document.querySelector(".modal-close, .modal-close-btn") as HTMLElement | null)?.dispatchEvent(
                new MouseEvent("click", { bubbles: true, cancelable: true })
            );
        });
        expect(document.querySelector("[data-commontext-total]")).toBeNull();

        // 关闭态收到配置推送：不构建列表派生数据，但不丢事件；重新打开能看到新条目。
        const fresh = {
            ...makeItem(999),
            id: "ct-perf-fresh",
            title: "Fresh sync item",
            lastusedat: now + 1000,
        };
        globalStore.set(atoms.fullConfigAtom, {
            settings: { "commontext:items": [fresh, ...seedItems] },
        } as any);
        await act(async () => {
            window.dispatchEvent(new CustomEvent(OpenCommonTextSearchEvent, { detail: {} }));
        });
        const list = listBox();
        expect(list.getAttribute("data-commontext-total")).toBe("121");
        // 新条目（最近使用）排在首位，可点击可达。
        const freshRow = list.querySelector('[data-commontext-title="Fresh sync item"]');
        expect(freshRow).not.toBeNull();
        expect(freshRow?.getAttribute("data-common-text-index")).toBe("0");
    });
});
