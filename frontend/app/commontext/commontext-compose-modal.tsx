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
import { OpenCommonTextSearchEvent, openCommonTextSaveDialog, type CommonTextSearchDetail } from "./commontext-events";
import { copyCommonText, sendTextToFocusedTerm } from "./commontext-insert";
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

const initialOpenState = (manualQuery = ""): ComposeState => ({
    open: true,
    editor: "",
    editorCaret: 0,
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
    const isComposingRef = useRef(false);
    const compositionEndTimerRef = useRef<number>(null);
    // editor blur 后延时折叠的 timer：onFocus 时取消，给用户从 editor 移动到
    // Send/Copy 等按钮留出 600ms 落点窗口，避免按钮还没点 editor 已塌回单行。
    const editorCollapseTimerRef = useRef<number>(null);

    const allItems = useMemo(() => getCommonTextItemsFromSettings(settings), [settings]);
    const tagSummaries = useMemo(() => getCommonTextTagSummaries(allItems).slice(0, MAX_TAG_CHIPS), [allItems]);
    // editor 当前正文里嵌入的 #tag：在 Send 右侧渲染成可删 chip，点 × 把字面从 editor 抹掉，
    // 这样剩余正文 send/copy 出去时不带走 #tag。
    const editorTags = useMemo(() => extractSessionTagsFromNote(state.editor).tags, [state.editor]);

    const filteredItems = useMemo(() => {
        if (!state.open) return [];
        return searchCommonTextComposeItems(allItems, state.editor, state.manualQuery, {
            limit: LIST_LIMIT,
            selectedTags: state.selectedTags,
            caret: state.editorCaret,
            insertedIds: state.insertedIds,
        });
    }, [
        allItems,
        state.editor,
        state.editorCaret,
        state.insertedIds,
        state.manualQuery,
        state.open,
        state.selectedTags,
    ]);

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
        };
    }, []);

    if (!state.open) return null;

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

    const setEditor = (editor: string, editorCaret: number) => update({ editor, editorCaret, selectedIndex: 0 });

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
        update({ editor: newText, editorCaret: Math.min(prevCaret, newText.length) });
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
    const handleListItemClick = (item: CommonTextItem) => {
        setState((cur) => ({
            ...cur,
            detailId: item.id,
            detailTitle: item.title,
            detailText: item.text,
            detailDirty: true,
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
            setStatus("Sent to focused terminal", "ok");
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
            setStatus("Sent to focused terminal", "ok");
            fireAndForget(() => recordCommonTextUse(item.id));
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

    // 详情区就地编辑：进入即编辑态（click 已经把 item 的 title/text 拷进 detailTitle/Text
    // 并设 detailDirty=true）。Cancel 丢弃草稿、Save 调 upsertCommonTextItem 写回 settings。
    const handleDetailCancelEdit = () => {
        if (detailItem == null) {
            setState((cur) => ({ ...cur, detailTitle: "", detailText: "", detailDirty: false }));
            return;
        }
        setState((cur) => ({
            ...cur,
            detailTitle: detailItem.title,
            detailText: detailItem.text,
            detailDirty: false,
        }));
    };

    // All tags 面板里点 chip：立即把该 tag 加进/移出当前 item.tags 并写回 settings，
    // 不走 footer Save 草稿流程（tag 改动点点即生效）。
    // 写回时用后端当前 item 的 title/text/pinned 副本，避免把未 Save 的 detailTitle/detailText
    // 草稿误回写（草稿只在 state 里，下次 Save 再落盘）。
    const handleDetailToggleTag = async (tag: string) => {
        if (detailItem == null) return;
        const currentTags = detailItem.tags ?? [];
        const lower = tag.toLowerCase();
        const exists = currentTags.some((t) => t.toLowerCase() === lower);
        const nextTags = exists
            ? currentTags.filter((t) => t.toLowerCase() !== lower)
            : [...currentTags, tag];
        try {
            await upsertCommonTextItem(
                {
                    title: detailItem.title,
                    text: detailItem.text,
                    tags: nextTags,
                    pinned: detailItem.pinned ?? false,
                },
                detailItem.id
            );
            setStatus(exists ? "Tag removed" : "Tag added", "ok");
        } catch (err) {
            setStatus(`Tag update failed: ${(err as Error).message ?? "unknown"}`, "err");
        }
    };

    // 详情区 Pin toggle 按钮：立即把 pinned 翻转写回 settings，与 tag toggle 同属"点点即生效"。
    // 用后端当前 item 的 title/text/tags 副本避免误回写未 Save 的草稿。
    const handleDetailTogglePin = async () => {
        if (detailItem == null) return;
        try {
            await upsertCommonTextItem(
                {
                    title: detailItem.title,
                    text: detailItem.text,
                    tags: detailItem.tags ?? [],
                    pinned: !detailItem.pinned,
                },
                detailItem.id
            );
            setStatus(detailItem.pinned ? "Unpinned" : "Pinned", "ok");
        } catch (err) {
            setStatus(`Pin toggle failed: ${(err as Error).message ?? "unknown"}`, "err");
        }
    };

    const handleDetailSaveEdit = async () => {
        if (detailItem == null) return;
        const title = state.detailTitle.trim();
        const text = state.detailText;
        if (text.trim() === "") {
            setStatus("Nothing to save", "err");
            return;
        }
        try {
            await upsertCommonTextItem(
                {
                    title,
                    text,
                    tags: detailItem.tags ?? [],
                    pinned: detailItem.pinned ?? false,
                },
                detailItem.id
            );
            setState((cur) => ({ ...cur, detailDirty: false }));
            setStatus("Saved", "ok");
        } catch (err) {
            setStatus(`Save failed: ${(err as Error).message ?? "unknown"}`, "err");
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
        openCommonTextSaveDialog({ text });
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
            className={"w-[min(960px,calc(100vw-32px))] h-[min(800px,calc(100vh-32px))] pt-6 pb-3"}
            onClose={close}
            onClickBackdrop={close}
        >
            <div className="flex flex-col gap-2 flex-1 min-h-0" style={{ overflow: "hidden" }}>
                {/* Header */}
                <div className="shrink-0 flex items-start justify-between gap-3 pr-8">
                    <div>
                        <div className="text-base font-semibold">Common Text</div>
                        <div className="text-[11px] text-muted">
                            Compose text. Click a row (or press Enter) to edit it on the right; Insert drops it into the editor.
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
                        "shrink-0 resize-y rounded border border-border bg-background text-sm font-mono p-2 focus:outline-none focus:border-accent leading-relaxed transition-[min-height] " +
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
                        title="Save editor content as a Common Text item"
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

                {/* Master-Detail: 左侧列表常驻、右侧详情常驻。行 hover → 详情同步；行 click → 仅选中不插入。 */}
                <div className="min-h-0 flex-1 flex gap-2">
                    {/* 左：列表 */}
                    <div className="flex-1 min-w-0 border border-border rounded flex flex-col overflow-hidden">
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
                                <SessionTagChips
                                    tags={tagSummaries.map((s) => s.tag)}
                                    selectedTags={state.selectedTags}
                                    countMap={(() => {
                                        const m = new Map<string, number>();
                                        for (const s of tagSummaries) m.set(s.tag.toLowerCase(), s.count);
                                        return m;
                                    })()}
                                    onClick={toggleTag}
                                    className="mt-2"
                                />
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
                                        "group flex items-start gap-1.5 px-3 py-1.5 cursor-pointer transition-colors " +
                                        (state.selectedIndex === index ? "bg-highlightbg" : "hover:bg-hoverbg")
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
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* 右：详情 */}
                    <div className="flex-1 min-w-0 border border-border rounded flex flex-col overflow-hidden">
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
                                {/* 详情区外层 padding+gap，子段间不再用 border-b 分隔；
                                    唯一保留的 border 是 All tags 面板自身的卡片边框。 */}
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

                                {/* item 自身 tags：单层 chip 行，无 Tags label、无空态提示，0 chip 直接不渲染 */}
                                {(detailItem.tags?.length ?? 0) > 0 && (
                                    <div className="shrink-0 flex flex-wrap items-center gap-1.5">
                                        <SessionTagChips tags={detailItem.tags} />
                                    </div>
                                )}

                                {/* 详情 body：永远 textarea 形态（点选即编辑），卡片样式对齐原型尺寸 */}
                                <div className="flex-1 min-h-0">
                                    <textarea
                                        value={state.detailText}
                                        onChange={(e) =>
                                            setState((cur) => ({ ...cur, detailText: e.target.value, detailDirty: true }))
                                        }
                                        placeholder="Text to insert"
                                        className="w-full h-full min-h-[200px] resize-none rounded-lg border border-border bg-editorbg text-[13.5px] font-mono p-[14px_16px] leading-[1.7] focus:outline-none focus:border-accent"
                                        spellCheck={false}
                                    />
                                </div>

                                {/* All tags 面板：贴边、border+圆角+半透 bg、padding 12/14、gap 8。 */}
                                {tagSummaries.length > 0 && (
                                    <div className="shrink-0 rounded-lg border border-border bg-modalbg/60 px-3.5 py-3 flex flex-col gap-2">
                                        <div className="flex items-center justify-between">
                                            <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-secondary">
                                                All tags
                                            </div>
                                            <div className="text-[10.5px] text-muted">
                                                {tagSummaries.length} tags · click to toggle on this item
                                            </div>
                                        </div>
                                        <div className="max-h-24 overflow-y-auto pr-1 -mr-1">
                                            <SessionTagChips
                                                tags={tagSummaries.map((s) => s.tag)}
                                                selectedTags={detailItem.tags ?? []}
                                                countMap={(() => {
                                                    const m = new Map<string, number>();
                                                    for (const s of tagSummaries) m.set(s.tag.toLowerCase(), s.count);
                                                    return m;
                                                })()}
                                                onClick={(tag) => fireAndForget(async () => handleDetailToggleTag(tag))}
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* 详情 footer：始终是 Save/Cancel + 行为条（点选即编辑，无中间只读态）。
                                    不带 border-t，靠外层 gap 与上面分隔。 */}
                                <div className="shrink-0 flex items-center gap-1.5 flex-wrap">
                                    <Button
                                        className="primary"
                                        onClick={handleDetailSaveEdit}
                                        title="Save changes"
                                    >
                                        <i className="fa fa-solid fa-check mr-1" />
                                        Save
                                    </Button>
                                    <Button
                                        className="grey"
                                        onClick={handleDetailCancelEdit}
                                        title="Discard changes and clear detail"
                                    >
                                        Cancel
                                    </Button>
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
                                    <Button
                                        className="grey"
                                        onClick={() => handleInsertDetail(detailItem)}
                                        title="Insert into editor at caret"
                                    >
                                        <i className="fa fa-solid fa-arrow-up mr-1" />
                                        Insert
                                    </Button>
                                    <div className="ml-auto">
                                        <button
                                            type="button"
                                            title="Delete this text"
                                            className="shrink-0 h-7 px-2 inline-flex items-center justify-center rounded bg-transparent border-0 text-secondary hover:text-error hover:bg-error/10 transition-colors duration-150 cursor-pointer"
                                            onClick={() => fireAndForget(async () => handleListItemDelete(detailItem))}
                                        >
                                            <i className="fa fa-regular fa-trash-can text-[11px] mr-1" />
                                            Delete
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
