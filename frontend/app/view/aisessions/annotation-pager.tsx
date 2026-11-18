// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 会话详情的**分页控件**（design/plans/aisessions-annotation-timeline-v2.md §4.2c / §4.2c-1）。
//
// 三件东西：
//  1. `AnnotationViewChip` —— 详情头右侧的视图 chip（`▦ 全部 / 按日 / 按问答 / 6h / 20 条`），
//     点开是分页方式弹层（5 模式 + interval 档 1/6/12/24h + count 档 20/50/100 + 跟随默认）。
//  2. `AnnotationPagerBar` —— 非 all 模式浮在消息流顶部的翻页条
//     `‹ 今天 · 11-11 · 2/2 · 7 条消息 ›`，中间文字是**上下文入口**（就地改模式）。
//  3. `usePageModeState` —— 分页状态（pageMode / intervalHours / countSize / userSet / 当前页）
//     + tab 持久化（读写通道由宿主注入，见 `PageModeStorage`：本文件不碰 RPC / jotai）。
//
// 契约（主文档 §4.2c-1）：
//  - 分页只发生在**渲染层**：页数组来自 `computePages`，与数据加载（游标）是两件事。
//  - 主入口 = 详情头 chip；上下文入口 = 翻页条文字；默认值 = `autoPageMode`（≤500 全部 / >500 按日）；
//    用户手动选过（`pageModeUserSet`）后默认规则不再覆盖。
//  - 「跟随默认」清掉 userSet 并回到默认规则。
//  - 文案全部走 i18n（`aisessions:annotationPager.*`），日期渲染复用列表的紧凑日期工具
//    （`formatSessionDateCompact`）；11-02 时间格式配置落地后替换这两个调用点即可。
//  - 弹层是轻量浮层（floating-ui + portal），**不走** DialogShell（那是编辑器的壳）。

import { i18n } from "@/i18n/config";
import { cn } from "@/util/util";
import {
    FloatingPortal,
    autoUpdate,
    flip,
    offset,
    shift,
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import * as React from "react";
import {
    CountDefaultSize,
    CountSizeChoices,
    IntervalDefaultHours,
    IntervalHourChoices,
    type MessagePage,
    type PageLabelData,
    type PageMode,
    type PagingRow,
    autoPageMode,
    clampPageIndex,
    computePages,
    pageIndexOfSeq,
    pageLabel,
    scopeSeqs,
} from "./annotation-model";
import {
    PageModeWriteDebounceMs,
    type PersistedPageMode,
    type PersistedPageModeMap,
    getPersistedPageMode,
    pageModeEqual,
    pageModeStateKey,
    withPersistedPageMode,
} from "./page-mode-persist";
import { formatSessionDateCompact } from "./utils";

/** unknown 桶的 dateKey（与 annotation-model 的 UnknownBucketKey 同值；这里只做展示分支）。 */
const UnknownDateKey = "unknown";

// ---------------------------------------------------------------------------
// 纯逻辑：chip 文案
// ---------------------------------------------------------------------------

/** chip 文案 = i18n key + 参数（纯数据，单测不用碰 i18n 实例）。 */
export type ChipLabelSpec = {
    key: string;
    params?: Record<string, unknown>;
};

/**
 * chip 文案随模式变化（§4.2c-1）：`全部 / 按日 / 按问答 / 6h / 20 条`。
 * 每个 chip 都只显示“能唯一确定这个模式的最小信息”：interval/count 用参数（6h / 20 条）就够，
 * turn 没有参数，只能给模式名（`按问答`）——页数（N 页）是结果不是模式，且与翻页条的 `1/3` 重复。
 */
export function pageModeChipLabelSpec(
    pageMode: PageMode,
    intervalHours: number,
    countSize: number,
    _totalPages: number
): ChipLabelSpec {
    switch (pageMode) {
        case "day":
            return { key: "aisessions:annotationPager.mode.day" };
        case "turn":
            return { key: "aisessions:annotationPager.mode.turnName" };
        case "interval":
            return { key: "aisessions:annotationPager.mode.interval", params: { count: intervalHours } };
        case "count":
            return { key: "aisessions:annotationPager.mode.count", params: { count: countSize } };
        case "all":
        default:
            return { key: "aisessions:annotationPager.mode.all" };
    }
}

/** 分页方式菜单的选择结果（interval / count 各带自己的档位）。 */
export type PageModeSelection = {
    mode: PageMode;
    intervalHours?: number;
    countSize?: number;
};

/** "YYYY-MM-DD" → 与列表一致的紧凑日期（同年省略年份）。
 *  11-02-datetime-format-config 落地后，把这里换成配置驱动的格式化器。 */
function formatDateKeyLabel(dateKey: string, now: number): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    if (match == null) return dateKey;
    const ts = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
    return formatSessionDateCompact(ts, now);
}

