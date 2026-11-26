// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// W2-1 源码契约（性能，2026-11-26）：重型依赖不得进每个终端 Tab 的入口 chunk。
//
// 为什么是源码级断言：本包的目的是「普通终端 Tab 的入口 chunk 不携带 shiki /
// @observablehq/plot / markdown.tsx（6261 行）」，这是依赖图层面的性质，挂载单个
// 组件测不出来；与 message-dialog-no-delete.test.ts 同范式：锁源码结构里的契约钩子。
//
// 三个重型面：
//   - streamdown.tsx 顶层 `import { codeToHtml } from "shiki/bundle/web"`（引用面不止
//     aisessions：aipanel / onboarding 也用 streamdown，所以必须在 streamdown 内部按需）；
//   - sysinfo.tsx 顶层 `import * as Plot from "@observablehq/plot"`（model 与 view 同文件）；
//   - preview-model.tsx 顶层 `import { PreviewView } from "./preview"`（拖进 markdown.tsx 链）。
//
// 红证：HEAD 上三条静态 import 全部存在 → 本文件全红。

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const streamdownSource = readFileSync(join(root, "app", "element", "streamdown.tsx"), "utf8");
const sysinfoSource = readFileSync(join(root, "app", "view", "sysinfo", "sysinfo.tsx"), "utf8");
const previewModelSource = readFileSync(join(root, "app", "view", "preview", "preview-model.tsx"), "utf8");

describe("重型视图懒加载（W2-1）", () => {
    it("streamdown.tsx 不再静态 import shiki（codeToHtml 走按需动态 import + LRU）", () => {
        expect(streamdownSource).not.toMatch(/from\s+["']shiki/);
        // 拆分真实存在：shiki 改为动态 import()（不是删掉代码高亮能力）。
        expect(streamdownSource).toMatch(/import\s*\(\s*["']shiki/);
    });

    it("sysinfo.tsx（model 文件）不再静态 import @observablehq/plot（plot 只活在拆出的 view 文件）", () => {
        expect(sysinfoSource).not.toMatch(/from\s+["']@observablehq\/plot["']/);
        // viewComponent 走 React.lazy 加载拆出的 view 文件。
        expect(sysinfoSource).toMatch(/lazy\s*\(\s*\(\s*\)\s*=>\s*import/);
    });

    it("preview-model.tsx 不再静态 import ./preview（PreviewView 改 React.lazy）", () => {
        expect(previewModelSource).not.toMatch(/from\s+["']\.\/preview["']/);
        expect(previewModelSource).toMatch(/lazy\s*\(\s*\(\s*\)\s*=>\s*import/);
    });
});
