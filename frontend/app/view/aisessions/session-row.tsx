// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { cn } from "@/util/util";
import type { MouseEventHandler, MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { CopyIconButton, IconButton } from "./controls";
import { NoteAutoSaveDelayMs, shouldAutoSaveNote } from "./session-note-autosave";
import { SessionTagChips } from "./session-tag-chips";
import {
    extractSessionTagsFromNote,
    mergeSessionTags,
    normalizeSessionTags,
    removeSessionTagFromNote,
    sessionTagsEqual,
    sessionTagsLabel,
    stripSessionTagHashes,
} from "./session-tags";
import { getChatSource } from "./sources";
import type { SessionRunningState } from "./use-sessions-running";
import { formatDateTimeToSecond, formatFileSize, formatSessionRelativeTime, restoreCommandForSession } from "./utils";

/**
 * A note's *real* content is whatever survives stripping `#tag` hash-tags.
 * A note like "#fix #snorkeling" has empty body but still passes `Boolean(session.note)`,
 * which would wrongly render the accent stripe. Use this for visual decorations that
 * should only appear when there's prose, not when only tags are present.
 */
function noteHasProse(note: string | null | undefined): boolean {
    return Boolean(note) && stripSessionTagHashes(note).trim().length > 0;
}

function sourceDotClass(source: string): string {
    return getChatSource(source).dotClass ?? "bg-secondary";
}

/**
 * 行内交互元素（星标、复制、Resume、note/标签编辑…）的标记。
 *
 * 点击语义：单击 = 选中，双击 = 打开 Detail Block。行内控件两种都不该触发，
 * 否则用户"想点一下编辑标签"却把会话详情弹了出来。stopPropagation 只挡 click，
 * 挡不住 dblclick，所以统一用这个属性做判定。
 */
const RowActionAttribute = "data-row-action";

/** 折叠态默认展示的标签数（design §4：4 个，超出折叠成 +N）。 */
export const DefaultVisibleTagCount = 4;

/**
 * 折叠态只取前 4 个标签，其余折叠成 `+N`；展开态给全部。
 * 抽成纯函数便于单测（行内交互态不落盘，见 design §4）。
 */
export function visibleTagsFor(tags: string[], expanded: boolean): string[] {
    return expanded ? tags : tags.slice(0, DefaultVisibleTagCount);
}

/** 折叠态下被藏起来的标签数量（0 表示不需要渲染 `+N`）。 */
export function hiddenTagCount(tags: string[], expanded: boolean): number {
    return expanded ? 0 : Math.max(0, tags.length - DefaultVisibleTagCount);
}

function isRowActionTarget(event: { target: EventTarget | null }): boolean {
    const target = event.target as HTMLElement | null;
    if (target == null || typeof target.closest !== "function") return false;
    return target.closest(`[${RowActionAttribute}]`) != null;
}

/**
 * Four-dot spinner shown beneath the mark button when the session has a live block.
 * Four dots sit at the top/right/bottom/left of a small box and the whole box rotates,
 * so the dots appear to chase each other around a square path.
 * Returns null for any non-running state so callers can drop it straight into JSX.
 */
export function RunningDot({
    runningState,
    onJumpToBlock,
}: {
    runningState: SessionRunningState | null;
    onJumpToBlock: (runningState: SessionRunningState) => void;
}): ReactElement | null {
    if (runningState == null || runningState.status !== "running") return null;
    const dotClass = "absolute rounded-full bg-success";
    return (
        <Tooltip
            placement="top"
            openDelay={200}
            hideOnClick
            divClassName="mt-0.5 inline-flex h-4 w-4 shrink-0"
            content={
                <div className="max-w-[420px] whitespace-pre-wrap break-words text-[11px] leading-4">
                    <div className="text-secondary">This session has a live block in the app.</div>
                    <div className="mt-1 inline-flex items-center gap-1 text-[10px] uppercase text-secondary">
                        <span className="h-1.5 w-1.5 rounded-full bg-success/90 ring-2 ring-success/20" />
                        <span>Click to jump to block</span>
                    </div>
                </div>
            }
        >
            <button
                type="button"
                className="relative inline-flex h-4 w-4 shrink-0 cursor-pointer animate-spin border-0 bg-transparent p-0"
                aria-label="Jump to live block"
                onClick={(event) => {
                    event.stopPropagation();
                    onJumpToBlock(runningState);
                }}
            >
                <span className={cn(dotClass, "left-1/2 top-0 h-1 w-1 -translate-x-1/2")} />
                <span className={cn(dotClass, "right-0 top-1/2 h-1 w-1 -translate-y-1/2")} />
                <span className={cn(dotClass, "bottom-0 left-1/2 h-1 w-1 -translate-x-1/2")} />
                <span className={cn(dotClass, "left-0 top-1/2 h-1 w-1 -translate-y-1/2")} />
            </button>
        </Tooltip>
    );
}

type NoteSaveStatus = "idle" | "saving" | "saved" | "error";

export function SessionRow({
    session,
    selected,
    onSelect,
    onOpen,
    onMark,
    onNoteSave,
    onResume,
    resumeDisabled = false,
    runningState = null,
    chatRunning = false,
    onJumpToBlock,
    depth = 0,
    childKind,
    expandable = false,
    expanded = false,
    childCount = 0,
    matchedChildCount = 0,
    onToggleExpand,
    expandAllTags = false,
}: {
    session: SessionSummary;
    selected: boolean;
    // 带上事件，让上层能区分 Ctrl/Cmd+点击（强制单开详情块）。
    onSelect: (event: ReactMouseEvent<HTMLDivElement>) => void;
    /** 双击行：打开该会话的 Detail Block（纯列表块下新建块，详情块下新开一个块）。 */
    onOpen?: (event: ReactMouseEvent<HTMLDivElement>) => void;
    onMark: MouseEventHandler<HTMLButtonElement>;
    onNoteSave: (note: string, tags: string[]) => Promise<boolean>;
    onResume: MouseEventHandler<HTMLButtonElement>;
    resumeDisabled?: boolean;
    runningState?: SessionRunningState | null;
    chatRunning?: boolean;
    onJumpToBlock: (runningState: SessionRunningState) => void;
    /** 树层级：0 = 顶层会话，1 = 子会话（subagent / fork）。 */
    depth?: number;
    /** 子会话类型 → 决定行内图标；顶层行不传。 */
    childKind?: "subagent" | "fork";
    /** 父行：有子会话可展开。 */
    expandable?: boolean;
    /** 父行：当前是否展开。 */
    expanded?: boolean;
    /** 父行：子会话总数（计数徽标用）。 */
    childCount?: number;
    /** 父行：命中本次筛选的子会话数（>0 时徽标走 accent 高亮）。 */
    matchedChildCount?: number;
    /** 点箭头 / 计数徽标：只展开收起，不选中、不打开。 */
    onToggleExpand?: (event: ReactMouseEvent<HTMLElement>) => void;
    /**
     * 工具栏「展开全部标签」的全局偏好（方案 B）。
     * 打开时所有行铺开全部标签；行内「Show less」只收起自己，不改全局偏好。
     */
    expandAllTags?: boolean;
}) {
    const isChild = depth > 0;
    const childIcon =
        childKind === "fork" ? "fa-sharp fa-solid fa-code-branch" : "fa-sharp fa-solid fa-wand-magic-sparkles";
    const childBadge =
        matchedChildCount > 0 && childCount > 0 ? `${matchedChildCount}/${childCount}` : `+${childCount}`;
    const childBadgeTitle =
        matchedChildCount > 0 && childCount > 0
            ? `${matchedChildCount} of ${childCount} sub-sessions match this filter`
            : `${childCount} sub-session${childCount === 1 ? "" : "s"}`;
    const [noteEditing, setNoteEditing] = useState(false);
    // 标签展开是纯 UI 态：不落盘、不跨会话记忆，避免行高跳动（design §4）。
    const [tagsExpanded, setTagsExpanded] = useState(false);
    // 全局「展开全部标签」打开时，单行仍可用「Show less」收起自己。
    const [tagsCollapsedLocally, setTagsCollapsedLocally] = useState(false);
    const [noteDraft, setNoteDraft] = useState(session.note ?? "");
    const [tagDraft, setTagDraft] = useState<string[]>(() => normalizeSessionTags(session.tags));
    const [noteSaveStatus, setNoteSaveStatus] = useState<NoteSaveStatus>("idle");
    const latestDraftRef = useRef(session.note ?? "");

    useEffect(() => {
        if (!noteEditing) {
            const nextNote = session.note ?? "";
            latestDraftRef.current = nextNote;
            setNoteDraft(nextNote);
            setTagDraft(normalizeSessionTags(session.tags));
        }
    }, [noteEditing, session.note, session.tags]);

    useEffect(() => {
        if (noteSaveStatus !== "saved" && noteSaveStatus !== "error") return;
        const handle = window.setTimeout(() => setNoteSaveStatus("idle"), noteSaveStatus === "saved" ? 1200 : 1800);
        return () => window.clearTimeout(handle);
    }, [noteSaveStatus]);

    const tooltip = useMemo(
        () =>
            [
                session.title || session.id,
                session.snippet ? `Content: ${session.snippet}` : "",
                session.note ? `Note: ${session.note}` : "",
                session.tags?.length ? `Tags: ${sessionTagsLabel(session.tags)}` : "",
                session.size != null ? `Size: ${formatFileSize(session.size)} (${session.size} bytes)` : "",
                session.projectPath || session.filePath ? `Path: ${session.projectPath || session.filePath}` : "",
            ]
                .filter(Boolean)
                .join("\n\n"),
        [session]
    );

    const parsedDraft = extractSessionTagsFromNote(noteDraft);
    const nextTags = mergeSessionTags(tagDraft, parsedDraft.tags);
    const noteUnchanged = parsedDraft.note === (session.note ?? "") && sessionTagsEqual(nextTags, session.tags);
    const noteSaving = noteSaveStatus === "saving";
    const sessionTime = session.updatedAt || session.createdAt || 0;
    const sessionTags = normalizeSessionTags(session.tags);
    // 折叠态默认 4 个标签（design §4）；展开态由行内「收起」按钮回折。
    // 全局偏好优先；单行的「Show less」只覆盖自己。
    const tagsOpen = expandAllTags ? !tagsCollapsedLocally : tagsExpanded;
    const visibleSessionTags = visibleTagsFor(sessionTags, tagsOpen);
    const hiddenTags = hiddenTagCount(sessionTags, tagsOpen);
    /** 行内切换：全局偏好打开时只覆盖本行，否则翻转本行的展开态。 */
    const toggleTags = () => {
        if (expandAllTags) {
            setTagsCollapsedLocally((current) => !current);
            return;
        }
        setTagsExpanded((current) => !current);
    };
    const hasNoteInfo = Boolean(session.note || sessionTags.length);
    const noteToggleLabel =
        !hasNoteInfo && !noteEditing
            ? "Add note and tags"
            : noteEditing && noteUnchanged
              ? "Collapse note and tags"
              : noteEditing
                ? "Save and collapse note and tags"
                : "Edit note and tags";

    const saveNote = useCallback(async (): Promise<boolean> => {
        if (noteSaveStatus === "saving") return false;
        const parsed = extractSessionTagsFromNote(noteDraft);
        const tags = mergeSessionTags(tagDraft, parsed.tags);
        if (parsed.note === (session.note ?? "") && sessionTagsEqual(tags, session.tags)) {
            return true;
        }
        setNoteSaveStatus("saving");
        const saved = await onNoteSave(parsed.note, tags);
        const currentDraftSaved = extractSessionTagsFromNote(latestDraftRef.current).note === parsed.note;
        setNoteSaveStatus(saved ? (currentDraftSaved ? "saved" : "idle") : "error");
        return saved && currentDraftSaved;
    }, [noteDraft, noteSaveStatus, onNoteSave, session.note, session.tags, tagDraft]);

    // 防抖自动保存：停止输入 NoteAutoSaveDelayMs 后落盘，与详情面板/Note 弹窗行为一致。
    useEffect(() => {
        if (!shouldAutoSaveNote({ loaded: true, visible: noteEditing, unchanged: noteUnchanged, saving: noteSaving })) {
            return;
        }
        const handle = window.setTimeout(() => void saveNote(), NoteAutoSaveDelayMs);
        return () => window.clearTimeout(handle);
    }, [noteEditing, noteSaving, noteUnchanged, saveNote]);

    const toggleNoteEditor = useCallback(async () => {
        if (!noteEditing) {
            setNoteEditing(true);
            return;
        }
        if (noteSaving) {
            return;
        }
        if (!noteUnchanged) {
            const saved = await saveNote();
            if (!saved) {
                return;
            }
        }
        setNoteEditing(false);
    }, [noteEditing, noteSaving, noteUnchanged, saveNote]);

    return (
        <div
            className={cn(
                // 子行缩进 20px（design §3.1）：父行 pl-3 = 12px，子行 pl-8 = 32px。
                // 这里不用 px-3 + 条件 pl-*，两个 padding 工具类会互相覆盖。
                "group relative cursor-pointer border-b border-border bg-block-solid py-2 pr-3 text-sm hover:bg-hoverbg",
                isChild ? "bg-block-solid/60 pl-8 text-[13px]" : "pl-3",
                selected &&
                    "bg-accent/10 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-accent"
            )}
            title={tooltip}
            onClick={(event) => {
                if (isRowActionTarget(event)) return;
                onSelect(event);
            }}
            onDoubleClick={(event) => {
                if (isRowActionTarget(event)) return;
                onOpen?.(event);
            }}
        >
            <div className="flex min-w-0 items-start gap-2">
                {isChild ? (
                    // 左侧竖线：self-stretch 让这个 rail 撑满行高，span 再用 flex-1 填满它。
                    // 只写 h-full 的话父容器高度是 auto，百分比高度会退化成 0（线不可见）。
                    <div className="flex w-4 shrink-0 flex-col items-center self-stretch" aria-hidden="true">
                        <span className="w-px flex-1 bg-border/70" />
                    </div>
                ) : null}
                <div className={cn("flex shrink-0 flex-col items-center gap-1", !expandable && "mt-0.5")}>
                    {expandable ? (
                        <button
                            type="button"
                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-secondary transition-colors hover:text-accent"
                            aria-expanded={expanded}
                            aria-label={expanded ? "Collapse sub-sessions" : "Expand sub-sessions"}
                            title={
                                expanded
                                    ? "Collapse sub-sessions"
                                    : `Expand ${childCount} sub-session${childCount === 1 ? "" : "s"}`
                            }
                            data-row-action="true"
                            onClick={(event) => {
                                event.stopPropagation();
                                onToggleExpand?.(event);
                            }}
                        >
                            <i
                                className={cn(
                                    "fa-sharp fa-solid text-[9px]",
                                    expanded ? "fa-chevron-down" : "fa-chevron-right"
                                )}
                            />
                        </button>
                    ) : null}
                    <button
                        className={cn(
                            "text-secondary opacity-0 transition-opacity hover:text-accent group-hover:opacity-100 group-focus-within:opacity-100",
                            session.marked && "text-accent opacity-100"
                        )}
                        title="Mark session"
                        data-row-action="true"
                        onClick={onMark}
                    >
                        <i className={cn("fa-sharp", session.marked ? "fa-solid fa-star" : "fa-regular fa-star")} />
                    </button>
                    <RunningDot runningState={runningState} onJumpToBlock={onJumpToBlock} />
                </div>
                <div className="min-w-0 flex-1 border-l border-border pl-3">
                    <div className="flex min-w-0 items-center gap-2">
                        {isChild ? (
                            <i
                                className={cn(childIcon, "shrink-0 text-[10px] text-secondary")}
                                title={childKind === "fork" ? "Fork" : "Sub-agent session"}
                            />
                        ) : null}
                        <div className="min-w-0 flex-1 truncate font-medium">{session.title || session.id}</div>
                        {expandable ? (
                            <button
                                type="button"
                                className={cn(
                                    "flex h-4 shrink-0 items-center gap-1 rounded-full px-1.5 text-[10px] tabular-nums transition-colors",
                                    matchedChildCount > 0
                                        ? "bg-accent/15 text-accent"
                                        : "bg-surface text-secondary hover:text-primary"
                                )}
                                title={childBadgeTitle}
                                aria-label={childBadgeTitle}
                                data-row-action="true"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onToggleExpand?.(event);
                                }}
                            >
                                <i className="fa-sharp fa-solid fa-diagram-project text-[8px]" />
                                {childBadge}
                            </button>
                        ) : null}
                        <button
                            type="button"
                            className="flex h-5 shrink-0 items-center gap-1 rounded border border-border px-2 text-[10px] text-secondary opacity-0 transition-opacity hover:bg-hover hover:text-primary disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-secondary group-hover:opacity-100 group-focus-within:opacity-100"
                            title="Resume session"
                            data-row-action="true"
                            disabled={resumeDisabled}
                            onClick={onResume}
                        >
                            <i className="fa-sharp fa-solid fa-square-terminal" />
                            <span>Resume</span>
                        </button>
                        <span data-row-action="true" className="inline-flex">
                            <CopyIconButton
                                text={restoreCommandForSession(session)}
                                label="Copy resume command"
                                size="xs"
                                className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                            />
                        </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-secondary tabular-nums">
                        <span className="inline-flex items-center gap-1">
                            <span className={cn("h-1.5 w-1.5 rounded-full", sourceDotClass(session.source))} />
                            {session.source}
                        </span>
                        {chatRunning ? (
                            <span className="inline-flex items-center gap-1 text-accent" title="GUI Chat is running">
                                <i className="fa-sharp fa-solid fa-spinner animate-spin text-[10px]" />
                                GUI Chat
                            </span>
                        ) : null}
                        {session.vendorid ? (
                            <span
                                className="max-w-40 truncate rounded border border-border px-1.5 py-0.5 text-[10px] text-primary"
                                title={session.configdir || session.vendorid}
                            >
                                Vendor {session.vendorid.slice(0, 8)}
                            </span>
                        ) : null}
                        <span title={formatDateTimeToSecond(sessionTime)}>
                            {formatSessionRelativeTime(sessionTime)}
                        </span>
                        <span>{session.messageCount ?? 0} msgs</span>
                        {session.size != null ? <span>{formatFileSize(session.size)}</span> : null}
                    </div>
                    {session.snippet ? (
                        <div className="mt-1 flex items-start gap-1">
                            <div className="min-w-0 flex-1 line-clamp-2 text-xs leading-5 text-secondary">
                                {session.snippet}
                            </div>
                            {!hasNoteInfo && !noteEditing ? (
                                <button
                                    type="button"
                                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-secondary opacity-0 transition-opacity hover:bg-hover hover:text-primary group-hover:opacity-100 group-focus-within:opacity-100"
                                    title="Add note and tags"
                                    aria-label="Add note and tags"
                                    data-row-action="true"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        void toggleNoteEditor();
                                    }}
                                >
                                    <i className="fa-sharp fa-solid fa-pen text-[10px]" />
                                </button>
                            ) : null}
                        </div>
                    ) : null}
                    {hasNoteInfo || noteEditing ? (
                        /*
                         * 外层不能用 <button>：里面还要放「+N / 收起」真按钮（button 不能嵌套）。
                         * 改成 div[role=button] 保留键盘可达性（Enter/Space）。
                         */
                        <div
                            role="button"
                            tabIndex={0}
                            className={cn(
                                "relative mt-1 flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded py-0.5 pl-2 pr-1 text-left text-xs transition-colors hover:bg-hover hover:text-accent",
                                noteHasProse(session.note) &&
                                    "before:absolute before:top-0 before:bottom-0 before:left-0 before:w-0.5 before:bg-accent/50 before:content-['']",
                                noteEditing && "bg-hover/60 text-accent"
                            )}
                            title={noteToggleLabel}
                            aria-label={noteToggleLabel}
                            data-row-action="true"
                            onClick={(e) => {
                                e.stopPropagation();
                                void toggleNoteEditor();
                            }}
                            onKeyDown={(e) => {
                                if (e.key !== "Enter" && e.key !== " ") return;
                                e.preventDefault();
                                e.stopPropagation();
                                void toggleNoteEditor();
                            }}
                        >
                            <span
                                className={cn("flex min-w-0 flex-1 items-center gap-1.5", tagsExpanded && "flex-wrap")}
                            >
                                {session.note ? (
                                    <span className="min-w-0 flex-1 truncate text-accent">
                                        {stripSessionTagHashes(session.note)}
                                    </span>
                                ) : null}
                                {visibleSessionTags.map((tag) => (
                                    <span
                                        key={tag}
                                        className="shrink-0 rounded-md border border-border bg-accent/10 px-2 py-0.5 text-[11px] leading-none text-accent"
                                    >
                                        {tag}
                                    </span>
                                ))}
                                {hiddenTags > 0 || tagsOpen ? (
                                    <button
                                        type="button"
                                        className="shrink-0 cursor-pointer rounded-md border border-accent/20 bg-accent/10 px-1.5 py-0.5 text-[10px] leading-none text-accent transition-colors hover:bg-accent/20"
                                        title={
                                            tagsOpen
                                                ? "Show fewer tags"
                                                : `Show ${sessionTags.length - DefaultVisibleTagCount} more tag(s)`
                                        }
                                        aria-label={
                                            tagsOpen
                                                ? "Show fewer tags"
                                                : `Show ${sessionTags.length - DefaultVisibleTagCount} more tag(s)`
                                        }
                                        data-row-action="true"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            toggleTags();
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key !== "Enter" && e.key !== " ") return;
                                            e.preventDefault();
                                            e.stopPropagation();
                                            toggleTags();
                                        }}
                                    >
                                        {tagsOpen ? "Show less" : `+${hiddenTags}`}
                                    </button>
                                ) : null}
                            </span>
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-secondary opacity-0 transition-opacity hover:bg-hover hover:text-primary group-hover:opacity-100 group-focus-within:opacity-100">
                                <i className="fa-sharp fa-solid fa-pen text-[10px]" />
                            </span>
                        </div>
                    ) : null}
                    {noteEditing ? (
                        <div className="mt-2 space-y-2" data-row-action="true" onClick={(e) => e.stopPropagation()}>
                            <SessionTagChips
                                tags={nextTags}
                                removable
                                onRemove={(tag) => {
                                    setTagDraft((current) => current.filter((item) => item !== tag));
                                    const nextNote = removeSessionTagFromNote(noteDraft, tag);
                                    latestDraftRef.current = nextNote;
                                    setNoteDraft(nextNote);
                                }}
                            />
                            <textarea
                                className="min-h-[56px] w-full resize-none rounded border border-border bg-transparent px-2 py-2 text-xs outline-none focus:border-accent"
                                placeholder="Add a note, use #tag to add tags"
                                value={noteDraft}
                                onChange={(e) => {
                                    latestDraftRef.current = e.target.value;
                                    setNoteDraft(e.target.value);
                                    if (noteSaveStatus !== "saving") {
                                        setNoteSaveStatus("idle");
                                    }
                                }}
                                onBlur={() => {
                                    if (!noteUnchanged && !noteSaving) {
                                        void saveNote();
                                    }
                                }}
                            />
                            <div className="flex items-center gap-2">
                                <IconButton
                                    icon="fa-eraser"
                                    label="Clear note"
                                    size="xs"
                                    disabled={noteSaving || (!session.note && noteDraft.trim() === "")}
                                    onClick={() => {
                                        const nextNote = "";
                                        latestDraftRef.current = nextNote;
                                        setNoteSaveStatus("saving");
                                        setNoteDraft(nextNote);
                                        setTagDraft([]);
                                        void onNoteSave(nextNote, []).then((saved) => {
                                            const currentDraftSaved = latestDraftRef.current.trim() === nextNote;
                                            setNoteSaveStatus(saved ? (currentDraftSaved ? "saved" : "idle") : "error");
                                            if (saved && currentDraftSaved) {
                                                setNoteEditing(false);
                                            }
                                        });
                                    }}
                                />
                                <span
                                    className={cn(
                                        "text-[10px] text-secondary",
                                        noteSaveStatus === "saved" && "text-accent",
                                        noteSaveStatus === "error" && "text-error"
                                    )}
                                    aria-live="polite"
                                >
                                    {noteSaveStatus === "saving"
                                        ? "Saving..."
                                        : noteSaveStatus === "saved"
                                          ? "Saved"
                                          : noteSaveStatus === "error"
                                            ? "Save failed"
                                            : !noteUnchanged
                                              ? "Unsaved changes"
                                              : ""}
                                </span>
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
