// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 「更多」下拉 DOM 契约测试.
// 覆盖: 触发器计数 / 全量列表渲染 / 点击激活并关闭 / 关闭按钮不误触发激活 /
//       搜索框阈值与过滤 / 空态.
// Run: npx vitest run frontend/app/tab/tab-more-menu.dom.test.tsx

// @vitest-environment jsdom

import { globalStore } from "@/app/store/jotaiStore";
import { WaveEnvContext } from "@/app/waveenv/waveenv";
import { makeMockWaveEnv } from "@/preview/mock/mockwaveenv";
import { installPreviewElectronApi } from "@/preview/mock/preview-electron-api";
import { atom, Provider } from "jotai";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collapsedTabIdsAtom } from "./tab-collapse-state";
import { TabMoreMenu } from "./tab-more-menu";
import { openedThisLaunchTabIdsAtom } from "./tab-open-state";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

function makeEnv(tabIds: string[]) {
    const mockWaveObjs: Record<string, WaveObj> = {};
    for (const tabId of tabIds) {
        mockWaveObjs[`tab:${tabId}`] = {
            otype: "tab",
            oid: tabId,
            version: 1,
            name: `Tab ${tabId}`,
            blockids: [],
            meta: {},
        } as Tab;
    }
    return makeMockWaveEnv({
        tabId: "t1",
        mockWaveObjs,
        atoms: { staticTabId: atom("t1") } as Partial<GlobalAtomsType>,
    });
}

function render(tabIds: string[], props?: Partial<React.ComponentProps<typeof TabMoreMenu>>) {
    const env = makeEnv(tabIds);
    act(() => {
        root.render(
            <Provider store={globalStore}>
                <WaveEnvContext.Provider value={env}>
                    <TabMoreMenu
                        tabIds={tabIds}
                        placement="top-start"
                        variant="vertical"
                        onActivateTab={() => {}}
                        onCloseTab={() => {}}
                        onNewTab={() => {}}
                        onCollapseInactive={() => {}}
                        {...props}
                    />
                </WaveEnvContext.Provider>
            </Provider>
        );
    });
}

/** jsdom 里触发 React onChange 必须走原生 value setter, 直接赋值不会触发 tracker. */
function typeInto(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

function trigger(): HTMLButtonElement {
    return container.querySelector<HTMLButtonElement>("[aria-haspopup='menu']")!;
}

function rows(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>("[role='menuitem']"));
}

