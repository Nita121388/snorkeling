// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { FlexiModal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { AISessionsServiceType } from "@/app/store/services";
import { SessionDetailController, SessionDetailPane } from "@/app/view/aisessions/session-detail";
import { dispatchAISessionNoteUpdated } from "@/app/view/aisessions/session-note-events";
import { dirname, getErrorMessage } from "@/app/view/aisessions/utils";
import { createBlock } from "@/store/global";
import { isBlank } from "@/util/util";
import { useCallback, useEffect, useMemo, useState } from "react";

type AISessionDetailModalProps = {
    sessionId: string;
};

function AISessionDetailModal({ sessionId }: AISessionDetailModalProps) {
    const service = useMemo(() => new AISessionsServiceType(), []);
    const [detail, setDetail] = useState<SessionDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [toolCallsLoading, setToolCallsLoading] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState("");

    const closeModal = useCallback(() => {
        modalsModel.popModal();
    }, []);

    const replaceSession = useCallback((updated: SessionSummary) => {
        setDetail((current) =>
            current?.summary?.key === updated.key
                ? { ...current, summary: { ...current.summary, ...updated } }
                : current
        );
    }, []);

    const controller = useMemo<SessionDetailController>(
        () => ({
            loadDetail: async (session, refresh = false) => {
                if (isBlank(session?.key)) {
                    setDetail(null);
                    return;
                }
                setLoading(true);
                setError("");
                try {
                    const nextDetail = await service.Detail({ id: session.key, refresh });
                    setDetail(nextDetail);
                } catch (e) {
                    setError(getErrorMessage(e));
                } finally {
                    setLoading(false);
                }
            },
            loadDetailTools: async (refresh = false) => {
                const currentSummary = detail?.summary;
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
            updateNote: async (session, note) => {
                if (isBlank(session?.key)) {
                    return false;
                }
                setError("");
                try {
                    const updated = await service.Note(session.key, note);
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
                    const cmd = session.source === "claude" ? "claude" : "codex";
                    const meta: MetaType & Record<string, unknown> = {
                        view: "term",
                        controller: "cmd",
                        cmd,
                        "cmd:shell": false,
                        "cmd:runonstart": true,
                        "agent:autoresume": true,
                        "agent:provider": session.source,
                        "agent:sessionid": session.id,
                    };
                    if (session.projectPath) {
                        meta["cmd:cwd"] = session.projectPath;
                    }
                    await createBlock({ meta });
                } catch (e) {
                    setError(getErrorMessage(e));
                } finally {
                    setRestoring(false);
                }
            },
            openSessionFolder: async (summary) => {
                const folderPath = summary.projectPath || dirname(summary.filePath);
                if (isBlank(folderPath)) {
                    return;
                }
                try {
                    await createBlock({
                        meta: {
                            view: "preview",
                            file: folderPath,
                        },
                    });
                } catch (e) {
                    setError(getErrorMessage(e));
                }
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
        [detail?.summary, replaceSession, service]
    );

    useEffect(() => {
        const trimmedSessionId = sessionId.trim();
        if (trimmedSessionId === "") {
            setError("Missing session ID.");
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError("");
        service
            .Detail({ id: trimmedSessionId })
            .then((nextDetail) => {
                if (!cancelled) {
                    setDetail(nextDetail);
                }
            })
            .catch((e) => {
                if (!cancelled) {
                    setError(getErrorMessage(e));
                }
            })
            .finally(() => {
                if (!cancelled) {
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
