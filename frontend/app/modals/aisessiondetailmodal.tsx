// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { AISessionsServiceType } from "@/app/store/services";
import { SessionDetailController, SessionDetailPane } from "@/app/view/aisessions/session-detail";
import { dispatchAISessionNoteUpdated } from "@/app/view/aisessions/session-note-events";
import { getErrorMessage, restoreMetaForSession } from "@/app/view/aisessions/utils";
import { createBlock, getApi } from "@/store/global";
import { isBlank } from "@/util/util";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** 归一化会话所属 origin："local" / 空 = 本机；其余为外部 dump id。 */
function originOf(session: SessionSummary | null | undefined): string {
    const tagged = (session?.origin ?? "").trim();
    return tagged === "" || tagged === "local" ? "" : tagged;
}

type AISessionDetailModalProps = {
    sessionId: string;
    /** 打开方的连接（远端块）。缺省时 Detail 会按 key 的 remote 段路由。 */
    connection?: string;
    /** 打开方的 origin（外部 dump）。不传就可能落到本机 manager。 */
    origin?: string;
};

/** Detail / DetailDelta / DetailTools 的查询范围。 */
export type SessionDetailRequestScope = {
    id: string;
    connection?: string;
    origin?: string;
};

function normalizeScopeOrigin(value?: string | null): string {
    const trimmed = (value ?? "").trim();
    return trimmed === "" || trimmed === "local" ? "" : trimmed;
}

/**
 * 统一算一次查询的 scope：已加载 summary 的 origin 标签优先（后端在外部 origin 下回填），
 * 没有标签时用打开方传入的 scope。connection 只能来自打开方（summary 不带 connection）。
 */
export function detailRequestScope(
    session: SessionSummary | null | undefined,
    fallback?: { connection?: string | null; origin?: string | null }
): SessionDetailRequestScope {
    const id = (session?.key ?? "").trim();
    const summaryOrigin = (session?.origin ?? "").trim();
    const origin =
        summaryOrigin !== "" ? normalizeScopeOrigin(summaryOrigin) : normalizeScopeOrigin(fallback?.origin);
    const connection = (fallback?.connection ?? "").trim();
    const scope: SessionDetailRequestScope = { id };
    if (connection !== "") {
        scope.connection = connection;
    }
    if (origin !== "") {
        scope.origin = origin;
    }
    return scope;
}