// ---------------------------------------------------------------------------
// 分页状态 + 持久化（tab 状态通道由宿主注入）
// ---------------------------------------------------------------------------

/** 分页状态的读写通道。宿主（session-detail）用 block meta + 内存热缓存实现。 */
export type PageModeStorage = {
    load: () => PersistedPageModeMap;
    save: (map: PersistedPageModeMap) => void;
};

export type PageModeStateOptions = {
    /** 会话消息行（升序/乱序都可以，computePages 自己排序）。 */
    rows: PagingRow[];
    /** seq → 锚点消息时间戳（ms）；缺失的条目在 day/interval 归 unknown 页。 */
    timestamps?: Map<number, number>;
    /** 会话 key（与 connection 一起构成持久化键）；空串 = 不持久化（modal / 新会话）。 */
    sessionKey: string;
    connection?: string;
    /** 持久化通道；缺省 = 纯内存态（不影响功能，只是切 tab 后回默认）。 */
    storage?: PageModeStorage;
    /** 消息总数（autoPageMode 判据）；缺省取 rows.length。 */
    totalMessages?: number;
    /** 页面当前所在消息 seq（切模式时把页脚对准它，避免翻页条指向无关页）。 */
    currentSeq?: number | null;
    /** 切换/翻页成功后回调：父级负责把视口滚到该页首条消息。 */
    onPageActivate?: (page: MessagePage) => void;
    /** 已到最旧页还要「更早」时回调（游标加载；未接线时翻页条在首页禁用 ‹）。 */
    onLoadOlder?: () => void;
};

export type PageModeState = {
    pageMode: PageMode;
    intervalHours: number;
    countSize: number;
    /** 用户是否手动选过分页方式（false = autoPageMode 可以覆盖）。 */
    pageModeUserSet: boolean;
    pages: MessagePage[];
    activePageIndex: number;
    activePage: MessagePage | null;
    /** 当前页 seq 集合（§4.2c 作用域收窄；all 模式 = 全部消息）。 */
    pageScopeSeqs: Set<number>;
    selectMode: (selection: PageModeSelection) => void;
    /** 跟随默认：清掉 userSet，回到 autoPageMode 的取值。 */
    followDefault: () => void;
    goPrevPage: () => void;
    goNextPage: () => void;
    goToPage: (index: number) => void;
};

