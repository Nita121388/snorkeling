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

// 「+」升格条目的链路要能跑完（否则无后端时 upsert 对 RpcApi 报错、editor 不会被清空）。
// 只替换写路径两个函数，读取/排序等真实现保持不动。
vi.mock("./commontext-model", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./commontext-model")>();
    return {
        ...actual,
        // upsert mock 与真实路径同构：写回 settings atom，让 tags 结构化写入在 UI 上可观察
        // （动态 import 规避 vi.mock 提升作用域拿不到 jotai store 的问题）。
        upsertCommonTextItem: vi.fn(async (draft: any, existingId?: string) => {
            const { globalStore } = await import("@/app/store/jotaiStore");
            const { atoms } = await import("@/app/store/global-atoms");
            const config: any = globalStore.get(atoms.fullConfigAtom) ?? {};
            const items: any[] = config.settings?.["commontext:items"] ?? [];
            const idx = existingId != null ? items.findIndex((i) => i.id === existingId) : -1;
            const base =
                idx >= 0
                    ? items[idx]
                    : { id: existingId ?? "ct-mock-new", createdat: Date.now(), usagecount: 0, tags: [] };
            const item = {
                ...base,
                title: draft.title || base.title || "Mock",
                text: draft.text,
                tags: draft.tags ?? [],
                pinned: draft.pinned ?? base.pinned ?? false,
                updatedat: Date.now(),
                emoji: draft.emoji ?? base.emoji,
            };
            const next = idx >= 0 ? items.map((i, k) => (k === idx ? item : i)) : [item, ...items];
            globalStore.set(atoms.fullConfigAtom, {
                ...config,
                settings: { ...config.settings, "commontext:items": next },
            });
            return item;
        }),
        recordCommonTextUse: vi.fn(async () => undefined),
    };
});

