// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 批注 AI 生成的 RPC 封装（手动触发，只在用户点击时调用）。
// 结果一律是 draft：调用方决定采纳（保存/替换）或丢弃。

import { AISessionsServiceType } from "@/app/store/services";
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
export async function requestAnnotationDrafts(context: AnnotationAssistContext): Promise<AnnotationDraftResult[]> {
    const ai = annotationAIAvailability();
    if (ai.available === false) {
        throw new Error(ai.reason);
    }
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
    return (response.drafts ?? []).map((draft) => ({
        anchorKey: draft.anchorKey,
        kind: draft.kind,
        title: draft.title ?? "",
        body: draft.body ?? "",
        tags: draft.tags ?? [],
    }));
}

/** Persist drafts as the session's replaceable annotations (single transaction). */
export async function replaceAnnotationDrafts(
    sessionKey: string,
    connection: string | null | undefined,
    drafts: AnnotationDraftResult[]
): Promise<void> {
    await service.AnnotationReplace({
        sessionKey,
        connection: connection?.trim() || undefined,
        annotations: drafts,
    });
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