export function usePageModeState(options: PageModeStateOptions): PageModeState {
    const { rows, timestamps, sessionKey, connection = "", storage, totalMessages, currentSeq } = options;
    const total = totalMessages ?? rows.length;
    const stateKey = React.useMemo(() => pageModeStateKey(connection, sessionKey), [connection, sessionKey]);

    const [pageMode, setPageMode] = React.useState<PageMode>(() => autoPageMode(total, false, "all"));
    const [intervalHours, setIntervalHours] = React.useState<number>(IntervalDefaultHours);
    const [countSize, setCountSize] = React.useState<number>(CountDefaultSize);
    const [pageModeUserSet, setPageModeUserSet] = React.useState(false);
    // null = 还没手动翻过页：跟随最新页（打开会话默认在底部，翻页条应指向最新一页）。
    const [pageIndexState, setPageIndexState] = React.useState<number | null>(null);

    const tsOf = React.useCallback((seq: number) => timestamps?.get(seq), [timestamps]);
    const pages = React.useMemo(
        () => computePages(rows, tsOf, { mode: pageMode, intervalHours, countSize }),
        [rows, tsOf, pageMode, intervalHours, countSize]
    );
    const activePageIndex = clampPageIndex(pageIndexState ?? pages.length - 1, pages.length);
    const activePage = pages[activePageIndex] ?? null;
    const pageScopeSeqs = React.useMemo(() => scopeSeqs(activePage), [activePage]);

    // ── refs：回调保持引用稳定（父级 memo 契约 + 事件闭包读最新值） ──
    const pagesRef = React.useRef(pages);
    pagesRef.current = pages;
    const activeIndexRef = React.useRef(activePageIndex);
    activeIndexRef.current = activePageIndex;
    const rowsRef = React.useRef(rows);
    rowsRef.current = rows;
    const tsOfRef = React.useRef(tsOf);
    tsOfRef.current = tsOf;
    const totalRef = React.useRef(total);
    totalRef.current = total;
    const currentSeqRef = React.useRef<number | null | undefined>(currentSeq);
    currentSeqRef.current = currentSeq;
    const onActivateRef = React.useRef(options.onPageActivate);
    onActivateRef.current = options.onPageActivate;
    const onLoadOlderRef = React.useRef(options.onLoadOlder);
    onLoadOlderRef.current = options.onLoadOlder;
    const stateRef = React.useRef<PersistedPageMode>({
        mode: pageMode,
        intervalHours,
        countSize,
        userSet: pageModeUserSet,
    });
    stateRef.current = {
        mode: pageMode,
        intervalHours,
        countSize,
        userSet: pageModeUserSet,
    };

    // ── 持久化：切会话先落盘上一个会话，再读回当前会话（§4.2c-1「每个 tab 记住自己的选择」） ──
    const hydratedKeyRef = React.useRef("");
    const lastSavedRef = React.useRef<PersistedPageMode | null>(null);

    React.useEffect(() => {
        const previousKey = hydratedKeyRef.current;
        if (storage != null && previousKey !== "" && previousKey !== stateKey) {
            // 同一个块里换会话：上一份选择必须先写出去，否则会被新房客的默认值覆盖。
            const map = storage.load();
            const entry = stateRef.current;
            if (!pageModeEqual(getPersistedPageMode(map, previousKey), entry)) {
                storage.save(withPersistedPageMode(map, previousKey, entry));
            }
        }
        hydratedKeyRef.current = stateKey;
        if (stateKey === "") {
            lastSavedRef.current = null;
            return;
        }
        const saved = storage == null ? null : getPersistedPageMode(storage.load(), stateKey);
        lastSavedRef.current = saved;
        if (saved == null) {
            setPageMode(autoPageMode(totalRef.current, false, "all"));
            setIntervalHours(IntervalDefaultHours);
            setCountSize(CountDefaultSize);
            setPageModeUserSet(false);
        } else {
            setPageMode(saved.mode);
            setIntervalHours(saved.intervalHours);
            setCountSize(saved.countSize);
            setPageModeUserSet(saved.userSet);
        }
        setPageIndexState(null);
    }, [stateKey, storage]);

    // 没手动选过 → 跟随 autoPageMode（≤500 全部 / >500 按日，§4.2c-1）。
    React.useEffect(() => {
        if (pageModeUserSet) return;
        if (stateKey !== "" && hydratedKeyRef.current !== stateKey) return;
        const next = autoPageMode(total, false, pageMode);
        if (next === pageMode) return;
        setPageMode(next);
        setPageIndexState(null);
    }, [pageMode, pageModeUserSet, stateKey, total]);

    // 状态变化 → debounce 落盘（对齐 10-29 筛选状态的写入节奏）。
    React.useEffect(() => {
        if (stateKey === "") return;
        if (hydratedKeyRef.current !== stateKey) return;
        const entry: PersistedPageMode = {
            mode: pageMode,
            intervalHours,
            countSize,
            userSet: pageModeUserSet,
        };
        if (pageModeEqual(entry, lastSavedRef.current)) return;
        const timer = window.setTimeout(() => {
            lastSavedRef.current = entry;
            if (storage == null) return;
            storage.save(withPersistedPageMode(storage.load(), stateKey, entry));
        }, PageModeWriteDebounceMs);
        return () => window.clearTimeout(timer);
    }, [countSize, intervalHours, pageMode, pageModeUserSet, stateKey, storage]);

    // ── 动作（全部稳定引用：父级把它们传给 memo 化的行组件） ──
    const activatePage = React.useCallback((page: MessagePage | null | undefined) => {
        if (page == null) return;
        onActivateRef.current?.(page);
    }, []);

    const goToPage = React.useCallback(
        (index: number) => {
            const list = pagesRef.current;
            const clamped = clampPageIndex(index, list.length);
            if (clamped < 0) return;
            setPageIndexState(clamped);
            activatePage(list[clamped]);
        },
        [activatePage]
    );

    const goPrevPage = React.useCallback(() => {
        const index = activeIndexRef.current;
        if (index <= 0) {
            // 已到最旧页：交给游标加载（未接线时翻页条在首页禁用 ‹）。
            onLoadOlderRef.current?.();
            return;
        }
        goToPage(index - 1);
    }, [goToPage]);

    const goNextPage = React.useCallback(() => {
        goToPage(activeIndexRef.current + 1);
    }, [goToPage]);

    // 切模式：页空间变了，用「视口所在消息」重新定位页脚（§3.6「切筛选 → 重置最新页」同口径，
    // 这里更保守一点：能找到视口消息就停在它所在的页，不把用户甩回最新页）。
    const reseatPage = React.useCallback((mode: PageMode, nextIntervalHours: number, nextCountSize: number) => {
        const nextPages = computePages(rowsRef.current, tsOfRef.current, {
            mode,
            intervalHours: nextIntervalHours,
            countSize: nextCountSize,
        });
        const anchorSeq = currentSeqRef.current;
        const index = anchorSeq == null ? -1 : pageIndexOfSeq(nextPages, anchorSeq);
        setPageIndexState(index >= 0 ? index : null);
    }, []);

    const selectMode = React.useCallback(
        (selection: PageModeSelection) => {
            const nextIntervalHours = selection.intervalHours ?? IntervalDefaultHours;
            const nextCountSize = selection.countSize ?? CountDefaultSize;
            setPageModeUserSet(true);
            setPageMode(selection.mode);
            setIntervalHours(nextIntervalHours);
            setCountSize(nextCountSize);
            reseatPage(selection.mode, nextIntervalHours, nextCountSize);
        },
        [reseatPage]
    );

    const followDefault = React.useCallback(() => {
        const nextMode = autoPageMode(totalRef.current, false, "all");
        setPageModeUserSet(false);
        setIntervalHours(IntervalDefaultHours);
        setCountSize(CountDefaultSize);
        setPageMode(nextMode);
        reseatPage(nextMode, IntervalDefaultHours, CountDefaultSize);
    }, [reseatPage]);

    return {
        pageMode,
        intervalHours,
        countSize,
        pageModeUserSet,
        pages,
        activePageIndex,
        activePage,
        pageScopeSeqs,
        selectMode,
        followDefault,
        goPrevPage,
        goNextPage,
        goToPage,
    };
}

