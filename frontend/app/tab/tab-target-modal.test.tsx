// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// TabTargetModal 结构契约测试（Move Block to Tab 收敛后的形态）。
//
// 覆盖：New tab 行置顶 / 行容器不是 <button> / 每行两个图标动作 / 无模式状态 /
//       行体点击 = primary 动作 / 图标点击 = 各自动作 / working 期间全禁用 /
//       onCreate 不被 rowActions 抢走 / 空态 / 错误恢复 / 旧单动作路径不受影响。
//
// Run: npx vitest run frontend/app/tab/tab-target-modal.test.tsx

// @vitest-environment jsdom

import { globalStore } from "@/app/store/jotaiStore";
import { WaveEnvContext } from "@/app/waveenv/waveenv";
import { makeMockWaveEnv } from "@/preview/mock/mockwaveenv";
import { atom, Provider } from "jotai";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TabTargetModal, type TabRowAction } from "./tab-target-modal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let portalTarget: HTMLElement;
let root: Root;

function makeEnv(tabIds: string[], currentTabId = "t1") {
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
        tabId: currentTabId,
        mockWaveObjs,
        atoms: { modalOpen: atom(false), staticTabId: atom(currentTabId) } as Partial<GlobalAtomsType>,
    });
}

type RenderOpts = {
    tabIds?: string[];
    currentTabId?: string;
    onCreate?: () => Promise<void>;
    createHint?: React.ReactNode;
    rowActions?: TabRowAction[];
    onSelect?: (targetTabId: string) => Promise<void>;
    actionLabel?: string;
    workingLabel?: string;
};

function render(opts: RenderOpts = {}) {
    const tabIds = opts.tabIds ?? ["t1", "t2", "t3"];
    const currentTabId = opts.currentTabId ?? "t1";
    const env = makeEnv(tabIds, currentTabId);
    const workspace = { tabids: tabIds } as Workspace;

    act(() => {
        root.render(
            <Provider store={globalStore}>
                <WaveEnvContext.Provider value={env}>
                    <TabTargetModal
                        workspace={workspace}
                        currentTabId={currentTabId}
                        title="Move Block"
                        subtitle="↳ from «Snorkeling»"
                        actionLabel={opts.actionLabel ?? "Move"}
                        workingLabel={opts.workingLabel ?? "Moving..."}
                        onClose={() => {}}
                        onSelect={opts.onSelect ?? (async () => {})}
                        onCreate={opts.onCreate}
                        createHint={opts.createHint}
                        rowActions={opts.rowActions}
                    />
                </WaveEnvContext.Provider>
            </Provider>
        );
    });
}

/** 两段式 rowActions：第一个 primary（行体点击），第二个是 ⧉。 */
function makeRowActions(spy: { move: string[]; copy: string[] }, failOn?: string): TabRowAction[] {
    return [
        {
            key: "move",
            label: "Move to tab",
            icon: "→",
            primary: true,
            run: async ({ targetTabId }) => {
                spy.move.push(targetTabId);
                if (failOn === "move") throw new Error("move exploded");
            },
        },
        {
            key: "copy",
            label: "Copy to tab",
            icon: "⧉",
            run: async ({ targetTabId }) => {
                spy.copy.push(targetTabId);
                if (failOn === "copy") throw new Error("copy exploded");
            },
        },
    ];
}

function listEl(): HTMLElement {
    return portalTarget.querySelector<HTMLElement>("[data-target-list]")!;
}

function newTabRow(): HTMLElement {
    return portalTarget.querySelector<HTMLElement>("[data-new-tab]")!;
}

function tabRows(): HTMLElement[] {
    return Array.from(portalTarget.querySelectorAll<HTMLElement>("[data-tab-row]"));
}

function iconButtons(row: HTMLElement): HTMLButtonElement[] {
    return Array.from(row.querySelectorAll<HTMLButtonElement>(".row-icon-btn"));
}

async function flush() {
    // 让 promise 链（setWorking → await run → setWorking(null)）跑完。
    await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
    });
}

