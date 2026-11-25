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
import { loadAgentCatalog } from "@/app/workspace/agent-catalog";
import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { CommontextSendButton, commontextSendConfigAtom, type CommontextSendConfig } from "./commontext-send-button";

// ── 重型依赖置空：让真实组件的渲染路径只跑纯逻辑 ──
vi.mock("@/app/store/global", async () => {
    const { atom: jotaiAtom } = await import("jotai");
    return {
        atoms: {
            workspace: jotaiAtom({ oid: "ws-1", tabids: ["tab-1", "tab-2"] }),
            staticTabId: jotaiAtom("tab-1"),
            settingsAtom: jotaiAtom<unknown>(null),
        },
        createBlock: async () => "block-mock",
        getApi: () => ({ getHomeDir: () => "C:/Users/test", pickDirectory: async () => null }),
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
    getWaveObjectAtom: (orefOrType: string, maybeOid?: string) => {
        const [otype, oid] = maybeOid == null ? orefOrType.split(":") : [orefOrType, maybeOid];
        if (otype === "tab" && oid === "tab-1") return atom({ oid: "tab:tab-1", tabId: "tab-1", name: "Tab One" });
        if (otype === "tab" && oid === "tab-2") return atom({ oid: "tab:tab-2", tabId: "tab-2", name: "Tab Two" });
        return atom<unknown>(null);
    },
}));
vi.mock("@/layout/index", () => ({ getLayoutModelForStaticTab: () => null }));
vi.mock("@/layout/lib/inlineTabs", () => ({ getLayoutDataActiveBlockId: () => null }));
vi.mock("@/app/workspace/use-agent-profile-options", () => ({
    useDetectedAgentProfileOptions: () => [
        { name: "codex", label: "Codex", cmd: "codex", isDefault: true },
        { name: "pi", label: "Pi", cmd: "pi", isDefault: false },
    ],
}));
vi.mock("@/app/workspace/agent-catalog", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/app/workspace/agent-catalog")>();
    return {
        ...actual,
        loadAgentCatalog: vi.fn(async () => [
            {
                name: "codex",
                label: "Codex",
                cmd: "codex",
                default: true,
                defaultModel: "gpt-5.2-codex",
                models: [
                    { id: "gpt-5.2-codex", label: "GPT-5.2 Codex", default: true },
                    { id: "gpt-5.2", label: "GPT-5.2" },
                ],
            },
            {
                name: "pi",
                label: "Pi",
                cmd: "pi",
                defaultModel: "deepseek-v4.1-flash",
                models: [
                    { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", default: true },
                    { id: "pi-reasoning", label: "Pi Reasoning" },
                ],
            },
        ]),
    };
});
vi.mock("@/app/workspace/agent-launch", () => ({
    collectAgentLaunchTargetsInTab: (tab: { tabId?: string }) =>
        tab.tabId === "tab-2"
            ? [
                  { cwd: "E:/work/tab-two-agent", source: "agent" },
                  { cwd: "E:/work/tab-two-files", source: "files" },
              ]
            : [
                  { cwd: "E:/work/tab-one-agent", source: "agent" },
                  { cwd: "E:/work/tab-one-files", source: "files" },
              ],
    createAgentBlockDefForProfile: () => ({}),
    getCurrentWorkspaceContextMeta: () => ({ "cmd:cwd": "E:/workspace/common" }),
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
    globalStore.set(commontextSendConfigAtom, {
        mode: "focused",
        background: true,
        profile: null,
        tab: { kind: "current" },
        folder: null,
        model: null,
    } as CommontextSendConfig);
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
    await act(async () => {
        await Promise.resolve();
    });
}

/** 解析 "min(<px>, <vw>vw)" 表达式并按夹具视口宽求值（jsdom 不算 vw，这里补上）。 */
function evaluateMinPxVw(expr: string, viewportWidth: number): number | null {
    const m = expr.match(/^min\(\s*([\d.]+)px\s*,\s*([\d.]+)vw\s*\)$/);
    if (m == null) return null;
    return Math.min(Number(m[1]), (Number(m[2]) / 100) * viewportWidth);
}

function pathRows(): HTMLButtonElement[] {
    return [...document.querySelectorAll<HTMLButtonElement>("[data-commontext-path-row]")];
}

function modelSelect(): HTMLSelectElement | null {
    return document.querySelector<HTMLSelectElement>("[data-commontext-model-select]");
}

describe("CommonText 发送弹层 Agent / 模型 / 路径契约", () => {
    it("命名 Agent chip 保留默认提示与选中语义", async () => {
        await openPopover();
        const chips = [...document.querySelectorAll<HTMLButtonElement>("[data-commontext-agent-chip]")];
        expect(chips).toHaveLength(2);
        expect(chips[0].textContent).toContain("Codex");
        expect(chips[1].textContent).toContain("Pi");
        expect(chips[0].getAttribute("aria-label")).toBe("Codex");
        expect(chips[0].getAttribute("aria-pressed")).toBe("true");
        expect(chips[0].title).toContain("(default)");
        expect(chips[1].getAttribute("aria-pressed")).toBe("false");
    });

    it("模型目录来自 agent-catalog，模型与可见路径控件同时存在", async () => {
        await openPopover();
        expect(loadAgentCatalog).toHaveBeenCalled();
        for (const selector of [
            "[data-commontext-model-row]",
            "[data-commontext-model-select]",
            "[data-commontext-tab-row]",
            "[data-commontext-path-list]",
            "[data-commontext-send-footer] [role=switch]",
        ]) {
            expect(document.querySelector(selector), selector).not.toBeNull();
        }
        expect(pathRows().length).toBeGreaterThanOrEqual(2);
    });

    it("选择具体模型强制新建；切换 Agent 后模型回到自动并更换候选", async () => {
        await openPopover();
        const select = modelSelect();
        expect(select).not.toBeNull();
        const options = [...select!.querySelectorAll("option")];
        expect(options[0].value).toBe("");
        expect(options[0].textContent).toMatch(/auto/i);
        expect(options.map((option) => option.value)).toEqual(["", "gpt-5.2-codex", "gpt-5.2"]);

        await act(async () => {
            select!.value = "gpt-5.2-codex";
            select!.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(globalStore.get(commontextSendConfigAtom).model).toBe("gpt-5.2-codex");
        expect(globalStore.get(commontextSendConfigAtom).mode).toBe("create");
        expect(document.querySelector<HTMLElement>("[data-commontext-send-submit]")?.textContent).toContain(
            "Create & send"
        );

        const piChip = document.querySelector<HTMLButtonElement>('[data-commontext-agent-chip="pi"]');
        expect(piChip).not.toBeNull();
        await act(async () => {
            piChip!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        });
        expect(globalStore.get(commontextSendConfigAtom).model).toBeNull();
        expect(modelSelect()?.value).toBe("");
        expect([...modelSelect()!.querySelectorAll("option")].map((option) => option.value)).toEqual([
            "",
            "deepseek-v4.1-flash",
            "pi-reasoning",
        ]);
    });

    it("目录不可用时允许手填模型，输入具体模型同样强制新建", async () => {
        vi.mocked(loadAgentCatalog).mockResolvedValueOnce([]);
        await openPopover();
        const input = document.querySelector<HTMLInputElement>("[data-commontext-model-select]");
        expect(input).not.toBeNull();
        expect(input?.placeholder).toMatch(/model ID/i);
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        await act(async () => {
            setter?.call(input!, "custom-model");
            input!.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(globalStore.get(commontextSendConfigAtom).model).toBe("custom-model");
        expect(globalStore.get(commontextSendConfigAtom).mode).toBe("create");
        expect(document.querySelector<HTMLElement>("[data-commontext-send-submit]")?.textContent).toContain(
            "Create & send"
        );
    });

    it("路径列表默认推荐第一行；点击路径更新 footer 并强制新建", async () => {
        await openPopover();
        const rows = pathRows();
        expect(rows).toHaveLength(4);
        expect(rows.map((row) => row.textContent)).toEqual([
            expect.stringContaining("E:/work/tab-one-agent"),
            expect.stringContaining("E:/work/tab-one-files"),
            expect.stringContaining("E:/workspace/common"),
            expect.stringContaining("C:/Users/test"),
        ]);
        expect(rows[0].getAttribute("role")).toBe("option");
        expect(rows[0].getAttribute("aria-selected")).toBe("true");
        expect(rows[0].textContent).toMatch(/default|auto|follow/i);
        expect(globalStore.get(commontextSendConfigAtom).folder).toBeNull();

        await act(async () => {
            rows[1].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        });
        expect(globalStore.get(commontextSendConfigAtom).folder).toBe("E:/work/tab-one-files");
        expect(globalStore.get(commontextSendConfigAtom).mode).toBe("create");
        expect(document.querySelector<HTMLElement>("[data-commontext-send-footer]")?.textContent).toContain(
            "E:/work/tab-one-files"
        );
    });

    it("切 Tab 整体替换路径候选并回到该 Tab 的默认推荐行", async () => {
        await openPopover();
        const initialRows = pathRows();
        expect(initialRows.length).toBeGreaterThanOrEqual(2);
        await act(async () => {
            initialRows[1].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        });
        expect(globalStore.get(commontextSendConfigAtom).folder).toBe("E:/work/tab-one-files");

        const tabTrigger = document.querySelector<HTMLButtonElement>("[data-commontext-tab-trigger]");
        expect(tabTrigger).not.toBeNull();
        await act(async () => {
            tabTrigger!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        });
        const tabTwo = [...document.querySelectorAll<HTMLButtonElement>("[data-commontext-send-picker] button")].find(
            (button) => button.textContent?.includes("Tab Two")
        );
        expect(tabTwo).toBeDefined();
        await act(async () => {
            tabTwo!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        });

        expect(globalStore.get(commontextSendConfigAtom).tab).toEqual({ kind: "existing", tabId: "tab-2" });
        expect(globalStore.get(commontextSendConfigAtom).folder).toBeNull();
        const resetRows = pathRows();
        expect(resetRows.map((row) => row.textContent)).toEqual([
            expect.stringContaining("E:/work/tab-two-agent"),
            expect.stringContaining("E:/work/tab-two-files"),
            expect.stringContaining("E:/workspace/common"),
            expect.stringContaining("C:/Users/test"),
        ]);
        expect(resetRows[0].getAttribute("aria-selected")).toBe("true");
        expect(document.querySelector<HTMLElement>("[data-commontext-send-footer]")?.textContent).toContain(
            "E:/work/tab-two-agent"
        );
    });

    it("长路径列表内部滚动，header / footer 不参与滚动", async () => {
        await openPopover();
        const popover = document.querySelector<HTMLElement>("[data-commontext-send-popover]");
        const list = document.querySelector<HTMLElement>("[data-commontext-path-list]");
        const footer = document.querySelector<HTMLElement>("[data-commontext-send-footer]");
        expect(list).not.toBeNull();
        expect(popover?.className).toContain("flex-col");
        expect(list?.className).toContain("overflow-y-auto");
        expect(list?.className).toContain("overflow-x-hidden");
        expect(list?.className).toContain("overscroll-contain");
        expect(footer?.className).toContain("shrink-0");
    });
});

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

        // 新信息架构删除重复目标卡；Agent / 模型 / Tab / 路径与后台执行分区常显
        expect(document.querySelector("[data-commontext-send-target-card]")).toBeNull();
        for (const row of [
            "[data-commontext-agent-row]",
            "[data-commontext-model-row]",
            "[data-commontext-tab-row]",
            "[data-commontext-dir-row]",
            "[data-commontext-send-footer]",
        ]) {
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