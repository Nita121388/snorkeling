// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { Input, InputGroup, InputRightElement } from "@/app/element/input";
import { Modal } from "@/app/modals/modal";
import { getBlockComponentModel, atoms } from "@/app/store/global";
import { blockComponentModelMap } from "@/app/store/global-atoms";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { getLayoutDataActiveBlockId } from "@/layout/lib/inlineTabs";
import { fireAndForget } from "@/util/util";
import { atom, useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { OpenCommonTextSearchEvent, type CommonTextSearchDetail } from "./commontext-events";
import { copyCommonText, insertOrCopyCommonText, sendTextToFocusedTerm } from "./commontext-insert";
import {
    deleteCommonTextItem,
    getCommonTextItemsFromSettings,
    getCommonTextTagSummaries,
    openCommonTextManager,
    recordCommonTextUse,
    searchCommonTextComposeItems,
    upsertCommonTextItem,
    type CommonTextItem,
} from "./commontext-model";
import { extractSessionTagsFromNote, removeSessionTagFromNote } from "@/app/view/aisessions/session-tags";
import { SessionTagChips } from "@/app/view/aisessions/session-tag-chips";

const LIST_LIMIT = 500;
const MAX_TAG_CHIPS = 16;

type ComposeState = {
    open: boolean;
    editor: string;
    editorCaret: number;
    editorFilterDismissed: boolean;
    manualQuery: string;
    selectedTags: string[];
    selectedIndex: number;
    // 详情区当前展示的 item id —— hover/键盘 ↑↓/单击 同步它，但不触发插入。
    // 与 selectedIndex 解耦：selectedIndex 仍服务于列表行高亮与键盘导航边界，
    // detailId 才是右侧详情区渲染的真源。
    detailId: string | null;
    // 详情区就地编辑态：editing 进入时由 detail item 拷贝而来，Cancel 丢弃、Save upsert。
    detailTitle: string;
    detailText: string;
    detailDirty: boolean;
    insertedIds: string[];
    status: string;
    statusKind: "info" | "ok" | "err";
};

// 进程内草稿暂存：弹窗关闭后保留 editor 内容，下次无 query 打开时还原；重启进程即丢。
// 带 detail.query 的外部触发（如选区 overlay 复制场景）不取草稿，避免与外部文本冲突。
type ComposeDraft = Pick<ComposeState, "editor" | "editorCaret" | "insertedIds">;
let composeDraft: ComposeDraft | null = null;

// 弹窗尺寸偏好持久化：用户拖动右下角 resize 手柄后无感记入 localStorage，下次打开沿用。
// 无设置 UI、无 schema 文件；存储失败（隐私模式等）静默 fallback 到默认尺寸。
const ComposeModalSizeKey = "commontext:composeModalSize";
const ComposeModalDefaultW = "min(85vw, 900px)";
const ComposeModalDefaultH = "min(78vh, 620px)";
const ComposeModalMinW = 500;
const ComposeModalMinH = 350;

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
    selectedIndex: 0,
    detailId: null,
    detailTitle: "",
    detailText: "",
    detailDirty: false,
    insertedIds: [],
    status: "",
    statusKind: "info",
});

const restoreOpenState = (): ComposeState => {
    if (composeDraft == null) return initialOpenState();
    return {
        ...initialOpenState(),
        ...composeDraft,
    };
};

// Resolves the truly-active block of the focused layout node. Layout nodes use
// either `blockId` (single-block) or `blockIds` + `activeBlockId` (inline-tabs
// container holding several blocks) — `data.blockId` alone misses the latter, so
// we go through `getLayoutDataActiveBlockId`, the same helper `closeFocusedNode`
// / `keymodel` use. Returns the blockId only when it's a term view, else null.
// Drives the Send button's availability so users see it disabled up-front
// instead of clicking first, and feeds `sendTextToFocusedTerm` so Send doesn't
// route through the modal's own textarea.
const focusedTermBlockIdAtom = atom<string | null>((get) => {
    const layoutModel = getLayoutModelForStaticTab();
    if (layoutModel == null) return null;
    const focusedNode = get(layoutModel.focusedNode);
    const blockId = getLayoutDataActiveBlockId(focusedNode?.data);
    if (blockId == null) return null;
    const bcm = getBlockComponentModel(blockId);
    if (bcm?.viewModel?.viewType !== "term") return null;
    return blockId;
});

