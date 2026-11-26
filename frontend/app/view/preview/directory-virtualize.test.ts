// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// W2-3 源码契约（性能）：Preview 目录表虚拟化。
//
// 为什么是源码级断言：目录表的真实痛点是「5000 行全量渲染 + onScroll 防抖 setScrollHeight
// 触发整表重渲」，这是渲染结构的性质，JSDOM 挂载整目录组件成本过高；与
// message-dialog-no-delete.test.ts 同范式：锁源码结构里的契约钩子。
//
// 红证：HEAD 上无 useVirtualizer、有 scrollHeight state → 本文件全红。

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "preview-directory.tsx"), "utf8");

describe("DirectoryTable 虚拟化（W2-3）", () => {
    it("使用 @tanstack/react-virtual 的 useVirtualizer（TableBody 虚拟化真实存在）", () => {
        expect(source).toMatch(/useVirtualizer/);
    });

    it("不再有 scrollHeight state（onScroll 防抖整表重渲的根源）", () => {
        expect(source).not.toMatch(/const\s*\[\s*scrollHeight\s*,\s*setScrollHeight\s*\]/);
    });

    it("样式需要的滚动高度直写 dataset，不走 React state", () => {
        expect(source).toMatch(/data-scroll-height/);
    });
});
