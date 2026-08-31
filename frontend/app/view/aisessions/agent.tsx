// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Agent Block — 独立的 agent 聊天界面，只包含聊天详情，不包含 session 列表。
// 用于右侧 Widgets 中点击 Agent 时创建。

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { AISessionsServiceType } from "@/app/store/services";
import type { TabModel } from "@/app/store/tab-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveEnv } from "@/app/waveenv/waveenv";
import { globalStore } from "@/store/jotaiStore";
import * as jotai from "jotai";
import { useCallback, useEffect } from "react";
import { SessionDetailPane, type SessionDetailController } from "./session-detail";
import { defaultChatSource } from "./sources";
import {
    AiSessionNoteUpdatedEvent,
    dispatchAISessionNoteUpdated,
    isAISessionNoteUpdatedEvent,
} from "./session-note-events";
import { NewSessionKey } from "./types";
import {
    getErrorMessage,
    restoreMetaForSession,
} from "./utils";

export class AgentViewModel implements ViewModel {
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    env: WaveEnv;
    service: AISessionsServiceType;
    blockAtom: jotai.Atom<Block>;
    viewType = "agent";
    viewIcon = jotai.atom("robot");
    viewName = jotai.atom("Agent");
    noPadding = jotai.atom(true);

    // 会话详情相关状态
    detailAtom: jotai.PrimitiveAtom<SessionDetail | null> = jotai.atom(
        null
    ) as jotai.PrimitiveAtom<SessionDetail | null>;
    selectedKeyAtom = jotai.atom<string>("");
    loadingAtom = jotai.atom<boolean>(false);
    detailLoadingAtom = jotai.atom<boolean>(false);
    detailDeltaLoadingAtom = jotai.atom<boolean>(false);
    toolCallsLoadingAtom = jotai.atom<boolean>(false);
    errorAtom = jotai.atom<string>("");
    restoringAtom = jotai.atom<boolean>(false);
    deletingAtom = jotai.atom<boolean>(false);
    newSessionAtom: jotai.PrimitiveAtom<SessionSummary | null> = jotai.atom(null) as jotai.PrimitiveAtom<
        SessionSummary | null
    >;
    newChatEpochAtom = jotai.atom(0);

    // 用于 SessionDetailController 的加载序列
    detailLoadSeq = 0;
    detailToolsLoadSeq = 0;

