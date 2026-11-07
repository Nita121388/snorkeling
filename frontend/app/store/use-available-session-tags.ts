// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// useAvailableSessionTags — 把全局标签清单（含 count）送进组件。
//
// 消费方：`SessionNoteSection` → `PropertyList` 的 `tagCatalog`。
// 数据源：`store/available-session-tags.ts`（按 connection+origin 分桶、60s TTL、in-flight 合并）。
//
// 设计要点：
//   - 契约见 store 模块注释；这里只做 React 适配（订阅 + 挂载时触发一次 ensure）。
//   - **不阻塞渲染**：首帧返回空数组 → `PropertyList` 的候选池退化为「def.options + 已选值」，
//     与引入本通道之前完全一致。RPC 回来后才多出全局候选（渐进增强，不是必要依赖）。
//   - **失败静默**：store 内部吞掉错误并返回空清单，这里不额外抛错到卡片。

import { useSyncExternalStore } from "react";
import * as React from "react";
import { AISessionsServiceType } from "@/app/store/services";
import {
    ensureAvailableTags,
    getAvailableTagsSnapshot,
    subscribeAvailableTags,
    type AvailableTagsKey,
} from "@/app/store/available-session-tags";

/** 空清单常量：让「未加载 / 失败」共用同一引用，避免无意义的重渲染。 */
const EmptyTags: SessionTagSummary[] = [];

/**
 * 订阅某个 (connection, origin) 桶的全局标签清单。
 *
 * @param connection 远端连接名（空串表示本地）
 * @param origin     标签来源作用域（空串表示不限）
 */
export function useAvailableSessionTags(connection: string, origin: string): SessionTagSummary[] {
    const service = React.useMemo(() => new AISessionsServiceType(), []);
    const key: AvailableTagsKey = React.useMemo(() => ({ connection, origin }), [connection, origin]);

    // 挂载 / key 变化时触发一次拉取（幂等：TTL 内命中缓存）。
    React.useEffect(() => {
        void ensureAvailableTags(key, { service });
    }, [key, service]);

    const subscribe = React.useCallback(
        (listener: () => void) => subscribeAvailableTags(key, listener),
        [key]
    );
    const getSnapshot = React.useCallback(
        () => getAvailableTagsSnapshot(key),
        [key]
    );
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return snapshot ?? EmptyTags;
}
