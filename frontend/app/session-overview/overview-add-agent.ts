// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview「＋ 新建 Agent」纯逻辑：分组守卫 + Tab 列 key 解析 + 路径候选行 + 建块上下文组装。
// UI 层在 overview-add-agent-modal.tsx；看板入口在 overview-board.tsx / session-overview.tsx。
//
// 保持纯函数（不 import React / jotai），与 overview-board-model.ts 同一约定，规则直接单测。

import type { AgentLaunchContext, AgentLaunchTarget } from "@/app/workspace/agent-launch";
import type { OverviewBoardGroup } from "./overview-board-model";

/**
 * 分组守卫：只有容器型分组（tab）提供「＋ 新建」入口。
 * status/provider/project/tags 都是派生列 —— 「把卡片塞进 working 列 ≠ 让它变 working」，
 * 那是假交互，不提供。
 */
export function shouldShowAddAgent(group: OverviewBoardGroup): boolean {
    return group === "tab";
}

/** 看板 tab 列的稳定 key 前缀（`tab:<tabId>`，见 overview-board-model.groupOverviewCardsByTab）。 */
export const AddAgentTabColumnKeyPrefix = "tab:";

/** `tab:<tabId>` → tabId；其它分组列 key → null。 */
export function parseBoardTabColumnKey(key: string): string | null {
    if (typeof key !== "string" || !key.startsWith(AddAgentTabColumnKeyPrefix)) {
        return null;
    }
    const tabId = key.slice(AddAgentTabColumnKeyPrefix.length).trim();
    return tabId === "" ? null : tabId;
}

/** 路径候选行（弹窗「选择一个路径。」列表的模型）。第二行 `sub` 仅在远端时非空。 */
export type AddAgentPathRow = {
    /** 去重键 = 归一化 cwd。 */
    key: string;
    detail: string;
    /** 远端 connection（如 `ssh://mac`）；本地行为空串，不渲染。 */
    sub: string;
    /** 默认项（随 Tab 解析出的 cwd）。 */
    isDefault: boolean;
    isLocal: boolean;
    source: AgentLaunchTarget["source"] | "fallback";
};

/** 是否远端连接：空 / "local"（含 `local:` 前缀）都算本机。 */
export function isRemoteConnection(connection: string | null | undefined): boolean {
    const value = typeof connection === "string" ? connection.trim() : "";
    if (value === "" || value === "local") return false;
    if (value.startsWith("local:")) return false;
    return true;
}

function cleanPath(value: string | null | undefined): string | null {
    const path = value?.trim();
    return path === "" || path == null ? null : path;
}

/**
 * 路径候选行：去重 + 默认项置顶。
 *
 * 默认项（随 Tab）插到最前；候选里的重复项按首次出现去重。默认项出现在候选里时
 * 复用该行（不重复插入）。
 */
export function collectAddAgentPathRows(
    targets: readonly AgentLaunchTarget[] | null | undefined,
    defaultPath: string | null | undefined,
    /** 默认项（随 Tab）所属连接：远端 Tab 的默认行不能当作本地行（否则会丢掉 connection）。 */
    defaultConnection?: string | null
): AddAgentPathRow[] {
    // 候选先按 cwd 去重（保留首次出现的行 —— 这样远端行的 connection 不会丢）
    const byKey = new Map<string, AddAgentPathRow>();
    for (const target of targets ?? []) {
        const key = cleanPath(target?.cwd);
        if (key == null || byKey.has(key)) continue;
        // `connection === "local"` 是本机连接的规范写法（agent-launch 的 dedupe key 就用它），
        // 不能当远端处理 —— 否则本地行会多出一行 "local" 噪音。
        const isLocalRow = target.isLocal || isRemoteConnection(target.connection) === false;
        byKey.set(key, {
            key,
            detail: key,
            sub: isLocalRow ? "" : (target.connection ?? "").trim(),
            isDefault: false,
            // 行级本地判定（connection 空/local/local:* 都算本机）：不能裸存 target.isLocal ——
            // 构造侧的 isLocal 语义已经错过一次（connection="local" 被当远端），这里用同一套判定兑底
            isLocal: isLocalRow,
            source: target.source,
        });
    }
    const def = cleanPath(defaultPath);
    const defaultIsLocal = !isRemoteConnection(defaultConnection);
    let rows = Array.from(byKey.values());
    if (def != null) {
        const hit = byKey.get(def);
        if (hit != null) {
            hit.isDefault = true;
        } else {
            rows = [
                {
                    key: def,
                    detail: def,
                    sub: defaultIsLocal ? "" : (defaultConnection ?? "").trim(),
                    isDefault: true,
                    isLocal: defaultIsLocal,
                    source: "fallback",
                },
                ...rows,
            ];
        }
        // 默认项（随 Tab）置顶；Array#sort 稳定，其余顺序不变。
        rows = rows.slice().sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    }
    return rows;
}

export type AddAgentTabContextInput = {
    connection: string | null | undefined;
    cwd: string | null | undefined;
};

/**
 * 弹窗「发送内容」的归一：trim 后非空才算消息（null = 只建块，不发送）。
 * 与 wsh agentsend 的 64KB 上限对齐在这里提前拦（超长直接截为 null 并交给调用万报错）——
 * 不做静默截断：静默截断会把用户意图改掉，比报错更糟。
 */
export function normalizeAddAgentMessage(value: string | null | undefined): string | null {
    const text = typeof value === "string" ? value.trim() : "";
    return text === "" ? null : text;
}

/**
 * 建块上下文：显式传该 Tab 的 connection/cwd，**绝不**继承当前焦点块。
 *
 * `inheritWorkspaceContext: false` 是关键 —— agent-launch.ts 的 GUI 对话块路径
 * （createAgentBlockDef*，`agent-launch.ts` 中 resolveContextMeta）默认会用当前聚焦
 * 工作区 context 兜底，用户在 Overview 里选好的目录会被静默换掉（该坑已在该文件注释）。
 */
export function buildAddAgentLaunchContext(tab: AddAgentTabContextInput): AgentLaunchContext {
    const connection = typeof tab.connection === "string" && tab.connection.trim() !== "" ? tab.connection.trim() : null;
    const cwd = cleanPath(tab.cwd);
    const context: AgentLaunchContext = { connection, inheritWorkspaceContext: false };
    if (cwd != null) {
        context.cwd = cwd;
    }
    return context;
}
