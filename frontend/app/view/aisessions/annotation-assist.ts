// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 批注 AI 生成的 RPC 封装（手动触发，只在用户点击时调用）。
// 结果一律是 draft：调用方决定采纳（保存/替换）或丢弃。

import { AISessionsServiceType } from "@/app/store/services";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { resolveMetadataAIMode } from "@/app/view/term/agent-ai-config";
import type { AnnotationLike } from "./annotation-model";

export type AnnotationAssistScope = "timeline" | "entry-title" | "entry-body" | "entry-tags";

export type AnnotationAssistContext = {
    sessionKey: string;
    connection?: string;
    scope: AnnotationAssistScope;
    anchorKey?: string;
    title?: string;
    body?: string;
    tags?: string[];
    maxEntries?: number;
};

export type AnnotationDraftResult = {
    anchorKey: string;
    kind: string;
    title: string;
    body: string;
    tags: string[];
};

const service = new AISessionsServiceType();

export type AssistAvailability = { available: true; mode: string } | { available: false; reason: string };

export function annotationAIAvailability(): AssistAvailability {
    return resolveMetadataAIMode();
}

/** Generate drafts. Throws with a user-facing message on failure. */
type PendingAssist = {
    resolve: (drafts: AnnotationDraftResult[]) => void;
    reject: (error: Error) => void;
    timer: number;
};

let listenerAttached = false;
const pendingAssists = new Map<string, PendingAssist>();
const earlyEvents = new Map<string, AnnotationAssistEvent>();
const activeJobs = new Map<string, string>(); // jobId -> sessionKey

function settleAssist(event: AnnotationAssistEvent): void {
    const pending = pendingAssists.get(event.jobId);
    if (pending == null) {
        earlyEvents.set(event.jobId, event);
        return;
    }
    if (event.state === "queued" || event.state === "running") {
        return;
    }
    window.clearTimeout(pending.timer);
    pendingAssists.delete(event.jobId);
    activeJobs.delete(event.jobId);
    if (event.state === "done") {
        pending.resolve(
            (event.drafts ?? []).map((draft) => ({
                anchorKey: draft.anchorKey,
                kind: draft.kind,
                title: draft.title ?? "",
                body: draft.body ?? "",
                tags: draft.tags ?? [],
            }))
        );
        return;
    }
    pending.reject(new Error(event.error || `annotation generation ${event.state}`));
}

export function ensureAssistListener(): void {
    if (listenerAttached || typeof window === "undefined") return;
    listenerAttached = true;
    (window as unknown as { __annotationAssistStates?: string }).__annotationAssistStates = "subscribed";
    try {
        waveEventSubscribeSingle<"aisessions:annotationassist">({
            eventType: "aisessions:annotationassist",
            handler: (event) => {
                const data = event.data;
                if (data == null || typeof data.jobId !== "string") {
                    return;
                }
                console.log("[annotation-ai] event", data);
                (window as unknown as { __annotationAssistStates?: string }).__annotationAssistStates = "received";
                if (data.state === "queued" || data.state === "running") {
                    (window as unknown as { __annotationAssistStates?: string }).__annotationAssistStates = data.state;
                    return;
                }
                settleAssist(data);
            },
        });
    } catch {
        listenerAttached = false;
    }
}

/** Cancel every in-flight annotation job for one session (best effort). */
export function cancelActiveAnnotationAssist(sessionKey: string): void {
    for (const [jobId, key] of activeJobs) {
        if (key === sessionKey) {
            void service.AnnotationAssistCancel(jobId).catch(() => {});
            const pending = pendingAssists.get(jobId);
            if (pending != null) {
                window.clearTimeout(pending.timer);
                pending.reject(new Error("cancelled"));
                pendingAssists.delete(jobId);
            }
            activeJobs.delete(jobId);
        }
    }
}

/** Generate drafts. The RPC enqueues and returns a job id; this promise resolves
 *  when the background worker publishes the result. */
export async function requestAnnotationDrafts(context: AnnotationAssistContext): Promise<AnnotationDraftResult[]> {
    const ai = annotationAIAvailability();
    if (ai.available === false) {
        throw new Error(ai.reason);
    }
    ensureAssistListener();
    const response = await service.AnnotationAssist({
        sessionKey: context.sessionKey,
        connection: context.connection?.trim() || undefined,
        scope: context.scope,
        anchorKey: context.anchorKey,
        title: context.title,
        body: context.body,
        tags: context.tags,
        maxEntries: context.maxEntries,
        aiMode: ai.mode,
    });
    const jobId = response.jobId;
    console.log("[annotation-ai] job queued", { jobId, scope: context.scope, sessionKey: context.sessionKey });
    activeJobs.set(jobId, context.sessionKey);
    return await new Promise<AnnotationDraftResult[]>((resolve, reject) => {
        const timer = window.setTimeout(() => {
            const state = (window as unknown as { __annotationAssistStates?: string }).__annotationAssistStates;
            pendingAssists.delete(jobId);
            activeJobs.delete(jobId);
            if (state === "none") {
                // 没收到任何事件：订阅没建立或后端没发布。
                reject(new Error("AI 生成没有返回任何结果：事件未送达（检查 wps 订阅）"));
                return;
            }
            reject(new Error("annotation generation timed out"));
        }, 45_000);
        pendingAssists.set(jobId, { resolve, reject, timer });
        const early = earlyEvents.get(jobId);
        if (early != null) {
            earlyEvents.delete(jobId);
            settleAssist(early);
        }
    });
}

/** Persist drafts as the session's replaceable annotations (single transaction). */
export async function replaceAnnotationDrafts(
    sessionKey: string,
    connection: string | null | undefined,
    drafts: AnnotationDraftResult[]
): Promise<number> {
    const response = await service.AnnotationReplace({
        sessionKey,
        connection: connection?.trim() || undefined,
        annotations: drafts,
    });
    return (response.annotations ?? []).length;
}

export function draftToAnnotationLike(draft: AnnotationDraftResult, sessionKey: string): AnnotationLike {
    return {
        id: -1,
        sessionKey,
        anchorKey: draft.anchorKey,
        seq: 0,
        kind: draft.kind,
        title: draft.title,
        body: draft.body,
        tags: draft.tags,
        status: "draft",
        source: "ai",
    };
}
