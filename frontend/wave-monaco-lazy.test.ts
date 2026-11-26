// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// W2-1 源码契约（性能，2026-11-26）：启动路径不得同步阻塞加载 Monaco。
//
// 为什么是源码级断言：`await loadMonaco()` 在首帧渲染前执行（wave.ts:274），
// 它把 monaco-editor + 5 种语言 contribution + monaco-yaml + 6 个 worker 同步灌进
// 每个终端 Tab 的入口 chunk —— 这是启动依赖图的性质，JSDOM 挂载测不出来。
//
// 红证：HEAD 上 wave.ts 有 `await loadMonaco()` 且 monaco-env.ts 顶层静态
// import "monaco-editor" → 本文件全红。

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const waveSource = readFileSync(join(import.meta.dirname, "wave.ts"), "utf8");
const monacoEnvSource = readFileSync(join(import.meta.dirname, "app", "monaco", "monaco-env.ts"), "utf8");

describe("wave.ts 启动路径不阻塞加载 Monaco（W2-1）", () => {
    it("不再有 `await loadMonaco()` 阻塞调用（按需加载走非阻塞 ensureMonacoLoaded）", () => {
        expect(waveSource).not.toMatch(/await\s+loadMonaco\s*\(\s*\)/);
    });

    it("monaco-env.ts 主文件不再静态 import monaco-editor（拆到按需 loader 子模块）", () => {
        expect(monacoEnvSource).not.toMatch(/from\s+["']monaco-editor["']/);
    });

    it("拆分真实存在：monaco-env 保留轻量 theme 桩（setMonacoTheme 可同步调用）", () => {
        expect(monacoEnvSource).toMatch(/export function setMonacoTheme/);
    });
});
