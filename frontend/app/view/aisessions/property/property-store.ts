// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// property-store — 属性写入的统一入口。
//
// 内置属性（note / tags / starred）继续走各自的既有 RPC（NoteAndTags / Mark），保证
// 旧数据与其它 surface 一致；自定义属性走新增的 SetProps。调用方只需要给
// (def, value)，不用关心落到哪张表。

import type { AISessionsServiceType } from "@/app/store/services";
import { saveSessionNote, saveSessionProps } from "@/app/store/session-note-cache";
import { dispatchAISessionNoteUpdated } from "../session-note-events";
import { BUILTIN_PROP_KEYS, type PropertyDef, type PropertyValue } from "./property-model";

export type SetSessionPropertyResult = { ok: true } | { ok: false; error: string };

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

export async function setSessionProperty(args: {
    service: AISessionsServiceType;
    sessionId: string;
    connection: string;
    summary: SessionSummary;
    def: PropertyDef;
    value: PropertyValue;
}): Promise<SetSessionPropertyResult> {
    const { service, sessionId, connection, summary, def, value } = args;

    if (def.builtin) {
        switch (def.key) {
            case BUILTIN_PROP_KEYS.note: {
                const result = await saveSessionNote(
                    service,
                    sessionId,
                    connection,
                    typeof value === "string" ? value : "",
                    summary.tags ?? []
                );
                return result.status === "ok" ? { ok: true } : { ok: false, error: result.error };
            }
            case BUILTIN_PROP_KEYS.tags: {
                const tags = Array.isArray(value) ? value.map((tag) => String(tag)) : [];
                const result = await saveSessionNote(service, sessionId, connection, summary.note ?? "", tags);
                return result.status === "ok" ? { ok: true } : { ok: false, error: result.error };
            }
            case BUILTIN_PROP_KEYS.starred: {
                try {
                    const updated = await service.Mark(summary.key, value === true);
                    dispatchAISessionNoteUpdated(updated);
                    return { ok: true };
                } catch (err) {
                    return { ok: false, error: errorMessage(err) };
                }
            }
            default:
                return { ok: false, error: "property is read-only" };
        }
    }

    const result = await saveSessionProps(service, sessionId, connection, {
        [def.key]: {
            value: value as unknown,
            type: def.type,
            source: "user",
            updatedAt: Date.now(),
        },
    });
    return result.status === "ok" ? { ok: true } : { ok: false, error: result.error };
}
