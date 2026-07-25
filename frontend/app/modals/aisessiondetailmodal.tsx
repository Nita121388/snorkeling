// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { FlexiModal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { AISessionsServiceType } from "@/app/store/services";
import { SessionDetailController, SessionDetailPane } from "@/app/view/aisessions/session-detail";
import { dispatchAISessionNoteUpdated } from "@/app/view/aisessions/session-note-events";
import { getErrorMessage, restoreMetaForSession } from "@/app/view/aisessions/utils";
import { createBlock, getApi } from "@/store/global";
import { isBlank } from "@/util/util";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type AISessionDetailModalProps = {
    sessionId: string;
};

function AISessionDetailModal({ sessionId }: AISessionDetailModalProps) {
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
                const nextDetail = await service.Detail({ id: session.key, refresh });
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
                    id: currentSummary.key,
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
                return deltaMessages.length > 0;
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
                    return;
                }
                setToolCallsLoading(true);
                setError("");
                try {
                    const nextDetail = await service.Detail({ id: currentSummary.key, refresh, includeTools: true });
                    setDetail(nextDetail);
                } catch (e) {
                    setError(getErrorMessage(e));
                } finally {
                    setToolCallsLoading(false);
                }
            },
            loadUserLines: async (session, request = {}) => {
                if (isBlank(session?.key)) {
                    throw new Error("session id is required");
                }
                const result = await service.UserLines({
                    ...request,
                    id: session.key,
                });
                replaceSession(result.summary);
                return result;
            },
            updateNote: async (session, note, tags) => {
                if (isBlank(session?.key)) {
                    return false;
                }
                setError("");
                try {
                    const updated =
                        tags == null
                            ? await service.Note(session.key, note)
                            : await service.NoteAndTags({ id: session.key, note, tags });
                    replaceSession(updated);
                    dispatchAISessionNoteUpdated(updated);
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
                    await service.Delete(session.key);
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
                    const updated = await service.Mark(session.key, !session.marked);
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
            .Detail({ id: trimmedSessionId })
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
    }, [service, sessionId]);

    return (
        <FlexiModal
            className="h-[min(760px,calc(100vh-56px))] w-[min(1120px,calc(100vw-40px))] overflow-hidden p-0"
            onClickBackdrop={closeModal}
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
        </FlexiModal>
    );
}

AISessionDetailModal.displayName = "AISessionDetailModal";

export { AISessionDetailModal };
