// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// SessionNoteSection — InfoCard 里可复用的 note / tags 区段。
//
// 数据全部来自 useSessionNoteState（session-note-hook.ts），本组件只负责渲染：
//   - 标题 + AI 一键生成按钮（后台静默入队，不阻塞、不需要 Apply）+ 保存状态图标
//   - note 预览（点击进入编辑）或 textarea
//   - tags chips
//   - 错误提示 / note 被 AI 覆盖后的 Undo
//
// AgentHoverCard（term agent block）与 SessionDetailInfoCard（会话详情 / GUI Chat）
// 共用，避免两份 note UI 漂移。

import { createBlock } from "@/app/store/global";
import type { SessionNoteState } from "@/app/store/session-note-hook";
import { GenActionButton } from "@/app/view/aisessions/gen-action-button";
import { TitleSourceBadge } from "@/app/view/aisessions/title-source-badge";
import { UndoNoteBar, useNoteUndo, type NoteUndoSnapshot } from "@/app/view/aisessions/undo-toast";
import * as React from "react";
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
    } = state;

    const openAIConfig = React.useCallback(() => {
        void createBlock({ meta: { view: "waveconfig", file: "waveai.json" } }, false, true);
    }, []);

    const sessionKey = summary?.key ?? state.sessionId;
    const connection = state.connection ?? "";
    const undo = useNoteUndo(state.service, sessionKey, connection);
    const prevNoteRef = React.useRef<NoteUndoSnapshot | null>(null);
    const [genError, setGenError] = React.useState("");

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
                    <TitleSourceBadge titleSource={summary.titleSource} className="ml-1" />
                </InfoCardHead>
                <div className="flex shrink-0 items-center gap-0.5">
                    {/* 一键后台生成：点击即入队，worker 串行生成并直接落库。 */}
                    <GenActionButton
                        sessionKey={sessionKey}
                        connection={connection}
                        kind="title"
                        titleSource={summary.titleSource}
                        size="xs"
                        source="agent-card"
                        onError={setGenError}
                    />
                    <GenActionButton
                        sessionKey={sessionKey}
                        connection={connection}
                        kind="metadata"
                        size="xs"
                        source="agent-card"
                        onBeforeGenerate={() => {
                            prevNoteRef.current = { note: summary.note ?? "", tags: summary.tags ?? [] };
                        }}
                        onDone={() => undo.capture(prevNoteRef.current)}
                        onError={setGenError}
                    />
                </div>
            </div>
            {genError ? (
                <div className="flex items-center gap-2 text-[10px] text-warning">
                    <span className="min-w-0 flex-1 break-words">{genError}</span>
                    <button
                        type="button"
                        className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[10px] text-secondary hover:bg-hover hover:text-primary"
                        onClick={(event) => {
                            event.stopPropagation();
                            openAIConfig();
                        }}
                    >
                        Open AI settings
                    </button>
                    <button
                        type="button"
                        className="shrink-0 cursor-pointer text-secondary hover:text-primary"
                        title="Dismiss"
                        aria-label="Dismiss"
                        onClick={(event) => {
                            event.stopPropagation();
                            setGenError("");
                        }}
                    >
                        <i className="fa-sharp fa-solid fa-xmark" />
                    </button>
                </div>
            ) : null}
            <UndoNoteBar
                pending={undo.pending}
                error={undo.error}
                onUndo={() => void undo.undo()}
                onDismiss={undo.dismiss}
                className="my-0.5"
            />
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
        </InfoCardSection>
    );
}
