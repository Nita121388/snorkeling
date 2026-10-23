// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// SessionNoteSection — InfoCard 里可复用的 note / tags 区段。
//
// 数据全部来自 useSessionNoteState（session-note-hook.ts），本组件只负责渲染：
//   - 标题 + AI 生成按钮 + 保存状态图标
//   - note 预览（点击进入编辑）或 textarea
//   - tags chips
//   - 错误 / AI 提案面板
//
// AgentHoverCard（term agent block）与 SessionDetailInfoCard（会话详情 / GUI Chat）
// 共用，避免两份 note UI 漂移。

import {
    InfoCardEmpty,
    InfoCardError,
    InfoCardHead,
    InfoCardIcon,
    InfoCardInput,
    InfoCardPreview,
    InfoCardSection,
    InfoCardText,
} from "./info-card";
import { InfoCardMarquee } from "./marquee";
import type { SessionNoteState } from "@/app/store/session-note-hook";
import { createBlock } from "@/app/store/global";
import { cn } from "@/util/util";
import * as React from "react";

function statusIcon(state: SessionNoteState): string {
    return state.saveStatus === "saving"
        ? "fa-spinner animate-spin"
        : state.saveStatus === "saved"
          ? "fa-check"
          : state.saveStatus === "error"
            ? "fa-triangle-exclamation"
            : "fa-tag";
}