// ---------------------------------------------------------------------------
// 视图 chip + 分页方式弹层
// ---------------------------------------------------------------------------

export type AnnotationViewChipProps = {
    pageMode: PageMode;
    intervalHours: number;
    countSize: number;
    totalPages: number;
    /** 受控开合：翻页条也是入口（上下文入口要能打开同一个弹层）。 */
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSelect: (selection: PageModeSelection) => void;
    onFollowDefault?: () => void;
};

export function AnnotationViewChip({
    pageMode,
    intervalHours,
    countSize,
    totalPages,
    open,
    onOpenChange,
    onSelect,
    onFollowDefault,
}: AnnotationViewChipProps) {
    const [reference, setReference] = React.useState<HTMLButtonElement | null>(null);
    const menuRef = React.useRef<HTMLDivElement | null>(null);

    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange,
        placement: "bottom-end",
        middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8, crossAxis: true })],
        whileElementsMounted: autoUpdate,
        elements: { reference },
    });
    const dismiss = useDismiss(context);
    const { getFloatingProps } = useInteractions([dismiss]);

    const labelSpec = pageModeChipLabelSpec(pageMode, intervalHours, countSize, totalPages);
    const label: string =
        labelSpec.params == null
            ? (i18n.t(labelSpec.key as never) as unknown as string)
            : (i18n.t(labelSpec.key as never, labelSpec.params as never) as unknown as string);

    // 打开时把焦点落到当前选中的那一项（roving focus 的起点）。
    React.useEffect(() => {
        if (!open) return;
        const menu = menuRef.current;
        if (menu == null) return;
        const checked = menu.querySelector<HTMLElement>('[data-pager-menu-item][aria-checked="true"]');
        (checked ?? menu.querySelector<HTMLElement>("[data-pager-menu-item]"))?.focus();
    }, [open]);

    const menuItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[data-pager-menu-item]") ?? []);

    const moveFocus = (delta: number) => {
        const items = menuItems();
        if (items.length === 0) return;
        const current = items.findIndex((item) => item === document.activeElement);
        const from = current < 0 ? 0 : current;
        const next = (from + delta + items.length) % items.length;
        items[next]?.focus();
    };

    const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            moveFocus(1);
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            moveFocus(-1);
        }
    };

    const choose = (selection: PageModeSelection) => {
        onSelect(selection);
        onOpenChange(false);
    };

    const modeRow = (mode: PageMode, text: string, selection: PageModeSelection) => {
        const checked = pageMode === mode && selection.intervalHours == null && selection.countSize == null;
        return (
            <button
                key={mode}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                data-pager-menu-item="1"
                data-pager-mode={mode}
                onClick={() => choose(selection)}
                className={cn(
                    "flex h-[28px] w-full cursor-pointer items-center gap-1.5 rounded px-2 text-xs transition-colors",
                    checked ? "bg-accent/10 text-accent" : "text-secondary hover:bg-hover hover:text-primary"
                )}
            >
                <i
                    aria-hidden="true"
                    className={cn("fa-sharp fa-solid w-3 shrink-0 text-[10px]", checked ? "fa-check" : "")}
                />
                <span className="min-w-0 flex-1 truncate text-left">{text}</span>
            </button>
        );
    };

    const choicePill = (
        kind: "interval" | "count",
        value: number,
        text: string,
        selection: PageModeSelection,
        checked: boolean
    ) => (
        <button
            key={`${kind}-${value}`}
            type="button"
            role="menuitemradio"
            aria-checked={checked}
            data-pager-menu-item="1"
            data-pager-interval={kind === "interval" ? value : undefined}
            data-pager-count={kind === "count" ? value : undefined}
            onClick={() => choose(selection)}
            className={cn(
                "cursor-pointer rounded-full border px-2 py-[2px] text-[11px] tabular-nums transition-colors",
                checked
                    ? "border-accent/60 bg-accent/10 text-accent"
                    : "border-border text-secondary hover:border-accent/40 hover:text-primary"
            )}
        >
            {text}
        </button>
    );

    return (
        <>
            <button
                ref={setReference}
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                data-testid="annotation-view-chip"
                data-pager-mode={pageMode}
                title={i18n.t("aisessions:annotationPager.chipAria", { label })}
                aria-label={i18n.t("aisessions:annotationPager.chipAria", { label })}
                onClick={() => onOpenChange(!open)}
                className={cn(
                    "inline-flex h-[22px] shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2 text-[11px] transition-colors",
                    open
                        ? "border-accent/60 bg-accent/10 text-accent"
                        : "border-border text-secondary hover:bg-hover hover:text-primary"
                )}
            >
                <i aria-hidden="true" className="fa-sharp fa-solid fa-table-columns text-[9px]" />
                <span className="whitespace-nowrap">{label}</span>
            </button>
            {open ? (
                <FloatingPortal>
                    <div
                        ref={(node) => {
                            refs.setFloating(node);
                            menuRef.current = node;
                        }}
                        style={{ ...floatingStyles, width: 208 }}
                        {...getFloatingProps()}
                        role="menu"
                        aria-label={i18n.t("aisessions:annotationPager.menuTitle")}
                        data-testid="annotation-pager-menu"
                        onKeyDown={handleMenuKeyDown}
                        className="z-50 flex flex-col gap-0.5 overflow-hidden rounded-lg border border-border bg-modalbg p-1 shadow-xl backdrop-blur"
                    >
                        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted">
                            {i18n.t("aisessions:annotationPager.menuTitle")}
                        </div>
                        {modeRow("all", i18n.t("aisessions:annotationPager.mode.all"), { mode: "all" })}
                        {modeRow("day", i18n.t("aisessions:annotationPager.mode.day"), { mode: "day" })}
                        {modeRow("turn", i18n.t("aisessions:annotationPager.mode.turnName"), { mode: "turn" })}
                        {modeRow(
                            "interval",
                            i18n.t("aisessions:annotationPager.mode.interval", { count: intervalHours }),
                            {
                                mode: "interval",
                                intervalHours,
                            }
                        )}
                        <div className="flex flex-wrap items-center gap-1 px-2 pb-1">
                            <span className="w-14 shrink-0 text-[10px] text-muted">
                                {i18n.t("aisessions:annotationPager.intervalLabel")}
                            </span>
                            {IntervalHourChoices.map((hours) =>
                                choicePill(
                                    "interval",
                                    hours,
                                    i18n.t("aisessions:annotationPager.mode.interval", { count: hours }),
                                    { mode: "interval", intervalHours: hours },
                                    pageMode === "interval" && intervalHours === hours
                                )
                            )}
                        </div>
                        {modeRow("count", i18n.t("aisessions:annotationPager.mode.count", { count: countSize }), {
                            mode: "count",
                            countSize,
                        })}
                        <div className="flex flex-wrap items-center gap-1 px-2 pb-1">
                            <span className="w-14 shrink-0 text-[10px] text-muted">
                                {i18n.t("aisessions:annotationPager.countLabel")}
                            </span>
                            {CountSizeChoices.map((size) =>
                                choicePill(
                                    "count",
                                    size,
                                    i18n.t("aisessions:annotationPager.mode.count", { count: size }),
                                    { mode: "count", countSize: size },
                                    pageMode === "count" && countSize === size
                                )
                            )}
                        </div>
                        {onFollowDefault != null ? (
                            <button
                                type="button"
                                role="menuitem"
                                data-pager-menu-item="1"
                                data-pager-action="follow-default"
                                onClick={() => {
                                    onFollowDefault();
                                    onOpenChange(false);
                                }}
                                title={i18n.t("aisessions:annotationPager.followDefaultTitle")}
                                className="mt-0.5 flex h-[26px] w-full cursor-pointer items-center gap-1.5 rounded border-t border-border/60 px-2 text-[11px] text-secondary transition-colors hover:bg-hover hover:text-primary"
                            >
                                <i aria-hidden="true" className="fa-sharp fa-solid fa-rotate-left text-[9px]" />
                                <span className="truncate">{i18n.t("aisessions:annotationPager.followDefault")}</span>
                            </button>
                        ) : null}
                    </div>
                </FloatingPortal>
            ) : null}
        </>
    );
}

