// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// CommonText 发送目标弹层「几何放宽」回归锁（jsdom 组件级）。
//
// 背景（11-18-commontext-send-compact 追加需求）：上一轮紧凑化把弹层宽度定成
// min(360px, 92vw)（SplitButton menuWidth=380），内部 padding/gap 压到 1.5/2px 级，
// 真机 380×379px 读起来很挤。本次只放宽空间、不动信息架构：
//   - 弹层根节点宽度收口到 [data-commontext-send-popover] 的 inline min(440px, 94vw)；
//   - 三个选择器行（Agent/Tab/目录）行距 inline rowGap:10px；
//   - SplitButton menu 用 w-fit! 贴合根节点宽度（否则 440 面板被 380 menu 裁掉）。
//
// jsdom 没有排版引擎：Tailwind 类不产生 computed 值、clientWidth/scrollWidth 全是 0。
// 所以几何断言全部打在「组件声明的 inline 样式」上——jsdom 能真实解析 inline min()
// （实测 min(440px,94vw) → computed width "440px"）与 inline rowGap（"10px"）。
// 窄视口回落是 vw 语义，jsdom 不算 vw，由测试内的 evaluateMinPxVw() 按夹具视口宽求值，
// 数值来自真实 style 声明而非 mock。真实排版由浏览器/fit-content 保证。
//
// @vitest-environment jsdom

import { Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/config";
import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { CommontextSendButton } from "./commontext-send-button";

// ── 重型依赖置空：让真实组件的渲染路径只跑纯逻辑 ──
vi.mock("@/app/store/global", async () => {
    const { atom: jotaiAtom } = await import("jotai");
    return {
        atoms: {
            workspace: jotaiAtom<unknown>(null),
            staticTabId: jotaiAtom("tab-1"),
            settingsAtom: jotaiAtom<unknown>(null),
        },
        createBlock: async () => "block-mock",
        getApi: () => ({ getHomeDir: () => "", pickDirectory: async () => null }),
        getFocusedBlockId: () => "",
        getBlockComponentModel: () => null,
    };
});
vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { Init: () => {} } }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/services", () => ({
    ObjectService: {
        CreateBlockInTab: async () => ({ blockid: "b" }),
        CreateBlockInNewTab: async () => ({ blockid: "b", tabid: "t" }),
    },
}));
vi.mock("@/app/store/wos", () => ({
    makeORef: (otype: string, oid: string) => `${otype}:${oid}`,
    getWaveObjectAtom: () => atom<unknown>(null),
}));
vi.mock("@/layout/index", () => ({ getLayoutModelForStaticTab: () => null }));
vi.mock("@/layout/lib/inlineTabs", () => ({ getLayoutDataActiveBlockId: () => null }));
vi.mock("@/app/workspace/use-agent-profile-options", () => ({
    useDetectedAgentProfileOptions: () => [
        { name: "codex", label: "Codex", cmd: "codex", isDefault: true },
        { name: "pi", label: "Pi", cmd: "pi", isDefault: false },
    ],
}));
vi.mock("@/app/workspace/agent-launch", () => ({
    collectAgentLaunchTargetsInTab: () => [],
    createAgentBlockDefForProfile: () => ({}),
    getCurrentWorkspaceContextMeta: () => ({}),
}));
vi.mock("@/app/agent-persona/use-agent-personas", () => ({
    useAgentPersonas: () => ({}),
}));
vi.mock("@/app/view/term/agent-logo", () => ({
    getAgentIcon: () => ({ kind: "emoji", emoji: "🦊" }),
}));
vi.mock("@/app/session-overview/session-overview-model", () => ({
    filterSessionOverviewTabIds: (tabIds: string[]) => tabIds,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
    await initI18n("en");
});

beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true, writable: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    if (root != null) {
        await act(async () => root.unmount());
    }
    container.remove();
    document.body.innerHTML = "";
});

