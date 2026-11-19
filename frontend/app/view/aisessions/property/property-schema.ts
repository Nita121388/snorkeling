// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// property-schema — 全局属性模板（wconfig agent:propertyschema）的读写。
//
// 与 per-session props 分离：schema 是「定义」（key/name/type/options/order/scope），
// session props 是「值」。用户从表单新建属性时可选择同时写入 schema（在所有会话可用）。

import { useSettingsKeyAtom } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import {
    normalizePropertyType,
    slugifyPropertyKey,
    type PropertyType,
} from "@/app/view/aisessions/property/property-model";
import * as React from "react";

export type PropertySchemaDef = AgentPropertyDefType;

export const SCHEMA_CONFIG_KEY = "agent:propertyschema";

/** 读取全局属性模板（响应 settings 变化）。 */
export function usePropertySchema(): PropertySchemaDef[] {
    const raw = useSettingsKeyAtom(SCHEMA_CONFIG_KEY) as PropertySchemaDef[] | null | undefined;
    return React.useMemo(() => (Array.isArray(raw) ? raw.filter((d) => (d?.key ?? "") !== "") : []), [raw]);
}

export function setPropertySchema(defs: PropertySchemaDef[]): Promise<void> {
    return RpcApi.SetConfigCommand(TabRpcClient, {
        [SCHEMA_CONFIG_KEY]: defs,
    } as SettingsType);
}

/** 把一条定义写进模板（同 key 覆盖）。 */
export function upsertSchemaDef(current: PropertySchemaDef[], def: PropertySchemaDef): PropertySchemaDef[] {
    const defs = current.slice();
    const idx = defs.findIndex((d) => d.key === def.key);
    if (idx >= 0) {
        defs[idx] = { ...defs[idx], ...def };
    } else {
        defs.push(def);
    }
    defs.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return defs;
}

// 按 slugified key 匹配：toPropertyDefs 建索引时就是用这个口径归一化 schema key 的，
// settings.json 里手写的 "Priority" 与表单建的 "priority" 应视为同一条定义。
export function removeSchemaDef(current: PropertySchemaDef[], key: string): PropertySchemaDef[] {
    const normalized = slugifyPropertyKey(key);
    return current.filter((d) => slugifyPropertyKey(d.key ?? "") !== normalized);
}

/**
 * 定义 scope 是否允许追加候选（settings 编码："" = 全局，"agent:<source>" = 仅该 Agent）。
 * 会话私有（session）与任何未知 scope 一律跳过 —— 私有属性本就不共享，
 * 写全局模板只会污染其它项目（决策 #2）。
 */
function isAppendableScope(def: PropertySchemaDef): boolean {
    const scope = (def.scope ?? "").trim();
    return scope === "" || scope.toLowerCase().startsWith("agent:");
}

/**
 * 把 UI 新提交的值追加为模板定义的 options 候选（select / multi_select）。
 *
 * 纯函数，不变量与 CLI 侧 `MergePropertyOptions`（pkg/agentdata/patch.go）一致：
 *  - 幂等：重复追加相同值 → changed=false，options 不变；
 *  - 保序：新值按 values 输入顺序追加到 options **末尾**，已有顺序不动（决策 #3：
 *    换序会让用户已习惯的位置跳动）；
 *  - 去重策略（写死）：比较用 trim + 全部小写，大小写变体视为同一候选，跳过；
 *    已存在的值不追加、不重写模板（无新增时 settings 必须字节级不变）；
 *  - 绝不删已有 option。
 *
 * 命中条件：
 *  - key 命中模板定义（按 slugified key 匹配，与 toPropertyDefs / removeSchemaDef 同口径）；
 *  - 定义类型 ∈ {select, status, multi_select}（status 读时归一为 select），
 *    person / relation 等非选项类型不追加；
 *  - 定义 scope 是全局或 agent（见 isAppendableScope）；不在模板里（session 私有）
 *    与未知 scope 一律跳过。
 *
 * `changed === false` 时调用方**不得**发 setPropertySchema。
 */
export function appendOptionToSchemaDefs(
    defs: PropertySchemaDef[],
    key: string,
    values: string[]
): { next: PropertySchemaDef[]; changed: boolean } {
    const normalized = slugifyPropertyKey(key);
    const idx = defs.findIndex((d) => slugifyPropertyKey(d?.key ?? "") === normalized);
    if (idx < 0) return { next: defs, changed: false };

    const def = defs[idx];
    const type = normalizePropertyType(((def.type ?? "text") as PropertyType) || "text");
    if (type !== "select" && type !== "multi_select") return { next: defs, changed: false };
    if (!isAppendableScope(def)) return { next: defs, changed: false };

    const existing = Array.isArray(def.options) ? def.options.map((opt) => String(opt)) : [];
    const seen = new Set(existing.map((opt) => opt.trim().toLowerCase()));
    const added: string[] = [];
    for (const raw of values ?? []) {
        if (raw == null) continue; // 防御：多选数组里不会出现 null，但外部调用可能带脏数据
        const value = String(raw).trim();
        if (value === "" || seen.has(value.toLowerCase())) continue;
        seen.add(value.toLowerCase());
        // 追加原值（保留用户输入的大小写），仅比较时归一 —— 与 CLI MergePropertyOptions 一致。
        added.push(value);
    }
    if (added.length === 0) return { next: defs, changed: false };

    const next = defs.slice();
    next[idx] = { ...def, options: [...existing, ...added] };
    return { next, changed: true };
}
