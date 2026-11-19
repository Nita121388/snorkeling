// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Block 标题的纯函数辅助（可从 React 组件里安全单测）。
 *
 * Hero 登场块的据点目录名是磁盘不变量（pkg/hero ValidateID: 目录名 == id），
 * 中文名 Hero 的 id 必然是 `hero-<hash8>`；`block.tsx` 的 agent 分支原先直接用
 * `basename(cmd:cwd)` 当默认标题，于是 Tab / Block 头部显示
 * `E:\primary\heros/hero-feaa3f86` 这种既哈希又混合分隔符的目录名。
 *
 * 启动时 `buildHeroLaunchBlockDef` 已把纯名字写进 `hero:name`；老块可能带
 * `emoji + name`，这里按同块 `agent:emoji` 剥掉重复前缀。没有身份时返回空串。
 */
export function heroHeaderName(meta: Record<string, unknown> | null | undefined): string {
    const raw = meta?.["hero:name"];
    const name = typeof raw === "string" ? raw.trim() : "";
    const blockEmoji = meta?.["agent:emoji"];
    if (name === "" || typeof blockEmoji !== "string" || blockEmoji.trim() === "") {
        return name;
    }
    const prefix = `${blockEmoji.trim()} `;
    return name.startsWith(prefix) ? name.slice(prefix.length).trim() : name;
}
