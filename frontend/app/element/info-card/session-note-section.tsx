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
import { PropertyList, type PropertyAddScope } from "@/app/view/aisessions/property/property-list";
import { AIPropertiesButton } from "@/app/view/aisessions/property/property-ai";
import { usePropertySchema, setPropertySchema, upsertSchemaDef } from "@/app/view/aisessions/property/property-schema";
import { patchSessionProperty, setSessionProperty } from "@/app/view/aisessions/property/property-store";
import { toPropertyDefs } from "@/app/view/aisessions/property/property-model";
import { saveSessionProps } from "@/app/store/session-note-cache";
import { useAvailableSessionTags } from "@/app/store/use-available-session-tags";
import { humanizeKey, type PropertyDef, type PropertyType, type PropertyValue } from "@/app/view/aisessions/property/property-model";
import { TitleSourceBadge } from "@/app/view/aisessions/title-source-badge";
import { EditableTitle } from "./editable-title";
import { UndoNoteBar, useNoteUndo, type NoteUndoSnapshot } from "@/app/view/aisessions/undo-toast";
import { modalsModel } from "@/app/store/modalmodel";
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
    onOpenCardDialog,
    variant = "detail",
    footerExtra,
    onRenameTitle,
}: {
    state: SessionNoteState;
    /**
     * 是否允许在卡片内联编辑属性（note 总可点进编辑）。
     * 悬浮卡用 false（hover 即预览，不把整张卡变成编辑器）；详情卡用 true。
     */
    canEditProperties?: boolean;
    /** 卡片头部放大按钮（打开整卡放大编辑弹窗）。 */
    onOpenCardDialog?: () => void;
    /**
     * 展示形态：
     *  - detail：详情卡 / 弹窗（现状，InfoCardHead + Notion 属性面板）；
     *  - hover：agent hover 卡（标题引用块 + agent 行骨架 + 单行 footer）。
     */
    variant?: "detail" | "hover";
    /** hover 卡底部右组的额外内容（session id + 复制），与 AI 按钮同一行右对齐。 */
    footerExtra?: React.ReactNode;
    /**
     * 手动改名的提交回调（可选）。
     *
     * 未提供时标题降级为**只读展示**（session-detail-info-card 等现有调用点行为不变）；
     * 由调用面（AgentHoverCard / AgentCardModal）传入 `noteState.renameTitle` 包装版本，
     * 因为只有它们持有 blockId，能完成「改名不得点亮 Done」的 ack（design.md §3.3）。
     */
    onRenameTitle?: (next: string) => Promise<unknown | null>;
}) {
    const {
        summary,
        noteDraft,
        setNoteDraft,
        isEditing,
        setIsEditing,
        inputRef,
        finishEditing,
        flushSave,
        title,
        error,
    } = state;

    const openAIConfig = React.useCallback(() => {
        void createBlock({ meta: { view: "waveconfig", file: "waveai.json" } }, false, true);
    }, []);

    const sessionKey = summary?.key ?? state.sessionId;
    // 写路径必须用 hook 建档所用的同一个 id：useSessionNoteState 的 block 侧调用方
    // （AgentHoverCard / SessionDetailInfoCard / AgentCardModal）传入的是 meta 里的
    // 裸 sessionId（agent:sessionid），note-cache 按 (sessionId, connection) 建档；
    // 而 summary.key 是完整 stable key（pi:<id>:<path>），两者不同。saveSessionNote /
    // saveSessionProps 用传入 id 查缓存拿乐观更新基线（before），传 summary.key 会
    // 查空 → "session summary not loaded" → UI 显示「保存失败」。
    // GenActionButton / AISessionNoteModal 等直接走 RPC 的路径不受影响，仍可用 sessionKey。
    const writeSessionId = state.sessionId;
    const connection = state.connection ?? "";
    // 全局标签清单（含使用次数）：给 PropertyList 的 Tags 浮层补上「别的会话用过什么标签」。
    // 首帧为空数组 → 候选池退化为「def.options + 已选值」，与接入前完全一致（渐进增强）。
    const availableTags = useAvailableSessionTags(connection, summary?.origin ?? "");
    const tagCatalog = React.useMemo<Record<string, SessionTagSummary[]>>(
        () => (availableTags.length > 0 ? { tags: availableTags } : {}),
        [availableTags]
    );
    const undo = useNoteUndo(state.service, writeSessionId, connection);

    // 弹窗编辑 Note（类似 aisessions 列表行）：App 级 modal，不渲染在卡片内。
    const openNoteDialog = React.useCallback(() => {
        modalsModel.pushModal("AISessionNoteModal", {
            sessionId: sessionKey,
            connection: connection || undefined,
        });
    }, [sessionKey, connection]);

    const prevNoteRef = React.useRef<NoteUndoSnapshot | null>(null);
    const [genError, setGenError] = React.useState("");
    const [writeError, setWriteError] = React.useState("");
    const schema = usePropertySchema();

    const writeProperty = React.useCallback(
        (def: PropertyDef, value: PropertyValue) => {
            if (summary == null) return;
            // 写失败必须说出来：以前这里 `void setSessionProperty(...)` 把返回值全丢了，
            // 用户点选/删除标签如果 RPC 失败，屏幕上只看到乐观更新后又被回滚，
            // 表现为“改了但没保存”且完全没有任何提示。
            void setSessionProperty({
                service: state.service,
                sessionId: writeSessionId,
                connection,
                summary,
                def,
                value,
            }).then((result) => {
                setWriteError(result.ok ? "" : `保存失败：${result.error}`);
            });
        },
        [connection, writeSessionId, state.service, summary]
    );

    const addProperty = React.useCallback(
        (key: string, type: PropertyType, scope: PropertyAddScope) => {
            // 新建的空属性需要非 null 初值才能落库（SetProps 把 null 当删除）。
            // 值永远只写当前会话；scope 只影响「定义」是否写进全局模板。
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
            if (scope !== "session") {
                const source = (summary?.source ?? "").trim();
                // agent 范围必须能解析出 Agent 标识；没有 source 时退化为仅此会话
                // （UI 已禁用该选项，这里再兜一层，避免写出 "agent:" 空值）。
                if (scope === "agent" && source === "") return;
                const next = upsertSchemaDef(schema, {
                    key,
                    name: humanizeKey(key),
                    type,
                    order: schema.length + 1,
                    scope: scope === "agent" ? `agent:${source}` : "",
                });
                void setPropertySchema(next);
            }
        },
        [writeProperty, schema, summary]
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

    const renameProperty = React.useCallback(
        (key: string, name: string) => {
            if (summary == null) return;
            void patchSessionProperty({
                service: state.service,
                sessionId: writeSessionId,
                connection,
                summary,
                key,
                name,
            });
        },
        [connection, writeSessionId, state.service, summary]
    );

    const retypeProperty = React.useCallback(
        (key: string, type: PropertyType) => {
            if (summary == null) return;
            void patchSessionProperty({
                service: state.service,
                sessionId: writeSessionId,
                connection,
                summary,
                key,
                type,
            });
        },
        [connection, writeSessionId, state.service, summary]
    );

    const moveProperty = React.useCallback(
        (key: string, direction: -1 | 1) => {
            if (summary == null) return;
            const defs = toPropertyDefs(summary, schema).filter(
                (entry) => !entry.def.builtin && summary.props?.[entry.def.key] != null
            );
            const index = defs.findIndex((entry) => entry.def.key === key);
            const target = index + direction;
            if (index < 0 || target < 0 || target >= defs.length) return;
            const keys = defs.map((entry) => entry.def.key);
            const tmp = keys[index];
            keys[index] = keys[target];
            keys[target] = tmp;
            const next: { [key: string]: PropertyCell } = {};
            keys.forEach((k, i) => {
                const existing = summary.props[k];
                next[k] = { ...existing, order: i + 1, updatedAt: Date.now() };
            });
            void saveSessionProps(state.service, writeSessionId, connection, next);
        },
        [connection, schema, writeSessionId, state.service, summary]
    );

    if (summary == null) {
        return null;
    }

    const titleSourceBadge = <TitleSourceBadge titleSource={summary.titleSource} className="mr-1 align-baseline" />;
    // 标题块：有 onRenameTitle 就可编辑（双击/单击进编辑），否则降级为纯展示。
    // hover 卡用 single（悬停即预览，单击改名的意图更直接）；detail 用 double（
    // 与 session-detail 头栏同一手感，避免与选中文字冲突）。
    //
    // variant="card" 让 hover 卡的标题直接复用 0.0.121 的 .agent-card-title-block
    // （12.5px / 2 行 clamp / 左侧状态色引用线），且**编辑态排版零变化** ——
    // 用户点进标题看到的是“文字变成光标”，不是“凭空多出一个表单框”。
    const titleNode =
        onRenameTitle != null ? (
            <EditableTitle
                title={title}
                titleSource={summary.titleSource}
                variant={variant === "hover" ? "card" : "inline"}
                enterToEdit={variant === "hover" ? "single" : "double"}
                onCommit={onRenameTitle}
            />
        ) : null;

    return (
        <InfoCardSection>
            {variant === "hover" ? (
                /* hover 卡：标题是卡片主体（2 行 + 状态色引用线）。
                   AI 标题 / metadata 生成属写入操作，留在详情卡与弹窗里；
                   hover 卡的 AI 入口只有 footer 的 ✨ 属性自动填充。
                   titleNode 自带 .agent-card-title-wrap + .agent-card-title-block，
                   不再包一层，否则双层 margin 会把标题推下去。 */
                titleNode != null ? (
                    titleNode
                ) : (
                    <div className="agent-card-title-wrap">
                        <div className="agent-card-title-block" title={title}>
                            {titleSourceBadge}
                            {title}
                        </div>
                    </div>
                )
            ) : (
                <div className="flex items-center justify-between gap-2">
                    {/* min-w-0 + flex-1：标题行可收缩，长会话名不再把卡片撑破。 */}
                    <InfoCardHead className="min-w-0 flex-1">
                        <InfoCardIcon icon={`fa-sharp fa-solid ${statusIcon(state)}`} />
                        {titleNode != null ? titleNode : <InfoCardMarquee text={title} />}
                        {titleNode == null ? (
                            <TitleSourceBadge titleSource={summary.titleSource} className="ml-1" />
                        ) : null}
                    </InfoCardHead>
                    <div className="flex shrink-0 items-center gap-0.5">
                        {onOpenCardDialog != null ? (
                            <button
                                type="button"
                                className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[11px] text-secondary opacity-0 transition-opacity hover:bg-hover hover:text-primary focus:opacity-100 group-hover:opacity-100"
                                title="Open card in dialog"
                                aria-label="Open card in dialog"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onOpenCardDialog();
                                }}
                            >
                                <i className="fa-sharp fa-solid fa-up-right-and-down-left-from-center" />
                            </button>
                        ) : null}
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
            )}
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
                    onBlur={
                        variant === "hover"
                            ? () => {
                                  // 悬浮卡：不要求「点卡片外部」。有未保存草稿就立即落盘（
                                  // 防抖到期与卸载兜底之外再补一条“离开输入框即存”），
                                  // 然后仅退出编辑态，不额外触发一次重复保存。
                                  flushSave();
                                  setIsEditing(false);
                              }
                            : finishEditing
                    }
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
                    layout={variant === "hover" ? "agent" : "notion"}
                    canEdit={canEditProperties}
                    schema={schema}
                    tagCatalog={tagCatalog}
                    onAddProperty={canEditProperties ? addProperty : undefined}
                    onDeleteProperty={canEditProperties ? deleteProperty : undefined}
                    onRenameProperty={canEditProperties ? renameProperty : undefined}
                    onRetypeProperty={canEditProperties ? retypeProperty : undefined}
                    onMoveProperty={canEditProperties ? moveProperty : undefined}
                    footer={
                        canEditProperties || footerExtra != null ? (
                            <>
                                {canEditProperties ? (
                                    <AIPropertiesButton
                                        service={state.service}
                                        sessionId={sessionKey}
                                        connection={connection}
                                        summary={summary}
                                        compact={variant === "hover"}
                                    />
                                ) : null}
                                {footerExtra}
                            </>
                        ) : undefined
                    }
                    onOpenNoteDialog={openNoteDialog}
                    onEditNote={() => {
                        // 弹窗 / 详情卡：走既有 AISessionNoteModal（有 AI 生成、保存状态、未保存提示）。
                        // 以前这里会 setIsEditing(true) 把整个属性列表换成 textarea，
                        // 六行属性瞬间消失且没有返回入口。
                        if (canEditProperties) {
                            openNoteDialog();
                            return;
                        }
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
            {/* 属性写失败（含标签删除）的提示：不能静默，否则用户只看到“改了又变回去”。 */}
            {writeError !== "" ? (
                <div className="flex items-center gap-2 text-[10px] text-warning" role="alert">
                    <span className="min-w-0 flex-1 break-words">{writeError}</span>
                    <button
                        type="button"
                        className="shrink-0 cursor-pointer text-secondary hover:text-primary"
                        title="Dismiss"
                        aria-label="Dismiss save error"
                        onClick={(event) => {
                            event.stopPropagation();
                            setWriteError("");
                        }}
                    >
                        <i className="fa-sharp fa-solid fa-xmark" />
                    </button>
                </div>
            ) : null}
        </InfoCardSection>
    );
}