export function SessionNoteSection({ state }: { state: SessionNoteState }) {
    const {
        summary,
        noteDraft,
        setNoteDraft,
        isEditing,
        setIsEditing,
        inputRef,
        finishEditing,
        trimmedDraft,
        previewText,
        title,
        error,
        metadataStatus,
        metadataError,
        metadataNote,
        metadataTags,
        setMetadataNote,
        setMetadataStatus,
        generateMetadata,
        applyMetadata,
        titleSuggestion,
        titleStatus,
        titleError,
        generateTitle,
        applyTitle,
        dismissTitle,
    } = state;

    const openAIConfig = React.useCallback(() => {
        void createBlock({ meta: { view: "waveconfig", file: "waveai.json" } }, false, true);
    }, []);

    if (summary == null) {
        return null;
    }

    return (
        <InfoCardSection>
            <div className="flex items-center justify-between gap-2">
                {/* min-w-0 + flex-1：标题行可收缩，长会话名不再把卡片撑破。 */}
                <InfoCardHead className="min-w-0 flex-1">
                    <InfoCardIcon icon={`fa-sharp fa-solid ${statusIcon(state)}`} />
                    <InfoCardMarquee text={title} />
                </InfoCardHead>
                <div className="flex shrink-0 items-center gap-0.5">
                    <button
                        type="button"
                        className="shrink-0 cursor-pointer rounded px-1.5 py-1 text-xs text-secondary hover:bg-hover hover:text-primary disabled:opacity-60"
                        title="Generate title with AI"
                        aria-label="Generate title with AI"
                        disabled={titleStatus === "loading" || state.sessionId === ""}
                        onClick={(event) => {
                            event.stopPropagation();
                            void generateTitle();
                        }}
                    >
                        <i
                            className={cn(
                                "fa-sharp fa-solid",
                                titleStatus === "loading" ? "fa-spinner animate-spin" : "fa-heading"
                            )}
                        />
                    </button>
                    <button
                        type="button"
                        className="shrink-0 cursor-pointer rounded px-1.5 py-1 text-xs text-secondary hover:bg-hover hover:text-primary disabled:opacity-60"
                        title="Generate note and tags with AI"
                        aria-label="Generate note and tags with AI"
                        disabled={metadataStatus === "loading" || state.sessionId === ""}
                        onClick={(event) => {
                            event.stopPropagation();
                            void generateMetadata();
                        }}
                    >
                        <i
                            className={cn(
                                "fa-sharp fa-solid",
                                metadataStatus === "loading" ? "fa-spinner animate-spin" : "fa-wand-magic-sparkles"
                            )}
                        />
                    </button>
                </div>
            </div>
            {/* AI 标题提案：只展示建议，点 Apply 才写入。 */}
            {titleStatus === "loading" ? (
                <div className="text-xs text-secondary">Generating title…</div>
            ) : null}
            {titleStatus === "ready" ? (
                <div className="space-y-2 rounded border border-border bg-surface-soft p-2">
                    <div className="break-words text-xs text-primary">{titleSuggestion || "(empty title)"}</div>
                    <div className="flex justify-end gap-1.5">
                        <button
                            type="button"
                            className="cursor-pointer rounded border border-border px-2 py-1 text-[10px] text-secondary hover:bg-hover"
                            onClick={dismissTitle}
                        >
                            Dismiss
                        </button>
                        <button
                            type="button"
                            className="cursor-pointer rounded border border-border px-2 py-1 text-[10px] text-secondary hover:bg-hover"
                            onClick={() => void generateTitle()}
                        >
                            Regenerate
                        </button>
                        <button
                            type="button"
                            className="cursor-pointer rounded bg-action px-2 py-1 text-[10px] text-actiontext hover:bg-actionhover disabled:opacity-60"
                            disabled={titleSuggestion.trim() === ""}
                            onClick={() => void applyTitle()}
                        >
                            Apply
                        </button>
                    </div>
                </div>
            ) : null}
            {titleStatus === "error" && titleError ? (
                <InfoCardError>{titleError}</InfoCardError>
            ) : null}
            {isEditing ? (
                <InfoCardInput
                    ref={inputRef}
                    value={noteDraft}
                    rows={4}
                    placeholder="Note"
                    aria-label="Session note"
                    spellCheck={false}
                    onChange={(event) => {
                        setNoteDraft(event.target.value);
                    }}
                    onBlur={finishEditing}
                    onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Escape") {
                            event.currentTarget.blur();
                        }
                    }}
                />
            ) : (
                <InfoCardPreview
                    onClick={() => {
                        setIsEditing(true);
                        window.setTimeout(() => {
                            inputRef.current?.focus();
                            inputRef.current?.setSelectionRange(noteDraft.length, noteDraft.length);
                        }, 0);
                    }}
                >
                    {trimmedDraft === "" && (summary?.note ?? "").trim() === "" ? (
                        <InfoCardEmpty>Click to add a note...</InfoCardEmpty>
                    ) : (
                        <InfoCardText>{previewText}</InfoCardText>
                    )}
                </InfoCardPreview>
            )}
            {/* Tags chips（有则显示） */}
            {(summary?.tags?.length ?? 0) > 0 && (
                <div className="agent-card-tags">
                    {summary.tags.map((tag, idx) => (
                        <span key={idx} className="agent-card-tag">
                            {tag}
                        </span>
                    ))}
                </div>
            )}
            {error ? <InfoCardError>{error}</InfoCardError> : null}
            {metadataStatus === "loading" ? (
                <div className="text-xs text-secondary">Generating note and tags…</div>
            ) : null}
            {metadataStatus === "ready" ? (
                <div className="space-y-2 rounded border border-border bg-surface-soft p-2">
                    <textarea
                        className="min-h-[60px] w-full resize-none rounded border border-border bg-transparent px-2 py-1 text-xs outline-none focus:border-accent"
                        value={metadataNote}
                        aria-label="AI generated note"
                        onChange={(event) => {
                            setMetadataNote(event.target.value);
                        }}
                    />
                    <div className="flex flex-wrap gap-1">
                        {metadataTags.map((tag) => (
                            <span
                                key={tag}
                                className="rounded border border-border px-1.5 py-0.5 text-[10px] text-secondary"
                            >
                                #{tag}
                            </span>
                        ))}
                    </div>
                    <div className="flex justify-end gap-1.5">
                        <button
                            type="button"
                            className="cursor-pointer rounded border border-border px-2 py-1 text-[10px] text-secondary hover:bg-hover"
                            onClick={() => setMetadataStatus("idle")}
                        >
                            Dismiss
                        </button>
                        <button
                            type="button"
                            className="cursor-pointer rounded border border-border px-2 py-1 text-[10px] text-secondary hover:bg-hover"
                            onClick={() => void generateMetadata()}
                        >
                            Regenerate
                        </button>
                        <button
                            type="button"
                            className="cursor-pointer rounded bg-action px-2 py-1 text-[10px] text-actiontext hover:bg-actionhover"
                            onClick={() => void applyMetadata()}
                        >
                            Apply
                        </button>
                    </div>
                </div>
            ) : null}
            {metadataStatus === "error" && metadataError ? (
                <div className="space-y-1.5">
                    <InfoCardError>{metadataError}</InfoCardError>
                    <button
                        type="button"
                        className="cursor-pointer rounded border border-border px-2 py-1 text-[10px] text-secondary hover:bg-hover hover:text-primary"
                        onClick={openAIConfig}
                    >
                        Open AI settings
                    </button>
                </div>
            ) : null}
        </InfoCardSection>
    );
}
