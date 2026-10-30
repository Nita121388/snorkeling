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
import { PropertyList } from "@/app/view/aisessions/property/property-list";
import { setSessionProperty } from "@/app/view/aisessions/property/property-store";
import { humanizeKey, type PropertyDef, type PropertyType, type PropertyValue } from "@/app/view/aisessions/property/property-model";
import { TitleSourceBadge } from "@/app/view/aisessions/title-source-badge";
import { UndoNoteBar, useNoteUndo, type NoteUndoSnapshot } from "@/app/view/aisessions/undo-toast";
import * as React from "react";
import {
    InfoCardError,
    InfoCardHead,
    InfoCardIcon,
    InfoCardInput,
    InfoCardSection,
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

export function SessionNoteSection({
    state,
    canEditProperties = false,
}: {
    state: SessionNoteState;
    /**
     * 是否允许在卡片内联编辑属性（note 总可点进编辑）。
     * 悬浮卡用 false（hover 即预览，不把整张卡变成编辑器）；详情卡用 true。
     */
    canEditProperties?: boolean;
}) {
    const {
        summary,
        noteDraft,
        setNoteDraft,
        isEditing,
        setIsEditing,
        inputRef,
        finishEditing,
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

    const writeProperty = React.useCallback(
        (def: PropertyDef, value: PropertyValue) => {
            if (summary == null) return;
            void setSessionProperty({
                service: state.service,
                sessionId: sessionKey,
                connection,
                summary,
                def,
                value,
            });
        },
        [connection, sessionKey, state.service, summary]
    );

    const addProperty = React.useCallback(
        (key: string, type: PropertyType) => {
            // 新建的空属性需要非 null 初值才能落库（SetProps 把 null 当删除）。
            const initial: PropertyValue =
                type === "multi_select" || type === "person" || type === "relation"
                    ? []
                    : type === "checkbox"
                      ? false
                      : "";
            writeProperty(
                { key, name: humanizeKey(key), type, order: 100, scope: "session", builtin: false },
                initial
            );
        },
        [writeProperty]
    );

    const deleteProperty = React.useCallback(
        (key: string) => {
            writeProperty(
                { key, name: humanizeKey(key), type: "text", order: 100, scope: "session", builtin: false },
                null
            );
        },
        [writeProperty]
    );

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
                        origin={summary.origin ?? ""}
                        kind="title"
                        titleSource={summary.titleSource}
                        size="xs"
                        source="agent-card"
                        onError={setGenError}
                    />
                    <GenActionButton
                        sessionKey={sessionKey}
                        connection={connection}
                        origin={summary.origin ?? ""}
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
                <PropertyList
                    summary={summary}
                    mode={canEditProperties ? "detail" : "card"}
                    canEdit={canEditProperties}
                    onAddProperty={canEditProperties ? addProperty : undefined}
                    onDeleteProperty={canEditProperties ? deleteProperty : undefined}
                    onEditNote={() => {
                        setIsEditing(true);
                        window.setTimeout(() => {
                            inputRef.current?.focus();
                            inputRef.current?.setSelectionRange(noteDraft.length, noteDraft.length);
                        }, 0);
                    }}
                    onChange={(key, value, def) => writeProperty(def, value)}
                />
            )}
            {error ? <InfoCardError>{error}</InfoCardError> : null}
        </InfoCardSection>
    );
}