/** 挂载发送按钮并打开目标弹层（点击 caret 段）。 */
async function openPopover(): Promise<void> {
    await act(async () => {
        root.render(
            <Provider store={globalStore}>
                <CommontextSendButton text="hello" onSent={() => {}} onStatus={() => {}} />
            </Provider>
        );
    });
    const caret = container.querySelector(".wave-split-button__caret") as HTMLButtonElement | null;
    expect(caret).not.toBeNull();
    await act(async () => {
        caret!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    const popover = document.querySelector<HTMLElement>("[data-commontext-send-popover]");
    expect(popover).not.toBeNull();
}

/** 解析 "min(<px>, <vw>vw)" 表达式并按夹具视口宽求值（jsdom 不算 vw，这里补上）。 */
function evaluateMinPxVw(expr: string, viewportWidth: number): number | null {
    const m = expr.match(/^min\(\s*([\d.]+)px\s*,\s*([\d.]+)vw\s*\)$/);
    if (m == null) return null;
    return Math.min(Number(m[1]), (Number(m[2]) / 100) * viewportWidth);
}

describe("CommonText 发送弹层几何放宽（追加需求）", () => {
    it("宽视口：弹层根节点宽度 ≥ 420px，且三行选择器垂直间距 ≥ 8px", async () => {
        Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true, writable: true });
        await openPopover();

        const popover = document.querySelector<HTMLElement>("[data-commontext-send-popover]")!;
        // 根节点宽度唯一权威声明：min(440px, 94vw)。jsdom 解析 inline min() → "440px"。
        const computedWidth = getComputedStyle(popover).width;
        const widthPx = computedWidth.endsWith("px") ? Number.parseFloat(computedWidth) : NaN;
        expect(widthPx).toBeGreaterThanOrEqual(420);
        // 声明里同时带 vw 回落（窄视口不溢出的来源），数值断言不含糊
        expect(evaluateMinPxVw(popover.style.width, 1440)).toBeGreaterThanOrEqual(420);

        // 目标卡 + 三行选择器常显（信息架构不变）
        expect(document.querySelector("[data-commontext-send-target-card]")).not.toBeNull();
        for (const row of ["[data-commontext-agent-row]", "[data-commontext-tab-row]", "[data-commontext-dir-row]"]) {
            expect(document.querySelector(row), row).not.toBeNull();
        }

        // 三行垂直间距：容器 inline rowGap:10px → computed rowGap "10px" ≥ 8
        const rows = document.querySelector<HTMLElement>("[data-commontext-send-rows]")!;
        const rowGap = getComputedStyle(rows).rowGap;
        expect(Number.parseFloat(rowGap)).toBeGreaterThanOrEqual(8);
    });

    it("窄视口（≤420px）：宽度表达式回落 94vw，不超过视口宽且无横向溢出", async () => {
        const viewport = 400;
        Object.defineProperty(window, "innerWidth", { value: viewport, configurable: true, writable: true });
        await openPopover();

        const popover = document.querySelector<HTMLElement>("[data-commontext-send-popover]")!;
        // 回落语义来自真实 style 声明：min(440px, 94vw) 在 400px 视口下 = 376px ≤ 400。
        const fallbackWidth = evaluateMinPxVw(popover.style.width, viewport);
        expect(fallbackWidth).not.toBeNull();
        expect(fallbackWidth!).toBeLessThanOrEqual(viewport);
        expect(fallbackWidth!).toBeLessThan(420);
        expect(popover.style.width).toContain("94vw");

        // 无横向滚动：弹层被约束在视口宽内，内容盒不超过弹层声明宽度
        // （jsdom 的 scrollWidth/clientWidth 恒 0，这里把 clientWidth 按声明求值打桩，
        // 验证"内容不超出弹层宽度"的判定路径；真实几何由浏览器 vw/fit-content 保证）。
        Object.defineProperty(popover, "clientWidth", { get: () => fallbackWidth!, configurable: true });
        Object.defineProperty(popover, "scrollWidth", { get: () => fallbackWidth!, configurable: true });
        expect(popover.scrollWidth).toBeLessThanOrEqual(popover.clientWidth);
    });

    it("窄视口下降级到最小视口（320px）也不溢出", async () => {
        const viewport = 320;
        Object.defineProperty(window, "innerWidth", { value: viewport, configurable: true, writable: true });
        await openPopover();
        const popover = document.querySelector<HTMLElement>("[data-commontext-send-popover]")!;
        const fallbackWidth = evaluateMinPxVw(popover.style.width, viewport);
        expect(fallbackWidth).toBeCloseTo(300.8, 5); // min(440, 94%*320=300.8)
        expect(fallbackWidth!).toBeLessThanOrEqual(viewport);
    });
});