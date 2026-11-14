// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { Input, InputGroup, InputRightElement } from "@/app/element/input";
import { Modal } from "@/app/modals/modal";
import { atoms } from "@/app/store/global";
import { SessionTagChips } from "@/app/view/aisessions/session-tag-chips";
import { extractSessionTagsFromNote, removeSessionTagFromNote } from "@/app/view/aisessions/session-tags";
import { formatSessionDateCompact, formatSessionRelativeTime } from "@/app/view/aisessions/utils";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { clearEditorDraft, loadEditorDraft, saveEditorDraft } from "./commontext-editor-draft";
import { computeEditorMaxHeight } from "./commontext-editor-size";
import { OpenCommonTextSearchEvent, type CommonTextSearchDetail } from "./commontext-events";
// 标签属性浮层：与 md 预览属性卡 / AISessions 属性面板共用的 Wolai 风格编辑器，
// 避免同一个标签交互在三个面各自漂移。
import { PropertyTagEditor, PropertyValuePopover } from "@/app/element/property-editor";
import { commonTextFreshnessTier, formatCommonTextFreshnessCompact } from "./commontext-freshness";
import { CommonTextFreshnessSquare } from "./commontext-freshness-square";
import { copyCommonText, insertOrCopyCommonText } from "./commontext-insert";
import {
    DefaultCommonTextSortKey,
    deleteCommonTextItem,
    filterCommonTextItemsByTags,
    getCommonTextCreatorKind,
    getCommonTextDeviceSummaries,
    getCommonTextItems,
    getCommonTextItemsFromSettings,
    getCommonTextOriginDeviceId,
    getCommonTextOriginDeviceName,
    getCommonTextTagSummaries,
    getLiveCommonTextItems,
    recordCommonTextUse,
    searchCommonTextComposeItems,
    upsertCommonTextItem,
    type CommonTextCreatorFilter,
    type CommonTextItem,
    type CommonTextSortKey,
} from "./commontext-model";
import { PageIconSlot } from "./commontext-page-icon";
import {
    materializePastedImages,
    pickPastedImages,
    spliceTextAtRange,
    type PasteImageInsertResult,
} from "./commontext-paste-image";
import { CommontextSendButton } from "./commontext-send-button";
import { loadCommonTextSortKey, saveCommonTextSortKey } from "./commontext-sort-preference";

const LIST_LIMIT = 500;
const MAX_TAG_CHIPS = 16;

/** 创建者筛选三档：图标 + 计数，含义全走 title / aria-label（与排序控件同口径）。 */
const CommonTextCreatorFilters: { key: CommonTextCreatorFilter; icon: string; label: string }[] = [
    { key: "all", icon: "fa-solid fa-layer-group", label: "All creators" },
    { key: "human", icon: "fa-solid fa-user", label: "Created by a person" },
    { key: "agent", icon: "fa-solid fa-robot", label: "Created by an agent" },
];

/** 排序控件：只用图标，含义全走 title / aria-label（不占左栏宽度）。 */
const CommonTextSortOptions: { key: CommonTextSortKey; icon: string; label: string }[] = [
    { key: "lastused-desc", icon: "fa-clock-rotate-left", label: "Recently used" },
    { key: "updated-desc", icon: "fa-pen", label: "Recently updated" },
    { key: "created-desc", icon: "fa-calendar-plus", label: "Recently created" },
    { key: "usage-desc", icon: "fa-fire", label: "Most used" },
    { key: "title-asc", icon: "fa-arrow-down-a-z", label: "Title A to Z" },
];

/**
 * 同步状态的唯一文案来源：列表圆点 tooltip 与详情页脚都读它。
 * pending 说的是「云端还没收到这一份内容」，不是「正在上传」——上传是整包同步，没有单条进度。
 */
function describeCommonTextSyncState(item: CommonTextItem): string {
    if (item.syncstate === "synced") {
        const rev = item.syncedrev != null && item.syncedrev > 0 ? ` · rev ${item.syncedrev}` : "";
        return `Synced${rev}`;
    }
    return "Pending upload — the next sync will send it";
}

/** 列表行标题右侧的小圆点：只在 pending 时出现，已同步不占布局。 */
function CommonTextSyncDot({ item }: { item: CommonTextItem }) {
    const pending = item.syncstate !== "synced";
    if (!pending) return null;
    return (
        <span
            data-commontext-sync-state={item.syncstate}
            title={describeCommonTextSyncState(item)}
            aria-label={describeCommonTextSyncState(item)}
            className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-warn"
        />
    );
}

/** 时间一律走会话列表同一套口径（formatSessionDateCompact），不另写一套格式化。 */
/** 徽标上的名字：agent 显示 agent 名，human 显示人名；都没名就退回类型名。 */
function describeCommonTextCreatorName(item: CommonTextItem): string {
    const name = item.createdby?.name?.trim();
    if (name != null && name !== "") return name;
    return getCommonTextCreatorKind(item) === "agent" ? "agent" : "human";
}

/** 徽标的 tooltip：谁 + 哪台机器 + 什么时候建的。 */
function describeCommonTextSource(item: CommonTextItem): string {
    const kind = getCommonTextCreatorKind(item);
    const who = describeCommonTextCreatorName(item);
    const device = getCommonTextOriginDeviceName(item);
    const platform = item.origin?.platform?.trim();
    const deviceLabel = platform != null && platform !== "" ? `${device} · ${platform}` : device;
    const created = compactCommonTextTime(item.createdat, true);
    return `Created by ${kind === "agent" ? `agent ${who}` : who} on ${deviceLabel}${created ? ` · ${created}` : ""}`;
}

function compactCommonTextTime(timestamp: number | undefined, withTime = false): string {
    if (timestamp == null) return "never";
    return formatSessionDateCompact(timestamp, Date.now(), withTime) || "never";
}

/** 列表行与详情页脚的完整时间信息：不可图标化的语义全下沉到 tooltip。 */
function describeCommonTextTime(item: CommonTextItem): string {
    return [
        `Created ${compactCommonTextTime(item.createdat, true)}`,
        `Updated ${compactCommonTextTime(item.updatedat, true)}`,
        `Last used ${compactCommonTextTime(item.lastusedat, true)}`,
        `Used ${item.usagecount ?? 0} time(s)`,
    ].join("\n");
}

type ComposeState = {
    open: boolean;
    editor: string;
    editorCaret: number;
    editorFilterDismissed: boolean;
    manualQuery: string;
    selectedTags: string[];
    // 无标签筛选：与 selectedTags 互斥（开启时清空 tag 选择）。
    untaggedOnly: boolean;
    // 来源筛选（与 tag/查询正交叠加）：创建者类型 + 设备。
    creatorFilter: CommonTextCreatorFilter;
    deviceFilter: string;
    selectedIndex: number;
    // 详情区当前展示的 item id —— hover/键盘 ↑↓/单击 同步它，但不触发插入。
    // 与 selectedIndex 解耦：selectedIndex 仍服务于列表行高亮与键盘导航边界，
    // detailId 才是右侧详情区渲染的真源。
    detailId: string | null;
    // 详情区就地编辑态：editing 进入时由 detail item 拷贝而来，Cancel 丢弃、Save upsert。
    // detailEmoji 是页面 icon（Notion 式页面头），空串表示未设置。
    detailEmoji: string;
    detailTitle: string;
    detailText: string;
    detailDirty: boolean;
    insertedIds: string[];
    // 浏览态列表排序键（localStorage 持久化）。搜索态下由相关度接管，这里只当并列 tie-break。
    sortKey: CommonTextSortKey;
    status: string;
    statusKind: "info" | "ok" | "err";
};

// 进程内草稿已不再需要：editor 文本落 localStorage 持久草稿（跨重启不丢），见
// commontext-editor-draft.ts。带 detail.query 的外部触发（如选区 overlay 复制场景）不读草稿，
// 避免与外部文本冲突。

// 弹窗尺寸偏好持久化：用户拖动右下角 resize 手柄后无感记入 localStorage，下次打开沿用。
// 无设置 UI、无 schema 文件；存储失败（隐私模式等）静默 fallback 到默认尺寸。
const ComposeModalSizeKey = "commontext:composeModalSize";
const ComposeModalDefaultW = "min(85vw, 900px)";
const ComposeModalDefaultH = "min(78vh, 620px)";
const ComposeModalMinW = 500;
const ComposeModalMinH = 350;
// 收起态单行高度（= h-9 = leading-5 20px + p-2×2 16px）：拖高过（resize-y 会在元素上留下浏览器
// 写入的 inline height）的 editor 收起时必须显式盖掉，否则 inline 高度压过 h-9、收不回一行。
const EDITOR_COLLAPSED_HEIGHT_PX = 36;
// Editor 持久草稿防抖窗口：与详情区自动保存（800ms）同节奏。
const EDITOR_DRAFT_DEBOUNCE_MS = 800;

type ComposeModalSize = { w: string; h: string };