import { atoms, initGlobalAtoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { CommonTextComposeModal } from "./commontext-compose-modal";
import { EditorDraftKey } from "./commontext-editor-draft";
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

// 组件文案走 i18n.t：先把实例初始化到 en（Pattern I），断言的 title/文本与 en 真源一致。
beforeAll(async () => {
    await initI18n("en");
});

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
    // 持久草稿落在 jsdom localStorage（同文件跨测试共享），每个用例后清空避免串。
    localStorage.clear();
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

function draftStatusEl(): Element | null {
    return document.querySelector("[data-commontext-draft-status]");
}

function readPersistedDraft(): { text: string; caret: number } | null {
    const raw = localStorage.getItem(EditorDraftKey);
    return raw == null ? null : JSON.parse(raw);
}

describe("CommonTextComposeModal — Enter flush (R2)", () => {
    function detailTitleInput(): HTMLInputElement | null {
        return document.querySelector("[data-commontext-detail-title]") as HTMLInputElement | null;
    }

    function listBox(): HTMLElement {
        const el = document.querySelector("[data-commontext-total]") as HTMLElement | null;
        expect(el).not.toBeNull();
        return el!;
    }

    it("opens the fresh top match when Enter is pressed right after typing (no debounce wait)", async () => {
        await openModal();
        // 输入 "Alpha" 只排了 80ms 防抖提交，此时仍未 commit；立即 Enter 必须走 flushSearch
        // 同步消费新文本——禁止 Enter 读到防抖窗口内的旧列表（否则会打开全量列表首位）。
        await typeIntoComposer("Alpha");
        const list = listBox();
        expect(list.getAttribute("data-commontext-total")).toBe("2");
        await act(async () => {
            list.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        });
        expect(detailTitleInput()?.value).toBe("Alpha standup");
        // 容器数据锚点：flush 后列表窗口重建，总数 = 命中数，窗口覆盖 [0-1)。
        expect(listBox().getAttribute("data-commontext-total")).toBe("1");
        expect(listBox().getAttribute("data-commontext-window")).toBe("0-1");
        // 行带绝对索引：第 0 行是相关度第一名。
        const rows = [...listBox().querySelectorAll("[data-common-text-index]")];
        expect(rows.length).toBe(1);
        expect(rows[0].getAttribute("data-common-text-index")).toBe("0");
        expect(rows[0].getAttribute("data-commontext-title")).toBe("Alpha standup");
    });

    it("keeps the ordering stable when the caret moves inside the same word before Enter", async () => {
        await openModal();
        // 同词内移动光标：caretContextSignature 不变 → 不重新提交搜索，Enter 仍打开当前词首位。
        await typeIntoComposer("Bravo");
        const el = composer();
        await act(async () => {
            el.setSelectionRange(1, 1);
            el.dispatchEvent(new Event("select", { bubbles: true }));
        });
        const list = listBox();
        await act(async () => {
            list.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        });
        expect(detailTitleInput()?.value).toBe("Bravo refund");
        expect(listBox().getAttribute("data-commontext-total")).toBe("1");
    });
});

describe("CommonTextComposeModal — editor draft autosave", () => {
    beforeEach(() => {
        // 只假 setTimeout/clearTimeout：草稿防抖是这条通道；rAF 等保留真实现（focus/合成路径靠它）。
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    async function advance(ms: number): Promise<void> {
        await act(async () => {
            vi.advanceTimersByTime(ms);
        });
    }

    it("persists the draft after the debounce and restores it on the next open", async () => {
        await openModal();
        await typeIntoComposer("draft line one\ndraft line two");
        // 防抖未到点不落盘
        expect(readPersistedDraft()).toBeNull();
        await advance(900);
        expect(readPersistedDraft()?.text).toBe("draft line one\ndraft line two");
        expect(draftStatusEl()?.getAttribute("data-commontext-draft-status")).toBe("saved");
        expect(draftStatusEl()?.textContent).toBe("Draft saved");

        // 模拟重启：整个组件卸载后重新挂载，无 query 打开 → 文本还原
        await act(async () => root.unmount());
        container.remove();
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
        await openModal();
        expect(composer().value).toBe("draft line one\ndraft line two");
        // 还原不冒「Draft saved」提示（本次没有改动）
        expect(draftStatusEl()?.getAttribute("data-commontext-draft-status")).toBe("idle");
    });

    it("clears the persisted draft when the eraser empties the editor", async () => {
        await openModal();
        await typeIntoComposer("erase me");
        await advance(900);
        expect(readPersistedDraft()?.text).toBe("erase me");
        await click(document.querySelector('button[title="Clear editor"]'));
        expect(composer().value).toBe("");
        expect(localStorage.getItem(EditorDraftKey)).toBeNull();
    });

    it("clears the persisted draft after + turns it into a list item", async () => {
        await openModal();
        await typeIntoComposer("promote me");
        await advance(900);
        expect(readPersistedDraft()?.text).toBe("promote me");
        await click(document.querySelector('button[title="Add new common text item (edit on the right)"]'));
        // fireAndForget 里的 upsert mock → setEditor("", 0) 需要几拍微任务
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(composer().value).toBe("");
        expect(localStorage.getItem(EditorDraftKey)).toBeNull();
    });

    it("ignores and drops a corrupt draft payload on open", async () => {
        localStorage.setItem(EditorDraftKey, "{definitely not json");
        await openModal();
        expect(composer().value).toBe("");
        expect(localStorage.getItem(EditorDraftKey)).toBeNull();
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
            "tags",
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

        // 展开 → 完整 6 行网格（Tags 首行 + 原 5 行）
        await click(document.querySelector("[data-commontext-properties-toggle]"));
        expect(document.querySelector("[data-commontext-properties]")!.getAttribute("data-commontext-properties")).toBe(
            "expanded"
        );
        const rows = [...document.querySelectorAll("[data-commontext-property]")];
        expect(rows.map((r) => r.getAttribute("data-commontext-property"))).toEqual([
            "Tags",
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
        // 底部 All tags 面板已移除：不再出现面板标题
        expect([...document.querySelectorAll("div")].some((d) => d.textContent === "All tags")).toBe(false);
    });

    it("edits tags through the property row popover (add via create, remove via chip ×)", async () => {
        await openModal({ query: "Bravo" });
        await click(document.querySelector("[data-commontext-properties-toggle]"));

        const detailTextarea = () =>
            document.querySelector(
                ".commontext-compose-modal textarea:not([data-commontext-composer])"
            ) as HTMLTextAreaElement;
        // 空 tags 显示 Empty 占位，值区可点开浮层
        expect(document.querySelector("[data-commontext-tags-value]")!.textContent).toContain("Empty");
        await click(document.querySelector("[data-commontext-tags-value]"));
        expect(document.querySelector('[data-testid="property-tag-editor"]')).not.toBeNull();

        // 输入新 tag + Enter（无候选 → 走「创建」分支）→ 正文追加 #urgent、chip 出现
        const input = document.querySelector(".ptag-input") as HTMLInputElement;
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
            setter.call(input, "urgent");
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => {
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        });
        // 内容与标签分离：tag 进结构化字段，正文不出现 #urgent 字面
        expect(detailTextarea().value).not.toContain("#urgent");
        expect(document.querySelector("[data-commontext-tags-value]")!.textContent).toContain("urgent");
        // 折叠摘要行同步展示标签名（不是只有数量），且不带 # 前缀
        const tagsSummary = document.querySelector('[data-commontext-properties-summary="tags"]');
        expect(tagsSummary!.textContent).toContain("urgent");
        expect(tagsSummary!.textContent).not.toContain("#");
        // 样式与展开态统一：摘要里是同一个 SessionTagChips chip（button），不是 join 纯文本
        expect(tagsSummary!.querySelector("button")).not.toBeNull();

        // chip × 删除 → 结构化 tags 里被移除（正文全程不变）
        const removeBtn = document.querySelector(".ptag-chip-remove") as HTMLButtonElement;
        const textBeforeRemove = detailTextarea().value;
        await act(async () => {
            removeBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        });
        expect(document.querySelector("[data-commontext-tags-value]")!.textContent).not.toContain("urgent");
        expect(detailTextarea().value).toBe(textBeforeRemove);

        // Esc 关闭浮层
        await act(async () => {
            (document.querySelector(".ptag-input") as HTMLInputElement).dispatchEvent(
                new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
            );
        });
        expect(document.querySelector('[data-testid="property-tag-editor"]')).toBeNull();
    });

    it("renders legacy #tag storage without the hash prefix in chips and picker options", async () => {
        // 历史脏数据：tags 带 # 前缀/后缀 + 正文里残留 #tag 字面——读路径惰性迁移必须：
        // tags 剥净、正文字面剥掉进 tags（内容与标签分离）。
        globalStore.set(atoms.fullConfigAtom, {
            settings: {
                "commontext:items": [
                    seedItems[0],
                    {
                        ...seedItems[1],
                        text: "Bravo refund policy #legacy #work",
                        tags: ["#legacy", "work#"],
                    },
                ],
            },
        } as any);
        await openModal({ query: "Bravo" });
        // 列表行 chip：历史 `#legacy` / `work#` 存量读出来即净，不显示 #。
        // 行内标签是静态 span（非 button）——不是筛选控件，点击该选中行而不是吞 click。
        const row = document.querySelector("[data-common-text-index]");
        const rowChips = [
            ...new Set(
                [...(row?.querySelectorAll("[data-commontext-row-tags] span") ?? [])]
                    .map((el) => (el.textContent ?? "").trim())
                    .filter((text) => text === "legacy" || text === "work")
            ),
        ];
        expect(rowChips.sort()).toEqual(["legacy", "work"]);
        // 左侧标签筛选 chips 同源：也不带 #
        const allChips = [...document.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim());
        expect(allChips.some((t) => t.startsWith("#"))).toBe(false);
        // Tags 浮层候选（PropertyTagEditor 直接渲染原文，不经过 SessionTagChips 的归一）：
        // 历史 #tag 存量必须已在读路径剥净，否则候选 chip 会显示 #legacy
        await click(document.querySelector("[data-commontext-properties-toggle]"));
        await click(document.querySelector("[data-commontext-tags-value]"));
        const optionChips = [...document.querySelectorAll(".ptag-option-chip")].map((el) =>
            (el.textContent ?? "").trim()
        );
        expect(optionChips).toContain("legacy");
        expect(optionChips).toContain("work");
        expect(optionChips.some((t) => t.startsWith("#"))).toBe(false);
    });
});

describe("CommonTextComposeModal — list row shrink guard", () => {
    // 回归背景（2026-11-20 用户截图）：列表滚动容器是 `flex flex-col`，行带
    // `overflow-hidden`（min-height:auto 解析为 0）且是一次渲染 N 行的虚拟列表 ——
    // 少了 shrink-0，N 行 44px 会被 flex 一起摊薄成十几像素一行，行内容被裁掉大半，
    // 真机表现为「列表文字缩成一条细线、行与行叠在一起、列表底部凭空多出空白」。
    // jsdom 不做 flex 布局计算（量不出 44px），所以这里锁的是**结构扳机**：
    // 行 / 虚拟占位一旦丢掉 shrink-0，布局塌陷立刻复现，本用例先红。
    function listBox(): HTMLElement {
        const el = document.querySelector("[data-commontext-total]") as HTMLElement | null;
        expect(el).not.toBeNull();
        return el!;
    }

    it("gives every rendered row shrink-0", async () => {
        await openModal();
        const rows = [...listBox().querySelectorAll("[data-common-text-index]")];
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
            expect(row.className).toContain("shrink-0");
        }
    });

    it("gives the virtualization spacer shrink-0 so scroll geometry stays intact", async () => {
        // 200 条：抛过窗口后 start>0 才会渲染顶部占位。
        const many = Array.from({ length: 200 }, (_, i) => ({
            ...seedItems[0],
            id: `ct-many-${i}`,
            title: `Item ${i}`,
            text: `Item ${i} body`,
        }));
        globalStore.set(atoms.fullConfigAtom, { settings: { "commontext:items": many } } as any);
        await openModal();
        const list = listBox();
        await act(async () => {
            list.scrollTop = 44 * 60;
            list.dispatchEvent(new Event("scroll", { bubbles: true }));
        });
        const [start] = (list.getAttribute("data-commontext-window") ?? "0-0").split("-").map(Number);
        expect(start).toBeGreaterThan(0);
        const spacer = list.querySelector('div[aria-hidden="true"]');
        expect(spacer).not.toBeNull();
        expect(spacer!.className).toContain("shrink-0");
    });
});

// ── 2026-11-20 commontext-compose-polish（R1–R5）───────────────────────────
// 这五点都是用户在真机上逐条提的视觉/交互整改；jsdom 量不了动画时长与像素居中，
// 所以这里锁**结构扳机**（该在的标记在、该删的类名已不存在），像素证据走验证台。
describe("CommonTextComposeModal — compose polish (11-20)", () => {
    function secondaryDeviceItems() {
        const other = {
            ...seedItems[0],
            id: "ct-charlie",
            title: "Charlie deploy",
            text: "Charlie deploy steps",
            origin: { deviceid: "dev-2", devicename: "Laptop", platform: "win32" },
        };
        globalStore.set(atoms.fullConfigAtom, {
            settings: { "commontext:items": [...seedItems, other] },
        } as any);
    }

    it("R1: drops the tutorial subtitle line from the header", async () => {
        await openModal();
        expect(document.body.textContent ?? "").not.toContain("Click + to add a new item to the top");
    });

    it("R2: focuses the composer into the expanded state and keeps the manual-collapse contract", async () => {
        await openModal();
        expect(isCollapsed()).toBe(true);
        await focusComposer();
        // 展开：不再写 inline height（保留 resize-y 拖高持久），改由 min-h-[120px] 撑开
        expect(isCollapsed()).toBe(false);
        expect(composer().style.height).toBe("");
        expect(composer().style.maxHeight).not.toBe("");
        // 显式收起后再次聚焦不应自动弹开（既有回归锁 A 不破）
        await click(editorToggle());
        expect(isCollapsed()).toBe(true);
        await focusComposer();
        expect(isCollapsed()).toBe(true);
    });

    it("R3: machine filter uses the unified AppSelect chip and keeps the native value channel", async () => {
        secondaryDeviceItems();
        await openModal();
        const chip = document.querySelector("[data-commontext-device-chip]");
        expect(chip).not.toBeNull();
        // 值通道仍是隐藏原生 select：验证台与 CDP 靠 .value/.options 驱动
        const proxy = chip!.querySelector("[data-commontext-device]") as HTMLSelectElement | null;
        expect(proxy).not.toBeNull();
        expect(proxy!.tagName).toBe("SELECT");
        expect([...proxy!.options].map((o) => o.value)).toEqual(["any", "dev-1", "dev-2"]);
        // 统一 AppSelect 触发器（不再是裸 select 视觉）
        expect(chip!.querySelector("[data-select-trigger]")).not.toBeNull();
        expect(chip!.className).not.toContain("text-accent");
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
            setter.call(proxy, "dev-2");
            proxy!.dispatchEvent(new Event("change", { bubbles: true }));
        });
        // 激活非 any 时 chip 用 accent 底色高亮（可发现性：现在筛的是哪台机器）
        expect(document.querySelector("[data-commontext-device-chip]")!.className).toContain("text-accent");
        const titles = [...document.querySelectorAll("[data-commontext-title]")].map((el) =>
            el.getAttribute("data-commontext-title")
        );
        expect(titles).toEqual(["Charlie deploy"]);
    });

    it("R4: rows no longer expose the hover insert icon and keep the meta column visible", async () => {
        await openModal();
        expect(document.querySelector(".item-insert-btn")).toBeNull();
        const meta = document.querySelector("[data-commontext-meta]");
        expect(meta).not.toBeNull();
        const child = meta!.firstElementChild as HTMLElement;
        expect(child.className).not.toContain("group-hover:opacity-0");
        // 插入入口搬到详情栏（唯一可见插入动作）
        await click(document.querySelector('[data-commontext-title="Alpha standup"]'));
        expect(document.querySelector("[data-commontext-detail-insert]")).not.toBeNull();
    });

    it("R5: synced detail status uses a lit cloud in accent and a compact relative time", async () => {
        globalStore.set(atoms.fullConfigAtom, {
            settings: {
                "commontext:items": [{ ...seedItems[0], syncstate: "synced", syncedrev: 3 }],
            },
        } as any);
        await openModal({ query: "Alpha" });
        const sync = document.querySelector("[data-commontext-detail-sync]") as HTMLElement | null;
        expect(sync).not.toBeNull();
        expect(sync!.getAttribute("data-commontext-detail-sync")).toBe("synced");
        // 点亮的云：实心云 + accent 字色（旧的暗灰云读不出「已同步」）
        expect(sync!.className).toContain("text-accent");
        expect(sync!.querySelector(".fa-cloud")).not.toBeNull();
        expect(sync!.querySelector(".fa-cloud-arrow-up")).toBeNull();
        // 图标与文字同一 14px 行盒居中
        expect(sync!.className).toContain("h-[14px]");
        expect(sync!.className).toContain("items-center");
        // 相对时间改成紧凑字形（1h 而不是「1 hour ago」/「1 小时前」）
        const compact = [...document.querySelectorAll<HTMLElement>("[data-commontext-detail-meta] span")]
            .map((el) => (el.textContent ?? "").trim())
            .filter((text) => /^(now|\d+[smhd])$/.test(text));
        expect(compact.length).toBeGreaterThan(0);
    });
});

// ── 2026-11-21 commontext-row-filter-polish（R1–R4）─────────────────────────
// 行高 44→52 修裁切 + 徽章居右 + 筛选区单行化 + 排序 chip 菜单。
// jsdom 量不出真实像素，这里锁结构扳机：行高常量、行内两段拆分、标签 3+N、
// 徽章 ml-auto、筛选条单容器与清空链路；像素证据由真机验证台兜住。
describe("CommonTextComposeModal — row height & filter bar (11-21)", () => {
    function seedManyTags() {
        const tagged = {
            ...seedItems[0],
            id: "ct-many-tags",
            title: "Many tags",
            text: "Row with four tags",
            tags: ["alpha", "bravo", "charlie", "delta", "echo"],
        };
        globalStore.set(atoms.fullConfigAtom, {
            settings: { "commontext:items": [...seedItems, tagged] },
        } as any);
        return tagged;
    }

    it("R1: rows are a fixed 52px two-line layout (title / preview+tags) with no third line", async () => {
        await openModal();
        const rows = [...document.querySelectorAll("[data-common-text-index]")];
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
            // 固定行高仍是虚拟化的单一常量；py-2 = 8/8，内高 36（16 + 2 + 18）
            expect((row as HTMLElement).style.height).toBe("52px");
            expect(row.className).toContain("py-2");
            // 行内标签容器绝不换行：换行第三行 = 旧行被裁切的根因
            const tagsSlot = row.querySelector("[data-commontext-row-tags]");
            if (tagsSlot != null) {
                expect((tagsSlot as HTMLElement).className).not.toContain("flex-wrap");
            }
            // 摘要与标签在同一行容器内（line2），不是两个独立块
            const main = row.firstElementChild?.nextElementSibling;
            expect(main?.className).toContain("flex-col");
            expect(main?.childElementCount).toBe(2);
        }
    });

    it("R1: shows at most 3 inline tags with +N and a full-list tooltip", async () => {
        seedManyTags();
        await openModal({ query: "Many tags" });
        const row = document.querySelector("[data-common-text-index]") as HTMLElement;
        const tagsSlot = row.querySelector("[data-commontext-row-tags]") as HTMLElement | null;
        expect(tagsSlot).not.toBeNull();
        expect(tagsSlot!.getAttribute("data-commontext-row-tags")).toBe("5");
        const chips = [...tagsSlot!.querySelectorAll(":scope > span")].map((el) => (el.textContent ?? "").trim());
        expect(chips).toEqual(["alpha", "bravo", "charlie", "+2"]);
        // 完整标签列表走 tooltip：截断不丢语义
        expect(tagsSlot!.getAttribute("title")).toContain("alpha");
        expect(tagsSlot!.getAttribute("title")).toContain("delta");
    });

    it("R2: creator badge is right-aligned after the title main area", async () => {
        await openModal({ query: "Alpha" });
        const row = document.querySelector("[data-common-text-index]") as HTMLElement;
        const badge = row.querySelector("[data-commontext-creator-badge]") as HTMLElement | null;
        expect(badge).not.toBeNull();
        expect(badge!.className).toContain("ml-auto");
        // 徽章在标题主区（title + syncdot wrapper）之后，不在标题文本前面
        const line1 = badge!.parentElement!;
        expect(line1.childElementCount).toBe(2);
        expect(line1.firstElementChild!.querySelector(".truncate")).not.toBeNull();
        expect(line1.lastElementChild).toBe(badge);
    });

    it("R3: the filter bar is a single container holding creator/device/sort/untagged/tags/reset", async () => {
        seedManyTags();
        await openModal();
        const bar = document.querySelector("[data-commontext-source-row]");
        expect(bar).not.toBeNull();
        // 创建者三档
        for (const key of ["all", "human", "agent"]) {
            expect(bar!.querySelector(`[data-commontext-creator="${key}"]`)).not.toBeNull();
        }
        // 无标签 chip / 标签条（nowrap + 单行滚动）
        expect(bar!.querySelector('[title="Show items with no tags"]')).not.toBeNull();
        const tagStrip = bar!.querySelector(".overflow-x-auto");
        expect(tagStrip).not.toBeNull();
        const chipsRoot = tagStrip!.firstElementChild as HTMLElement;
        expect(chipsRoot.className).toContain("flex-nowrap");
        expect(chipsRoot.className).not.toContain("flex-wrap");
        // 默认无筛选生效 → 清空按钮不出现
        expect(document.querySelector("[data-commontext-filter-reset]")).toBeNull();
        // 点一个创建者档 → 清空按钮出现；点它回到 all（机器/标签一并清）
        await click(bar!.querySelector('[data-commontext-creator="agent"]'));
        const reset = document.querySelector("[data-commontext-filter-reset]");
        expect(reset).not.toBeNull();
        const tagChip = [...document.querySelectorAll("[data-commontext-source-row] button")].find((b) =>
            (b.textContent ?? "").trim().startsWith("alpha")
        );
        expect(tagChip).toBeDefined();
        await click(tagChip!);
        expect(document.querySelector('[data-commontext-creator="all"]')!.getAttribute("aria-pressed")).toBe("false");
        await click(document.querySelector("[data-commontext-filter-reset]"));
        expect(document.querySelector('[data-commontext-creator="all"]')!.getAttribute("aria-pressed")).toBe("true");
        expect(document.querySelector("[data-commontext-filter-reset]")).toBeNull();
    });

    it("R4: sort is a native-select-backed chip menu that disables during relevance sort", async () => {
        await openModal();
        const sortSelect = document.querySelector("[data-commontext-sort]") as HTMLSelectElement | null;
        expect(sortSelect).not.toBeNull();
        expect(sortSelect!.tagName).toBe("SELECT");
        expect([...sortSelect!.options].map((o) => o.value)).toEqual([
            "lastused-desc",
            "updated-desc",
            "created-desc",
            "usage-desc",
            "title-asc",
        ]);
        expect(sortSelect!.disabled).toBe(false);
        // 切排序：值通道落盘（localStorage 偏好）
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
            setter.call(sortSelect, "title-asc");
            sortSelect!.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(sortSelect!.value).toBe("title-asc");
        expect(localStorage.getItem("commontext:sortKey")).toBe("title-asc");
        // 搜索态：菜单禁用 + 相关度指示出现
        await typeIntoComposer("Alpha standup notes");
        await act(async () => {
            await new Promise((r) => setTimeout(r, 300));
        });
        const disabledSelect = document.querySelector("[data-commontext-sort]") as HTMLSelectElement | null;
        expect(disabledSelect!.disabled).toBe(true);
        expect(document.querySelector("[data-commontext-sort-relevance]")).not.toBeNull();
    });
});