// ---------------------------------------------------------------------------
// 翻页条
// ---------------------------------------------------------------------------

export type AnnotationPagerBarProps = {
    pages: MessagePage[];
    activePageIndex: number;
    onPrev: () => void;
    onNext: () => void;
    /** 中间文字 = 上下文入口（就地改分页方式，不用回顶部找 chip）。 */
    onOpenModeMenu: () => void;
    /** 已接线的游标加载；为 undefined 时首页的 ‹ 直接禁用。 */
    onLoadOlder?: () => void;
    /** 相对日期的比较基准（缺省 Date.now()，测试注入固定值）。 */
    now?: number;
};

/** 翻页条主文案（结构化字段 → 本地化片段）：相对日期 chip 用 accent 微调（§4.2 规格）。
 *  返回 null = 该模式无主文案（turn / count）：调用方据此省掉前导分隔点。 */
function pageBarPrimary(label: PageLabelData, now: number): React.ReactNode {
    if (label.mode === "day") {
        if (label.relative != null) {
            return (
                <span className="shrink-0 font-medium text-accent">
                    {i18n.t(
                        label.relative === "today"
                            ? "aisessions:annotationRail.today"
                            : "aisessions:annotationRail.yesterday"
                    )}
                </span>
            );
        }
        if (label.dateKey == null || label.dateKey === UnknownDateKey) {
            return <span className="shrink-0 text-secondary">{i18n.t("aisessions:annotationPager.unknownDate")}</span>;
        }
        return <span className="shrink-0 tabular-nums">{formatDateKeyLabel(label.dateKey, now)}</span>;
    }
    if (label.mode === "interval" && label.windowStartTs != null) {
        return (
            <span className="shrink-0 tabular-nums">{formatSessionDateCompact(label.windowStartTs, now, true)}</span>
        );
    }
    return null;
}