function loadComposeModalSize(): ComposeModalSize | null {
    try {
        const raw = localStorage.getItem(ComposeModalSizeKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<ComposeModalSize>;
        if (typeof parsed.w !== "string" || typeof parsed.h !== "string") return null;
        if (parsed.w.trim() === "" || parsed.h.trim() === "") return null;
        return { w: parsed.w, h: parsed.h };
    } catch {
        return null;
    }
}

function saveComposeModalSize(size: ComposeModalSize): void {
    try {
        localStorage.setItem(ComposeModalSizeKey, JSON.stringify(size));
    } catch {
        // 隐私模式 / 配额满：静默忽略，下次仍可临时 resize 当次会话内有效。
    }
}

const initialOpenState = (manualQuery = ""): ComposeState => ({
    open: true,
    editor: "",
    editorCaret: 0,
    editorFilterDismissed: false,
    manualQuery,
    selectedTags: [],
    untaggedOnly: false,
    creatorFilter: "all",
    deviceFilter: "any",
    selectedIndex: 0,
    detailId: null,
    detailEmoji: "",
    detailTitle: "",
    detailText: "",
    detailDirty: false,
    insertedIds: [],
    sortKey: DefaultCommonTextSortKey,
    status: "",
    statusKind: "info",
});

const restoreOpenState = (): ComposeState => {
    // 持久草稿（localStorage）：同进程重开与跨重启统一走这一条路径。
    const draft = loadEditorDraft();
    if (draft == null) return initialOpenState();
    return {
        ...initialOpenState(),
        editor: draft.text,
        // caret 落盘时可能因外部编辑器变更越界，clamp 回文本长度。
        editorCaret: Math.min(draft.caret, draft.text.length),
        insertedIds: draft.insertedIds,
    };
};

const CommonTextComposeModal = memo(() => {
    const [state, setState] = useState<ComposeState>(() => ({ ...initialOpenState(), open: false }));
    // 最新 state 镜像：卸载清理闭包里拿不到最新 state，草稿兜底落盘用它。
    const stateRef = useRef(state);
    stateRef.current = state;
    // editor 默认收缩为单行高度（与 Title/Action 控件视觉对齐），聚焦时再撑开到多行，
    // 避免每次打开弹窗都被一个 120px 的 textarea 撑高、抢走主视觉。
    // "草稿含换行"会作为初始展开判定，防止多行草稿被压缩成单行截断。
    const [editorExpanded, setEditorExpanded] = useState(false);
    // 手动收起态：置位后 onFocus 不再自动展开（否则收起按钮一点就"失效"）。
    // 这是多行草稿唯一的收窄通道——失焦折叠判定见 valueHasNewline 会一直保持展开。
    const [editorManuallyCollapsed, setEditorManuallyCollapsed] = useState(false);
    // 详情属性网格默认折叠成一行 icon 摘要，chevron 展开完整网格；每次打开弹窗重置。
    const [propertiesExpanded, setPropertiesExpanded] = useState(false);
    // Tags 属性行的浮层编辑态：锚定值单元格，PropertyValuePopover portal 到 body。
    const [tagsEditing, setTagsEditing] = useState(false);
    const tagsValueRef = useRef<HTMLDivElement>(null);
    const settings = useAtomValue(atoms.settingsAtom);
    const editorRef = useRef<HTMLTextAreaElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const listScrollRef = useRef<HTMLDivElement>(null);
    // 详情区 textarea 聚焦目标：新建条目落库后聚焦这里，承接后续原地编辑。
    const detailTextRef = useRef<HTMLTextAreaElement>(null);
    const modalRef = useRef<HTMLDivElement>(null);
    // 当前生效的尺寸样式；打开弹窗时由 loadComposeModalSize() 初始化，resize 时实时更新。
    // useState 而非纯 ref：尺寸变化要触发 modal 节点 style 重渲染，光改 ref 不够。
    const [modalSize, setModalSize] = useState<ComposeModalSize>(
        () => loadComposeModalSize() ?? { w: ComposeModalDefaultW, h: ComposeModalDefaultH }
    );
    // 展开态 Editor 上限随弹窗高度缩放：modalSize.h 在用户拖拽时被 ResizeObserver 写成真实 px；
    // 首次打开存的可能是 "min(78vh, 620px)" 兜底字符串，parseFloat 拿不到就回退 modalRef 实测高度。
    // ponytail: 回退常量 620 只在首帧生效，RO 首 tick 后 modalSize.h 即变真实像素，无需额外监听。
    const editorMaxHeight = useMemo(() => {
        const parsed = parseFloat(modalSize.h);
        const modalH = Number.isFinite(parsed) && parsed > 0 ? parsed : (modalRef.current?.offsetHeight ?? 620);
        return computeEditorMaxHeight(modalH, window.innerHeight);
    }, [modalSize.h]);
    const isComposingRef = useRef(false);
    const compositionEndTimerRef = useRef<number>(null);
    // editor blur 后延时折叠的 timer：onFocus 时取消，给用户从 editor 移动到
    // Send/Copy 等按钮留出 600ms 落点窗口，避免按钮还没点 editor 已塌回单行。
    const editorCollapseTimerRef = useRef<number>(null);
    // 详情区自动保存防抖 timer：detailTitle/detailText 变化触发，800ms 后落盘。
    // 切项/关闭/卸载前会被强制 flush（auto-save 兜底），timer 清理在 effect cleanup 里同步处理。
    const detailSaveTimerRef = useRef<number>(null);
    // "Saved" 文字淡回 idle 的延时 timer——避免停留在 footer 右下角，但又给用户一个落盘确认。
    const detailSaveFadeRef = useRef<number>(null);
    const DETAIL_SAVE_DEBOUNCE_MS = 800;
    // 自动保存状态：与 state.status（Send/Copy/Delete 瞬时反馈）分开，贴在 footer 右下角。
    const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "err">("idle");
    const saveStatusMsgRef = useRef<string>("");
    // 持久草稿（localStorage）：落盘指示与防抖计时。
    const [draftStatus, setDraftStatus] = useState<"idle" | "saved">("idle");
    const editorDraftTimerRef = useRef<number>(null);
    const draftStatusFadeRef = useRef<number>(null);
    // 已落盘的草稿文本基线：打开/还原时对齐它，只有「本次会话里用户改过文本」才写回，
    // 避免外部 query 打开（editor 空、不动）时误清持久草稿。
    const lastDraftTextRef = useRef<string>("");
    // unmount/closing guard——组件关闭或同步 flush 中途被卸载时置 true，
    // 之后所有 await 之 setState 都跳过，避免"setState on unmounted component"触发 React 19 卸载期 throw 白屏。
    const unmountedRef = useRef(false);

    // 墓碑（已删除、等同步上传的条目）不进列表/标签统计：它们在库里存在只是为了把删除推出去。
    const allItems = useMemo(() => getLiveCommonTextItems(getCommonTextItemsFromSettings(settings)), [settings]);
    const tagSummaries = useMemo(() => getCommonTextTagSummaries(allItems).slice(0, MAX_TAG_CHIPS), [allItems]);
    // 无标签条目数：驱动 untagged chip 的计数展示，与筛选走同一 normalize 口径。
    const untaggedCount = useMemo(
        () => filterCommonTextItemsByTags(allItems, [], { untagged: true }).length,
        [allItems]
    );
    // editor 当前正文里嵌入的 #tag：在 Send 右侧渲染成可删 chip，点 × 把字面从 editor 抹掉，
    // 这样剩余正文 send/copy 出去时不带走 #tag。
    const editorTags = useMemo(() => extractSessionTagsFromNote(state.editor).tags, [state.editor]);

    // 详情区 tag 完全由 detailText 派生——与编辑器上方的 editorTags 同语义。手写 #tag 落在 Text
    // 正文里，All Tags 面板据此决定 chip 亮灭；该 memo 也是 Save 时写回 item.tags 的真源。
    const detailTags = useMemo(() => extractSessionTagsFromNote(state.detailText).tags, [state.detailText]);

    // 计数与设备清单按「当前 tag/查询过滤后的集合」统计，与列表实际可见范围一致：
    // 若按全量统计，chip 上的数字会与点下去后的行数不符。
    const sourceScopeItems = useMemo(
        () => filterCommonTextItemsByTags(allItems, state.selectedTags, { untagged: state.untaggedOnly }),
        [allItems, state.selectedTags, state.untaggedOnly]
    );
    const creatorCounts = useMemo(() => {
        let human = 0;
        let agent = 0;
        for (const item of sourceScopeItems) {
            if (getCommonTextCreatorKind(item) === "agent") agent++;
            else human++;
        }
        return { all: sourceScopeItems.length, human, agent } as Record<CommonTextCreatorFilter, number>;
    }, [sourceScopeItems]);
    const deviceSummaries = useMemo(() => getCommonTextDeviceSummaries(sourceScopeItems), [sourceScopeItems]);

    const filteredItems = useMemo(() => {
        if (!state.open) return [];
        return searchCommonTextComposeItems(
            allItems,
            state.editorFilterDismissed ? "" : state.editor,
            state.manualQuery,
            {
                limit: LIST_LIMIT,
                selectedTags: state.selectedTags,
                untagged: state.untaggedOnly,
                caret: state.editorCaret,
                insertedIds: state.insertedIds,
                sortKey: state.sortKey,
                creator: state.creatorFilter,
                device: state.deviceFilter,
            }
        );
    }, [
        allItems,
        state.creatorFilter,
        state.deviceFilter,
        state.editor,
        state.editorCaret,
        state.editorFilterDismissed,
        state.insertedIds,
        state.manualQuery,
        state.open,
        state.selectedTags,
        state.sortKey,
        state.untaggedOnly,
    ]);
    // 空结果文案按起因分流：查询无命中 vs 筛选把结果清空，两种情况用户要做的事不一样。
    const sourceFilterActive = state.creatorFilter !== "all" || state.deviceFilter !== "any";
    const emptyListMessage =
        allItems.length === 0
            ? "No common text yet"
            : filteredItems.length === 0 && sourceFilterActive
              ? "No items from this filter"
              : "No matching text";
    const editorFilterActive =
        !state.editorFilterDismissed && state.manualQuery.trim() === "" && state.editor.trim() !== "";
    // 相关度接管列表次序的两种情形：搜索框有字（手动搜索），或编辑器过滤生效。
    // 此时排序控件点了也没效果，所以禁用并点亮相关度图标，不留假控件。
    const relevanceActive = state.manualQuery.trim() !== "" || editorFilterActive;

    // 详情区当前展示/编辑的 item。以 detailId 为准；若 detailId 为 null 或已不在
    // 当前筛选结果里（被 tag 过滤掉等），回退到 selectedIndex 指向的行 —— 这样
    // 键盘 ↑↓ / hover 不丢详情。
    const detailItem = useMemo(() => {
        if (!state.open) return null;
        if (state.detailId != null) {
            const byId = filteredItems.find((it) => it.id === state.detailId);
            if (byId != null) return byId;
        }
        if (filteredItems.length === 0) return null;
        const idx = Math.min(state.selectedIndex, filteredItems.length - 1);
        return filteredItems[idx] ?? null;
    }, [filteredItems, state.detailId, state.selectedIndex, state.open]);

    // Notion 式属性网格：来源信息是只读的（由写入侧决定），所以这里全部是派生值。
    // 值里的次要文本用独立 span，不嵌套 grid 项——嵌套会继承行样式把行高压乱。
    const detailProperties = useMemo(() => {
        const item = detailItem;
        if (item == null) return [] as { label: string; value: React.ReactNode }[];
        const kind = getCommonTextCreatorKind(item);
        const device = getCommonTextOriginDeviceName(item);
        const platform = item.origin?.platform?.trim();
        const deviceId = getCommonTextOriginDeviceId(item);
        return [
            {
                label: "Created by",
                value: (
                    <span className="inline-flex items-center gap-1">
                        <i
                            className={
                                kind === "agent"
                                    ? "fa-solid fa-robot text-[9px] text-sky-300"
                                    : "fa-solid fa-user text-[9px] text-orange-300"
                            }
                        />
                        <span>{describeCommonTextCreatorName(item)}</span>
                        <span className="text-muted">· {kind}</span>
                    </span>
                ),
            },
            {
                label: "Computer",
                value: (
                    // gap-1 的间距会被 truncate 吃掉（flex 子项收缩到 0 宽时中间空隙不可见），
                    // 所以分隔符显式带空格，不依赖弹性间距。
                    <span className="inline-flex min-w-0 items-center">
                        <span className="truncate">{device}</span>
                        {platform != null && platform !== "" && (
                            <span className="shrink-0 text-muted">&nbsp;{platform}</span>
                        )}
                        <span className="shrink-0 truncate font-mono text-[10px] text-muted">&nbsp;· {deviceId}</span>
                    </span>
                ),
            },
            {
                label: "Created",
                value: <span>{compactCommonTextTime(item.createdat, true)}</span>,
            },
            {
                label: "Updated",
                value: <span>{formatSessionRelativeTime(item.updatedat)}</span>,
            },
            {
                label: "Used",
                value: (
                    <span>
                        {item.usagecount ?? 0} time{(item.usagecount ?? 0) === 1 ? "" : "s"}
                        {item.lastusedat != null && item.lastusedat > 0 && (
                            <span className="text-muted"> · last {formatSessionRelativeTime(item.lastusedat)}</span>
                        )}
                    </span>
                ),
            },
        ];
    }, [detailItem]);

    // 折叠态属性摘要：icon + 短值，完整语义走 tooltip。与展开网格同源（同一批派生字段），
    // 不再重复算一遍 device/platform。
    const detailPropertySummary = useMemo(() => {
        const item = detailItem;
        if (item == null)
            return [] as { key: string; icon: string; iconClass: string; text: React.ReactNode; title: string }[];
        const kind = getCommonTextCreatorKind(item);
        const device = getCommonTextOriginDeviceName(item);
        const deviceId = getCommonTextOriginDeviceId(item);
        return [
            {
                key: "tags",
                icon: "fa-hashtag",
                iconClass: "text-muted",
                // 折叠态有标签时渲染层接管（与展开态同一个 chip 组件），空态给 0 占位。
                text: detailTags.length === 0 ? "0" : "",
                title: detailTags.length === 0 ? "No tags" : `Tags: ${detailTags.map((t) => "#" + t).join(" ")}`,
            },
            {
                key: "creator",
                icon: kind === "agent" ? "fa-robot" : "fa-user",
                iconClass: kind === "agent" ? "text-sky-300" : "text-orange-300",
                text: describeCommonTextCreatorName(item),
                title: describeCommonTextSource(item),
            },
            {
                key: "computer",
                icon: "fa-computer",
                iconClass: "text-muted",
                text: device,
                title: `${device} · ${deviceId}`,
            },
            {
                key: "updated",
                icon: "fa-pen",
                iconClass: "text-muted",
                text: formatSessionRelativeTime(item.updatedat),
                title: `Updated ${compactCommonTextTime(item.updatedat, true)}`,
            },
            {
                key: "used",
                icon: "fa-repeat",
                iconClass: "text-muted",
                text: String(item.usagecount ?? 0),
                title: `Used ${item.usagecount ?? 0} time(s)`,
            },
        ];
    }, [detailItem, detailTags]);

    // 详情区一旦选中某 item 即永远编辑态（点选即编辑），不存在只读中间态。
    // detailDirty 仅用来提示"有未保存改动"，控制 footer 上 Save 行为是否禁言。

    // Compose Modal open/close wiring.
    useEffect(() => {
        const handleOpen = (event: Event) => {
            const detail = (event as CustomEvent<CommonTextSearchDetail>).detail ?? {};
            const hasExternalQuery = (detail.query ?? "").trim() !== "";
            const manualQuery = detail.query ?? "";
            if (compositionEndTimerRef.current != null) {
                window.clearTimeout(compositionEndTimerRef.current);
                compositionEndTimerRef.current = null;
            }
            isComposingRef.current = false;
            // 外部带入 query（选区 overlay 找条目）走全新状态；纯打开尝试还原上次草稿。
            const next = hasExternalQuery ? initialOpenState(manualQuery) : restoreOpenState();
            // 排序偏好不在草稿里（草稿只存 editor 文本）：每次打开都从 localStorage 读。
            next.sortKey = loadCommonTextSortKey();
            // 当传入 editItemId 时（灯泡保存后的 Tag 入口）：定位到该条目并打开详情面板，
            // 用户可直接在详情区 Tags 属性行补标签；清空 query 保证条目在列表可见。
            if (detail.editItemId != null && detail.editItemId !== "") {
                const targetItem = getCommonTextItems().find((i) => i.id === detail.editItemId);
                if (targetItem) {
                    next.detailId = targetItem.id;
                    next.detailTitle = targetItem.title;
                    next.detailText = targetItem.text;
                    next.manualQuery = "";
                }
            }
            setState(next);
            // 草稿基线对齐本次打开后的 editor 内容：之后只有真正被用户改过才写回 localStorage。
            if (editorDraftTimerRef.current != null) {
                window.clearTimeout(editorDraftTimerRef.current);
                editorDraftTimerRef.current = null;
            }
            lastDraftTextRef.current = next.editor;
            setDraftStatus("idle");
            // 不主动聚焦 editor：避免一打开就把弹窗撑成编辑多行态。多行草稿按文本本身初始展开，
            // 让用户视觉上立刻知道草稿还在；单行草稿保持紧凑单行高，等用户点进去再撑开。
            setEditorExpanded(next.editor.includes("\n"));
            // 每次打开都从「自动展开 + 属性折叠」的默认态开始，不继承上次的手动收起。
            setEditorManuallyCollapsed(false);
            setPropertiesExpanded(false);
            setTagsEditing(false);
        };
        window.addEventListener(OpenCommonTextSearchEvent, handleOpen);
        return () => window.removeEventListener(OpenCommonTextSearchEvent, handleOpen);
    }, []);

    // 弹窗打开时自动聚焦搜索框——用户可直接打字搜索，无需手动点一下。
    useEffect(() => {
        if (!state.open) return;
        requestAnimationFrame(() => searchInputRef.current?.focus());
    }, [state.open]);

    // 用户拖动 resize 手柄（右下角）改变弹窗尺寸 → ResizeObserver 写入 localStorage 无感持久化。
    // 节流靠 rAF：连拖过程中每帧最多落一次 storage，避免高频写入；double-debounce 已无必要。
    // 注意：尺寸最小值由 CSS min-w/min-h 限定（与 ComposeModalMinW/MinH 对应），此处不再 clamp。
    useEffect(() => {
        if (!state.open) return;
        const node = modalRef.current;
        if (node == null) return;
        let raf: number | null = null;
        const ro = new ResizeObserver(() => {
            if (raf != null) return;
            raf = window.requestAnimationFrame(() => {
                raf = null;
                const w = node.offsetWidth;
                const h = node.offsetHeight;
                if (w < ComposeModalMinW || h < ComposeModalMinH) return;
                setModalSize({ w: `${w}px`, h: `${h}px` });
                saveComposeModalSize({ w: `${w}px`, h: `${h}px` });
            });
        });
        ro.observe(node);
        return () => {
            ro.disconnect();
            if (raf != null) window.cancelAnimationFrame(raf);
        };
    }, [state.open]);

    // detailId 与 selectedIndex 的联动：列表过滤变化、键盘导航移动、外部 detailId
    // 失效时，统一回退到 selectedIndex 指向的行，并丢弃就地编辑态草稿。
    useEffect(() => {
        if (!state.open) return;
        if (filteredItems.length === 0) {
            if (state.detailId != null || state.detailDirty) {
                setState((cur) => ({
                    ...cur,
                    detailId: null,
                    detailEmoji: "",
                    detailTitle: "",
                    detailText: "",
                    detailDirty: false,
                }));
            }
            return;
        }
        const cur = detailItem;
        if (cur == null || cur.id !== state.detailId) {
            setState((s) => ({
                ...s,
                detailId: cur?.id ?? null,
                detailEmoji: cur?.emoji ?? "",
                detailTitle: cur?.title ?? "",
                detailText: cur?.text ?? "",
                detailDirty: false,
            }));
        }
    }, [filteredItems, detailItem, state.detailId, state.detailDirty, state.open]);

    useEffect(() => {
        if (!state.open) return;
        if (state.selectedIndex >= filteredItems.length) {
            setState((cur) => ({ ...cur, selectedIndex: Math.max(0, filteredItems.length - 1) }));
        }
    }, [filteredItems.length, state.open, state.selectedIndex]);

    // 切换排序键后让行高亮跟上详情区：以 detailId 为准回填 selectedIndex，避免"右侧显示 A、
    // 左侧高亮 B"。**必须用 ref 门控成"只在排序键变化时触发"**：无门控版本会在任何
    // filteredItems 变化时执行，把 setManualQuery / setEditor / toggleTag 们"重置到第 0 行"的
    // 意图又拽回 detailId —— 搜索态下相关度第一名就不再是高亮行，Enter 会打开错条目（已实测）。
    const alignedSortKeyRef = useRef<CommonTextSortKey>(state.sortKey);
    useEffect(() => {
        if (!state.open) return;
        if (alignedSortKeyRef.current === state.sortKey) return;
        alignedSortKeyRef.current = state.sortKey;
        setState((cur) => {
            if (cur.detailId == null) return cur;
            const index = filteredItems.findIndex((it) => it.id === cur.detailId);
            if (index < 0 || index === cur.selectedIndex) return cur;
            return { ...cur, selectedIndex: index };
        });
    }, [filteredItems, state.sortKey, state.open]);

    useEffect(() => {
        if (!state.open) return;
        listScrollRef.current?.scrollTo({ top: 0 });
    }, [
        state.editor,
        state.editorCaret,
        state.insertedIds,
        state.manualQuery,
        state.open,
        state.selectedTags,
        state.untaggedOnly,
    ]);

    useEffect(() => {
        if (!state.open) return;
        listScrollRef.current
            ?.querySelector(`[data-common-text-index="${state.selectedIndex}"]`)
            ?.scrollIntoView({ block: "nearest" });
    }, [state.open, state.selectedIndex]);

    useEffect(() => {
        return () => {
            if (compositionEndTimerRef.current != null) {
                window.clearTimeout(compositionEndTimerRef.current);
                window.cancelAnimationFrame(compositionEndTimerRef.current);
                compositionEndTimerRef.current = null;
            }
            if (editorCollapseTimerRef.current != null) {
                window.clearTimeout(editorCollapseTimerRef.current);
            }
            // 卸载前若还有未 flush 的 detail 草稿，强制存盘兜底（关弹窗已 flush，这里只是 React
            // 卸载流的最后保险，避免极小窗口内的改动丢失）。
            if (detailSaveTimerRef.current != null) {
                window.clearTimeout(detailSaveTimerRef.current);
                detailSaveTimerRef.current = null;
            }
            if (detailSaveFadeRef.current != null) {
                window.clearTimeout(detailSaveFadeRef.current);
                detailSaveFadeRef.current = null;
            }
            // 卸载前若草稿防抖还挂着：直接同步落盘（组件即将消失，setState 不再可用，只写不报状态）。
            if (editorDraftTimerRef.current != null) {
                window.clearTimeout(editorDraftTimerRef.current);
                editorDraftTimerRef.current = null;
                saveEditorDraft({
                    text: stateRef.current.editor,
                    caret: stateRef.current.editorCaret,
                    insertedIds: stateRef.current.insertedIds,
                });
            }
            if (draftStatusFadeRef.current != null) {
                window.clearTimeout(draftStatusFadeRef.current);
                draftStatusFadeRef.current = null;
            }
            // 关闭弹窗已在 close() 里执行强制 flush，此处 React 卸载流不再重复 fire——
            // 避免组件已卸载却仍调用 setState（saveStatus / detailDirty）触发 React 卸载期 throw 白屏。
            unmountedRef.current = true;
        };
    }, []);

    // 草稿落盘指示：saved 显示 1.5s 后淡回 idle，让自动保存可感知又不长期占位。
    const markDraftSaved = () => {
        setDraftStatus("saved");
        if (draftStatusFadeRef.current != null) {
            window.clearTimeout(draftStatusFadeRef.current);
        }
        draftStatusFadeRef.current = window.setTimeout(() => {
            draftStatusFadeRef.current = null;
            if (!unmountedRef.current) {
                setDraftStatus((cur) => (cur === "saved" ? "idle" : cur));
            }
        }, 1500);
    };

    // 强制落盘：close / 卸载前的兑底。文本与基线相同（本次只是还原或查阅）则跳过，
    // 避免外部 query 打开后直接关闭误清持久草稿。
    const flushEditorDraft = () => {
        if (editorDraftTimerRef.current != null) {
            window.clearTimeout(editorDraftTimerRef.current);
            editorDraftTimerRef.current = null;
        }
        if (state.editor === lastDraftTextRef.current) return;
        saveEditorDraft({ text: state.editor, caret: state.editorCaret, insertedIds: state.insertedIds });
        lastDraftTextRef.current = state.editor;
    };

    // 防抖自动保存：文本与已落盘值不同才排 800ms 写；pending 中即使文本未变（仅 caret/insertedIds
    // 变动）也重排，避免后一次状态更新把前一次还没落盘的文本改动吞掉。
    useEffect(() => {
        if (!state.open) return;
        const textChanged = state.editor !== lastDraftTextRef.current;
        if (!textChanged && editorDraftTimerRef.current == null) return;
        if (editorDraftTimerRef.current != null) {
            window.clearTimeout(editorDraftTimerRef.current);
        }
        editorDraftTimerRef.current = window.setTimeout(() => {
            editorDraftTimerRef.current = null;
            saveEditorDraft({ text: state.editor, caret: state.editorCaret, insertedIds: state.insertedIds });
            lastDraftTextRef.current = state.editor;
            if (!unmountedRef.current) markDraftSaved();
        }, EDITOR_DRAFT_DEBOUNCE_MS);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- markDraftSaved 是稳定的本地闭包
    }, [state.open, state.editor, state.editorCaret, state.insertedIds]);

    const close = () => {
        if (compositionEndTimerRef.current != null) {
            // compositionEndTimerRef 既能容纳 setTimeout 也能容纳 rAF 的 numeric id
            // （两者共用同一 numeric handle 空间），所以两种调度都尝试取消。
            window.clearTimeout(compositionEndTimerRef.current);
            window.cancelAnimationFrame(compositionEndTimerRef.current);
            compositionEndTimerRef.current = null;
        }
        if (editorCollapseTimerRef.current != null) {
            window.clearTimeout(editorCollapseTimerRef.current);
            editorCollapseTimerRef.current = null;
        }
        // 关闭前强制 flush 详情草稿——auto-save 防抖窗口内未落盘的改动在关弹窗这一刻统一存盘。
        if (detailSaveTimerRef.current != null) {
            window.clearTimeout(detailSaveTimerRef.current);
            detailSaveTimerRef.current = null;
        }
        if (detailSaveFadeRef.current != null) {
            window.clearTimeout(detailSaveFadeRef.current);
            detailSaveFadeRef.current = null;
        }
        fireAndForget(() => flushDetailSave({ keepDirty: true }));
        isComposingRef.current = false;
        // 关闭前强制落草稿：防抖窗口内的最后一刻改动也要保住（同进程重开与跨重启都能还原）。
        flushEditorDraft();
        setState((cur) => ({ ...cur, open: false }));
    };

    const update = (patch: Partial<ComposeState>) => setState((cur) => ({ ...cur, ...patch }));

    const setEditor = (editor: string, editorCaret: number) =>
        update({ editor, editorCaret, editorFilterDismissed: false, selectedIndex: 0 });

    // Editor 收起/展开切换：手动收起优先于聚焦自动展开；再次点按钮恢复自动行为。
    // 收起不清正文——内容仍留在 textarea 里，展开即恢复。
    const toggleEditorCollapse = () => {
        if (editorExpanded) {
            setEditorManuallyCollapsed(true);
            setEditorExpanded(false);
        } else {
            setEditorManuallyCollapsed(false);
            setEditorExpanded(true);
        }
    };

    const setManualQuery = (manualQuery: string) => update({ manualQuery, selectedIndex: 0 });

    const updateEditorCaret = (target: HTMLTextAreaElement) =>
        update({ editorCaret: target.selectionStart ?? target.value.length, selectedIndex: 0 });

    const toggleTag = (tag: string) => {
        setState((cur) => {
            const present = cur.selectedTags.some((t) => t.toLowerCase() === tag.toLowerCase());
            const selectedTags = present
                ? cur.selectedTags.filter((t) => t.toLowerCase() !== tag.toLowerCase())
                : [...cur.selectedTags, tag];
            // 选了具体 tag 就退出"无标签"筛选（互斥）。
            return { ...cur, selectedTags, untaggedOnly: false, selectedIndex: 0 };
        });
    };

    // 无标签筛选开关：开启时清空已选 tag（互斥，避免"有 X 标签 AND 无标签"空集）；
    // 关闭时保留现有 tag 选择不变。
    const toggleUntagged = () => {
        setState((cur) => ({
            ...cur,
            untaggedOnly: !cur.untaggedOnly,
            selectedTags: cur.untaggedOnly ? cur.selectedTags : [],
            selectedIndex: 0,
        }));
    };

    const setStatus = (status: string, statusKind: "info" | "ok" | "err" = "info") => update({ status, statusKind });

    // 排序键切换：写 localStorage → 列表重排（filteredItems memo 依赖 sortKey）。
    // 点击时不动 selectedIndex —— 由 detailId 同步 effect 把它带到新位置。
    const handleSortChange = (sortKey: CommonTextSortKey) => {
        if (sortKey === state.sortKey) return;
        saveCommonTextSortKey(sortKey);
        update({ sortKey });
    };

    // 从 editor 正文里抹掉某个 #tag 字面并保持 caret 在原位置附近。tags 字段不用单独维护：
    // 它始终由 editor 文本派生（extractSessionTagsFromNote），抹掉字面后下一次 memo 自动重算。
    const removeEditorTag = (tag: string) => {
        const editor = editorRef.current;
        const prevCaret = editor?.selectionStart ?? state.editor.length;
        const newText = removeSessionTagFromNote(state.editor, tag);
        update({ editor: newText, editorCaret: Math.min(prevCaret, newText.length), editorFilterDismissed: false });
        if (newText === state.editor) return;
        if (editor != null) {
            requestAnimationFrame(() => {
                editor.focus();
                editor.setSelectionRange(Math.min(prevCaret, newText.length), Math.min(prevCaret, newText.length));
            });
        }
    };

    // 列表行 click —— Master-Detail 模式下进入详情就地编辑态：
    // 不再"只选中"再点 Edit，而是一点进编辑态（title input + body textarea 直接出现，
    // footer 直接是 Save/Cancel）。这样省掉只读中间态、减少需要手点 Edit 的步骤。
    // 列表行 click —— Master-Detail 模式下进入详情就地编辑态：title input + body textarea
    // 直接出现。切项前先 flush 当前 detail 草稿（auto-save 兜底），避免漏存上一项的改动；
    // 新项目从已存数据开始，dirty=false（除非用户 T1 刚看到 B 就改了它，那时 onChange 才置 dirty）。
    const handleListItemClick = (item: CommonTextItem) => {
        if (state.detailId != null && state.detailId !== item.id) {
            if (detailSaveTimerRef.current != null) {
                window.clearTimeout(detailSaveTimerRef.current);
                detailSaveTimerRef.current = null;
            }
            fireAndForget(() => flushDetailSave({ keepDirty: true }));
        }
        setState((cur) => ({
            ...cur,
            detailId: item.id,
            detailEmoji: item.emoji ?? "",
            detailTitle: item.title,
            detailText: item.text,
            detailDirty: false,
            selectedIndex: filteredItems.findIndex((it) => it.id === item.id),
        }));
    };

    // 详情 footer 的 Insert 按钮：把详情当前 item.text 插进 editor caret 处。
    // 复用原 handleListItemSelected 的插入语义（caret 区间替换、recordCommonTextUse、
    // manualSearchActive 时把焦点送回 search 输入框）。
    const handleInsertDetail = (item: CommonTextItem) => {
        const editor = editorRef.current;
        const manualSearchActive = state.manualQuery.trim() !== "";
        const insertedIds = state.insertedIds.includes(item.id) ? state.insertedIds : [...state.insertedIds, item.id];
        if (editor == null) {
            const newEditor = state.editor + item.text;
            update({
                editor: newEditor,
                editorCaret: newEditor.length,
                editorFilterDismissed: false,
                selectedIndex: 0,
                insertedIds,
            });
            if (manualSearchActive) {
                requestAnimationFrame(() => searchInputRef.current?.focus());
            }
            fireAndForget(() => recordCommonTextUse(item.id));
            return;
        }
        const start = editor.selectionStart ?? editor.value.length;
        const end = editor.selectionEnd ?? start;
        const newEditor = editor.value.slice(0, start) + item.text + editor.value.slice(end);
        if (!manualSearchActive) {
            editor.focus();
        }
        editor.setRangeText(item.text, start, end, "end");
        update({
            editor: newEditor,
            editorCaret: start + item.text.length,
            editorFilterDismissed: false,
            selectedIndex: 0,
            insertedIds,
        });
        if (manualSearchActive) {
            requestAnimationFrame(() => searchInputRef.current?.focus());
        }
        fireAndForget(() => recordCommonTextUse(item.id));
    };

    const handleCopy = async () => {
        const text = state.editor;
        if (text.trim() === "") {
            setStatus("Nothing to copy", "err");
            return;
        }
        try {
            await copyCommonText(text);
            setStatus("Copied", "ok");
        } catch (err) {
            setStatus(`Copy failed: ${(err as Error).message ?? "unknown"}`, "err");
        }
    };

    const handleListItemCopy = async (item: CommonTextItem) => {
        try {
            await copyCommonText(item.text);
            // 复制也是一次使用：此前只有 Insert/Send 计数，导致 usagecount 长期偏低。
            fireAndForget(() => recordCommonTextUse(item.id));
            setStatus("Copied", "ok");
        } catch (err) {
            setStatus(`Copy failed: ${(err as Error).message ?? "unknown"}`, "err");
        }
    };

    const handleListItemDelete = async (item: CommonTextItem) => {
        if (!window.confirm("Delete this common text?")) {
            return;
        }
        try {
            await deleteCommonTextItem(item.id);
            setStatus("Deleted", "ok");
        } catch (err) {
            setStatus(`Delete failed: ${(err as Error).message ?? "unknown"}`, "err");
        }
    };

    // 详情区自动保存：草稿态没有手动 Save/Cancel——typed 停手 800ms 后落盘。flushDetailSave 既是
    // 防抖到点的执行器，也是切项/关闭/卸载前的强制兜底，避免最后一次编辑丢失。
    // 空纯空白草稿跳过存储（当空草稿就意味着"清掉本文"会被显式点 Delete 处理），避免一改空就误空写。
    const flushDetailSave = async (opts?: { keepDirty?: boolean }) => {
        const id = state.detailId;
        if (id == null) return;
        if (!state.detailDirty) return;
        const text = state.detailText;
        if (text.trim() === "") return;
        const title = state.detailTitle.trim();
        if (!unmountedRef.current) {
            setSaveStatus("saving");
        }
        try {
            await upsertCommonTextItem(
                {
                    title,
                    text,
                    tags: extractSessionTagsFromNote(text).tags,
                    pinned: detailItem?.pinned ?? false,
                    emoji: state.detailEmoji,
                },
                id
            );
            if (!opts?.keepDirty && !unmountedRef.current) {
                setState((cur) => ({ ...cur, detailDirty: false }));
            }
            if (!unmountedRef.current) {
                setSaveStatus("saved");
            }
            saveStatusMsgRef.current = "";
            // "Saved" 在 1.5s 后淡回 idle，给用户一个落盘确认又不长期占着 footer 右下角。
            if (detailSaveFadeRef.current != null) {
                window.clearTimeout(detailSaveFadeRef.current);
            }
            detailSaveFadeRef.current = window.setTimeout(() => {
                detailSaveFadeRef.current = null;
                if (!unmountedRef.current) {
                    setSaveStatus((cur) => (cur === "saved" ? "idle" : cur));
                }
            }, 1500);
        } catch (err) {
            if (!unmountedRef.current) {
                setSaveStatus("err");
            }
            saveStatusMsgRef.current = (err as Error)?.message ?? "save failed";
        }
    };

    // 防抖触发：detailDirty 被置 true 后排 800ms 一次性 flush，timer 在每次新改动时被清并重排。
    useEffect(() => {
        if (!state.detailDirty) return;
        // 重新打字进新一轮保存：把上一轮的 "Saved" 淡回 timer 取消，并立刻切 "Saving…" 以反映
        // 当前确实有未落盘改动（避免视觉上停在 "Saved" 让用户误以为已存）。
        if (detailSaveFadeRef.current != null) {
            window.clearTimeout(detailSaveFadeRef.current);
            detailSaveFadeRef.current = null;
        }
        setSaveStatus("saving");
        if (detailSaveTimerRef.current != null) {
            window.clearTimeout(detailSaveTimerRef.current);
        }
        detailSaveTimerRef.current = window.setTimeout(() => {
            detailSaveTimerRef.current = null;
            fireAndForget(() => flushDetailSave());
        }, DETAIL_SAVE_DEBOUNCE_MS);
        return () => {
            if (detailSaveTimerRef.current != null) {
                window.clearTimeout(detailSaveTimerRef.current);
                detailSaveTimerRef.current = null;
            }
        };
    }, [state.detailDirty, state.detailTitle, state.detailText, state.detailId]);

    if (!state.open) return null;

    // Tags 属性浮层提交（PropertyTagEditor 给最终 items）：按最小 diff 写回正文 #tag 字面。
    // tag 与 text 完全同源——不建结构化字段；新增在末尾追加 ` #tag`，移除用 removeSessionTagFromNote；
    // 置 detailDirty 走既有 800ms 自动保存，与正文手编同一条落盘路径。
    const applyDetailTags = (nextTags: string[]) => {
        setState((cur) => {
            const normalize = (tag: string) => tag.trim().toLowerCase().replace(/^#+/, "").replace(/#+$/, "");
            const current = extractSessionTagsFromNote(cur.detailText).tags;
            const currentSet = new Set(current.map((t) => t.toLowerCase()));
            const next = [...new Set(nextTags.map(normalize).filter((t) => t !== ""))];
            const nextSet = new Set(next);
            const toRemove = current.filter((t) => !nextSet.has(t.toLowerCase()));
            const toAdd = next.filter((t) => !currentSet.has(t));
            if (toRemove.length === 0 && toAdd.length === 0) return cur;
            let nextText = cur.detailText;
            for (const tag of toRemove) {
                nextText = removeSessionTagFromNote(nextText, tag);
            }
            for (const tag of toAdd) {
                // 同行末尾追加，单空格分隔；若 text 为空或已以空白结尾则不再加第二空格。
                const sep = nextText === "" || /\s$/.test(nextText) ? "" : " ";
                nextText = nextText + sep + "#" + tag;
            }
            return { ...cur, detailText: nextText, detailDirty: true };
        });
    };

    // 详情区 Pin toggle 按钮：立即把 pinned 翻转写回 settings，与 tag toggle 同属"点点即生效"。
    // 用后端当前 item 的 title/text 副本，tags 从 text 抽（与渲染真源一致），避免误回写未 Save 的草稿。
    const handleDetailTogglePin = async () => {
        if (detailItem == null) return;
        try {
            await upsertCommonTextItem(
                {
                    title: detailItem.title,
                    text: detailItem.text,
                    tags: extractSessionTagsFromNote(detailItem.text).tags,
                    pinned: !detailItem.pinned,
                },
                detailItem.id
            );
            setStatus(detailItem.pinned ? "Unpinned" : "Pinned", "ok");
        } catch (err) {
            setStatus(`Pin toggle failed: ${(err as Error).message ?? "unknown"}`, "err");
        }
    };

    const handleClearEditor = () => {
        if (state.editor.trim() === "") return;
        setEditor("", 0);
        // 显式清空 = 用户主动丢弃草稿：立即清持久键，不等 800ms 防抖（否则关得快一点草稿又回来了）。
        clearEditorDraft();
        lastDraftTextRef.current = "";
        setDraftStatus("idle");
        requestAnimationFrame(() => editorRef.current?.focus());
    };

    const handleSaveDialog = () => {
        const text = state.editor;
        if (text.trim() === "") {
            setStatus("Nothing to save", "err");
            return;
        }
        // 不再弹独立的 SaveDialog：直接新建一条带 editor 正文的 item，让详情区接管就地编辑。
        // upsertCommonTextItem 收口 title 派生（normalizeCommonTextTitle）；新建后刷新 lastusedat
        // （让它排在默认「最近使用」排序的前排），但**不计 usagecount** —— 新建不是一次使用，
        // 之前记 1 次会让列表里的次数虚高。
        fireAndForget(async () => {
            const item = await upsertCommonTextItem({
                title: "",
                text,
                tags: extractSessionTagsFromNote(text).tags,
                pinned: false,
            });
            await recordCommonTextUse(item.id, { countUsage: false });
            // 新条目落库后：
            // 1. 清空 editor + 折叠回单行——编辑已完成，左栏角色回到匹配/过滤通道
            // 2. 把新条目拉进详情区就地编辑
            // 3. 下一帧把光标聚焦到详情 textarea，让用户直接继续 refine
            setEditor("", 0);
            setEditorExpanded(false);
            // 已升格为列表条目：editor 里的草稿使命结束，立即清持久键。
            clearEditorDraft();
            lastDraftTextRef.current = "";
            setDraftStatus("idle");
            setState((cur) => ({
                ...cur,
                detailId: item.id,
                detailEmoji: item.emoji ?? "",
                detailTitle: item.title,
                detailText: item.text,
                detailDirty: false,
            }));
            requestAnimationFrame(() => detailTextRef.current?.focus());
        });
    };

    const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            update({ selectedIndex: Math.min(state.selectedIndex + 1, Math.max(0, filteredItems.length - 1)) });
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            update({ selectedIndex: Math.max(0, state.selectedIndex - 1) });
            return;
        }
        if (event.key === "Enter") {
            // Enter 不再插入 editor，而是与 click 同语义：把选中项拉进右侧详情就地编辑态。
            // 详情 textarea 自己有 Enter = 换行；这里只处理列表聚焦时的 Enter。
            event.preventDefault();
            const selected = filteredItems[state.selectedIndex];
            if (selected != null) handleListItemClick(selected);
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            close();
            return;
        }
    };

    const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        const isComposing =
            isComposingRef.current || event.nativeEvent?.isComposing || event.keyCode == 229 || event.key === "Process";
        if (isComposing) return;
        if (event.key === "Escape") {
            event.preventDefault();
            if (state.manualQuery.trim() === "") {
                close();
                return;
            }
            setManualQuery("");
            requestAnimationFrame(() => editorRef.current?.focus());
            return;
        }
        if (event.key === "ArrowDown") {
            event.preventDefault();
            update({ selectedIndex: Math.min(state.selectedIndex + 1, Math.max(0, filteredItems.length - 1)) });
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            update({ selectedIndex: Math.max(0, state.selectedIndex - 1) });
            return;
        }
        if (event.key === "Enter") {
            // Enter 不再插入 editor，与 click 同语义：进详情就地编辑态。
            event.preventDefault();
            const selected = filteredItems[state.selectedIndex];
            if (selected != null) handleListItemClick(selected);
        }
    };

    // 粘贴图片：Cmd/Ctrl+V 时若剪贴板里是 png/jpeg/gif/webp，接管这次粘贴——图片先落成
    // 附件文件，再在 caret 处插入 markdown 图片引用。纯文本粘贴不进入这个分支（直接
    // 放行给浏览器原生），所以既有文本插入/撤销行为完全不变。
    // 落盘与插入是异步的：先记下粘贴瞬间的 caret 区间，等文件写好再落到同一个位置。
    const handleEditorPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const images = pickPastedImages(event.clipboardData?.items ?? null);
        if (images.length === 0) {
            return;
        }
        event.preventDefault();
        const target = event.currentTarget;
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? start;
        fireAndForget(() => insertPastedImages(images, start, end));
    };

    const insertPastedImages = async (images: Blob[], start: number, end: number) => {
        const pasted: PasteImageInsertResult = await materializePastedImages(images);
        if (pasted.markdown !== "") {
            // 用 setState 的函数式更新拿最新 editor：写盘期间用户可能已经改过文本，
            // 用闭包里的旧 state.editor 会把这期间的输入抹掉。
            setState((cur) => {
                const next = spliceTextAtRange(cur.editor, start, end, pasted.markdown);
                return {
                    ...cur,
                    editor: next.text,
                    editorCaret: next.caret,
                    editorFilterDismissed: false,
                    selectedIndex: 0,
                };
            });
            // 图片引用是块级内容，粘完把 editor 撑开展示（折叠态只有一行高，看不见引用）。
            // 但手动收起优先：用户显式收起时不再自动弹开。
            if (!editorManuallyCollapsed) setEditorExpanded(true);
            const editor = editorRef.current;
            if (editor != null) {
                requestAnimationFrame(() => {
                    editor.focus();
                    const caret = Math.min(start + pasted.markdown.length, editor.value.length);
                    editor.setSelectionRange(caret, caret);
                });
            }
        }
        if (pasted.failures.length > 0) {
            setStatus(pasted.failures.join("; "), "err");
        } else if (pasted.written > 0) {
            setStatus(pasted.written === 1 ? "Pasted image" : `Pasted ${pasted.written} images`, "ok");
        }
    };

    const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const isComposing =
            isComposingRef.current || event.nativeEvent?.isComposing || event.keyCode == 229 || event.key === "Process";
        if (isComposing) return;
        if (event.key === "Escape") {
            event.preventDefault();
            close();
            return;
        }
        // Alt+↑ 快捷收起/展开 editor：不想用鼠标点右上角按钮时的键盘通道。
        if (event.altKey && event.key === "ArrowUp") {
            event.preventDefault();
            toggleEditorCollapse();
            return;
        }
    };

    const handleCompositionStart = () => {
        if (compositionEndTimerRef.current != null) {
            // compositionEndTimerRef 既能容纳 setTimeout 也能容纳 rAF 的 numeric id
            // （两者共用同一 numeric handle 空间），所以两种调度都尝试取消。
            window.clearTimeout(compositionEndTimerRef.current);
            window.cancelAnimationFrame(compositionEndTimerRef.current);
            compositionEndTimerRef.current = null;
        }
        isComposingRef.current = true;
    };

    const handleCompositionEnd = () => {
        if (compositionEndTimerRef.current != null) {
            window.clearTimeout(compositionEndTimerRef.current);
            window.cancelAnimationFrame(compositionEndTimerRef.current);
        }
        // 用 requestAnimationFrame 而非 setTimeout(0)：合成刚结束那一刻浏览器还要把
        // 提交的拼音落到 textarea 的 value 上、再触发 change/select 回灌 React。
        // setTimeout(0) 会和这次落地抢同一任务槽，导致正在合中文时被同帧重画打断、光标丢。
        // 推到下一帧，先把 isComposingRef 维持 true，让 onChange/keyboarddown 看到"还在合成中"而不
        // 误处理为普通键，给拼音真正落地一帧的时间窗口。
        compositionEndTimerRef.current = window.requestAnimationFrame(() => {
            isComposingRef.current = false;
            compositionEndTimerRef.current = null;
        });
    };

    return (
        <Modal
            ref={modalRef}
            // 尺寸由 modalSize state 驱动：用户 resize 后写成 px 精确尺寸，再次打开沿用；
            // 首次打开用兜底值（max(500px, min(85vw,900px)) / max(350px, min(78vh,620px))）。
            // min-w/min-h 写死，避免用户拖太小后塌缩；max-w/max-h 留屏幕边界。
            className={`commontext-compose-modal pt-6 pb-3`}
            style={{
                width: modalSize.w,
                height: modalSize.h,
                minWidth: `${ComposeModalMinW}px`,
                minHeight: `${ComposeModalMinH}px`,
                maxWidth: "96vw",
                maxHeight: "92vh",
            }}
            onClose={close}
            onClickBackdrop={close}
        >
            <div className="flex flex-col gap-2 flex-1 min-h-0" style={{ overflow: "hidden" }}>
                {/* Header */}
                <div className="shrink-0">
                    <div>
                        <div className="text-base font-semibold">Common Text</div>
                        <div className="text-[11px] text-muted">
                            Compose text. Click + to add a new item to the top, then edit it on the right; click a row
                            (or press Enter) to edit it; Insert drops it into the editor.
                        </div>
                    </div>
                </div>

                {/* Editor 包裹层：收起/展开按钮贴右上角，不占正文布局；点击不抢 editor 焦点。 */}
                <div className="relative shrink-0" data-commontext-editor-wrap="">
                    <button
                        type="button"
                        data-commontext-editor-toggle=""
                        aria-pressed={editorExpanded}
                        aria-label={editorExpanded ? "Collapse editor" : "Expand editor"}
                        title={editorExpanded ? "Collapse editor (free space for the list below)" : "Expand editor"}
                        // 不抢焦点：点按钮不触发 editor blur 的折叠计时，也不打断中文输入。
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={(event) => {
                            event.preventDefault();
                            toggleEditorCollapse();
                        }}
                        className={
                            "absolute right-1.5 top-1.5 z-10 inline-flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-hoverbg hover:text-primary cursor-pointer " +
                            (editorManuallyCollapsed ? "bg-modalbg/90 text-accent" : "bg-modalbg/70 text-secondary/50")
                        }
                    >
                        <i
                            className={
                                "fa fa-solid text-[10px] " + (editorExpanded ? "fa-chevron-up" : "fa-chevron-down")
                            }
                        />
                    </button>
                    <textarea
                        ref={editorRef}
                        // 验证台靠这个属性稳定拿到 editor（弹窗里还有详情 textarea）。
                        data-commontext-composer=""
                        // 展开态上限由 editorMaxHeight 动态给（随弹窗高度缩放），不再写死 max-h-[280px]；
                        // 收起态显式给 height：React 只在收起时设置这个 prop，展开时移除它——
                        // 这样既盖掉拖高留下的 inline 高度，又不影响展开后的拖高持久。
                        style={
                            editorExpanded
                                ? { maxHeight: editorMaxHeight }
                                : { height: `${EDITOR_COLLAPSED_HEIGHT_PX}px` }
                        }
                        className={
                            "block w-full resize-y rounded border border-border bg-[var(--form-element-bg-color)] text-[var(--form-element-text-color)] text-sm font-mono p-2 focus:outline-none focus:border-accent leading-relaxed transition-[min-height] " +
                            (editorExpanded
                                ? "min-h-[120px]"
                                : "min-h-0 h-9 resize-none overflow-hidden whitespace-nowrap leading-5")
                        }
                        rows={editorExpanded ? undefined : 1}
                        value={state.editor}
                        onChange={(event) => {
                            const value = event.currentTarget.value;
                            // expanded 只由 onFocus 拉起、onBlur 依据文本收回——onChange 不去重置它，
                            // 否则用户在聚焦态敲普通字符（无换行）会被立即打回单行高度，
                            // 出现"聚焦时展开、一开始编辑又缩回"的闪烁。
                            setEditor(value, event.currentTarget.selectionStart ?? value.length);
                        }}
                        onFocus={() => {
                            // 取消还未触发的折叠延时，避免 editor 间切换/快速回流时被误塌。
                            if (editorCollapseTimerRef.current != null) {
                                window.clearTimeout(editorCollapseTimerRef.current);
                                editorCollapseTimerRef.current = null;
                            }
                            if (!editorManuallyCollapsed) setEditorExpanded(true);
                        }}
                        onBlur={(event) => {
                            // 手动收起态不受失焦折叠判定影响——多行草稿否则会一直保持展开。
                            if (editorManuallyCollapsed) return;
                            // 给 600ms 缓冲：让用户能从 editor 移动到下方 Send/Copy 等按钮，
                            // 期间 editor 暂时失焦但还未塌回单行，避免按钮还未点中 editor 已缩。
                            // 用事件目标当前值而非 state.editor，避开闭包陷阱拿到旧 text 导致失焦不收回。
                            const valueHasNewline = event.currentTarget.value.includes("\n");
                            if (editorCollapseTimerRef.current != null) {
                                window.clearTimeout(editorCollapseTimerRef.current);
                            }
                            editorCollapseTimerRef.current = window.setTimeout(() => {
                                editorCollapseTimerRef.current = null;
                                setEditorExpanded(valueHasNewline);
                            }, 600);
                        }}
                        onSelect={(event) => updateEditorCaret(event.currentTarget)}
                        onPaste={handleEditorPaste}
                        onKeyDown={handleEditorKeyDown}
                        onCompositionStart={handleCompositionStart}
                        onCompositionEnd={handleCompositionEnd}
                        placeholder="Compose here. The list below suggests common text matching what you type."
                        spellCheck={false}
                    />
                </div>

                {/* Action row */}
                <div className="shrink-0 flex items-center gap-2">
                    <button
                        type="button"
                        title={
                            state.editor.trim() === ""
                                ? "Filter list by editor content (type in editor to enable)"
                                : state.editorFilterDismissed
                                  ? "Filter list by editor content"
                                  : "Stop filtering by editor content"
                        }
                        disabled={state.editor.trim() === ""}
                        onClick={() =>
                            update({ editorFilterDismissed: !state.editorFilterDismissed, selectedIndex: 0 })
                        }
                        className={
                            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors " +
                            (state.editor.trim() === ""
                                ? "text-secondary/40 cursor-default"
                                : state.editorFilterDismissed
                                  ? "text-secondary hover:bg-hoverbg hover:text-primary cursor-pointer"
                                  : "text-accent bg-actionsoft hover:bg-actionsoft cursor-pointer")
                        }
                    >
                        <i className="fa fa-solid fa-filter text-[12px]" />
                    </button>
                    <Button
                        className="grey"
                        disabled={state.editor.trim() === ""}
                        onClick={handleClearEditor}
                        title="Clear editor"
                    >
                        <i className="fa fa-solid fa-eraser" />
                    </Button>
                    <Button
                        className="grey"
                        onClick={handleSaveDialog}
                        title="Add new common text item (edit on the right)"
                    >
                        <i className="fa fa-solid fa-plus" />
                    </Button>
                    <Button className="grey" onClick={handleCopy} title="Copy editor content to clipboard">
                        <i className="fa fa-regular fa-copy" />
                    </Button>
                    <CommontextSendButton text={state.editor} onSent={close} onStatus={setStatus} />
                    {editorTags.length > 0 && (
                        <SessionTagChips
                            tags={editorTags.slice(0, MAX_TAG_CHIPS)}
                            removable
                            onRemove={removeEditorTag}
                            className="min-w-0 flex-1"
                        />
                    )}
                    <span
                        data-commontext-draft-status={draftStatus}
                        className={"shrink-0 text-[11px] text-muted " + (draftStatus === "idle" ? "hidden" : "")}
                    >
                        {draftStatus === "saved" ? "Draft saved" : ""}
                    </span>
                    {state.status && (
                        <span
                            className={
                                state.statusKind === "err"
                                    ? "text-xs text-error"
                                    : state.statusKind === "ok"
                                      ? "text-xs text-success"
                                      : "text-xs text-muted"
                            }
                        >
                            {state.status}
                        </span>
                    )}
                </div>

                {/* Master-Detail: 左列表与右详情共用同一个圆角矩形容器，中间只一条 border-r 软分隔线
                    （对齐 .mockup/_to-keep/commontext-compose-modal-improved.html 的 .md-body）。 */}
                <div className="min-h-0 flex-1 flex border border-border rounded overflow-hidden">
                    {/* 左：列表 —— 去掉自己的 border/rounded，靠外层容器收口；右侧 border-r 作为内分隔线 */}
                    <div className="flex-1 min-w-0 flex flex-col border-r border-border bg-modalbg overflow-hidden">
                        <div
                            className="shrink-0 p-2 border-b border-border"
                            onCompositionStart={handleCompositionStart}
                            onCompositionEnd={handleCompositionEnd}
                        >
                            <InputGroup>
                                <Input
                                    ref={searchInputRef}
                                    value={state.manualQuery}
                                    onChange={setManualQuery}
                                    onKeyDown={handleSearchKeyDown}
                                    placeholder={
                                        state.editor.trim() !== ""
                                            ? "Type to override editor-based suggestions"
                                            : "Search common text"
                                    }
                                />
                                <InputRightElement>
                                    <i className="fa-regular fa-magnifying-glass" />
                                </InputRightElement>
                            </InputGroup>
                            {allItems.length > 0 && (
                                <div className="mt-2 flex min-w-0 items-center gap-1.5" data-commontext-source-row="">
                                    <div
                                        role="group"
                                        aria-label="Filter by creator"
                                        className="inline-flex shrink-0 items-center overflow-hidden rounded-md border border-border"
                                    >
                                        {CommonTextCreatorFilters.map((option) => {
                                            const active = option.key === state.creatorFilter;
                                            return (
                                                <button
                                                    key={option.key}
                                                    type="button"
                                                    data-commontext-creator={option.key}
                                                    aria-pressed={active}
                                                    title={option.label}
                                                    aria-label={option.label}
                                                    onClick={() =>
                                                        setState((cur) => ({
                                                            ...cur,
                                                            creatorFilter: option.key,
                                                            selectedIndex: 0,
                                                        }))
                                                    }
                                                    className={
                                                        "inline-flex items-center gap-1 px-2 py-0.5 text-[11px] leading-none cursor-pointer transition-colors " +
                                                        (active
                                                            ? "bg-actionsoft text-actionsofttext"
                                                            : "text-secondary hover:bg-hover hover:text-primary")
                                                    }
                                                >
                                                    <i className={option.icon + " text-[10px]"} />
                                                    <span
                                                        className="tabular-nums"
                                                        data-commontext-creator-count={option.key}
                                                    >
                                                        {creatorCounts[option.key]}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {deviceSummaries.length > 1 && (
                                        <select
                                            data-commontext-device=""
                                            aria-label="Filter by computer"
                                            title="Filter by originating computer"
                                            value={state.deviceFilter}
                                            onChange={(e) =>
                                                setState((cur) => ({
                                                    ...cur,
                                                    deviceFilter: e.target.value,
                                                    selectedIndex: 0,
                                                }))
                                            }
                                            className="min-w-0 max-w-[160px] shrink truncate h-[22px] rounded-md border border-border bg-surface-soft px-1.5 text-[11px] text-secondary cursor-pointer focus:outline-none focus:border-accent"
                                        >
                                            <option value="any">Any computer</option>
                                            {deviceSummaries.map((d) => (
                                                <option key={d.deviceid} value={d.deviceid}>
                                                    {d.devicename} ({d.count})
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                            )}
                            {allItems.length > 0 && (
                                <div className="mt-2 flex min-w-0 items-center gap-1.5" data-commontext-sort-row="">
                                    <div
                                        role="group"
                                        aria-label="Sort common text list"
                                        className="inline-flex shrink-0 items-center overflow-hidden rounded-md border border-border"
                                    >
                                        {CommonTextSortOptions.map((option) => {
                                            const active = option.key === state.sortKey;
                                            return (
                                                <button
                                                    key={option.key}
                                                    type="button"
                                                    data-commontext-sort={option.key}
                                                    aria-label={option.label}
                                                    aria-pressed={active}
                                                    // 用 aria-disabled 而不是 disabled：disabled 按钮在 Chromium 里
                                                    // 不派发鼠标事件，tooltip 也跟着失效——用户就看不到"为什么点不动"。
                                                    aria-disabled={relevanceActive}
                                                    title={
                                                        relevanceActive
                                                            ? "Results are ranked by relevance — clear the search to sort"
                                                            : option.label
                                                    }
                                                    onClick={() => {
                                                        if (relevanceActive) return;
                                                        handleSortChange(option.key);
                                                    }}
                                                    className={
                                                        "inline-flex h-6 w-6 items-center justify-center transition-colors " +
                                                        (relevanceActive
                                                            ? "text-secondary/30 cursor-default"
                                                            : active
                                                              ? "bg-actionsoft text-accent cursor-pointer"
                                                              : "text-secondary hover:bg-hoverbg hover:text-primary cursor-pointer")
                                                    }
                                                >
                                                    <i className={`fa fa-solid ${option.icon} text-[11px]`} />
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <span
                                        role="img"
                                        aria-label="Pinned items stay on top"
                                        title="Pinned items stay on top"
                                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-secondary/60"
                                    >
                                        <i className="fa fa-solid fa-thumbtack text-[10px]" />
                                    </span>
                                    {relevanceActive && (
                                        <span
                                            data-commontext-sort-relevance=""
                                            role="img"
                                            aria-label="Results ranked by relevance while searching"
                                            title="Search ranks by relevance — clear the search to sort again"
                                            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-actionsoft px-1.5 text-accent"
                                        >
                                            <i className="fa fa-solid fa-wand-magic-sparkles text-[10px]" />
                                        </span>
                                    )}
                                </div>
                            )}
                            {allItems.length > 0 && (
                                <div className="mt-2 flex min-w-0 items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={toggleUntagged}
                                        title="Show items with no tags"
                                        className={
                                            "inline-flex max-w-full shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] leading-none cursor-pointer transition-colors " +
                                            (state.untaggedOnly
                                                ? "border-transparent bg-accent/10 text-accent"
                                                : "border-border bg-surface-soft text-secondary hover:bg-hover hover:text-primary")
                                        }
                                    >
                                        <span className="truncate">untagged</span>
                                        <span className="text-[10px] opacity-70">{untaggedCount}</span>
                                    </button>
                                    {tagSummaries.length > 0 && (
                                        <SessionTagChips
                                            tags={tagSummaries.map((s) => s.tag)}
                                            selectedTags={state.selectedTags}
                                            countMap={(() => {
                                                const m = new Map<string, number>();
                                                for (const s of tagSummaries) m.set(s.tag.toLowerCase(), s.count);
                                                return m;
                                            })()}
                                            onClick={toggleTag}
                                            className="min-w-0"
                                        />
                                    )}
                                </div>
                            )}
                        </div>
                        <div
                            ref={listScrollRef}
                            className="flex-1 overflow-y-auto flex flex-col"
                            tabIndex={0}
                            onKeyDown={handleListKeyDown}
                            // 列表区有 tabIndex={0} 才能接键盘上下键，但也意味着鼠标点一下它就会
                            // 抢走 activeElement——上方 editor 的中文输入正合到一半时这是把焦点甩飞
                            // 的第二条暗道。mousedown 上 preventDefault 让"鼠标点列表"不再改焦点，
                            // click/键盘导航都不受影响。
                            onMouseDown={(e) => e.preventDefault()}
                        >
                            {filteredItems.length === 0 ? (
                                <div className="flex flex-1 min-h-[80px] items-center justify-center gap-2 text-secondary text-sm">
                                    <i className="fa fa-regular fa-quote-left text-xl opacity-60" />
                                    <div>{emptyListMessage}</div>
                                </div>
                            ) : (
                                filteredItems.map((item, index) => {
                                    // 每行只算一次 tooltip：列表上限 500 行，按键重渲染时不重复格式化日期。
                                    const metaTooltip = describeCommonTextTime(item);
                                    return (
                                        <div
                                            key={item.id}
                                            data-common-text-index={index}
                                            // 验证台按标题定位行：DOM 次序即真实排序结果，便于断言重排。
                                            data-commontext-title={item.title}
                                            className={
                                                "group flex items-start gap-1.5 border-l-2 px-3 py-1.5 cursor-pointer transition-colors " +
                                                (state.selectedIndex === index
                                                    ? "border-actionsoftborder bg-actionsoft"
                                                    : "border-transparent hover:bg-hoverbg")
                                            }
                                            // hover 仅高亮行、不联动右侧详情：避免鼠标在列表里扫过时右侧
                                            // 详情随每一行跳变。详情只在 click 时进编辑态。这里绝不能
                                            // setState(尤 selectedIndex)：每次 setState 触发整弹窗重渲染，
                                            // 上方 editor 的 textarea 会被 React 重新过一遍 DOM，正在用
                                            // 中文输入法合到一半的拼音就这一过被打飞，光标丢、字打不进。
                                            // 视觉上鼠标 hover 走下面 "hover:bg-hoverbg" 兜底，无需这里做事。
                                            onClick={() => handleListItemClick(item)}
                                        >
                                            <div className="pt-0.5 w-4 shrink-0 text-secondary">
                                                {item.pinned ? (
                                                    <i className="fa fa-solid fa-thumbtack text-[11px]" />
                                                ) : null}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex min-w-0 items-center gap-1.5">
                                                    <span className="min-w-0 truncate text-xs font-medium">
                                                        {item.title}
                                                    </span>
                                                    <CommonTextSyncDot item={item} />
                                                    <span
                                                        data-commontext-creator-badge={getCommonTextCreatorKind(item)}
                                                        title={describeCommonTextSource(item)}
                                                        className={
                                                            "inline-flex shrink-0 items-center gap-1 rounded-sm border px-1 py-px text-[9.5px] leading-none " +
                                                            (getCommonTextCreatorKind(item) === "agent"
                                                                ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
                                                                : "border-orange-400/30 bg-orange-400/10 text-orange-300")
                                                        }
                                                    >
                                                        <i
                                                            className={
                                                                getCommonTextCreatorKind(item) === "agent"
                                                                    ? "fa-solid fa-robot text-[8px]"
                                                                    : "fa-solid fa-user text-[8px]"
                                                            }
                                                        />
                                                        {describeCommonTextCreatorName(item)}
                                                    </span>
                                                </div>
                                                <div className="text-[11px] text-secondary truncate">
                                                    {makePreview(item.text)}
                                                </div>
                                                {(item.tags?.length ?? 0) > 0 && (
                                                    <div className="mt-0">
                                                        <SessionTagChips tags={item.tags?.slice(0, 4)} />
                                                    </div>
                                                )}
                                            </div>
                                            {/* 右侧固定宽槽：默认是「次数 + 更新时间」列（次数是图标 + 数字，
                                                更新时间是 12px 热力方块），鼠标悬浮时它淡出、插入按钮落在同一位置
                                                ——hover 不产生布局抖动。
                                                代价是标题列少了这 58px（靠 truncate 兜住，行高因此不变）。
                                                尺寸约束：次数行 10px + gap 2px + 方块 12px = 24px ≤ h-7(28px)。 */}
                                            <div
                                                className="relative shrink-0 self-center w-[58px] h-7 flex items-center justify-end"
                                                data-commontext-meta=""
                                            >
                                                <div
                                                    className="flex flex-col items-end gap-0.5 whitespace-nowrap text-[10px] leading-none tabular-nums text-secondary transition-opacity group-hover:opacity-0"
                                                    title={metaTooltip}
                                                >
                                                    <span
                                                        data-commontext-usage={item.usagecount ?? 0}
                                                        className={
                                                            "inline-flex items-center gap-1 " +
                                                            ((item.usagecount ?? 0) === 0 ? "text-muted" : "")
                                                        }
                                                        title={`Used ${item.usagecount ?? 0} time(s)`}
                                                    >
                                                        {/* 计数不再配图标：那个循环箭头读起来是「重来/重跑」，
                                                            与「这条被用过多少次」不是一回事。同一右槽第二行已改成
                                                            「方块 + 时间数字」的纯数字列，计数留纯数字反而最安静、
                                                            也对齐了 tabular-nums 的右边界。 */}
                                                        {item.usagecount ?? 0}
                                                    </span>
                                                    <span
                                                        data-commontext-updated=""
                                                        className="inline-flex items-center gap-1"
                                                    >
                                                        {/* 图形 + 数字双出口：方块管「扫一眼比大小」（填充高度 + 浓度
                                                            双通道，5 档在 12px 里都能分开），紧跟着的数字管「精确到
                                                            第几天」——悬停才会显形的时间等于没有时间，而 `4h ago`
                                                            那种整句在扫视时要逐个读字。取 `3d` / `12m` 这种最短形式，
                                                            先把 `ago` 去掉：同一列里所有值都是「多久以前」。 */}
                                                        <CommonTextFreshnessSquare
                                                            tier={commonTextFreshnessTier(item)}
                                                            title={`Updated ${compactCommonTextTime(item.updatedat, true)}`}
                                                            ariaLabel={`Updated ${formatSessionRelativeTime(item.updatedat)}`}
                                                        />
                                                        <span data-commontext-updated-rel="" aria-hidden="true">
                                                            {formatCommonTextFreshnessCompact(item.updatedat)}
                                                        </span>
                                                    </span>
                                                </div>
                                                <span
                                                    role="button"
                                                    tabIndex={-1}
                                                    aria-label="Insert this common text into the focused target"
                                                    title={`Insert into focused target · updated ${formatSessionRelativeTime(item.updatedat)}`}
                                                    className="item-insert-btn absolute right-0 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded bg-modalbg text-secondary opacity-0 transition-opacity hover:bg-hoverbg hover:text-primary group-hover:opacity-100 cursor-pointer"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        fireAndForget(async () => {
                                                            const result = await insertOrCopyCommonText(item.text);
                                                            setStatus(
                                                                result === "inserted"
                                                                    ? "Inserted"
                                                                    : "Copied (no target)",
                                                                result === "inserted" ? "ok" : "info"
                                                            );
                                                            // 先把详情区未落盘的草稿写完再计数：两条写路径都是
                                                            // "读全表 → 改 → 写全表"，交错会把用户刚改的正文覆盖掉。
                                                            // 顺手取消防抖定时器，免得同一份草稿再被写一遍。
                                                            if (detailSaveTimerRef.current != null) {
                                                                window.clearTimeout(detailSaveTimerRef.current);
                                                                detailSaveTimerRef.current = null;
                                                            }
                                                            await flushDetailSave({ keepDirty: true });
                                                            // 行内插入/无目标回退复制同样是一次使用：与详情 Insert 同口径计数。
                                                            await recordCommonTextUse(item.id);
                                                        });
                                                    }}
                                                >
                                                    <i className="fa fa-regular fa-paste text-[12px]" />
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* 右：详情 —— 与左侧共用 panel surface，靠中间分隔线组织层级 */}
                    <div className="flex-1 min-w-0 flex flex-col bg-modalbg overflow-hidden">
                        {detailItem == null ? (
                            <div className="flex flex-1 flex-col items-center justify-center gap-2.5 text-muted text-[13px] px-5 py-10 text-center">
                                <i className="fa fa-regular fa-square text-[28px] opacity-40" />
                                <div>No item selected — click a row to edit</div>
                                <div className="text-[11px] text-muted/70">
                                    <kbd className="px-1.5 py-0.5 rounded border border-border bg-surface-soft">
                                        Enter
                                    </kbd>{" "}
                                    on a row also opens it
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 min-h-0 p-4 flex flex-col gap-2.5 overflow-y-auto">
                                {/* 详情区外层 padding+gap；属性行只用分隔线组织，不形成嵌套卡片。 */}
                                {/* 详情 head：Notion 式页面 —— page icon（emoji 槽）+ 大标题 + 右侧 Pin。
                                    icon 槽与标题同一行：icon 是条目的「脸」，单独一行会把它变成装饰。 */}
                                <div className="shrink-0 flex items-start gap-2">
                                    <div className="shrink-0 pt-0.5">
                                        <PageIconSlot
                                            emoji={state.detailEmoji}
                                            title={detailItem.title}
                                            onChange={(emoji) =>
                                                setState((cur) => ({ ...cur, detailEmoji: emoji, detailDirty: true }))
                                            }
                                        />
                                    </div>
                                    <input
                                        type="text"
                                        value={state.detailTitle}
                                        onChange={(e) =>
                                            setState((cur) => ({
                                                ...cur,
                                                detailTitle: e.target.value,
                                                detailDirty: true,
                                            }))
                                        }
                                        placeholder="Untitled"
                                        className="flex-1 min-w-0 h-8 px-1 -ml-1 rounded border border-transparent bg-transparent text-[17px] font-semibold leading-8 hover:bg-surface-soft focus:outline-none focus:border-border focus:bg-modalbg transition-colors"
                                        spellCheck={false}
                                        data-commontext-detail-title=""
                                    />
                                    <button
                                        type="button"
                                        onClick={() => fireAndForget(async () => handleDetailTogglePin())}
                                        title={
                                            detailItem.pinned
                                                ? "Unpin this text"
                                                : "Pin this text to the top of the list"
                                        }
                                        className={
                                            "shrink-0 mt-0.5 w-8 h-8 inline-flex items-center justify-center rounded-md border transition-colors cursor-pointer " +
                                            (detailItem.pinned
                                                ? "border-accent bg-highlightbg text-accent"
                                                : "border-border bg-modalbg text-secondary hover:border-accent/70 hover:text-primary")
                                        }
                                    >
                                        <i className="fa fa-solid fa-thumbtack text-sm" />
                                    </button>
                                </div>

                                {/* 属性区：默认折叠成一行 icon+数字摘要（完整语义走 tooltip），
                                    chevron 展开完整 5 行网格。折叠把纵向空间留给 Text 正文。 */}
                                <div
                                    className="shrink-0 flex flex-col"
                                    data-commontext-properties={propertiesExpanded ? "expanded" : "collapsed"}
                                >
                                    <button
                                        type="button"
                                        data-commontext-properties-toggle=""
                                        aria-expanded={propertiesExpanded}
                                        title={propertiesExpanded ? "Hide properties" : "Show all properties"}
                                        onClick={() => setPropertiesExpanded((v) => !v)}
                                        className="flex w-full min-w-0 items-center gap-2 rounded px-1 -mx-1 py-1 text-[11px] leading-5 text-secondary hover:bg-surface-soft transition-colors cursor-pointer"
                                    >
                                        {detailPropertySummary.map((s) => (
                                            <span
                                                key={s.key}
                                                data-commontext-properties-summary={s.key}
                                                title={s.title}
                                                // 标签可能很多：tags 项允许收缩并换行（flex-wrap），
                                                // 不把 creator/computer/updated 等项挤出视口。
                                                className={
                                                    "inline-flex min-w-0 items-center gap-1 " +
                                                    (s.key === "tags" ? "" : "shrink-0")
                                                }
                                            >
                                                <i className={"fa fa-solid text-[9px] " + s.iconClass + " " + s.icon} />
                                                {s.key === "tags" && detailTags.length > 0 ? (
                                                    // 与展开态同一个 chip 组件：两态样式/尺寸一致
                                                    <SessionTagChips
                                                        tags={detailTags}
                                                        selectedTags={detailTags}
                                                        className="min-w-0 flex-wrap"
                                                    />
                                                ) : (
                                                    <span className="truncate tabular-nums">{s.text}</span>
                                                )}
                                            </span>
                                        ))}
                                        <i
                                            className={
                                                "ml-auto shrink-0 fa fa-solid fa-chevron-right text-[9px] text-muted transition-transform " +
                                                (propertiesExpanded ? "rotate-90" : "")
                                            }
                                        />
                                    </button>
                                    {/* 展开态：label 定宽 + 值，行间只用细分隔线（不套卡片）。
                                        值与 label 各自独立类名——嵌套会继承 grid 项样式把行高压乱。
                                        Tags 行排在第一：Notion/Obsidian 式属性选择——值区可点，
                                        唤起共享 PropertyTagEditor 浮层（输入过滤/全库候选带计数/创建）。 */}
                                    {propertiesExpanded && (
                                        <div
                                            data-commontext-property="Tags"
                                            className="flex items-start gap-2 border-b border-border/40 py-1"
                                        >
                                            <div className="w-[104px] shrink-0 text-[10.5px] leading-5 text-muted">
                                                Tags
                                            </div>
                                            <div
                                                ref={tagsValueRef}
                                                data-commontext-tags-value=""
                                                onClick={() => setTagsEditing(true)}
                                                title="Edit tags"
                                                className="-mx-1 min-w-0 flex-1 flex flex-wrap items-center gap-1 rounded px-1 py-0.5 text-[11px] leading-5 hover:bg-surface-soft transition-colors cursor-pointer"
                                            >
                                                {detailTags.length === 0 ? (
                                                    <span className="text-muted/70">Empty</span>
                                                ) : (
                                                    <SessionTagChips tags={detailTags} selectedTags={detailTags} />
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    {propertiesExpanded &&
                                        detailProperties.map((prop) => (
                                            <div
                                                key={prop.label}
                                                data-commontext-property={prop.label}
                                                className="flex items-start gap-2 border-b border-border/40 py-1 last:border-b-0"
                                            >
                                                <div className="w-[104px] shrink-0 text-[10.5px] leading-5 text-muted">
                                                    {prop.label}
                                                </div>
                                                <div className="min-w-0 flex-1 text-[11px] leading-5 text-secondary">
                                                    {prop.value}
                                                </div>
                                            </div>
                                        ))}
                                </div>

                                {/* 详情 body：永远 textarea 形态（点选即编辑），卡片样式对齐原型尺寸。
                                    最小高度挂在**包裹层**上（flex 项），不能挂 textarea 自己：
                                    后者拿到 `h-full` 后会用 min-height 硬撞出 flex 槽位，
                                    在窗口变矮时把下面属性行 / 按钮直接盖住（内容不会被自身裁掉）。
                                    包裹层长到 200px 后，超出部分由详情列的 `overflow-y-auto` 接管滚动。 */}
                                <div className="flex-1 min-h-[200px]">
                                    <textarea
                                        ref={detailTextRef}
                                        value={state.detailText}
                                        onChange={(e) =>
                                            setState((cur) => ({
                                                ...cur,
                                                detailText: e.target.value,
                                                detailDirty: true,
                                            }))
                                        }
                                        placeholder="Text to insert — type #tag inline to tag this item"
                                        className="w-full h-full min-h-0 resize-none rounded-lg border border-border bg-[var(--form-element-bg-color)] text-[var(--form-element-text-color)] text-[13.5px] font-mono p-[14px_16px] leading-[1.7] focus:outline-none focus:border-accent"
                                        spellCheck={false}
                                    />
                                </div>

                                {/* Tags 属性浮层：共享 Wolai 式编辑器（md 预览/AISessions 同源）。
                                    portal 到 body + 视口钳位，不会被详情列窄宽挤压。 */}
                                {tagsEditing && (
                                    <PropertyValuePopover
                                        open
                                        anchor={tagsValueRef.current}
                                        onClose={() => setTagsEditing(false)}
                                    >
                                        <PropertyTagEditor
                                            items={detailTags}
                                            options={tagSummaries.map((s) => s.tag)}
                                            optionCounts={(() => {
                                                const counts: Record<string, number> = {};
                                                for (const s of tagSummaries) counts[s.tag.toLowerCase()] = s.count;
                                                return counts;
                                            })()}
                                            multiple
                                            placeholder="搜索或新建标签"
                                            onChange={(items) => applyDetailTags(items)}
                                            onClose={() => setTagsEditing(false)}
                                        />
                                    </PropertyValuePopover>
                                )}

                                {/* 详情 footer：自动保存模式——无 Save/Cancel，仅行为条 + 右侧自动保存状态。
                                    不带 border-t，靠外层 gap 与上面分隔。 */}
                                <div className="shrink-0 flex items-center gap-1.5 flex-wrap">
                                    <CommontextSendButton
                                        text={detailItem.text}
                                        onSent={() => {
                                            fireAndForget(() => recordCommonTextUse(detailItem.id));
                                            close();
                                        }}
                                        onStatus={setStatus}
                                    />
                                    <Button
                                        className="grey"
                                        onClick={() => fireAndForget(async () => handleListItemCopy(detailItem))}
                                        title="Copy this text"
                                    >
                                        <i className="fa fa-regular fa-copy mr-1" />
                                        Copy
                                    </Button>
                                    <Button
                                        onClick={() => handleInsertDetail(detailItem)}
                                        title="Insert into editor at caret"
                                    >
                                        <i className="fa fa-solid fa-arrow-up mr-1" />
                                        Insert
                                    </Button>
                                    {/* 详情元信息：创建 / 更新 / 最近使用 / 次数。图标 + 数字，完整时间戳走 tooltip。 */}
                                    <div
                                        data-commontext-detail-meta=""
                                        className="flex items-center gap-2 text-[10.5px] leading-none tabular-nums text-secondary"
                                    >
                                        <span
                                            data-commontext-detail-sync={detailItem.syncstate ?? "pending"}
                                            className={
                                                "inline-flex items-center gap-1 " +
                                                (detailItem.syncstate === "synced" ? "" : "text-warn")
                                            }
                                            title={describeCommonTextSyncState(detailItem)}
                                        >
                                            <i
                                                className={
                                                    detailItem.syncstate === "synced"
                                                        ? "fa fa-solid fa-cloud text-[9px]"
                                                        : "fa fa-solid fa-cloud-arrow-up text-[9px]"
                                                }
                                            />
                                            {detailItem.syncstate === "synced" ? "Synced" : "Pending"}
                                        </span>
                                        <span
                                            className="inline-flex items-center gap-1"
                                            title={`Created ${compactCommonTextTime(detailItem.createdat, true)}`}
                                        >
                                            <i className="fa fa-regular fa-calendar-plus text-[10px]" />
                                            {compactCommonTextTime(detailItem.createdat)}
                                        </span>
                                        <span
                                            className="inline-flex items-center gap-1"
                                            title={`Updated ${compactCommonTextTime(detailItem.updatedat, true)}`}
                                        >
                                            <i className="fa fa-solid fa-pen text-[9px]" />
                                            {formatSessionRelativeTime(detailItem.updatedat)}
                                        </span>
                                        <span
                                            className="inline-flex items-center gap-1"
                                            title={`Last used ${compactCommonTextTime(detailItem.lastusedat, true)}`}
                                        >
                                            <i className="fa fa-solid fa-clock-rotate-left text-[10px]" />
                                            {detailItem.lastusedat != null
                                                ? formatSessionRelativeTime(detailItem.lastusedat)
                                                : "never"}
                                        </span>
                                        <span
                                            data-commontext-detail-usage={detailItem.usagecount ?? 0}
                                            className="inline-flex items-center gap-1"
                                            title={`Used ${detailItem.usagecount ?? 0} time(s)`}
                                        >
                                            <i className="fa fa-solid fa-repeat text-[9px]" />
                                            {detailItem.usagecount ?? 0}
                                        </span>
                                    </div>
                                    <div className="ml-auto flex items-center gap-2.5">
                                        {saveStatus !== "idle" && (
                                            <span
                                                className={
                                                    "text-[11px] " +
                                                    (saveStatus === "err"
                                                        ? "text-error"
                                                        : saveStatus === "saved"
                                                          ? "text-success"
                                                          : "text-muted")
                                                }
                                                title={saveStatus === "err" ? saveStatusMsgRef.current : undefined}
                                            >
                                                {saveStatus === "saving"
                                                    ? "Saving…"
                                                    : saveStatus === "saved"
                                                      ? "Saved"
                                                      : "Save failed"}
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            title="Delete this text"
                                            className="shrink-0 h-7 w-7 inline-flex items-center justify-center rounded bg-transparent border-0 text-secondary hover:text-error hover:bg-error/10 transition-colors duration-150 cursor-pointer"
                                            onClick={() => fireAndForget(async () => handleListItemDelete(detailItem))}
                                        >
                                            <i className="fa fa-regular fa-trash-can text-[12px]" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </Modal>
    );
});

CommonTextComposeModal.displayName = "CommonTextComposeModal";

function makePreview(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

export { CommonTextComposeModal };
