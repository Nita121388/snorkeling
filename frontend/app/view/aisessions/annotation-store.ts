// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Module-level annotation cache, mirroring session-note-cache:
//  - 组件只订阅，加载/保存/删除都在模块层，切 tab 不会丢状态
//  - getSnapshot 返回稳定的数组引用（只有真的变化才换引用），避免 React #185
//  - 锚点列表变化（消息加载完/增长）时自动重新拉取并做重锚定/orphan 标记

import { AISessionsServiceType } from "@/app/store/services";
import * as React from "react";
import type { AnnotationAnchorRequest, AnnotationLike } from "./annotation-model";

export type AnnotationStatus = "idle" | "loading" | "loaded" | "error";

type AnnotationEntry = {
    annotations: AnnotationView[];
    status: AnnotationStatus;
    error: string;
    listeners: Set<() => void>;
    inflight: boolean;
    lastAnchors: AnnotationAnchorRequest[];
};

const EMPTY_ANNOTATIONS: AnnotationView[] = [];
const annotationCache = new Map<string, AnnotationEntry>();
const service = new AISessionsServiceType();

function normalizeConnection(connection: string | null | undefined): string {
    return typeof connection === "string" ? connection.trim() : "";
}

function cacheKey(sessionKey: string, connection: string | null | undefined): string {
    return `${normalizeConnection(connection)}|${sessionKey}`;
}

function entryFor(sessionKey: string, connection: string | null | undefined): AnnotationEntry {
    const key = cacheKey(sessionKey, connection);
    let entry = annotationCache.get(key);
    if (entry == null) {
        entry = {
            annotations: EMPTY_ANNOTATIONS,
            status: "idle",
            error: "",
            listeners: new Set(),
            inflight: false,
            lastAnchors: [],
        };
        annotationCache.set(key, entry);
    }
    return entry;
}

function notify(entry: AnnotationEntry): void {
    for (const listener of entry.listeners) listener();
}

function subscribe(sessionKey: string, connection: string | null | undefined, listener: () => void): () => void {
    const entry = entryFor(sessionKey, connection);
    entry.listeners.add(listener);
    return () => {
        entry.listeners.delete(listener);
    };
}

async function loadAnnotations(
    sessionKey: string,
    connection: string | null | undefined,
    anchors: AnnotationAnchorRequest[]
): Promise<void> {
    if (sessionKey === "") return;
    const entry = entryFor(sessionKey, connection);
    entry.lastAnchors = anchors;
    if (entry.inflight) return;
    entry.inflight = true;
    entry.status = entry.annotations.length === 0 ? "loading" : entry.status;
    entry.error = "";
    notify(entry);
    try {
        const response = await service.Annotations({
            sessionKey,
            connection: normalizeConnection(connection) || undefined,
            anchors: anchors.length > 0 ? anchors : undefined,
        });
        const next = response.annotations ?? [];
        entry.annotations = next;
        entry.status = "loaded";
        entry.error = "";
    } catch (err) {
        entry.status = "error";
        entry.error = err instanceof Error ? err.message : String(err);
    } finally {
        entry.inflight = false;
        notify(entry);
    }
    // 请求进行中又来了新的 anchors（典型：打开会话时先以空锚点加载，消息到齐后
    // 才带上 anchorKey）：之前这里会直接 return，导致服务端永远拿不到锚点、
    // 历史批注的 seq 一直是 0。请求结束后用最新锚点补一次。
    if (entry.lastAnchors !== anchors) {
        void loadAnnotations(sessionKey, connection, entry.lastAnchors);
    }
}

/**
 * 用调用方提供的锚点强制重载一次。
 * 典型用途：会话详情的 renderItems 就绪后，用「工具锚点 → anchorSeq」的真实 seq
 * 覆盖掉先前基于空 ItemKey 的空锚点列表，顺带让服务端把历史 seq=0 的批注补正。
 */