export function AnnotationPagerBar({
    pages,
    activePageIndex,
    onPrev,
    onNext,
    onOpenModeMenu,
    onLoadOlder,
    now,
}: AnnotationPagerBarProps) {
    const page = pages[activePageIndex] ?? null;
    if (page == null) return null;
    const referenceNow = now ?? Date.now();
    const label = pageLabel(page, {
        now: referenceNow,
        index: activePageIndex + 1,
        total: pages.length,
    });
    const atFirst = activePageIndex <= 0;
    const atLast = activePageIndex >= pages.length - 1;
    const prevDisabled = atFirst && onLoadOlder == null;
    const prevTitle = prevDisabled
        ? i18n.t("aisessions:annotationPager.prev")
        : atFirst
          ? `${i18n.t("aisessions:annotationPager.prev")} — ${i18n.t("aisessions:annotationPager.olderHint")}`
          : i18n.t("aisessions:annotationPager.prev");
    // day 模式同时给出「今天 · 11-11」两档（§4.2 规格的原型文案）。
    const showAbsoluteDate = label.relative != null && label.dateKey != null && label.dateKey !== UnknownDateKey;
    const primary = pageBarPrimary(label, referenceNow);
    // 主文案 / 绝对日期 / 页码 / 消息数：只渲染存在的那几段，段间自动补分隔点
    // （turn / count 模式没有主文案，直接以页码开头，不泄漏前导「·」）。
    const barParts: React.ReactNode[] = [
        primary,
        showAbsoluteDate ? (
            <span key="date" className="shrink-0 tabular-nums text-secondary">
                {formatDateKeyLabel(label.dateKey as string, referenceNow)}
            </span>
        ) : null,
        <span
            key="pos"
            className="shrink-0 tabular-nums text-secondary"
            aria-label={
                label.index != null && label.total != null
                    ? i18n.t("aisessions:annotationPager.position", { index: label.index, total: label.total })
                    : undefined
            }
        >
            {label.index ?? 1}/{label.total ?? 1}
        </span>,
        <span key="count" className="shrink-0 text-secondary">
            {i18n.t("aisessions:annotationPager.messageCount", { count: label.messageCount })}
        </span>,
    ].filter((part) => part != null);

    return (
        <div
            role="toolbar"
            aria-label={i18n.t("aisessions:annotationPager.barAria")}
            data-testid="annotation-pager-bar"
            data-pager-page={activePageIndex}
            className="pointer-events-auto inline-flex h-[26px] max-w-full items-center gap-0.5 rounded-full border border-border bg-modalbg/95 px-1 text-[11px] text-primary shadow-lg backdrop-blur"
        >
            <button
                type="button"
                data-pager-prev="1"
                disabled={prevDisabled}
                title={prevTitle}
                aria-label={prevTitle}
                onClick={onPrev}
                className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors",
                    prevDisabled
                        ? "cursor-default text-muted opacity-40"
                        : "cursor-pointer text-secondary enabled:hover:bg-hover enabled:hover:text-primary"
                )}
            >
                <i aria-hidden="true" className="fa-sharp fa-solid fa-chevron-left text-[9px]" />
            </button>
            <button
                type="button"
                data-pager-mode-entry="1"
                onClick={onOpenModeMenu}
                title={i18n.t("aisessions:annotationPager.modeEntryTitle")}
                aria-label={i18n.t("aisessions:annotationPager.modeEntryTitle")}
                className="flex min-w-0 cursor-pointer items-center gap-1 rounded-full px-1.5 py-[1px] hover:bg-hover"
            >
                {barParts.map((part, index) => (
                    <React.Fragment key={index}>
                        {index > 0 ? (
                            <span aria-hidden="true" className="text-secondary/60">
                                ·
                            </span>
                        ) : null}
                        {part}
                    </React.Fragment>
                ))}
            </button>
            <button
                type="button"
                data-pager-next="1"
                disabled={atLast}
                title={i18n.t("aisessions:annotationPager.next")}
                aria-label={i18n.t("aisessions:annotationPager.next")}
                onClick={onNext}
                className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors",
                    atLast
                        ? "cursor-default text-muted opacity-40"
                        : "cursor-pointer text-secondary enabled:hover:bg-hover enabled:hover:text-primary"
                )}
            >
                <i aria-hidden="true" className="fa-sharp fa-solid fa-chevron-right text-[9px]" />
            </button>
        </div>
    );
}
