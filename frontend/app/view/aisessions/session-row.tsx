// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { modalsModel } from "@/app/store/modalmodel";
import { cn } from "@/util/util";
import type { MouseEventHandler, MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { CopyIconButton, IconButton } from "./controls";
import { GenActionButton } from "./gen-action-button";
import { NoteAIButton, NoteAISuggestionBar, useNoteAIGenerate } from "./note-ai-controls";
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
import { useAgentPersonas } from "@/app/agent-persona/use-agent-personas";
import { useSessionEmojis } from "@/app/agent-persona/use-session-personas";
import { openAgentEmojiPicker } from "@/app/agent-persona/picker-host";
import { getAgentIcon } from "@/app/view/term/agent-logo";
import { TitleSourceBadge } from "./title-source-badge";
import type { SessionRunningState } from "./use-sessions-running";
import {
    classifySnippet,
    describeSessionDates,
    formatFileSize,
    heatLevel,
    MessageHeatThresholds,
    restoreCommandForSession,
    SizeHeatThresholds,
} from "./utils";

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
 * 更新时间的「新鲜度」进度条填充宽度（索引 = freshnessLevel - 1）。
 *
 * 靠**形状**（条长）而不是颜色深浅编码新旧：11px 小字上的透明度差几乎看不出来，
 * 而 26px 宽「满格 vs 一成」的对比一眼就能区分。档位越旧条越短，
 * 陈旧会话（5 档，>30 天）只剩一根几乎空的槽位。
 */
const RecencyFillByLevel = ["100%", "62%", "32%", "15%", "6%"];

/** 热力方块内部实心块的染色：档位越高越亮（与填充高度双重编码，色弱也能分辨）。 */
const HeatFillClassByLevel = ["bg-accent/25", "bg-accent/40", "bg-accent/55", "bg-accent/70", "bg-accent/90"];

/**
 * 热力方块：一个 12x12 的方框，内部实心块高度 + 颜色共同表示档位（1..5）。
 *
 * 为什么不是纯色块：暗色主题下 5 档灰阶几乎分不开，色弱用户更是完全失效；
 * 填充高度是形状编码，不依赖颜色分辨。精确数值放 title/aria-label 供悬停与
 * 读屏获取 —— 方块的作用是「扫一眼比大小」，不是替代数字。
 */
function HeatCell({ level, title }: { level: number; title: string }) {
    const safeLevel = Math.min(Math.max(level, 1), HeatFillClassByLevel.length);
    return (
        <span
            role="img"
            aria-label={title}
            title={title}
            /*
             * 槽底而不是边框：格子的 12x12 轮廓必须表达出来，否则 1 档（只填 20% 高）
             * 就等于消失，热力编码当场失效。但中性灰 border 套在紫色填充外面看起来像
             * 「被框住的窗口」，所以用与行底色差一档的 surface-strong 当槽，安静但仍占位。
             */
            className="inline-flex h-3 w-3 shrink-0 items-end justify-center overflow-hidden rounded-[3px] bg-surface-strong/70"
        >
            <span
                className={cn("w-full rounded-[1px]", HeatFillClassByLevel[safeLevel - 1])}
                style={{ height: `${safeLevel * 20}%` }}
            />
        </span>
    );
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
    inSelection = false,
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
    /** 该行是父行展开后的最后一条子行 → 连接线只画到半高（收尾肘）。 */
    isLastChild = false,
    expandAllTags = false,
    /** 远端会话需要带 connection（供弹窗编辑时的 Summary/NoteAndTags RPC）。 */
    connection = "",
}: {
    session: SessionSummary;
    selected: boolean;
    /** 该行属于批量选区（与「当前行」是两个独立概念，可同时为真）。 */
    inSelection?: boolean;
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
    /** 展开后同组最后一条子行：竖线止于行的中线，形成 └ 收尾。 */
    isLastChild?: boolean;
    /**
     * 工具栏「展开全部标签」的全局偏好（方案 B）。
     * 打开时所有行铺开全部标签；行内「Show less」只收起自己，不改全局偏好。
     */
    expandAllTags?: boolean;
    /** 远端会话需要带 connection（供弹窗编辑时的 Summary/NoteAndTags RPC）。 */
    connection?: string;
}) {
    const isChild = depth > 0;
    // 上下文行（后端为了保住父子结构带出来的行）→ 次要色 + 图标 + tooltip 说明。
    const attachKind = (session.attached ?? "").trim();
    const isAttached = attachKind !== "";
    const attachIcon =
        attachKind === "parent"
            ? "fa-sharp fa-solid fa-link"
            : attachKind === "child"
              ? "fa-sharp fa-solid fa-sitemap"
              : "";
    const attachLabel =
        attachKind === "parent"
            ? "上下文父会话（未命中本次筛选）"
            : attachKind === "child"
              ? "子代理（未命中本次筛选，父会话命中所致）"
              : "";
    const childIcon =
        childKind === "fork" ? "fa-sharp fa-solid fa-code-branch" : "fa-sharp fa-solid fa-wand-magic-sparkles";
    // 折叠时显示总数；筛选命中时显示 M/N（信息量更大）。展开后普通总数让位给箭头，
    // 但命中徽标继续显示，因为它是筛选结论。M === N 时（上下文行关闭或全部命中）
    // 不再显示 N/N：分母已经表达了同一件事，只留纯数字避免列表被徽标噪声填满。
    const showMatchBadge = matchedChildCount > 0 && childCount > 0 && matchedChildCount < childCount;
    const childBadge = showMatchBadge ? `${matchedChildCount}/${childCount}` : `${childCount}`;
    const childBadgeTitle = showMatchBadge
        ? `${matchedChildCount} of ${childCount} sub-sessions match this filter`
        : `${childCount} sub-session${childCount === 1 ? "" : "s"}`;
    const [noteEditing, setNoteEditing] = useState(false);
    // 标签展开是纯 UI 态：不落盘、不跨会话记忆，避免行高跳动（design §4）。
    const [tagsExpanded, setTagsExpanded] = useState(false);
    // 全局「展开全部标签」打开时，单行仍可用「Show less」收起自己。
    const [tagsCollapsedLocally, setTagsCollapsedLocally] = useState(false);
    // 全局开关每次切换都清掉行内覆盖：否则关掉再打开，之前点过 Show less 的行
    // 会一直保持收起，看起来像「全局展开不生效」。
    useEffect(() => {
        setTagsCollapsedLocally(false);
    }, [expandAllTags]);
    const [noteDraft, setNoteDraft] = useState(session.note ?? "");
    const [tagDraft, setTagDraft] = useState<string[]>(() => normalizeSessionTags(session.tags));
    const [noteSaveStatus, setNoteSaveStatus] = useState<NoteSaveStatus>("idle");
    const latestDraftRef = useRef(session.note ?? "");
    // 行内编辑器里的 AI 生成：提案式（不自动落库），空草稿直填、非空走 Apply。
    const noteAI = useNoteAIGenerate(session.key, connection);

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

    // 创建 / 最近更新时间：相对时间给出新鲜度，紧凑日期给出定点，同年省略年份。
    const dateInfo = describeSessionDates(session.createdAt ?? 0, session.updatedAt ?? 0);
    // snippet 的字体/行数策略：机器产出单行等宽，散文父子行分别 2 / 1 行。
    const snippetKind = classifySnippet(session.snippet);

    const tooltip = useMemo(
        () =>
            [
                session.title || session.id,
                session.snippet ? `Content: ${session.snippet}` : "",
                session.createdAt ? `Created: ${dateInfo.createdFull}` : "",
                session.updatedAt || session.createdAt ? `Updated: ${dateInfo.updatedFull}` : "",
                session.note ? `Note: ${session.note}` : "",
                session.tags?.length ? `Tags: ${sessionTagsLabel(session.tags)}` : "",
                // 消息数已不再直接写在行里（改成热力方块），这里补回精确值。
                `Messages: ${session.messageCount ?? 0}`,
                session.size != null ? `Size: ${formatFileSize(session.size)} (${session.size} bytes)` : "",
                session.projectPath || session.filePath ? `Path: ${session.projectPath || session.filePath}` : "",
                // 搜索框支持按 session id/key 筛选，所以把 id 放在 tooltip 里方便查看/复制。
                session.id ? `Session ID: ${session.id}` : "",
                attachLabel,
            ]
                .filter(Boolean)
                .join("\n\n"),
        // 只依赖完整时间字符串（基元值）：相对时间每帧都在变，不能让 memo 每次都失效。
        [session, dateInfo.createdFull, dateInfo.updatedFull]
    );

    const parsedDraft = extractSessionTagsFromNote(noteDraft);
    const nextTags = mergeSessionTags(tagDraft, parsedDraft.tags);
    const noteUnchanged = parsedDraft.note === (session.note ?? "") && sessionTagsEqual(nextTags, session.tags);
    const noteSaving = noteSaveStatus === "saving";
    const sessionTags = normalizeSessionTags(session.tags);
    // 折叠态默认 4 个标签（design §4）；展开态由行内「收起」按钮回折。
    // 全局偏好优先；单行的「Show less」只覆盖自己。
    const tagsOpen = expandAllTags ? !tagsCollapsedLocally : tagsExpanded;
    const visibleSessionTags = visibleTagsFor(sessionTags, tagsOpen);
    const hiddenTags = hiddenTagCount(sessionTags, tagsOpen);
    // 只有真的存在被折叠的标签（超过 4 个）时才需要 +N / Show less 控件。
    // 否则单标签行在全局展开时也会长出一个点了没反应的「Show less」。
    const tagOverflow = sessionTags.length > DefaultVisibleTagCount;
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

    const personaMap = useAgentPersonas();
    const sessionEmojiMap = useSessionEmojis();
    // Session-level persona: history rows carry the session id (== `agent:sessionid`),
    // so "仅此会话" set on any surface also shows up here (and vice versa).
    const sourceIcon = getAgentIcon(session.source, {
        personas: personaMap,
        sessionEmojis: sessionEmojiMap,
        sessionId: session.id,
    });
    const openPersonaPicker = useCallback(
        (event: ReactMouseEvent<HTMLElement>) => {
            event.stopPropagation();
            openAgentEmojiPicker(
                null,
                session.source,
                event.currentTarget.getBoundingClientRect(),
                sourceIcon?.kind === "emoji" ? "session" : "provider",
                session.id
            );
        },
        [session.source, session.id, sourceIcon?.kind]
    );

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

    // 编辑器内 AI 生成：把建议写进草稿（不直接落库），草稿为空时自动应用。
    const applyNoteAISuggestion = useCallback((suggestion: { note: string; tags: string[] }) => {
        latestDraftRef.current = suggestion.note;
        setNoteDraft(suggestion.note);
        setTagDraft(suggestion.tags);
        setNoteSaveStatus("idle");
    }, []);
    useEffect(() => {
        if (!noteEditing || noteAI.status !== "ready" || noteAI.suggestion == null) return;
        const draftEmpty = noteDraft.trim() === "" && normalizeSessionTags(tagDraft).length === 0;
        if (!draftEmpty) return;
        applyNoteAISuggestion(noteAI.suggestion);
        noteAI.dismiss();
    }, [applyNoteAISuggestion, noteAI.status, noteAI.suggestion, noteAI.dismiss, noteEditing, noteDraft, tagDraft]);

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

    // 弹窗编辑：长 note 需要更宽的编辑面。App 级 modal（不渲染在 block 内，无焦点问题）。
    const openNoteDialog = useCallback(() => {
        modalsModel.pushModal("AISessionNoteModal", {
            sessionId: session.key,
            connection: connection || undefined,
        });
    }, [connection, session.key]);

    return (
        <div
            className={cn(
                // 层级：父行是组头（py-2 / text-sm / medium），子行是组内条目
                // （py-1.5 / 13px / 更低对比）。颜色由 design.md §3.2 规定。
                /*
                 * 分隔线只给顶层行：展开的子会话本来就整块落在 bg-surface/25 容器里，
                 * 每行再画一条底边会把展开区切成十几条横线的表格；容器自身负责块感。
                 */
                "group relative cursor-pointer bg-block-solid pl-3 pr-3 hover:bg-hoverbg",
                isChild ? "border-b-0 bg-transparent py-1.5 text-[13px]" : "border-b border-border/70 py-2 text-sm",
                // 选区内（多选）：左侧 2px 竖条 + 淡底；当前行（单选）用更实的 accent。
                inSelection &&
                    !selected &&
                    "bg-accent/5 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-accent/50",
                selected &&
                    "bg-accent/10 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-accent"
            )}
            title={tooltip}
            data-session-key={session.key}
            data-attached={attachKind || undefined}
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
                    /*
                     * 连接线：一条竖线 + 一个短肋。竖线固定在本列的 10px 处，加上外层
                     * pl-3(12px) 后落在 x=22px，与父行折叠箭头的中心同轴（箭头 20px
                     * 热区的中心 = 12+10）。最后一条子行竖线只画到半高，形成 └ 收尾，
                     * 不再继续向下延伸。
                     */
                    <div className="relative w-5 shrink-0 self-stretch" aria-hidden="true">
                        <span
                            className={cn(
                                "absolute left-2.5 top-0 w-px bg-border/70",
                                isLastChild ? "h-1/2" : "h-full"
                            )}
                        />
                        <span className="absolute left-2.5 top-1/2 h-px w-2 bg-border/70" />
                    </div>
                ) : null}
                <div className={cn("flex shrink-0 flex-col items-center gap-1", !expandable && "mt-0.5")}>
                    {expandable ? (
                        <button
                            type="button"
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-secondary transition-colors hover:bg-hover hover:text-accent"
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
                                    "fa-sharp fa-solid text-[10px] transition-transform duration-150 fa-chevron-right",
                                    expanded && "rotate-90"
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
                <div className={cn("min-w-0 flex-1 border-l border-border/60 pl-3", isChild && "border-none pl-0")}>
                    <div className="flex min-w-0 items-center gap-2">
                        {isChild ? (
                            <i
                                className={cn(childIcon, "shrink-0 text-[10px] text-secondary/80")}
                                title={childKind === "fork" ? "Fork" : "Sub-agent session"}
                            />
                        ) : null}
                        {isAttached ? (
                            <i
                                className={cn(attachIcon, "shrink-0 text-[10px] text-secondary/70")}
                                title={attachLabel}
                                data-attached-badge={attachKind}
                            />
                        ) : null}
                        <div
                            className={cn(
                                "min-w-0 flex-1 truncate",
                                isChild || isAttached
                                    ? "font-normal text-secondary group-hover:text-primary"
                                    : "font-medium text-primary"
                            )}
                        >
                            {session.title || session.id}
                            <TitleSourceBadge titleSource={session.titleSource} className="ml-1 align-middle" />
                        </div>
                        {expandable ? (
                            <button
                                type="button"
                                className={cn(
                                    "flex h-4 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] tabular-nums transition-colors",
                                    showMatchBadge
                                        ? "bg-accent/15 text-accent"
                                        : "bg-surface text-secondary hover:text-primary",
                                    // 展开后普通总数不再有意义（箭头已表达状态），但命中徽标保留。
                                    expanded && !showMatchBadge && "hidden"
                                )}
                                title={childBadgeTitle}
                                aria-label={childBadgeTitle}
                                data-row-action="true"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onToggleExpand?.(event);
                                }}
                            >
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
                        <GenActionButton
                            sessionKey={session.key}
                            connection={connection}
                            kind="title"
                            titleSource={session.titleSource}
                            size="xs"
                            source="session-row"
                            className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                        />
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
                        <button
                            type="button"
                            className="inline-flex cursor-pointer items-center gap-1 rounded border-none bg-transparent p-0 text-left text-inherit hover:text-primary"
                            title={`设置 ${session.source} 的 emoji 人格`}
                            aria-label={`Set ${session.source} emoji persona`}
                            data-row-action="true"
                            onClick={openPersonaPicker}
                        >
                            {sourceIcon?.kind === "emoji" ? (
                                <span className="agent-emoji-icon agent-emoji-icon--row" title={session.source}>
                                    {sourceIcon.emoji}
                                </span>
                            ) : (
                                <span className={cn("h-1.5 w-1.5 rounded-full", sourceDotClass(session.source))} />
                            )}
                            {session.source}
                        </button>
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
                        {dateInfo.updatedText ? (
                            <span
                                className="inline-flex items-center gap-1.5"
                                title={`Updated: ${dateInfo.updatedFull}`}
                            >
                                {/* 进度条自己带标题：条长只表达“比较新/比较旧”，悬停直接读多久前。 */}
                                <span
                                    className="inline-block h-[5px] w-[26px] shrink-0 overflow-hidden rounded-[2px] bg-border"
                                    title={`Updated ${dateInfo.updatedRelative} · ${dateInfo.updatedFull}`}
                                >
                                    <span
                                        className="block h-full rounded-[2px] bg-accent"
                                        style={{ width: RecencyFillByLevel[dateInfo.freshnessLevel - 1] ?? "6%" }}
                                    />
                                </span>
                                <span>{dateInfo.updatedText}</span>
                            </span>
                        ) : null}
                        {dateInfo.createdText ? (
                            <span title={`Created: ${dateInfo.createdFull}`}>Created {dateInfo.createdText}</span>
                        ) : null}
                        <span className="inline-flex items-center gap-1.5" data-heat="metrics">
                            <HeatCell
                                level={heatLevel(session.messageCount ?? 0, MessageHeatThresholds)}
                                title={`${session.messageCount ?? 0} messages`}
                            />
                            {session.size != null ? (
                                <HeatCell
                                    level={heatLevel(session.size, SizeHeatThresholds)}
                                    title={`${formatFileSize(session.size)} (${session.size} bytes)`}
                                />
                            ) : null}
                        </span>
                    </div>
                    {session.snippet ? (
                        <div className="mt-1 flex items-start gap-1">
                            <div
                                className={cn(
                                    "min-w-0 flex-1 text-secondary",
                                    // 机器产出（CSV / 日志尾 / 表格）走等宽 + 单行：
                                    // 用正文字体两行包裹会把这类行糊成段落，反而比标题更抢眼。
                                    snippetKind === "machine"
                                        ? "truncate font-mono text-[11px] leading-4"
                                        : cn("text-xs leading-5", isChild ? "line-clamp-1" : "line-clamp-2")
                                )}
                            >
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
                            <span className={cn("flex min-w-0 flex-1 items-center gap-1.5", tagsOpen && "flex-wrap")}>
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
                                {tagOverflow ? (
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
                            {session.note ? (
                                <button
                                    type="button"
                                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-secondary opacity-0 transition-opacity hover:bg-hover hover:text-primary group-hover:opacity-100 group-focus-within:opacity-100"
                                    title="Open note in dialog"
                                    aria-label="Open note in dialog"
                                    data-row-action="true"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        openNoteDialog();
                                    }}
                                >
                                    <i className="fa-sharp fa-solid fa-up-right-and-down-left-from-center text-[10px]" />
                                </button>
                            ) : null}
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
                                <NoteAIButton status={noteAI.status} onGenerate={() => void noteAI.generate()} />
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
                            <NoteAISuggestionBar
                                suggestion={noteAI.suggestion}
                                status={noteAI.status}
                                error={noteAI.error}
                                configError={noteAI.configError}
                                onApply={(suggestion) => {
                                    applyNoteAISuggestion(suggestion);
                                    noteAI.dismiss();
                                }}
                                onRegenerate={() => void noteAI.generate()}
                                onDismiss={noteAI.dismiss}
                                onOpenSettings={noteAI.openAISettings}
                            />
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
