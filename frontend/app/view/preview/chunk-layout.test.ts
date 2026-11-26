// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// W2-1 follow-up 源码契约（性能）：入口 chunk 布局——monaco 不得被无关引用面静态拖入。
//
// 背景（实测 2026-11-26）：入口静态闭包曾达 31.52MB（monaco 7.78 + shiki 9.33 +
// mermaid 3.35 + cytoscape 1.47 + katex 0.46），两个独立根因：
//   1. aifilediff / vcsdiff 为拿 30 行的 getFileLanguage 静态 import 了
//      preview-edit.tsx（它静态 import monaco-editor）→ 每个终端 Tab 的入口被迫
//      加载整个 monaco chunk；
//   2. vite 的 preload-helper 被 rollup 分进 monaco manual chunk + manualChunks
//      把已是动态 import 的 mermaid/cytoscape/katex 强制分组后因执行顺序被入口
//      bare-import 整包拖入。
// 治理后实测入口静态闭包 10.62MB。
//
// 为什么是源码级断言：这是**依赖图布局**的性质（构建产物才见），且每次完整构建
// 1 分钟、CI 成本高；源码钩子（谁 import 谁 + manualChunks 条目）是布局的决定
// 因素，锁住源码即锁住布局。

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..", "..", "..");
const viteConfig = readFileSync(join(root, "electron.vite.config.ts"), "utf8");
const aifilediff = readFileSync(join(root, "frontend", "app", "view", "aifilediff", "aifilediff.tsx"), "utf8");
const vcsdiff = readFileSync(join(root, "frontend", "app", "view", "vcsdiff", "vcsdiff.tsx"), "utf8");

describe("入口 chunk 布局（W2-1 follow-up）", () => {
    it("aifilediff 不再静态 import preview-edit（getFileLanguage 走零依赖的 preview-file-language）", () => {
        expect(aifilediff).not.toMatch(/from\s+["']@\/app\/view\/preview\/preview-edit["']/);
        expect(aifilediff).toMatch(/from\s+["']@\/app\/view\/preview\/preview-file-language["']/);
    });

    it("vcsdiff 不再静态 import preview-edit（同上）", () => {
        expect(vcsdiff).not.toMatch(/from\s+["']@\/app\/view\/preview\/preview-edit["']/);
        expect(vcsdiff).toMatch(/from\s+["']@\/app\/view\/preview\/preview-file-language["']/);
    });

    it("manualChunks：vite preload-helper 单开（不得落进 monaco/shiki 重型 chunk）", () => {
        expect(viteConfig).toMatch(/vite\/preload-helper/);
    });

    it("manualChunks：monaco 组只收 monaco 本体（monaco-editor/monaco-yaml），不再按前缀吞 vscode-uri 等共享包", () => {
        expect(viteConfig).toMatch(/node_modules\/monaco-editor\//);
        expect(viteConfig).not.toMatch(/p\.includes\("node_modules\/monaco"\)/);
    });

    it("manualChunks：不再给已是动态 import 的 mermaid/cytoscape/katex 强制分组（强制分组会因执行顺序被入口整包拖入）", () => {
        expect(viteConfig).not.toMatch(/return\s+"mermaid"/);
        expect(viteConfig).not.toMatch(/return\s+"cytoscape"/);
        expect(viteConfig).not.toMatch(/return\s+"katex"/);
    });
});
