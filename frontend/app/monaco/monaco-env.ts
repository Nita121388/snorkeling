// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// W2-1（性能）：轻量主题桩 + 按需加载入口。本文件被 wave.ts / app.tsx 在启动期
// import，**禁止**静态 import monaco-editor（会被拖进每个终端 Tab 的入口 chunk）。
// 真正的 Monaco 配置在 `./monaco-env-monaco`，只在编辑器真正需要时动态加载。

// 未加载 Monaco 期间记录的目标主题；首次加载完成后由 loader 统一应用。
let pendingTheme: ResolvedAppTheme = "dark";
// Monaco 是否已完成配置（由 monaco-env-monaco 回写）。未加载时 setMonacoTheme 只记账。
let monacoLoaded = false;
// 单飞：重复调用 ensureMonacoLoaded 返回同一个 promise。
let monacoLoadPromise: Promise<void> | null = null;

// 轻量主题桩：Monaco 未加载时只记录目标主题，等首次 ensureMonacoLoaded 完成
// 后应用；已加载时同步应用到 Monaco 实例（动态 import 命中已缓存的 chunk，开销极小）。
export function setMonacoTheme(appTheme: ResolvedAppTheme) {
    pendingTheme = appTheme;
    if (!monacoLoaded) {
        return;
    }
    void import("./monaco-env-monaco").then((monacoEnv) => {
        monacoEnv.setMonacoTheme(pendingTheme);
    });
}

/** @internal monaco-env-monaco 专用：读取启动以来记录的目标主题。 */
export function getPendingMonacoTheme(): ResolvedAppTheme {
    return pendingTheme;
}

/** @internal monaco-env-monaco 专用：配置完成后回写，让主题桩转为直连应用。 */
export function markMonacoLoaded(): void {
    monacoLoaded = true;
}

// 按需加载 Monaco（monaco-editor + 语言 contribution + monaco-yaml + workers）。
// 非阻塞：调用方不需要 await —— 编辑器组件（monaco-react）内部会在渲染时自行
// 等待模块就绪再创建编辑器实例。
export function ensureMonacoLoaded(): Promise<void> {
    if (!monacoLoadPromise) {
        monacoLoadPromise = import("./monaco-env-monaco").then((monacoEnv) => {
            monacoEnv.loadMonaco();
        });
    }
    return monacoLoadPromise;
}
