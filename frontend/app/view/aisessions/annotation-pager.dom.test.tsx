// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 分页控件（annotation-pager）DOM 契约测试（主文档 §4.2c / §4.2c-1）。
//
// 覆盖：
//  - chip 文案随 pageMode 变化（全部 / 按日 / 按问答 / 6h / 20 条），值与 i18n 实例同源（锁死 key）
//  - 菜单档位：5 模式行 + interval 1/6/12/24h + count 20/50/100 + 跟随默认
//  - 「跟随默认」点击回调 + 菜单关闭
//  - 翻页条边界：首页 ‹ 禁用（无 onLoadOlder 时）/ 接线后可点；末页 › 禁用
//  - 翻页条文案：相对日期 chip（今天/昨天 accent）/ 绝对日期 / 页序 / 消息数
//  - usePageModeState：恢复（storage）、autoPageMode（≤500 全部 / >500 按日）、
//    手动选过后不被默认规则覆盖、切页回调、debounce 落盘

// @vitest-environment jsdom

import { i18n, initI18n } from "@/i18n/config";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computePages, type PagingRow } from "./annotation-model";
import {
    AnnotationPagerBar,
    AnnotationViewChip,
    pageModeChipLabelSpec,
    usePageModeState,
    type PageModeStorage,
} from "./annotation-pager";
import { buildPageModeMeta, pageModeStateKey, parsePageModeMeta, type PersistedPageModeMap } from "./page-mode-persist";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement | null = null;
let root: Root | null = null;

function mount(node: React.ReactNode) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(node);
    });
}

/** 固定基准时刻：2026-11-12 12:00（本地时区；day 页跨 11-10/11-11/11-12 三天）。 */
const NOW = new Date(2026, 10, 12, 12, 0, 0, 0).getTime();

function dayAt(dayOffset: number, hour = 10): number {
    const base = new Date(NOW);
    return new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hour, 0, 0, 0).getTime();
}

/** 三天 × 每天 2 条消息（第二天带一条 user）：day/turn/count 三种页空间都能切。 */
function makeRows(): { rows: PagingRow[]; timestamps: Map<number, number> } {
    const rows: PagingRow[] = [
        { seq: 1, role: "user" },
        { seq: 2, role: "assistant" },
        { seq: 3, role: "user" },
        { seq: 4, role: "assistant" },
        { seq: 5, role: "user" },
        { seq: 6, role: "assistant" },
    ];
    const timestamps = new Map<number, number>([
        [1, dayAt(-2)],
        [2, dayAt(-2, 11)],
        [3, dayAt(-1)],
        [4, dayAt(-1, 11)],
        [5, dayAt(0)],
        [6, dayAt(0, 11)],
    ]);
    return { rows, timestamps };
}

function dayPages() {
    const { rows, timestamps } = makeRows();
    return computePages(rows, (seq) => timestamps.get(seq), { mode: "day" });
}

function turnPages() {
    const { rows, timestamps } = makeRows();
    return computePages(rows, (seq) => timestamps.get(seq), { mode: "turn" });
}

beforeEach(async () => {
    await initI18n("en");
    Element.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 200, 30);
});