function AISessionDetailModal({ sessionId, connection, origin }: AISessionDetailModalProps) {
    const service = useMemo(() => new AISessionsServiceType(), []);
    const [detail, setDetail] = useState<SessionDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [deltaLoading, setDeltaLoading] = useState(false);
    const [toolCallsLoading, setToolCallsLoading] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState("");
    const detailRef = useRef<SessionDetail | null>(null);
    const detailLoadSeqRef = useRef(0);
    const selectedKeyRef = useRef("");
    // 打开方传入的查询范围：summary 还没有 origin 标签时靠它兜底。
    const openerScope = useMemo(() => ({ connection, origin }), [connection, origin]);

    const closeModal = useCallback(() => {
        modalsModel.popModal();
    }, []);

    useEffect(() => {
        detailRef.current = detail;
        selectedKeyRef.current = detail?.summary?.key ?? "";
    }, [detail]);

    const replaceSession = useCallback((updated: SessionSummary) => {
        setDetail((current) =>
            current?.summary?.key === updated.key
                ? { ...current, summary: { ...current.summary, ...updated } }
                : current
        );
    }, []);

    const mergeDeltaSummary = useCallback((current: SessionSummary, deltaSummary?: SessionSummary): SessionSummary => {
        if (deltaSummary == null) {
            return current;
        }
        return {
            ...current,
            source: deltaSummary.source || current.source,
            filePath: deltaSummary.filePath || current.filePath,
            messageCount:
                typeof deltaSummary.messageCount === "number" ? deltaSummary.messageCount : current.messageCount,
        };
    }, []);

    const applyDetailDelta = useCallback(
        (sessionKey: string, delta: MessageDelta) => {
            setDetail((current) => {
                if (current?.summary?.key !== sessionKey) {
                    return current;
                }
                const existingSeqs = new Set((current.messages ?? []).map((message) => message.seq));
                const nextMessages = [
                    ...(current.messages ?? []),
                    ...(delta.messages ?? []).filter((message) => !existingSeqs.has(message.seq)),
                ];
                return {
                    ...current,
                    summary: mergeDeltaSummary(current.summary, delta.summary),
                    messages: nextMessages,
                    cursor: delta.cursor ?? current.cursor,
                };
            });
        },
        [mergeDeltaSummary]
    );

    const loadDetail = useCallback(
        async (session: SessionSummary, refresh = false) => {
            if (isBlank(session?.key)) {
                setDetail(null);
                return;
            }
            const loadSeq = ++detailLoadSeqRef.current;
            setLoading(true);
            setError("");
            try {
                const nextDetail = await service.Detail({
                    ...detailRequestScope(session, openerScope),
                    refresh,
                    includeTools: true,
                });
                if (loadSeq === detailLoadSeqRef.current) {
                    setDetail(nextDetail);
                }
            } catch (e) {
                if (loadSeq === detailLoadSeqRef.current) {
                    setError(getErrorMessage(e));
                }
            } finally {
                if (loadSeq === detailLoadSeqRef.current) {
                    setLoading(false);
                }
            }
        },
        [service]
    );

    const loadDetailDeltaRef = useRef<((reason?: "manual" | "bottom") => Promise<boolean>) | null>(null);
    const loadDetailDelta = useCallback(
        async (reason: "manual" | "bottom" = "manual"): Promise<boolean> => {
            const currentDetail = detailRef.current;
            const currentSummary = currentDetail?.summary;
            const cursor = currentDetail?.cursor;
            if (isBlank(currentSummary?.key) || cursor == null) {
                if (currentSummary != null) {
                    await loadDetail(currentSummary, true);
                    return true;
                }
                return false;
            }
            if (deltaLoading || loading) {
                return false;
            }
            const loadSeq = detailLoadSeqRef.current;
            setDeltaLoading(true);
            setError("");
            try {
                const delta = await service.DetailDelta({
                    ...detailRequestScope(currentSummary, openerScope),
                    source: currentSummary.source,
                    filePath: currentSummary.filePath,
                    cursor,
                    messageCount: currentSummary.messageCount,
                });
                if (loadSeq !== detailLoadSeqRef.current || selectedKeyRef.current !== currentSummary.key) {
                    return false;
                }
                if (delta.resetRequired) {
                    await loadDetail(currentSummary, true);
                    return true;
                }
                const deltaMessages = delta.messages ?? [];
                const cursorAdvanced = (delta.cursor?.byteOffset ?? cursor.byteOffset ?? 0) > (cursor.byteOffset ?? 0);
                applyDetailDelta(currentSummary.key, delta);
                if (delta.hasMore && reason === "bottom" && (cursorAdvanced || deltaMessages.length > 0)) {
                    window.setTimeout(() => {
                        void loadDetailDeltaRef.current?.("bottom");
                    }, 0);
                }
                return true;
            } catch (e) {
                if (loadSeq === detailLoadSeqRef.current) {
                    setError(getErrorMessage(e));
                }
                return false;
            } finally {
                setDeltaLoading(false);
            }
        },
        [applyDetailDelta, deltaLoading, loadDetail, loading, service]
    );

    useEffect(() => {
        loadDetailDeltaRef.current = loadDetailDelta;
    }, [loadDetailDelta]);

    const controller = useMemo<SessionDetailController>(
        () => ({
            loadDetail,
            loadDetailDelta,
            loadDetailTools: async (refresh = false) => {
                const currentSummary = detailRef.current?.summary;
                if (isBlank(currentSummary?.key)) {
                    return false;
                }
                setToolCallsLoading(true);
                setError("");
                try {
                    const nextDetail = await service.Detail({
                        ...detailRequestScope(currentSummary, openerScope),
                        refresh,
                        includeTools: true,
                    });
                    setDetail(nextDetail);
                    return true;
                } catch (e) {
                    setError(getErrorMessage(e));
                    return false;
                } finally {
                    setToolCallsLoading(false);
                }
            },
            updateNote: async (session, note, tags) => {
                if (isBlank(session?.key)) {
                    return false;
                }
                setError("");
                try {
                    const updated =
                        tags == null
                            ? await service.Note(session.key, note, originOf(session))
                            : await service.NoteAndTags({ id: session.key, note, tags, origin: originOf(session) });
                    replaceSession(updated);
                    dispatchAISessionNoteUpdated(updated);
                    return true;
                } catch (e) {
                    setError(getErrorMessage(e));
                    return false;
                }
            },
            updateTitle: async (session, title) => {
                if (isBlank(session?.key)) {
                    return false;
                }
                setError("");
                try {
                    const updated = await service.Title(session.key, title, originOf(session));
                    replaceSession(updated);
                    return true;
                } catch (e) {
                    setError(getErrorMessage(e));
                    return false;
                }
            },
            deleteSession: async (session) => {
                if (isBlank(session?.key)) {
                    return;
                }
                setDeleting(true);
                setError("");
                try {
                    await service.Delete(session.key, originOf(session));
                    setDetail(null);
                } catch (e) {
                    setError(getErrorMessage(e));
                } finally {
                    setDeleting(false);
                }
            },
            restoreSession: async (session) => {
                if (isBlank(session?.id) || isBlank(session?.source)) {
                    return;
                }
                setRestoring(true);
                setError("");
                try {
                    const context = await service.RestoreContext({ id: session.key || session.id });
                    await createBlock({ meta: restoreMetaForSession(context) });
                } catch (e) {
                    setError(getErrorMessage(e));
                } finally {
                    setRestoring(false);
                }
            },
            openProjectDirectory: async (summary) => {
                const projectDirectory = summary.projectPath?.trim() ?? "";
                if (isBlank(projectDirectory)) {
                    return;
                }
                try {
                    await createBlock({
                        meta: {
                            view: "preview",
                            file: projectDirectory,
                        },
                    });
                } catch (e) {
                    setError(getErrorMessage(e));
                }
            },
            openSessionFile: async (summary) => {
                const sessionFilePath = summary.filePath?.trim() ?? "";
                if (isBlank(sessionFilePath)) {
                    return;
                }
                getApi().openNativePath(sessionFilePath);
            },
            toggleMark: async (session) => {
                if (isBlank(session?.key)) {
                    return;
                }
                setError("");
                try {
                    const updated = await service.Mark(session.key, !session.marked, originOf(session));
                    replaceSession(updated);
                } catch (e) {
                    setError(getErrorMessage(e));
                }
            },
        }),
        [loadDetail, loadDetailDelta, replaceSession, service]
    );

    useEffect(() => {
        const trimmedSessionId = sessionId.trim();
        if (trimmedSessionId === "") {
            setError("Missing session ID.");
            setLoading(false);
            return;
        }
        let cancelled = false;
        const loadSeq = ++detailLoadSeqRef.current;
        setLoading(true);
        setError("");
        service
            .Detail({ id: trimmedSessionId, connection: connection?.trim() || undefined, origin: origin?.trim() || undefined, includeTools: true })
            .then((nextDetail) => {
                if (!cancelled && loadSeq === detailLoadSeqRef.current) {
                    setDetail(nextDetail);
                }
            })
            .catch((e) => {
                if (!cancelled && loadSeq === detailLoadSeqRef.current) {
                    setError(getErrorMessage(e));
                }
            })
            .finally(() => {
                if (!cancelled && loadSeq === detailLoadSeqRef.current) {
                    setLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [connection, origin, service, sessionId]);

    return (
        <Modal
            className="h-[min(760px,calc(100vh-56px))] w-[min(1120px,calc(100vw-40px))] overflow-hidden p-0"
            onClickBackdrop={closeModal}
            // 自带 p-0 全屏面板 + 内部自有滚动容器（会话详情虚拟列表）。
            padding={false}
            scrollBody={false}
        >
            <div className="flex h-full min-h-0 w-full flex-col bg-panel text-primary">
                {error ? (
                    <div className="shrink-0 border-b border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
                        {error}
                    </div>
                ) : null}
                <div className="flex h-full min-h-0 flex-1 flex-col">
                    <SessionDetailPane
                        model={controller}
                        detail={detail}
                        loading={loading}
                        deltaLoading={deltaLoading}
                        toolCallsLoading={toolCallsLoading}
                        restoring={restoring}
                        deleting={deleting}
                        onClose={closeModal}
                    />
                </div>
            </div>
        </Modal>
    );
}

AISessionDetailModal.displayName = "AISessionDetailModal";

export { AISessionDetailModal };