beforeEach(() => {
    Element.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 200, 30);
    installPreviewElectronApi();
    globalStore.set(openedThisLaunchTabIdsAtom, new Set(["t1"]));
    globalStore.set(collapsedTabIdsAtom, new Set<string>());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

describe("TabMoreMenu trigger", () => {
    it("shows the hidden-tab count", () => {
        // active tab (t1) 不计入隐藏; t2/t3 本次未打开 → 隐藏.
        render(["t1", "t2", "t3"]);
        expect(trigger().getAttribute("aria-label")).toBe("More tabs (2 hidden)");
        expect(trigger().textContent).toContain("更多");
        expect(trigger().textContent).toContain("2");
    });

    it("drops the count badge when nothing is hidden", () => {
        globalStore.set(openedThisLaunchTabIdsAtom, new Set(["t1", "t2", "t3"]));
        render(["t1", "t2", "t3"]);
        expect(trigger().getAttribute("aria-label")).toBe("More tabs");
        // 垂直栏始终保留「更多」文字, 只是计数徽章消失.
        expect(trigger().textContent).toBe("更多");
    });

    it("toggles the panel open and closed", () => {
        render(["t1", "t2"]);
        expect(trigger().getAttribute("aria-expanded")).toBe("false");
        act(() => {
            trigger().click();
        });
        expect(trigger().getAttribute("aria-expanded")).toBe("true");
        act(() => {
            trigger().click();
        });
        expect(trigger().getAttribute("aria-expanded")).toBe("false");
    });

    // 点亮 = 触发器的常驻 text-primary (忽略 hover:/group-hover: 变体).
    function isLit(el: HTMLElement) {
        return el.className
            .split(/\s+/)
            .filter((cls) => !cls.includes(":"))
            .includes("text-primary");
    }

    it("uses a vertical three-dot icon that only lights up when open", () => {
        render(["t1", "t2"]);
        const icon = trigger().querySelector("i")!;
        expect(icon.className).toContain("fa-ellipsis-vertical");
        expect(isLit(trigger())).toBe(false);
        act(() => {
            trigger().click();
        });
        expect(isLit(trigger())).toBe(true);
    });

    it("uses a horizontal three-dot icon on the horizontal bar", () => {
        render(["t1", "t2"], { variant: "horizontal", placement: "bottom-end" });
        const icon = trigger().querySelector("i")!;
        expect(icon.className).toContain("fa-ellipsis");
        expect(icon.className).not.toContain("fa-ellipsis-vertical");
        expect(isLit(trigger())).toBe(false);
    });
});

describe("TabMoreMenu rows", () => {
    it("activates a tab and closes the panel", () => {
        const onActivateTab = vi.fn();
        render(["t1", "t2", "t3"], { onActivateTab });
        act(() => {
            trigger().click();
        });
        expect(rows()).toHaveLength(3);
        act(() => {
            rows()[1].click();
        });
        expect(onActivateTab).toHaveBeenCalledWith("t2");
        expect(trigger().getAttribute("aria-expanded")).toBe("false");
    });

    it("keeps physical tab order in the list", () => {
        render(["t3", "t1", "t2"]);
        act(() => {
            trigger().click();
        });
        expect(rows().map((row) => row.getAttribute("data-tabid"))).toEqual(["t3", "t1", "t2"]);
    });

    it("marks rows hidden when their tab is collapsed", () => {
        globalStore.set(openedThisLaunchTabIdsAtom, new Set<string>(["t1"]));
        render(["t1", "t2"]);
        act(() => {
            trigger().click();
        });
        const list = rows();
        expect(list[0].getAttribute("data-hidden")).toBe("false");
        expect(list[1].getAttribute("data-hidden")).toBe("true");
    });

    it("dims hidden rows but keeps every tab listed", () => {
        // 默认隐藏的 Tab 也必须出现在下拉里, 只是灰色 — 不能因为"折叠了"就消失.
        globalStore.set(openedThisLaunchTabIdsAtom, new Set(["t1"]));
        render(["t1", "t2", "t3"]);
        act(() => {
            trigger().click();
        });
        const list = rows();
        expect(list).toHaveLength(3);
        expect(list[0].getAttribute("data-hidden")).toBe("false");
        expect(list[0].getAttribute("data-dimmed")).toBe("false");
        expect(list[0].className).not.toContain("opacity-55");
        expect(list[1].getAttribute("data-hidden")).toBe("true");
        expect(list[1].getAttribute("data-dimmed")).toBe("true");
        expect(list[1].className).toContain("opacity-55");
        expect(list[2].getAttribute("data-hidden")).toBe("true");
        expect(list[2].className).toContain("opacity-55");
    });

    it("lights a collapsed tab up once it becomes the active tab", () => {
        // 置灰只跟随「默认折叠」, 与激活无关: 同一个 Tab 一旦被激活就恢复常态亮度.
        globalStore.set(openedThisLaunchTabIdsAtom, new Set(["t1"]));
        globalStore.set(collapsedTabIdsAtom, new Set(["t2"]));
        render(["t1", "t2"]);
        act(() => {
            trigger().click();
        });
        const t2 = rows().find((row) => row.getAttribute("data-tabid") === "t2")!;
        expect(t2.getAttribute("data-hidden")).toBe("true");
        expect(t2.getAttribute("data-dimmed")).toBe("true");
        // 激活行永不置灰 (isTabHiddenFromBar 对激活 Tab 恒返回 false, 这里再加一道 isActive 兜底).
        const t1 = rows().find((row) => row.getAttribute("data-tabid") === "t1")!;
        expect(t1.getAttribute("data-hidden")).toBe("false");
        expect(t1.getAttribute("data-dimmed")).toBe("false");
    });

    it("closes a tab without activating it", () => {
        const onActivateTab = vi.fn();
        const onCloseTab = vi.fn();
        render(["t1", "t2"], { onActivateTab, onCloseTab });
        act(() => {
            trigger().click();
        });
        const closeBtn = rows()[1].querySelector<HTMLButtonElement>("[aria-label='Close tab']")!;
        act(() => {
            closeBtn.click();
        });
        expect(onCloseTab).toHaveBeenCalledWith("t2");
        expect(onActivateTab).not.toHaveBeenCalled();
    });
});

describe("TabMoreMenu search", () => {
    it("is hidden at the threshold", () => {
        render(Array.from({ length: 12 }, (_, index) => `t${index + 1}`));
        act(() => {
            trigger().click();
        });
        expect(document.querySelector("input[placeholder='搜索 Tab…']")).toBeNull();
    });

    it("appears above the threshold and filters rows", () => {
        const tabIds = Array.from({ length: 15 }, (_, index) => `t${index + 1}`);
        globalStore.set(openedThisLaunchTabIdsAtom, new Set(tabIds));
        render(tabIds);
        act(() => {
            trigger().click();
        });
        const input = document.querySelector<HTMLInputElement>("input[placeholder='搜索 Tab…']")!;
        expect(input).not.toBeNull();
        act(() => {
            typeInto(input, "Tab t13");
        });
        // "Tab t13" 只命中一行: 名称是 "Tab t13" 的那一个.
        expect(rows().length).toBe(1);
        expect(rows()[0].getAttribute("data-tabid")).toBe("t13");
    });

    it("reports an empty state when the query matches nothing", () => {
        const tabIds = Array.from({ length: 15 }, (_, index) => `t${index + 1}`);
        globalStore.set(openedThisLaunchTabIdsAtom, new Set(tabIds));
        render(tabIds);
        act(() => {
            trigger().click();
        });
        const input = document.querySelector<HTMLInputElement>("input[placeholder='搜索 Tab…']")!;
        act(() => {
            typeInto(input, "zzz");
        });
        expect(rows()).toHaveLength(0);
        expect(document.body.textContent).toContain("没有匹配的 Tab");
    });
});

describe("TabMoreMenu footer actions", () => {
    it("creates a tab and closes the panel", () => {
        const onNewTab = vi.fn();
        render(["t1"], { onNewTab });
        act(() => {
            trigger().click();
        });
        const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
        const newTabBtn = buttons.find((btn) => btn.textContent?.includes("新建 Tab"))!;
        act(() => {
            newTabBtn.click();
        });
        expect(onNewTab).toHaveBeenCalledTimes(1);
        expect(trigger().getAttribute("aria-expanded")).toBe("false");
    });

    it("collapses non-active visible tabs", () => {
        const onCollapseInactive = vi.fn();
        globalStore.set(openedThisLaunchTabIdsAtom, new Set(["t1", "t2"]));
        render(["t1", "t2"], { onCollapseInactive });
        act(() => {
            trigger().click();
        });
        const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
        const collapseBtn = buttons.find((btn) => btn.textContent?.includes("收起未使用的 Tab"));
        // active=t1, t2 本次已打开且非激活 → 有收起目标, 按钮应存在.
        expect(collapseBtn).not.toBeUndefined();
        act(() => {
            collapseBtn.click();
        });
        expect(onCollapseInactive).toHaveBeenCalledTimes(1);
    });
});


// 悬浮 Agent Card 接入契约测试。
//
// 行是否挂 portal 由 jsdom 下无法渲染完整 AgentHoverCard (它会真发 RPC / 取 uiContext) 决定,
// 所以这里只断言「数据链路 + 挂载点」: meta 正确收集 agent block, 行带 data-agent-card 标记,
// portal 容器在未 hover 时不渲染、hover 时尝试渲染 (jsdom 下组件抛错不影响挂载点存在性判定)。
// 卡片内容由 tab-more-agent-card 单测 / 组件本身保证。
//
// 注意: jsdom 下 localStorage 缺失 (Node >=22.11 不再默认提供), 必须走
// NODE_OPTIONS="--localstorage-file=..." 跑, 否则 SessionOverviewModel 构造即抛.
describe("TabMoreMenu agent card linkage", () => {
    // 注意: tab.blockids 存的是裸 OID, mock WOS 的 key 才是 "block:<oid>".
    function agentBlock(oid: string, sessionId: string): Block {
        return {
            otype: "block",
            oid,
            version: 1,
            meta: { "agent:sessionid": sessionId, "agent:provider": "codex" },
            subblockids: [],
        } as unknown as Block;
    }
    function renderWithBlocks(
        blocks: Record<string, Block>,
        subBlocks: Record<string, Block> = {},
        props?: Partial<React.ComponentProps<typeof TabMoreMenu>>
    ) {
        const mockWaveObjs: Record<string, WaveObj> = {
            "tab:t1": {
                otype: "tab",
                oid: "t1",
                version: 1,
                name: "AISessions",
                blockids: Object.keys(blocks),
                meta: {},
            } as Tab,
        };
        for (const [oid, block] of Object.entries({ ...blocks, ...subBlocks })) {
            mockWaveObjs[`block:${oid}`] = block;
        }
        const env = makeMockWaveEnv({ tabId: "t1", mockWaveObjs });
        act(() => {
            root.render(
                <Provider store={globalStore}>
                    <WaveEnvContext.Provider value={env}>
                        <TabMoreMenu
                            tabIds={["t1"]}
                            placement="top-start"
                            variant="vertical"
                            onActivateTab={() => {}}
                            onCloseTab={() => {}}
                            onNewTab={() => {}}
                            onCollapseInactive={() => {}}
                            {...props}
                        />
                    </WaveEnvContext.Provider>
                </Provider>
            );
        });
    }

    it("does not flag a tab with no agent block", () => {
        renderWithBlocks({
            note1: { otype: "block", oid: "note1", version: 1, meta: { "snorkeling:kind": "note", file: "a.md" }, subblockids: [] } as unknown as Block,
        });
        act(() => trigger().click());
        expect(rows()).toHaveLength(1);
        expect(rows()[0].getAttribute("data-agent-card")).toBe("false");
    });

    it("flags a tab with one agent block (single full card on hover path)", () => {
        renderWithBlocks({ a1: agentBlock("a1", "sess-1") });
        act(() => trigger().click());
        expect(rows()).toHaveLength(1);
        expect(rows()[0].getAttribute("data-agent-card")).toBe("true");
    });

    it("flags a tab with >=2 agent blocks (multi-agent header path)", () => {
        renderWithBlocks({ a1: agentBlock("a1", "sess-1"), b1: agentBlock("b1", "sess-2") });
        act(() => trigger().click());
        expect(rows()).toHaveLength(1);
        expect(rows()[0].getAttribute("data-agent-card")).toBe("true");
    });

    it("includes inline sub-block agent when tab blocks carry subblockids", () => {
        renderWithBlocks(
            {
                p1: {
                    otype: "block",
                    oid: "p1",
                    version: 1,
                    meta: { view: "preview" },
                    subblockids: ["sub1"],
                } as unknown as Block,
            },
            { sub1: agentBlock("sub1", "sess-sub") }
        );
        act(() => trigger().click());
        expect(rows()[0].getAttribute("data-agent-card")).toBe("true");
    });
});