// ── 2026-11-23 commontext-modal-focus（AC3/AC4）─────────────────────────────
// 真机排查结论：详情区的受控更新本身稳定，出问题的是"弹窗内点死区丢焦点到 body"与
// "合成期被联动 effect 重置"。这里锁住两条兜底行为。
describe("CommonTextComposeModal — 详情焦点保护 (11-23)", () => {
    const detailTextarea = () =>
        document.querySelector(
            ".commontext-compose-modal textarea:not([data-commontext-composer])"
        ) as HTMLTextAreaElement;

    async function focusEl(el: HTMLElement): Promise<void> {
        await act(async () => {
            el.focus();
        });
    }

    async function clickRow(title: string): Promise<void> {
        await click(document.querySelector(`[data-commontext-title="${title}"]`));
    }

    async function flushFrames(): Promise<void> {
        await act(async () => {
            await new Promise((r) => setTimeout(r, 40));
        });
    }

    it("焦点掉到 body 时回收到详情 textarea", async () => {
        await openModal();
        await clickRow("Alpha standup");
        const ta = detailTextarea();
        await focusEl(ta);
        expect(document.activeElement).toBe(ta);

        // 模拟"点弹窗内死区（页脚空白 / 属性行 / 内边距）"：焦点掉到 body，
        // focusout 的 relatedTarget 为 null。
        await act(async () => {
            ta.blur();
            ta.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        });
        expect(document.activeElement).toBe(document.body);

        await flushFrames();
        expect(document.activeElement).toBe(detailTextarea());
    });

    it("焦点在弹窗内控件之间移动时不干预", async () => {
        await openModal();
        await clickRow("Alpha standup");
        const ta = detailTextarea();
        await focusEl(ta);

        // relatedTarget 非空 = 用户主动点/切到弹窗内另一个控件（这里用 composer 代指）
        const other = composer();
        await act(async () => {
            ta.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: other }));
        });
        await flushFrames();
        expect(document.activeElement).toBe(ta);
    });

    it("合成期间联动 effect 不重置详情字段，合成结束后再校正", async () => {
        await openModal();
        await clickRow("Bravo refund");
        const ta = detailTextarea();
        expect(ta.value).toBe("Bravo refund policy");
        await focusEl(ta);

        // 用户正在详情区改字
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
            setter.call(ta, "Bravo refund policy + draft");
            ta.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(ta.value).toBe("Bravo refund policy + draft");

        // 开始中文合成
        await act(async () => {
            ta.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        });

        // 合成中让列表过滤把当前条目挤出去（正常情况下联动 effect 会立刻重置详情字段）
        await typeIntoComposer("Alpha standup");
        await act(async () => {
            await new Promise((r) => setTimeout(r, 200));
        });
        expect(detailTextarea().value).toBe("Bravo refund policy + draft");

        // 合成结束 → effect 重新跑一次，按最新数据校正（切到 Alpha）
        await act(async () => {
            ta.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "草稿" }));
        });
        await flushFrames();
        await act(async () => {
            await new Promise((r) => setTimeout(r, 60));
        });
        const after = document.querySelector(
            ".commontext-compose-modal textarea:not([data-commontext-composer])"
        ) as HTMLTextAreaElement | null;
        // 列表只剩 Alpha（composer 过滤），详情应校正到 Alpha，且不再保留已废弃的 Bravo 草稿
        expect(after?.value).toBe("Alpha standup notes");
    });
});