// All term-block ids visible in the current static tab. Used as a fallback chain
// when the focused block isn't a term (e.g. focus is on the AI panel, a file
// viewer, or the compose modal's own editor). Without this, "Send" silently
// failed whenever the user opened the modal without keeping focus on a terminal
// — modal focus moved to the textarea, so the user had no way to re-focus the
// term without closing the modal first.
const availableTermBlockIdsAtom = atom<string[]>((get) => {
    // preferred: the statically-tracked term belonging to the focused layout node
    const focusedTermId = get(focusedTermBlockIdAtom);
    const seen = new Set<string>();
    const out: string[] = [];
    // We don't have a layout-walk helper handy, so enumerate every block in the
    // app via the model map and keep the ones whose viewModel is a term. The
    // focused term (if any) is always first so "Send" defaults to the user's
    // most recently relevant terminal.
    if (focusedTermId != null) {
        out.push(focusedTermId);
        seen.add(focusedTermId);
    }
    for (const [blockId, bcm] of blockComponentModelMap.entries()) {
        if (blockId == null || seen.has(blockId)) continue;
        if (bcm?.viewModel?.viewType === "term") {
            out.push(blockId);
            seen.add(blockId);
        }
    }
    return out;
});

const CommonTextComposeModal = memo(() => {
    const [state, setState] = useState<ComposeState>(() => ({ ...initialOpenState(), open: false }));
    // editor 默认收缩为单行高度（与 Title/Action 控件视觉对齐），聚焦时再撑开到多行，
    // 避免每次打开弹窗都被一个 120px 的 textarea 撑高、抢走主视觉。
    // "草稿含换行"会作为初始展开判定，防止多行草稿被压缩成单行截断。
    const [editorExpanded, setEditorExpanded] = useState(false);
    const settings = useAtomValue(atoms.settingsAtom);
    const availableTermBlockIds = useAtomValue(availableTermBlockIdsAtom);
    const canSendToTerm = availableTermBlockIds.length > 0;
    const editorRef = useRef<HTMLTextAreaElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const listScrollRef = useRef<HTMLDivElement>(null);
    // 详情区 textarea 聚焦目标：新建条目落库后聚焦这里，承接后续原地编辑。
    const detailTextRef = useRef<HTMLTextAreaElement>(null);
    const modalRef = useRef<HTMLDivElement>(null);
    // 当前生效的尺寸样式；打开弹窗时由 loadComposeModalSize() 初始化，resize 时实时更新。
    // useState 而非纯 ref：尺寸变化要触发 modal 节点 style 重渲染，光改 ref 不够。
    const [modalSize, setModalSize] = useState<ComposeModalSize>(() => loadComposeModalSize() ?? { w: ComposeModalDefaultW, h: ComposeModalDefaultH });
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
    // unmount/closing guard——组件关闭或同步 flush 中途被卸载时置 true，
    // 之后所有 await 之 setState 都跳过，避免"setState on unmounted component"触发 React 19 卸载期 throw 白屏。
    const unmountedRef = useRef(false);

    const allItems = useMemo(() => getCommonTextItemsFromSettings(settings), [settings]);
    const tagSummaries = useMemo(() => getCommonTextTagSummaries(allItems).slice(0, MAX_TAG_CHIPS), [allItems]);
    // editor 当前正文里嵌入的 #tag：在 Send 右侧渲染成可删 chip，点 × 把字面从 editor 抹掉，
    // 这样剩余正文 send/copy 出去时不带走 #tag。
    const editorTags = useMemo(() => extractSessionTagsFromNote(state.editor).tags, [state.editor]);

    // 详情区 tag 完全由 detailText 派生——与编辑器上方的 editorTags 同语义。手写 #tag 落在 Text
    // 正文里，All Tags 面板据此决定 chip 亮灭；该 memo 也是 Save 时写回 item.tags 的真源。
    const detailTags = useMemo(() => extractSessionTagsFromNote(state.detailText).tags, [state.detailText]);

    const filteredItems = useMemo(() => {
        if (!state.open) return [];
        return searchCommonTextComposeItems(allItems, state.editorFilterDismissed ? "" : state.editor, state.manualQuery, {
            limit: LIST_LIMIT,
            selectedTags: state.selectedTags,
            caret: state.editorCaret,
            insertedIds: state.insertedIds,
        });
    }, [
        allItems,
        state.editor,
        state.editorCaret,
        state.editorFilterDismissed,
        state.insertedIds,
        state.manualQuery,
        state.open,
        state.selectedTags,
    ]);
    const editorFilterActive =
        !state.editorFilterDismissed && state.manualQuery.trim() === "" && state.editor.trim() !== "";

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
            setState(next);
            // 不主动聚焦 editor：避免一打开就把弹窗撑成编辑多行态。多行草稿按文本本身初始展开，
            // 让用户视觉上立刻知道草稿还在；单行草稿保持紧凑单行高，等用户点进去再撑开。
            setEditorExpanded(next.editor.includes("\n"));
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

    useEffect(() => {
        if (!state.open) return;
        listScrollRef.current?.scrollTo({ top: 0 });
    }, [state.editor, state.editorCaret, state.insertedIds, state.manualQuery, state.open, state.selectedTags]);

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
            // 关闭弹窗已在 close() 里执行强制 flush，此处 React 卸载流不再重复 fire——
            // 避免组件已卸载却仍调用 setState（saveStatus / detailDirty）触发 React 卸载期 throw 白屏。
            unmountedRef.current = true;
        };
    }, []);

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
        setState((cur) => {
            composeDraft = {
                editor: cur.editor,
                editorCaret: cur.editorCaret,
                insertedIds: cur.insertedIds,
            };
            return { ...cur, open: false };
        });
    };

    const update = (patch: Partial<ComposeState>) => setState((cur) => ({ ...cur, ...patch }));

    const setEditor = (editor: string, editorCaret: number) =>
        update({ editor, editorCaret, editorFilterDismissed: false, selectedIndex: 0 });

    const setManualQuery = (manualQuery: string) => update({ manualQuery, selectedIndex: 0 });

    const updateEditorCaret = (target: HTMLTextAreaElement) =>
        update({ editorCaret: target.selectionStart ?? target.value.length, selectedIndex: 0 });

    const toggleTag = (tag: string) => {
        setState((cur) => {
            const present = cur.selectedTags.some((t) => t.toLowerCase() === tag.toLowerCase());
            const selectedTags = present
                ? cur.selectedTags.filter((t) => t.toLowerCase() !== tag.toLowerCase())
                : [...cur.selectedTags, tag];
            return { ...cur, selectedTags, selectedIndex: 0 };
        });
    };

    const setStatus = (status: string, statusKind: "info" | "ok" | "err" = "info") => update({ status, statusKind });

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
                editor.setSelectionRange(
                    Math.min(prevCaret, newText.length),
                    Math.min(prevCaret, newText.length)
                );
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

    const handleSendToTerm = () => {
        const text = state.editor;
        if (text.trim() === "") {
            setStatus("Nothing to send", "err");
            return;
        }
        // Pick from the candidate chain (focused term → fallback terms in this
        // tab) so that opening the modal without focus on a terminal no longer
        // silently drops the Send. `sendTextToFocusedTerm` returns the blockId
        // it actually pasted into, or null when every candidate's TermWrap was
        // not live (panel mid-transition).
        const target = sendTextToFocusedTerm(text, availableTermBlockIds);
        if (target != null) {
            // Send 成功即关弹窗：失败分支保留弹窗让用户读到错误并重试。
            close();
        } else {
            setStatus("No live terminal — focus a terminal and retry", "err");
        }
    };

    const handleListItemCopy = async (item: CommonTextItem) => {
        try {
            await copyCommonText(item.text);
            setStatus("Copied", "ok");
        } catch (err) {
            setStatus(`Copy failed: ${(err as Error).message ?? "unknown"}`, "err");
        }
    };

    const handleListItemSend = (item: CommonTextItem) => {
        const target = sendTextToFocusedTerm(item.text, availableTermBlockIds);
        if (target != null) {
            // 详情区 Send 成功即关弹窗，与 editor 上方 Send 同语义；失败保留弹窗供重试。
            fireAndForget(() => recordCommonTextUse(item.id));
            close();
        } else {
            setStatus("No live terminal — focus a terminal and retry", "err");
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

    // All tags 面板里点 chip：在 detailText 正文里加/抹对应 #tag 字面（草稿态，Save 才落盘）。
    // tag 与 text 完全同源——点亮/熄灭由 detailTags（从 text 抽）决定，不在 item.tags 结构化字段
    // 上点点即生效。加 tag 时同行末尾追加 ` #tag`，单空格分隔；抹 tag 用 removeSessionTagFromNote。
    const handleDetailToggleTag = (tag: string) => {
        const normalized = tag.trim().toLowerCase().replace(/^#+/, "").replace(/#+$/, "");
        if (normalized === "") return;
        setState((cur) => {
            const currentTags = extractSessionTagsFromNote(cur.detailText).tags;
            const hasTag = currentTags.some((t) => t.toLowerCase() === normalized);
            let nextText: string;
            if (hasTag) {
                nextText = removeSessionTagFromNote(cur.detailText, normalized);
            } else {
                // 同行末尾追加，单空格分隔；若 text 为空或已以空白结尾则不再加第二空格。
                const sep = cur.detailText === "" || /\s$/.test(cur.detailText) ? "" : " ";
                nextText = cur.detailText + sep + "#" + normalized;
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
        requestAnimationFrame(() => editorRef.current?.focus());
    };

    const handleSaveDialog = () => {
        const text = state.editor;
        if (text.trim() === "") {
            setStatus("Nothing to save", "err");
            return;
        }
        // 不再弹独立的 SaveDialog：直接新建一条带 editor 正文的 item，让详情区接管就地编辑。
        // upsertCommonTextItem 收口 title 派生（normalizeCommonTextTitle）；新建后顺手记一次使用，
        // 让它在 sortCommonTextItems 的 lastusedat desc 里排到列表第一行（pinned 除外）。
        fireAndForget(async () => {
            const item = await upsertCommonTextItem({
                title: "",
                text,
                tags: extractSessionTagsFromNote(text).tags,
                pinned: false,
            });
            await recordCommonTextUse(item.id);
            // 新条目落库后：
            // 1. 清空 editor + 折叠回单行——编辑已完成，左栏角色回到匹配/过滤通道
            // 2. 把新条目拉进详情区就地编辑
            // 3. 下一帧把光标聚焦到详情 textarea，让用户直接继续 refine
            setEditor("", 0);
            setEditorExpanded(false);
            setState((cur) => ({
                ...cur,
                detailId: item.id,
                detailTitle: item.title,
                detailText: item.text,
                detailDirty: false,
            }));
            requestAnimationFrame(() => detailTextRef.current?.focus());
        });
    };

    const openManager = () => {
        close();
        fireAndForget(openCommonTextManager);
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

    const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const isComposing =
            isComposingRef.current || event.nativeEvent?.isComposing || event.keyCode == 229 || event.key === "Process";
        if (isComposing) return;
        if (event.key === "Escape") {
            event.preventDefault();
            close();
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
                <div className="shrink-0 flex items-start justify-between gap-3 pr-8">
                    <div>
                        <div className="text-base font-semibold">Common Text</div>
                        <div className="text-[11px] text-muted">
                            Compose text. Click + to add a new item to the top, then edit it on the right; click a row (or press Enter) to edit it; Insert drops it into the editor.
                        </div>
                    </div>
                    <button
                        type="button"
                        className="w-8 h-8 flex items-center justify-center rounded text-secondary hover:bg-hoverbg hover:text-primary transition-colors cursor-pointer"
                        onClick={openManager}
                        title="Manage common text"
                    >
                        <i className="fa fa-solid fa-gear" />
                    </button>
                </div>

                <textarea
                    ref={editorRef}
                    className={
                        "shrink-0 resize-y rounded border border-border bg-[var(--form-element-bg-color)] text-[var(--form-element-text-color)] text-sm font-mono p-2 focus:outline-none focus:border-accent leading-relaxed transition-[min-height] " +
                        (editorExpanded
                            ? "min-h-[120px] max-h-[280px]"
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
                        setEditorExpanded(true);
                    }}
                    onBlur={(event) => {
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
                    onKeyDown={handleEditorKeyDown}
                    onCompositionStart={handleCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    placeholder="Compose here. The list below suggests common text matching what you type."
                    spellCheck={false}
                />

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
                    {canSendToTerm ? (
                        <Button className="grey" onClick={handleSendToTerm} title="Paste into the focused terminal">
                            <i className="fa fa-solid fa-terminal mr-1" />
                            Send
                        </Button>
                    ) : (
                        <span title="Focus a terminal to enable Send" className="inline-flex">
                            <Button className="grey" disabled>
                                <i className="fa fa-solid fa-terminal mr-1" />
                                Send
                            </Button>
                        </span>
                    )}
                    {editorTags.length > 0 && (
                        <SessionTagChips
                            tags={editorTags.slice(0, MAX_TAG_CHIPS)}
                            removable
                            onRemove={removeEditorTag}
                            className="min-w-0 flex-1"
                        />
                    )}
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
                            {tagSummaries.length > 0 && (
                                <div className="mt-2 flex min-w-0 items-center gap-1.5">
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
                                    <div>{allItems.length === 0 ? "No common text yet" : "No matching text"}</div>
                                    <button type="button" className="text-accent hover:underline" onClick={openManager}>
                                        Manage
                                    </button>
                                </div>
                            ) : (
                                filteredItems.map((item, index) => (
                                    <div
                                        key={item.id}
                                        data-common-text-index={index}
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
                                            {item.pinned ? <i className="fa fa-solid fa-thumbtack text-[11px]" /> : null}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="text-xs font-medium truncate">{item.title}</div>
                                            <div className="text-[11px] text-secondary truncate">
                                                {makePreview(item.text)}
                                            </div>
                                            {(item.tags?.length ?? 0) > 0 && (
                                                <div className="mt-0">
                                                    <SessionTagChips tags={item.tags?.slice(0, 4)} />
                                                </div>
                                            )}
                                        </div>
                                        <span
                                            role="button"
                                            tabIndex={-1}
                                            aria-label="Insert this common text into the focused target"
                                            title="Insert into focused target"
                                            className="item-insert-btn inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-secondary opacity-0 transition-opacity hover:bg-hoverbg hover:text-primary group-hover:opacity-100 cursor-pointer"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                fireAndForget(async () => {
                                                    const result = await insertOrCopyCommonText(item.text);
                                                    setStatus(
                                                        result === "inserted" ? "Inserted" : "Copied (no target)",
                                                        result === "inserted" ? "ok" : "info"
                                                    );
                                                });
                                            }}
                                        >
                                            <i className="fa fa-regular fa-paste text-[12px]" />
                                        </span>
                                    </div>
                                ))
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
                                    <kbd className="px-1.5 py-0.5 rounded border border-border bg-surface-soft">Enter</kbd> on a row also opens it
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 min-h-0 p-4 flex flex-col gap-2.5">
                                {/* 详情区外层 padding+gap；All tags 只用分隔线组织，不形成嵌套卡片。 */}
                                {/* 详情 head：title input 卡片化 + 右侧 38×38 Pin toggle 按钮（平铺一行） */}
                                <div className="shrink-0 flex items-center gap-2">
                                    <input
                                        type="text"
                                        value={state.detailTitle}
                                        onChange={(e) =>
                                            setState((cur) => ({ ...cur, detailTitle: e.target.value, detailDirty: true }))
                                        }
                                        placeholder="Title (optional — auto-derived from text)"
                                        className="flex-1 min-w-0 h-9 px-3 rounded-md border border-border bg-modalbg text-sm font-medium focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 transition-colors"
                                        spellCheck={false}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => fireAndForget(async () => handleDetailTogglePin())}
                                        title={detailItem.pinned ? "Unpin this text" : "Pin this text to the top of the list"}
                                        className={
                                            "shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-md border transition-colors cursor-pointer " +
                                            (detailItem.pinned
                                                ? "border-accent bg-highlightbg text-accent"
                                                : "border-border bg-modalbg text-secondary hover:border-accent/70 hover:text-primary")
                                        }
                                    >
                                        <i className="fa fa-solid fa-thumbtack text-sm" />
                                    </button>
                                </div>

                                {/* 详情 body：永远 textarea 形态（点选即编辑），卡片样式对齐原型尺寸 */}
                                <div className="flex-1 min-h-0">
                                    <textarea
                                        ref={detailTextRef}
                                        value={state.detailText}
                                        onChange={(e) =>
                                            setState((cur) => ({ ...cur, detailText: e.target.value, detailDirty: true }))
                                        }
                                        placeholder="Text to insert — type #tag inline to tag this item"
                                        className="w-full h-full min-h-[200px] resize-none rounded-lg border border-border bg-[var(--form-element-bg-color)] text-[var(--form-element-text-color)] text-[13.5px] font-mono p-[14px_16px] leading-[1.7] focus:outline-none focus:border-accent"
                                        spellCheck={false}
                                    />
                                </div>

                                {/* All tags 面板：恒渲染（只要详情有选中项）。chip 选中态来自 detailTags——
                                    即从 Text 正文抽出的 #tag 集合，点 chip 在 Text 里加/抹对应字面（草稿态，Save 落盘）。 */}
                                <div className="shrink-0 border-t border-border pt-2.5 flex flex-col gap-2">
                                    <div className="flex items-center justify-between">
                                        <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-secondary">
                                            All tags
                                        </div>
                                        <div className="text-[10.5px] text-muted">
                                            {tagSummaries.length} tags · click to toggle in Text
                                        </div>
                                    </div>
                                    {tagSummaries.length === 0 ? (
                                        <div className="text-[11px] text-muted py-1">
                                            No tags yet — type <code className="px-1 rounded bg-surface-soft">#tag</code> in Text to create one
                                        </div>
                                    ) : (
                                        <div className="max-h-24 overflow-y-auto pr-1 -mr-1">
                                            <SessionTagChips
                                                tags={tagSummaries.map((s) => s.tag)}
                                                selectedTags={detailTags}
                                                countMap={(() => {
                                                    const m = new Map<string, number>();
                                                    for (const s of tagSummaries) m.set(s.tag.toLowerCase(), s.count);
                                                    return m;
                                                })()}
                                                onClick={(tag) => handleDetailToggleTag(tag)}
                                            />
                                        </div>
                                    )}
                                </div>

                                {/* 详情 footer：自动保存模式——无 Save/Cancel，仅行为条 + 右侧自动保存状态。
                                    不带 border-t，靠外层 gap 与上面分隔。 */}
                                <div className="shrink-0 flex items-center gap-1.5 flex-wrap">
                                    {canSendToTerm ? (
                                        <Button
                                            className="grey"
                                            onClick={() => handleListItemSend(detailItem)}
                                            title="Send to focused terminal"
                                        >
                                            <i className="fa fa-regular fa-paper-plane mr-1" />
                                            Send
                                        </Button>
                                    ) : (
                                        <span title="Focus a terminal to enable Send" className="inline-flex">
                                            <Button className="grey" disabled>
                                                <i className="fa fa-regular fa-paper-plane mr-1" />
                                                Send
                                            </Button>
                                        </span>
                                    )}
                                    <Button
                                        className="grey"
                                        onClick={() => fireAndForget(async () => handleListItemCopy(detailItem))}
                                        title="Copy this text"
                                    >
                                        <i className="fa fa-regular fa-copy mr-1" />
                                        Copy
                                    </Button>
                                    <Button onClick={() => handleInsertDetail(detailItem)} title="Insert into editor at caret">
                                        <i className="fa fa-solid fa-arrow-up mr-1" />
                                        Insert
                                    </Button>
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