beforeEach(() => {
    // Modal 走 createPortal 挂到 #main（同 modal.dom.test.tsx 的做法）。
    portalTarget = document.createElement("div");
    portalTarget.id = "main";
    document.body.appendChild(portalTarget);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    portalTarget.remove();
    vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────
// 旧路径（widgets.tsx 的 Create 弹窗）必须逐字段不变
// ─────────────────────────────────────────────────────────────

describe("legacy single-action path (no rowActions / no onCreate)", () => {
    it("does not render row icon buttons and keeps the old action label", () => {
        render();
        // 旧路径必须真的渲染出行，否则「没有图标」是真空为真。
        expect(tabRows()).toHaveLength(2);
        expect(portalTarget.querySelector(".row-icons")).toBeNull();
        expect(tabRows().every((row) => iconButtons(row).length === 0)).toBe(true);
        expect(portalTarget.querySelector(".tab-target-action-label")?.textContent).toBe("Move");
    });

    it("does not render a New tab row when onCreate is absent", () => {
        render();
        expect(newTabRow()).toBeNull();
        expect(listEl().querySelector("[data-new-tab]")).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────
// New tab 行
// ─────────────────────────────────────────────────────────────

describe("new tab row", () => {
    it("renders as the first list row and stays enabled", () => {
        render({ onCreate: async () => {} });
        const row = newTabRow();
        expect(row).not.toBeNull();
        expect(listEl().firstElementChild).toBe(row);
        expect(row.getAttribute("aria-disabled")).toBe("false");
    });

    it("is still available when there are no other tabs (empty state)", () => {
        render({ tabIds: ["t1"], onCreate: async () => {} });
        const row = newTabRow();
        expect(row).not.toBeNull();
        expect(row.getAttribute("aria-disabled")).toBe("false");
        expect(portalTarget.textContent).toContain("No other tabs");
    });

    it("runs onCreate alone when rowActions is absent (single-action path)", async () => {
        const onCreate = vi.fn(async () => {});
        render({ onCreate });
        await act(async () => {
            newTabRow().click();
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(onCreate).toHaveBeenCalledTimes(1);
    });

    it("with rowActions, the row body runs the primary action against the sentinel target", async () => {
        // 契约：有图标时 New tab 行的动作由 rowActions 承载，targetTabId 传哨兵
        // `__new__`，调用方负责翻成「建 tab + 该动作」。onCreate 在这条路径上不参与。
        const spy = { move: [] as string[], copy: [] as string[] };
        const onCreate = vi.fn(async () => {});
        render({ onCreate, rowActions: makeRowActions(spy) });
        await act(async () => {
            newTabRow().click();
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(spy.move).toEqual(["__new__"]);
        expect(spy.copy).toHaveLength(0);
        expect(onCreate).not.toHaveBeenCalled();
    });

    it("with rowActions, the copy icon on the New tab row targets the sentinel too", async () => {
        const spy = { move: [] as string[], copy: [] as string[] };
        render({ onCreate: async () => {}, rowActions: makeRowActions(spy) });
        const copyBtn = iconButtons(newTabRow()).find((b) => b.dataset.act === "copy")!;
        await act(async () => {
            copyBtn.click();
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(spy.copy).toEqual(["__new__"]);
    });
});

// ─────────────────────────────────────────────────────────────
// 行容器结构：不能是 <button>（图标按钮不能嵌套在按钮里）
// ─────────────────────────────────────────────────────────────

describe("row container structure", () => {
    it("uses div[role=button], never a <button> wrapper", () => {
        render({ rowActions: makeRowActions({ move: [], copy: [] }) });
        // 先钉住「确实渲染了行」：否则空数组会让下面的 for 循环真空通过（旧实现就这么骗过一次）。
        expect(tabRows()).toHaveLength(2);
        for (const row of tabRows()) {
            expect(row.tagName).toBe("DIV");
            expect(row.getAttribute("role")).toBe("button");
            expect(row.getAttribute("tabindex")).toBe("0");
        }
    });

    it("renders exactly two icon buttons per row, both labelled", () => {
        render({ rowActions: makeRowActions({ move: [], copy: [] }) });
        expect(tabRows()).toHaveLength(2);
        for (const row of tabRows()) {
            const icons = iconButtons(row);
            expect(icons).toHaveLength(2);
            expect(icons.map((b) => b.dataset.act)).toEqual(["move", "copy"]);
            for (const btn of icons) {
                expect(btn.getAttribute("title")).toBeTruthy();
                expect(btn.getAttribute("aria-label")).toBeTruthy();
            }
        }
    });

    it("has no mode switcher anywhere (title is fixed, no segmented control)", () => {
        render({ rowActions: makeRowActions({ move: [], copy: [] }) });
        expect(tabRows()).toHaveLength(2);
        expect(portalTarget.querySelector(".seg")).toBeNull();
        expect(portalTarget.querySelector("[data-mode]")).toBeNull();
        expect(portalTarget.querySelector("[data-mode-btn]")).toBeNull();
        expect(portalTarget.textContent).toContain("Move Block");
        expect(portalTarget.textContent).not.toContain("Copy Block");
    });
});

// ─────────────────────────────────────────────────────────────
// 动作分派：行体 = primary，图标 = 各自
// ─────────────────────────────────────────────────────────────

describe("action dispatch", () => {
    it("row body click runs the primary action (Move)", async () => {
        const spy = { move: [] as string[], copy: [] as string[] };
        render({ rowActions: makeRowActions(spy) });
        const row = tabRows()[0];
        await act(async () => {
            row.click();
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(spy.move).toEqual(["t2"]);
        expect(spy.copy).toHaveLength(0);
    });

    it("copy icon click runs the copy action on the same row (no mode switch)", async () => {
        const spy = { move: [] as string[], copy: [] as string[] };
        render({ rowActions: makeRowActions(spy) });
        const row = tabRows()[0];
        const copyBtn = iconButtons(row).find((b) => b.dataset.act === "copy")!;
        await act(async () => {
            copyBtn.click();
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(spy.copy).toEqual(["t2"]);
        expect(spy.move).toHaveLength(0);
    });

    it("Enter on the row body is equivalent to a body click", async () => {
        const spy = { move: [] as string[], copy: [] as string[] };
        render({ rowActions: makeRowActions(spy) });
        const row = tabRows()[0];
        await act(async () => {
            row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(spy.move).toEqual(["t2"]);
    });
});

// ─────────────────────────────────────────────────────────────
// working 期间：整行与两个图标都不可再点
// ─────────────────────────────────────────────────────────────

describe("working state", () => {
    it("disables the whole row and both icons while a row action is in flight", async () => {
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const actions: TabRowAction[] = [
            {
                key: "move",
                label: "Move",
                icon: "→",
                primary: true,
                run: async () => {
                    await gate;
                },
            },
            { key: "copy", label: "Copy", icon: "⧉", run: async () => {} },
        ];
        render({ rowActions: actions });

        await act(async () => {
            tabRows()[0].click();
            await new Promise((r) => setTimeout(r, 0));
        });

        const row = tabRows()[0];
        expect(row.getAttribute("aria-disabled")).toBe("true");
        expect(iconButtons(row).every((b) => b.disabled)).toBe(true);
        for (const other of tabRows().slice(1)) {
            expect(other.getAttribute("aria-disabled")).toBe("true");
        }
        if (newTabRow() != null) {
            expect(newTabRow().getAttribute("aria-disabled")).toBe("true");
        }

        await act(async () => {
            release();
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(tabRows()[0].getAttribute("aria-disabled")).toBe("false");
    });
});

// ─────────────────────────────────────────────────────────────
// 错误恢复
// ─────────────────────────────────────────────────────────────

describe("error handling", () => {
    it("shows the error text and re-enables the row when an action rejects", async () => {
        const spy = { move: [] as string[], copy: [] as string[] };
        render({ rowActions: makeRowActions(spy, "copy") });
        const row = tabRows()[0];
        const copyBtn = iconButtons(row).find((b) => b.dataset.act === "copy")!;
        await act(async () => {
            copyBtn.click();
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(portalTarget.textContent).toContain("copy exploded");
        expect(tabRows()[0].getAttribute("aria-disabled")).toBe("false");
    });
});
