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
import {
    BUILTIN_PROP_KEYS,
    type PropertyCell,
    type PropertyDef,
    type PropertySource,
    type PropertyType,
    type PropertyValue,
} from "./property-model";

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
                    // origin 参数：内置 starred 只在本地会话编辑（origin 字段当前仅外部 dump 用）。
                    const updated = await service.Mark(summary.key, value === true, "");
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
            value,
            type: def.type,
            source: "user",
            updatedAt: Date.now(),
        },
    });
    return result.status === "ok" ? { ok: true } : { ok: false, error: result.error };
}

function emptyValueForType(type: PropertyType): PropertyValue {
    if (type === "multi_select" || type === "person" || type === "relation") return [];
    if (type === "checkbox") return false;
    return "";
}

/**
 * 修改属性元信息（显示名 / 类型 / 排序），保留已有值与 source。
 * 用于重命名、换类型、拖动排序。值不合法时保持原值，由渲染层容错。
 */
export async function patchSessionProperty(args: {
    service: AISessionsServiceType;
    sessionId: string;
    connection: string;
    summary: SessionSummary;
    key: string;
    name?: string;
    type?: PropertyType;
    order?: number;
}): Promise<SetSessionPropertyResult> {
    const { service, sessionId, connection, summary, key, name, type, order } = args;
    const existing = summary.props?.[key];
    const existingValue = (existing?.value as PropertyValue) ?? null;
    const nextType = (type ?? (existing?.type as PropertyType) ?? "text") as PropertyType;
    const value: PropertyValue = existingValue == null || existingValue === ""
        ? emptyValueForType(nextType)
        : existingValue;
    const cell: PropertyCell = {
        value,
        type: nextType,
        source: ((existing?.source as PropertySource) ?? "user") as PropertySource,
        updatedAt: Date.now(),
    };
    if (name !== undefined) cell.name = name;
    else if (existing?.name) cell.name = existing.name as string;
    if (order !== undefined) cell.order = order;
    else if (typeof existing?.order === "number" && existing.order > 0) cell.order = existing.order as number;
    const result = await saveSessionProps(service, sessionId, connection, { [key]: cell });
    return result.status === "ok" ? { ok: true } : { ok: false, error: result.error };
}