    constructor({ blockId, nodeModel, tabModel, waveEnv }: ViewModelInitType) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.env = waveEnv;
        this.service = new AISessionsServiceType(waveEnv);
        this.blockAtom = this.env.wos.getWaveObjectAtom<Block>(`block:${blockId}`);
    }

    get viewComponent(): ViewComponent {
        return AgentView;
    }

    getConnection(): string {
        const blockData = globalStore.get(this.blockAtom);
        const connection = blockData?.meta?.connection;
        return typeof connection === "string" ? connection.trim() : "";
    }

    getBoundSessionId(): string {
        const blockData = globalStore.get(this.blockAtom);
        const meta = (blockData?.meta ?? {}) as Record<string, unknown>;
        const sessionId = meta["aisessions:sessionid"] ?? meta["agent:sessionid"];
        return typeof sessionId === "string" ? sessionId.trim() : "";
    }

    shouldAutoStartNewChat(): boolean {
        const blockData = globalStore.get(this.blockAtom);
        return (blockData?.meta as Record<string, unknown> | undefined)?.["aisessions:newchat"] === true;
    }

    // 启动新会话
    startNewSession(): void {
        const existing = globalStore.get(this.newSessionAtom);
        globalStore.set(this.newChatEpochAtom, globalStore.get(this.newChatEpochAtom) + 1);
        if (existing != null) {
            globalStore.set(this.selectedKeyAtom, NewSessionKey);
            globalStore.set(this.detailAtom, null);
            return;
        }
        globalStore.set(this.newSessionAtom, {
            key: NewSessionKey,
            id: "",
            source: defaultChatSource().id,
            title: "New Chat",
        });
        globalStore.set(this.selectedKeyAtom, NewSessionKey);
        globalStore.set(this.detailAtom, null);
    }

    // 当聊天流报告新分配的 session id 时调用
    bindNewSession(sessionId: string): void {
        const placeholder = globalStore.get(this.newSessionAtom);
        if (placeholder == null || placeholder.id !== "" || sessionId === "") return;
        globalStore.set(this.newSessionAtom, { ...placeholder, id: sessionId });
        void RpcApi.SetMetaCommand(TabRpcClient, {
            oref: `block:${this.blockId}`,
            meta: {
                "aisessions:sessionid": sessionId,
                "aisessions:newchat": null,
            } as MetaType,
        }).catch(() => undefined);
        void this.promoteNewSession(sessionId);
    }

    async promoteNewSession(sessionId: string): Promise<void> {
        try {
            const summary = await this.service.Summary({
                id: sessionId,
                connection: this.getConnection(),
                refresh: true,
            });
            const placeholder = globalStore.get(this.newSessionAtom);
            if (placeholder == null || placeholder.id !== sessionId) return;
            globalStore.set(this.newSessionAtom, null);
            globalStore.set(this.selectedKeyAtom, summary.key);
            globalStore.set(this.detailAtom, null);
            void this.loadDetail(summary, true);
        } catch {
            // 忽略错误
        }
    }

    async loadDetail(session: SessionSummary, refresh = false): Promise<void> {
        if (!session?.key) {
            globalStore.set(this.detailAtom, null);
            return;
        }
        const loadSeq = ++this.detailLoadSeq;
        globalStore.set(this.selectedKeyAtom, session.key);
        globalStore.set(this.detailLoadingAtom, true);
        globalStore.set(this.errorAtom, "");
        try {
            const detail = await this.service.Detail({
                id: session.key,
                connection: this.getConnection(),
                refresh,
                includeTools: true,
            });
            if (loadSeq !== this.detailLoadSeq || globalStore.get(this.selectedKeyAtom) !== session.key) {
                return;
            }
            globalStore.set(this.detailAtom, detail);
        } catch (e) {
            if (loadSeq === this.detailLoadSeq) {
                globalStore.set(this.errorAtom, getErrorMessage(e));
            }
        } finally {
            if (loadSeq === this.detailLoadSeq) {
                globalStore.set(this.detailLoadingAtom, false);
            }
        }
    }

    async loadDetailDelta(reason: "manual" | "bottom" = "manual"): Promise<boolean> {
        const currentDetail = globalStore.get(this.detailAtom);
        const currentSummary = currentDetail?.summary;
        const cursor = currentDetail?.cursor;
        if (!currentSummary?.key || cursor == null) {
            if (currentSummary != null) {
                await this.loadDetail(currentSummary, true);
                return true;
            }
            return false;
        }
        if (globalStore.get(this.detailDeltaLoadingAtom) || globalStore.get(this.detailLoadingAtom)) {
            return false;
        }
        const loadSeq = this.detailLoadSeq;
        globalStore.set(this.detailDeltaLoadingAtom, true);
        globalStore.set(this.errorAtom, "");
        try {
            const delta = await this.service.DetailDelta({
                id: currentSummary.key,
                connection: this.getConnection(),
                source: currentSummary.source,
                filePath: currentSummary.filePath,
                cursor,
                messageCount: currentSummary.messageCount,
            });
            if (loadSeq !== this.detailLoadSeq || globalStore.get(this.selectedKeyAtom) !== currentSummary.key) {
                return false;
            }
            if (delta.resetRequired) {
                await this.loadDetail(currentSummary, true);
                return true;
            }
            const deltaMessages = delta.messages ?? [];
            const cursorAdvanced = (delta.cursor?.byteOffset ?? cursor.byteOffset ?? 0) > (cursor.byteOffset ?? 0);
            this.applyDetailDelta(currentSummary.key, delta);
            if (delta.hasMore && reason === "bottom" && (cursorAdvanced || deltaMessages.length > 0)) {
                window.setTimeout(() => {
                    void this.loadDetailDelta("bottom");
                }, 0);
            }
            return true;
        } catch (e) {
            if (loadSeq === this.detailLoadSeq) {
                globalStore.set(this.errorAtom, getErrorMessage(e));
            }
            return false;
        } finally {
            globalStore.set(this.detailDeltaLoadingAtom, false);
        }
    }

    applyDetailDelta(sessionKey: string, delta: MessageDelta): void {
        const detail = globalStore.get(this.detailAtom);
        if (detail?.summary?.key !== sessionKey) {
            return;
        }
        const existingSeqs = new Set((detail.messages ?? []).map((message) => message.seq));
        const nextMessages = [
            ...(detail.messages ?? []),
            ...(delta.messages ?? []).filter((message) => !existingSeqs.has(message.seq)),
        ];
        const nextSummary = {
            ...detail.summary,
            source: delta.summary?.source || detail.summary.source,
            filePath: delta.summary?.filePath || detail.summary.filePath,
            messageCount:
                typeof delta.summary?.messageCount === "number"
                    ? delta.summary.messageCount
                    : detail.summary.messageCount,
        };
        const nextDetail: SessionDetail = {
            ...detail,
            summary: nextSummary,
            messages: nextMessages,
            cursor: delta.cursor ?? detail.cursor,
        };
        globalStore.set(this.detailAtom, nextDetail);
    }

    async loadDetailTools(refresh = false): Promise<boolean> {
        const currentDetail = globalStore.get(this.detailAtom);
        const currentSummary = currentDetail?.summary;
        if (!currentSummary?.key) {
            return false;
        }
        const loadSeq = ++this.detailToolsLoadSeq;
        const selectedKey = globalStore.get(this.selectedKeyAtom);
        globalStore.set(this.toolCallsLoadingAtom, true);
        globalStore.set(this.errorAtom, "");
        try {
            const detail = await this.service.Detail({
                id: currentSummary.key,
                connection: this.getConnection(),
                refresh,
                includeTools: true,
            });
            const latest = globalStore.get(this.detailAtom);
            if (
                loadSeq !== this.detailToolsLoadSeq ||
                globalStore.get(this.selectedKeyAtom) !== selectedKey ||
                latest?.summary?.key !== currentSummary.key
            ) {
                return false;
            }
            globalStore.set(this.detailAtom, detail);
            return true;
        } catch (e) {
            if (loadSeq === this.detailToolsLoadSeq && globalStore.get(this.selectedKeyAtom) === selectedKey) {
                globalStore.set(this.errorAtom, getErrorMessage(e));
            }
            return false;
        } finally {
            if (loadSeq === this.detailToolsLoadSeq) {
                globalStore.set(this.toolCallsLoadingAtom, false);
            }
        }
    }

    async refreshBoundSessionSummary(): Promise<void> {
        const boundSessionId = this.getBoundSessionId();
        if (boundSessionId === "") return;
        try {
            const summary = await this.service.Summary({
                id: boundSessionId,
                connection: this.getConnection(),
                refresh: false,
            });
            this.replaceSession(summary);
        } catch {
            return;
        }
    }

    async loadDetailById(sessionId: string, refresh = false): Promise<boolean> {
        const trimmedSessionId = sessionId.trim();
        if (trimmedSessionId === "") return false;
        globalStore.set(this.selectedKeyAtom, trimmedSessionId);
        globalStore.set(this.detailLoadingAtom, true);
        globalStore.set(this.errorAtom, "");
        try {
            const detail = await this.service.Detail({
                id: trimmedSessionId,
                connection: this.getConnection(),
                refresh,
                includeTools: true,
            });
            globalStore.set(this.selectedKeyAtom, detail.summary.key);
            globalStore.set(this.detailAtom, detail);
            return true;
        } catch (e) {
            globalStore.set(this.errorAtom, getErrorMessage(e));
            return false;
        } finally {
            globalStore.set(this.detailLoadingAtom, false);
        }
    }

    async toggleMark(session: SessionSummary): Promise<void> {
        if (!session?.key) return;
        const currentDetail = globalStore.get(this.detailAtom);
        const currentSession = currentDetail?.summary?.key === session.key ? currentDetail.summary : session;
        const nextMarked = !currentSession.marked;
        globalStore.set(this.errorAtom, "");
        try {
            const updated = await this.service.Mark(session.key, nextMarked);
            this.replaceSession(updated);
        } catch (e) {
            globalStore.set(this.errorAtom, getErrorMessage(e));
        }
    }

    async updateNote(session: SessionSummary, note: string, tags?: string[]): Promise<boolean> {
        if (!session?.key) return false;
        try {
            const updated =
                tags == null
                    ? await this.service.Note(session.key, note)
                    : await this.service.NoteAndTags({ id: session.key, note, tags });
            this.replaceSession(updated);
            dispatchAISessionNoteUpdated(updated);
            return true;
        } catch (e) {
            globalStore.set(this.errorAtom, getErrorMessage(e));
            return false;
        }
    }

    async updateTitle(session: SessionSummary, title: string): Promise<boolean> {
        if (!session?.key) return false;
        try {
            const updated = await this.service.Title(session.key, title);
            this.replaceSession(updated);
            return true;
        } catch (e) {
            globalStore.set(this.errorAtom, getErrorMessage(e));
            return false;
        }
    }

    async deleteSession(session: SessionSummary): Promise<void> {
        if (!session?.key) return;
        globalStore.set(this.deletingAtom, true);
        globalStore.set(this.errorAtom, "");
        try {
            await this.service.Delete(session.key);
            globalStore.set(this.detailAtom, null);
            globalStore.set(this.selectedKeyAtom, "");
            globalStore.set(this.newSessionAtom, null);
            // 启动新会话
            this.startNewSession();
        } catch (e) {
            globalStore.set(this.errorAtom, getErrorMessage(e));
        } finally {
            globalStore.set(this.deletingAtom, false);
        }
    }

    async restoreSession(session: SessionSummary): Promise<void> {
        if (!session?.id || !session?.source) return;
        globalStore.set(this.restoringAtom, true);
        globalStore.set(this.errorAtom, "");
        try {
            const context = await this.service.RestoreContext({
                id: session.key || session.id,
                connection: this.getConnection(),
            });
            const { createBlock } = await import("@/store/global");
            await createBlock({
                meta: restoreMetaForSession(context),
            });
        } catch (e) {
            globalStore.set(this.errorAtom, getErrorMessage(e));
        } finally {
            globalStore.set(this.restoringAtom, false);
        }
    }

    async openProjectDirectory(summary: SessionSummary): Promise<void> {
        const projectDirectory = summary.projectPath?.trim() ?? "";
        if (!projectDirectory) return;
        const blockDef: BlockDef = {
            meta: {
                view: "preview",
                file: projectDirectory,
            },
        };
        const connection = this.getConnection();
        if (connection !== "") {
            blockDef.meta.connection = connection;
        }
        const { createBlockSplitHorizontally } = await import("@/store/global");
        try {
            await createBlockSplitHorizontally(blockDef, this.blockId, "after");
        } catch (e) {
            const { createBlock } = await import("@/store/global");
            await createBlock(blockDef);
        }
    }

    async openSessionFile(summary: SessionSummary): Promise<void> {
        const sessionFilePath = summary.filePath?.trim() ?? "";
        if (!sessionFilePath) return;
        this.env.electron.openNativePath(sessionFilePath);
    }

    replaceSession(updated: SessionSummary): void {
        const detail = globalStore.get(this.detailAtom);
        if (detail?.summary?.key === updated.key) {
            globalStore.set(this.detailAtom, { ...detail, summary: { ...detail.summary, ...updated } });
        }
    }

    // 实现 SessionDetailController 接口
    get detailController(): SessionDetailController {
        return {
            loadDetail: this.loadDetail.bind(this),
            loadDetailDelta: this.loadDetailDelta.bind(this),
            loadDetailTools: this.loadDetailTools.bind(this),
            updateNote: this.updateNote.bind(this),
            updateTitle: this.updateTitle.bind(this),
            deleteSession: this.deleteSession.bind(this),
            restoreSession: this.restoreSession.bind(this),
            openProjectDirectory: this.openProjectDirectory.bind(this),
            openSessionFile: this.openSessionFile.bind(this),
            toggleMark: this.toggleMark.bind(this),
        };
    }
}