export function reloadAnnotationsWithAnchors(
    sessionKey: string,
    connection: string | null | undefined,
    anchors: AnnotationAnchorRequest[]
): Promise<void> {
    if (sessionKey === "" || anchors.length === 0) return Promise.resolve();
    return loadAnnotations(sessionKey, connection, anchors);
}

/** Force a reload (after an external mutation such as AI regeneration). */
export function refreshAnnotations(sessionKey: string, connection: string | null | undefined): Promise<void> {
    return loadAnnotations(sessionKey, connection, entryFor(sessionKey, connection).lastAnchors);
}

export async function saveAnnotation(request: AISessionsAnnotationSaveRequest): Promise<AnnotationView> {
    const saved = await service.AnnotationSave(request);
    await refreshAnnotations(request.sessionKey, request.connection);
    return saved;
}

/**
 * 只改一条批注的「节点原文」副本（NODE 区就地编辑）。
 * 其余字段原样回传，避免把 title/body/tags 冲掉；nodeText 为空串 = 清除覆盖。
 */
export async function saveAnnotationNodeText(
    annotation: AnnotationLike,
    nodeText: string,
    sessionKey: string,
    connection: string | null | undefined
): Promise<void> {
    const next = nodeText.trim();
    if ((annotation.nodeText ?? "") === next) return;
    await saveAnnotation({
        id: annotation.id,
        sessionKey,
        anchorKey: annotation.anchorKey,
        seq: annotation.seq,
        kind: annotation.kind,
        title: annotation.title,
        body: annotation.body,
        tags: annotation.tags ?? [],
        status: annotation.status,
        source: annotation.source,
        nodeText: next,
        connection: normalizeConnection(connection) || undefined,
    });
}

/** Accept or discard drafts (empty ids = all drafts of the session). */
export async function bulkDraftAnnotations(
    sessionKey: string,
    connection: string | null | undefined,
    ids: number[],
    action: "accept" | "discard"
): Promise<number> {
    const response = await service.AnnotationBulkDrafts({
        sessionKey,
        connection: normalizeConnection(connection) || undefined,
        ids,
        action,
    });
    await refreshAnnotations(sessionKey, connection);
    return response.affected;
}

export async function deleteAnnotation(id: number, sessionKey: string, connection?: string): Promise<void> {
    await service.AnnotationDelete(id);
    await refreshAnnotations(sessionKey, connection);
}

export function getAnnotationSnapshot(sessionKey: string, connection: string | null | undefined): AnnotationView[] {
    const entry = annotationCache.get(cacheKey(sessionKey, connection));
    return entry?.annotations ?? EMPTY_ANNOTATIONS;
}

export function useSessionAnnotations(
    sessionKey: string,
    connection: string | null | undefined,
    anchors: AnnotationAnchorRequest[]
): {
    annotations: AnnotationView[];
    status: AnnotationStatus;
    error: string;
    reload: () => Promise<void>;
} {
    const conn = normalizeConnection(connection);
    const anchorsSignature = React.useMemo(() => JSON.stringify(anchors), [anchors]);
    React.useEffect(() => {
        if (sessionKey === "") return;
        void loadAnnotations(sessionKey, conn, anchors);
        // anchorsSignature 覆盖数组内容；不依赖数组引用。
    }, [sessionKey, conn, anchorsSignature]);

    const sub = React.useCallback(
        (listener: () => void) => (sessionKey === "" ? () => {} : subscribe(sessionKey, conn, listener)),
        [sessionKey, conn]
    );
    const get = React.useCallback(
        () => (sessionKey === "" ? EMPTY_ANNOTATIONS : getAnnotationSnapshot(sessionKey, conn)),
        [sessionKey, conn]
    );
    const annotations = React.useSyncExternalStore(sub, get, get);
    const entry = annotationCache.get(cacheKey(sessionKey, conn));
    return {
        annotations,
        status: entry?.status ?? "idle",
        error: entry?.error ?? "",
        reload: () => loadAnnotations(sessionKey, conn, entry?.lastAnchors ?? []),
    };
}
