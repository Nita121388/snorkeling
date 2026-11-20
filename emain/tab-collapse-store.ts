// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * 「收起到更多」集合的落盘存储（主进程侧小 JSON）。
 *
 * 为什么在主进程落盘而不是 renderer localStorage：
 *   - 收起状态的唯一真源本来就在主进程（emain/emain-window.ts 的 collapsedTabIds），
 *     每个 Tab 是独立 renderer，状态放 renderer 会跨视图撕裂；既有 IPC + 广播机制已验证。
 *   - 这个模块只负责「读一次 / 每次变更覆盖写」，不参与可见性判定。
 *
 * 文件内容形如 `["tabid1","tabid2"]`。任何解析失败都退化为空集合 —— 收起状态丢了只是
 * 所有 Tab 重新露出，不能因为这个文件坏掉拖死启动。
 */
export interface TabCollapseStore {
    read(): string[];
    write(tabIds: readonly string[]): void;
}

/** 规整为 string[]：剔除空串/非字符串、去重、保留首次出现顺序。 */
export function normalizeCollapsedTabIds(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of raw) {
        if (typeof item !== "string") {
            continue;
        }
        const tabId = item.trim();
        if (!tabId || seen.has(tabId)) {
            continue;
        }
        seen.add(tabId);
        out.push(tabId);
    }
    return out;
}

/** 解析落盘文本；损坏/非 JSON 一律按空集合处理。 */
export function parseCollapsedTabIds(text: string | null | undefined): string[] {
    if (text == null || text.trim() === "") {
        return [];
    }
    try {
        return normalizeCollapsedTabIds(JSON.parse(text));
    } catch {
        return [];
    }
}

export function serializeCollapsedTabIds(tabIds: readonly string[]): string {
    return JSON.stringify(normalizeCollapsedTabIds(tabIds));
}

/**
 * 文件型 store。写入走「临时文件 + rename」避免半截文件；
 * 目录不存在时自动创建（首次启动场景）。
 */
export function createTabCollapseFileStore(filePath: string): TabCollapseStore {
    return {
        read(): string[] {
            try {
                if (!existsSync(filePath)) {
                    return [];
                }
                return parseCollapsedTabIds(readFileSync(filePath, "utf-8"));
            } catch (e) {
                console.log("[error] read collapsed tab ids", filePath, e);
                return [];
            }
        },
        write(tabIds: readonly string[]): void {
            try {
                const dir = dirname(filePath);
                if (dir) {
                    mkdirSync(dir, { recursive: true });
                }
                const tmpPath = `${filePath}.tmp`;
                writeFileSync(tmpPath, serializeCollapsedTabIds(tabIds), "utf-8");
                renameSync(tmpPath, filePath);
            } catch (e) {
                console.log("[error] write collapsed tab ids", filePath, e);
            }
        },
    };
}