function AgentView({ model }: ViewComponentProps<AgentViewModel>) {
    const detail = jotai.useAtomValue(model.detailAtom);
    const newChatEpoch = jotai.useAtomValue(model.newChatEpochAtom);
    const selectedKey = jotai.useAtomValue(model.selectedKeyAtom);
    const loading = jotai.useAtomValue(model.loadingAtom);
    const detailLoading = jotai.useAtomValue(model.detailLoadingAtom);
    const detailDeltaLoading = jotai.useAtomValue(model.detailDeltaLoadingAtom);
    const toolCallsLoading = jotai.useAtomValue(model.toolCallsLoadingAtom);
    const error = jotai.useAtomValue(model.errorAtom);
    const restoring = jotai.useAtomValue(model.restoringAtom);
    const deleting = jotai.useAtomValue(model.deletingAtom);

    const isNewChat = selectedKey === NewSessionKey;

    // 初始化：如果绑定了 session，加载详情；否则启动新会话
    useEffect(() => {
        const boundSessionId = model.getBoundSessionId();
        if (boundSessionId !== "") {
            void model.loadDetailById(boundSessionId);
        } else if (model.shouldAutoStartNewChat()) {
            model.startNewSession();
        } else {
            model.startNewSession();
        }
    }, [model]);

    // 监听笔记更新事件
    useEffect(() => {
        const handleNoteUpdated = (event: Event) => {
            if (isAISessionNoteUpdatedEvent(event)) {
                model.replaceSession(event.detail.summary);
            }
        };
        window.addEventListener(AiSessionNoteUpdatedEvent, handleNoteUpdated);
        return () => window.removeEventListener(AiSessionNoteUpdatedEvent, handleNoteUpdated);
    }, [model]);

    const handleBound = useCallback(
        (sessionId: string) => {
            model.bindNewSession(sessionId);
        },
        [model]
    );

    return (
        <div className="flex h-full w-full min-h-0 flex-col bg-panel text-primary">
            {error ? (
                <div className="shrink-0 border-b border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
                    {error}
                </div>
            ) : null}
            <SessionDetailPane
                model={model.detailController}
                detail={detail}
                isNewChat={isNewChat}
                newChatEpoch={newChatEpoch}
                loading={
                    error === "" &&
                    (loading ||
                        detailLoading ||
                        (isNewChat
                            ? false
                            : detail?.summary?.key !== selectedKey && selectedKey !== ""))
                }
                deltaLoading={detailDeltaLoading}
                toolCallsLoading={toolCallsLoading}
                restoring={restoring}
                deleting={deleting}
                onBound={handleBound}
            />
        </div>
    );
}
