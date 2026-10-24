// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// useBlockSessionTitle — 给 Tab 标签取会话标题（user / ai / provider 优先级由后端决定）。
//
// 性能约束（见 task 10-24-aisessions-title-autogen design §6.2）：
// 只有 active 或 hover 的 tab 才会触发 ensureSessionNote（可能产生一次 Summary RPC）；
// 背景 tab 只读缓存，不发请求。缓存由 session-note-cache 统一持有并被
// aisessions:titleupdated 事件增量刷新，因此标题到达后自动重渲染。

import { AISessionsServiceType } from "@/app/store/services";
import {
    ensureSessionNote,
    getSessionNoteSnapshot,
    subscribeSessionNote,
} from "@/app/store/session-note-cache";
import * as React from "react";

const titleService = new AISessionsServiceType();

export function useBlockSessionTitle(sessionId: string, connection: string, active: boolean): string {
    const conn = connection?.trim() ? connection.trim() : null;

    React.useEffect(() => {
        if (!active || sessionId === "") {
            return;
        }
        ensureSessionNote(titleService, sessionId, conn);
    }, [active, sessionId, conn]);

    const subscribe = React.useCallback(
        (listener: () => void) => {
            if (sessionId === "") {
                return () => {};
            }
            return subscribeSessionNote(sessionId, conn, listener);
        },
        [sessionId, conn]
    );
    const getSnapshot = React.useCallback(() => {
        if (sessionId === "") {
            return null;
        }
        return getSessionNoteSnapshot(sessionId, conn).summary;
    }, [sessionId, conn]);

    const summary = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return summary?.title ?? "";
}
