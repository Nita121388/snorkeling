// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// W2-3 源码契约（性能）：终端热更新不得销毁重建。
//
// 现状（HEAD）：创建 TermWrap 的 useEffect 依赖整个 termSettings 对象 —— 改
// term:bellsound / 字体等任一可热更新设置会把**所有终端的 PTY 容器**销毁重建。
//
// 红证：HEAD 上依赖数组是 `[blockId, termSettings, termFontSize, connFontFamily]` → 本文件红。

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "term.tsx"), "utf8");

describe("终端热更新缩窄（W2-3）", () => {
    it("TermWrap 创建 effect 不再依赖整个 termSettings 对象", () => {
        // 反例（HEAD）：`}, [blockId, termSettings, termFontSize, connFontFamily]);`
        expect(source).not.toMatch(/\}\s*,\s*\[\s*blockId\s*,\s*termSettings\b/);
    });

    it("init-only 字段仍在依赖里（不允许为了过测把依赖清空）", () => {
        expect(source).toMatch(/\}\s*,\s*\[[^\]]*blockId[^\]]*\]\s*\)/);
    });
});
