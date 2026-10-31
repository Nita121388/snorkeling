// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// property-schema — 全局属性模板（wconfig agent:propertyschema）的读写。
//
// 与 per-session props 分离：schema 是「定义」（key/name/type/options/order/scope），
// session props 是「值」。用户从表单新建属性时可选择同时写入 schema（在所有会话可用）。

import { useSettingsKeyAtom } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
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

export function removeSchemaDef(current: PropertySchemaDef[], key: string): PropertySchemaDef[] {
    return current.filter((d) => d.key !== key);
}