afterEach(() => {
    if (root != null) act(() => root!.unmount());
    root = null;
    container?.remove();
    container = null;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

function chipButton(): HTMLButtonElement {
    return container!.querySelector<HTMLButtonElement>("[data-testid='annotation-view-chip']")!;
}

function menuRoot(): HTMLElement | null {
    return document.querySelector<HTMLElement>("[data-testid='annotation-pager-menu']");
}

function pagerBar(): HTMLElement | null {
    return container!.querySelector<HTMLElement>("[data-testid='annotation-pager-bar']");
}

// ---------------------------------------------------------------------------
// chip 文案
// ---------------------------------------------------------------------------

describe("AnnotationViewChip label", () => {
    const cases: Array<[ReturnType<typeof pageModeChipLabelSpec>["key"], string, string, number, string, string?]> = [
        ["aisessions:annotationPager.mode.all", "all", "all", 3, "All"],
        ["aisessions:annotationPager.mode.day", "day", "day", 3, "By day"],
        ["aisessions:annotationPager.mode.turnName", "turn", "turn", 3, "By Q&A"],
        // turn 的 chip 不随页数变化：结果摘要属于翻页条的 1/3，不属于模式入口
        ["aisessions:annotationPager.mode.turnName", "turn", "turn", 1, "By Q&A"],
        ["aisessions:annotationPager.mode.interval", "interval", "interval", 3, "6h", "6"],
        ["aisessions:annotationPager.mode.count", "count", "count", 3, "20 msgs", "20"],
    ];

    it.each(cases)("renders %s label for %s mode", (_key, mode, _m2, totalPages, expected) => {
        const spec = pageModeChipLabelSpec(mode as never, 6, 20, totalPages);
        expect(i18n.t(spec.key as never, (spec.params ?? {}) as never)).toBe(expected);
    });

    it("chip text follows pageMode (i18n-sourced)", () => {
        mount(
            <AnnotationViewChip
                pageMode="count"
                intervalHours={6}
                countSize={50}
                totalPages={4}
                open={false}
                onOpenChange={vi.fn()}
                onSelect={vi.fn()}
                onFollowDefault={vi.fn()}
            />
        );
        expect(chipButton().textContent).toBe("50 msgs");
        expect(chipButton().getAttribute("data-pager-mode")).toBe("count");
    });

    it("turn chip shows the mode name, not a page count", () => {
        mount(
            <AnnotationViewChip
                pageMode="turn"
                intervalHours={6}
                countSize={50}
                totalPages={3}
                open={false}
                onOpenChange={vi.fn()}
                onSelect={vi.fn()}
                onFollowDefault={vi.fn()}
            />
        );
        expect(chipButton().textContent).toBe("By Q&A");
        expect(chipButton().getAttribute("data-pager-mode")).toBe("turn");
    });
});

// ---------------------------------------------------------------------------
// 菜单档位
// ---------------------------------------------------------------------------

describe("AnnotationViewChip menu", () => {
    function mountChip(pageMode: string, props: Partial<React.ComponentProps<typeof AnnotationViewChip>> = {}) {
        const onSelect = props.onSelect ?? vi.fn();
        const onFollowDefault = props.onFollowDefault ?? vi.fn();
        const onOpenChange = props.onOpenChange ?? vi.fn();
        mount(
            <AnnotationViewChip
                pageMode={pageMode as never}
                intervalHours={6}
                countSize={50}
                totalPages={3}
                open={true}
                onOpenChange={onOpenChange}
                onSelect={onSelect}
                onFollowDefault={onFollowDefault}
            />
        );
        return { onSelect, onOpenChange, onFollowDefault };
    }

    it("shows 5 mode rows, 4 interval choices, 3 count choices and follow-default", () => {
        mountChip("all");
        const menu = menuRoot()!;
        expect(menu.getAttribute("role")).toBe("menu");
        const modes = Array.from(menu.querySelectorAll<HTMLElement>("[data-pager-mode]")).map((el) =>
            el.getAttribute("data-pager-mode")
        );
        expect(modes).toEqual(["all", "day", "turn", "interval", "count"]);
        const intervals = Array.from(menu.querySelectorAll<HTMLElement>("[data-pager-interval]")).map((el) =>
            el.getAttribute("data-pager-interval")
        );
        expect(intervals).toEqual(["1", "6", "12", "24"]);
        const counts = Array.from(menu.querySelectorAll<HTMLElement>("[data-pager-count]")).map((el) =>
            el.getAttribute("data-pager-count")
        );
        expect(counts).toEqual(["20", "50", "100"]);
        expect(menu.querySelector('[data-pager-action="follow-default"]')).not.toBeNull();
    });

    it("marks the active mode row aria-checked", () => {
        mountChip("day");
        const checked = menuRoot()!.querySelector<HTMLElement>('[aria-checked="true"]');
        expect(checked?.getAttribute("data-pager-mode")).toBe("day");
    });

    it("turn mode row shows the mode name without a count (菜单行是模式名，chip 才是页数)", () => {
        mountChip("all");
        const turnRow = menuRoot()!.querySelector<HTMLElement>('[data-pager-mode="turn"]')!;
        expect(turnRow.textContent).toBe("By Q&A");
    });

    it("selecting an interval choice reports mode + intervalHours and closes", () => {
        const { onSelect, onOpenChange } = mountChip("all");
        const pill = menuRoot()!.querySelector<HTMLElement>('[data-pager-interval="12"]')!;
        act(() => pill.click());
        expect(onSelect).toHaveBeenCalledWith({ mode: "interval", intervalHours: 12 });
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("selecting a count choice reports mode + countSize", () => {
        const { onSelect } = mountChip("all");
        act(() => menuRoot()!.querySelector<HTMLElement>('[data-pager-count="20"]')!.click());
        expect(onSelect).toHaveBeenCalledWith({ mode: "count", countSize: 20 });
    });

    it("selecting a plain mode row reports the mode without档位 overrides", () => {
        const { onSelect } = mountChip("all");
        act(() => menuRoot()!.querySelector<HTMLElement>('[data-pager-mode="day"]')!.click());
        expect(onSelect).toHaveBeenCalledWith({ mode: "day" });
    });

    it("follow-default resets via callback and closes the menu", () => {
        const { onFollowDefault, onOpenChange } = mountChip("day");
        act(() => menuRoot()!.querySelector<HTMLElement>('[data-pager-action="follow-default"]')!.click());
        expect(onFollowDefault).toHaveBeenCalledTimes(1);
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("arrow keys move focus among menu items (roving)", () => {
        mountChip("all");
        const menu = menuRoot()!;
        const items = Array.from(menu.querySelectorAll<HTMLElement>("[data-pager-menu-item]"));
        expect(items.length).toBeGreaterThan(2);
        act(() => items[0].focus());
        act(() => {
            menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
        });
        expect(document.activeElement).toBe(items[1]);
        act(() => {
            menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
        });
        expect(document.activeElement).toBe(items[0]);
    });
});

// ---------------------------------------------------------------------------
// 翻页条
// ---------------------------------------------------------------------------

describe("AnnotationPagerBar", () => {
    function mountBar(activePageIndex: number, onLoadOlder?: () => void, now = NOW) {
        const pages = dayPages();
        const onPrev = vi.fn();
        const onNext = vi.fn();
        const onOpenModeMenu = vi.fn();
        mount(
            <AnnotationPagerBar
                pages={pages}
                activePageIndex={activePageIndex}
                onPrev={onPrev}
                onNext={onNext}
                onOpenModeMenu={onOpenModeMenu}
                onLoadOlder={onLoadOlder}
                now={now}
            />
        );
        return { pages, onPrev, onNext, onOpenModeMenu };
    }

    it("renders page label with relative date chip, absolute date, position and message count", () => {
        const { pages } = mountBar(2);
        const bar = pagerBar()!;
        const text = bar.textContent ?? "";
        // 最新一天（11-12）= 今天：相对日期 + 绝对日期 + 页序 + 消息数
        expect(text).toContain("Today");
        expect(text).toContain("11-12");
        expect(text).toContain(`3/${pages.length}`);
        expect(text).toContain("2 messages");
    });

    it("yesterday page renders the yesterday relative label", () => {
        mountBar(1);
        expect(pagerBar()!.textContent).toContain("Yesterday");
        expect(pagerBar()!.textContent).toContain("11-11");
    });

    it("older-than-yesterday page renders only the absolute date (no relative chip)", () => {
        mountBar(0);
        const text = pagerBar()!.textContent ?? "";
        expect(text).not.toContain("Today");
        expect(text).not.toContain("Yesterday");
        expect(text).toContain("11-10");
    });

    it("disables ‹ on the first page when no load-older is wired", () => {
        mountBar(0);
        const prev = pagerBar()!.querySelector<HTMLButtonElement>("[data-pager-prev]")!;
        expect(prev.disabled).toBe(true);
    });

    it("keeps ‹ enabled on the first page when load-older is wired (连按语义)", () => {
        mountBar(0, vi.fn());
        const prev = pagerBar()!.querySelector<HTMLButtonElement>("[data-pager-prev]")!;
        expect(prev.disabled).toBe(false);
    });

    it("disables › on the last page", () => {
        mountBar(2);
        const next = pagerBar()!.querySelector<HTMLButtonElement>("[data-pager-next]")!;
        expect(next.disabled).toBe(true);
    });

    it("clicking ‹ / › fires the callbacks on middle pages", () => {
        const { onPrev, onNext } = mountBar(1);
        act(() => pagerBar()!.querySelector<HTMLButtonElement>("[data-pager-prev]")!.click());
        expect(onPrev).toHaveBeenCalledTimes(1);
        act(() => pagerBar()!.querySelector<HTMLButtonElement>("[data-pager-next]")!.click());
        expect(onNext).toHaveBeenCalledTimes(1);
    });

    it("middle text is the contextual mode entry (就地改模式)", () => {
        const { onOpenModeMenu } = mountBar(1);
        act(() => pagerBar()!.querySelector<HTMLButtonElement>("[data-pager-mode-entry]")!.click());
        expect(onOpenModeMenu).toHaveBeenCalledTimes(1);
    });

    it("renders nothing without pages", () => {
        mount(
            <AnnotationPagerBar
                pages={[]}
                activePageIndex={0}
                onPrev={vi.fn()}
                onNext={vi.fn()}
                onOpenModeMenu={vi.fn()}
            />
        );
        expect(pagerBar()).toBeNull();
    });

    it("turn mode has no primary text: starts at the position, no leading separator or Turn #", () => {
        const pages = turnPages();
        mount(
            <AnnotationPagerBar
                pages={pages}
                activePageIndex={pages.length - 1}
                onPrev={vi.fn()}
                onNext={vi.fn()}
                onOpenModeMenu={vi.fn()}
                now={NOW}
            />
        );
        const entry = pagerBar()!.querySelector("[data-pager-mode-entry]")!;
        const text = entry.textContent ?? "";
        expect(text).not.toContain("Turn #");
        expect(text.trimStart().startsWith("·")).toBe(false);
        expect(text.replace(/\s+/g, "")).toBe(`${pages.length}/${pages.length}·2messages`);
    });
});

// ---------------------------------------------------------------------------
// usePageModeState（恢复 / autoPageMode / 手动选择 / 切页 / 落盘）
// ---------------------------------------------------------------------------

function makeStorage(initial: PersistedPageModeMap = {}): PageModeStorage & {
    maps: PersistedPageModeMap[];
} {
    let current: PersistedPageModeMap = initial;
    const storage: PageModeStorage & { maps: PersistedPageModeMap[] } = {
        maps: [],
        load: () => ({ ...current }),
        save: (map) => {
            current = map;
            storage.maps.push(map);
        },
    };
    return storage;
}

function HookHarness({
    rows,
    timestamps,
    storage,
    sessionKey = "sess-1",
    totalMessages,
    onActivate,
}: {
    rows: PagingRow[];
    timestamps: Map<number, number>;
    storage: PageModeStorage;
    sessionKey?: string;
    totalMessages?: number;
    onActivate?: (page: { startSeq: number }) => void;
}) {
    const state = usePageModeState({
        rows,
        timestamps,
        sessionKey,
        connection: "local",
        storage,
        totalMessages,
        onPageActivate: onActivate,
    });
    return (
        <div
            data-testid="pager-state"
            data-mode={state.pageMode}
            data-user-set={String(state.pageModeUserSet)}
            data-page-index={state.activePageIndex}
            data-pages={state.pages.length}
            data-interval={state.intervalHours}
            data-count={state.countSize}
        >
            <button data-action="select-day" onClick={() => state.selectMode({ mode: "day" })} />
            <button data-action="select-count" onClick={() => state.selectMode({ mode: "count", countSize: 20 })} />
            <button data-action="follow-default" onClick={() => state.followDefault()} />
            <button data-action="prev" onClick={() => state.goPrevPage()} />
            <button data-action="next" onClick={() => state.goNextPage()} />
        </div>
    );
}

function stateNode(): HTMLElement {
    return container!.querySelector<HTMLElement>("[data-testid='pager-state']")!;
}

function click(action: string) {
    act(() => {
        container!.querySelector<HTMLButtonElement>(`[data-action='${action}']`)!.click();
    });
}

describe("usePageModeState", () => {
    it("restores the persisted selection for the session key", () => {
        const { rows, timestamps } = makeRows();
        const storage = makeStorage({
            [pageModeStateKey("local", "sess-1")]: { mode: "count", intervalHours: 12, countSize: 50, userSet: true },
        });
        mount(<HookHarness rows={rows} timestamps={timestamps} storage={storage} />);
        expect(stateNode().dataset.mode).toBe("count");
        expect(stateNode().dataset.count).toBe("50");
        expect(stateNode().dataset.userSet).toBe("true");
    });

    it("defaults to autoPageMode: all for ≤500 messages, day for >500", () => {
        const { rows, timestamps } = makeRows();
        const small = makeStorage();
        mount(<HookHarness rows={rows} timestamps={timestamps} storage={small} totalMessages={500} />);
        expect(stateNode().dataset.mode).toBe("all");

        act(() => root.unmount());
        container.remove();

        const big = makeStorage();
        mount(<HookHarness rows={rows} timestamps={timestamps} storage={big} totalMessages={501} />);
        expect(stateNode().dataset.mode).toBe("day");
    });

    it("a manual choice survives the auto rule (userSet wins)", () => {
        const { rows, timestamps } = makeRows();
        const storage = makeStorage();
        mount(<HookHarness rows={rows} timestamps={timestamps} storage={storage} totalMessages={501} />);
        expect(stateNode().dataset.mode).toBe("day");
        click("select-day");
        click("select-count");
        expect(stateNode().dataset.mode).toBe("count");
        expect(stateNode().dataset.userSet).toBe("true");
    });

    it("follow-default drops userSet and returns to the auto mode", () => {
        const { rows, timestamps } = makeRows();
        const storage = makeStorage();
        mount(<HookHarness rows={rows} timestamps={timestamps} storage={storage} totalMessages={501} />);
        click("select-day");
        click("follow-default");
        expect(stateNode().dataset.mode).toBe("day"); // >500 → day
        expect(stateNode().dataset.userSet).toBe("false");
    });

    it("paging moves the index and fires the activate callback with the page", () => {
        const { rows, timestamps } = makeRows();
        const storage = makeStorage();
        const activated: number[] = [];
        mount(
            <HookHarness
                rows={rows}
                timestamps={timestamps}
                storage={storage}
                onActivate={(page) => activated.push(page.startSeq)}
            />
        );
        // 默认 mode=all 只有单页：切到 count(20) 得到多页（6 条消息 → 1 页），
        // 改用 day 模式（3 页）才能翻页。
        click("select-day");
        expect(stateNode().dataset.pages).toBe("3");
        expect(stateNode().dataset.pageIndex).toBe("2"); // 初始跟随最新页
        click("prev");
        expect(stateNode().dataset.pageIndex).toBe("1");
        expect(activated).toEqual([expect.any(Number)]);
        click("next");
        expect(stateNode().dataset.pageIndex).toBe("2");
    });

    it("debounces saves with the sanitized entry and survives a meta round-trip", () => {
        vi.useFakeTimers();
        try {
            const { rows, timestamps } = makeRows();
            const storage = makeStorage();
            mount(<HookHarness rows={rows} timestamps={timestamps} storage={storage} />);
            click("select-count");
            expect(storage.maps).toHaveLength(0); // debounce 未到期不写
            act(() => {
                vi.advanceTimersByTime(500);
            });
            expect(storage.maps.length).toBeGreaterThanOrEqual(1);
            const key = pageModeStateKey("local", "sess-1");
            const saved = storage.maps.at(-1)![key];
            expect(saved).toEqual({ mode: "count", intervalHours: 24, countSize: 20, userSet: true });
            // meta 字符串 round-trip（parsePageModeMeta/buildPageModeMeta）
            const roundTrip = parsePageModeMeta(buildPageModeMeta(storage.maps.at(-1)!));
            expect(roundTrip![key]).toEqual(saved);
        } finally {
            vi.useRealTimers();
        }
    });
});
