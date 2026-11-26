// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// W2-1（性能）：真正的 Monaco 配置模块。本文件静态 import monaco-editor（含语言
// contribution、monaco-yaml 与 6 个 `?worker`），只能被按需动态 import —— 入口
// 请走 `./monaco-env` 的 `ensureMonacoLoaded()`，否则 Monaco 会被灌进每个普通
// 终端 Tab 的入口 chunk。

import * as monaco from "monaco-editor";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution";
import "monaco-editor/esm/vs/language/css/monaco.contribution";
import "monaco-editor/esm/vs/language/html/monaco.contribution";
import "monaco-editor/esm/vs/language/json/monaco.contribution";
import "monaco-editor/esm/vs/language/typescript/monaco.contribution";
import { configureMonacoYaml } from "monaco-yaml";

import { getPendingMonacoTheme, markMonacoLoaded } from "@/app/monaco/monaco-env";
import { registerMarkdownFolding } from "@/app/monaco/markdown-folding";
import { MonacoSchemas } from "@/app/monaco/schemaendpoints";
import { isLightResolvedTheme } from "@/app/theme-mode";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import ymlWorker from "./yamlworker?worker";

let monacoConfigured = false;

export function setMonacoTheme(appTheme: ResolvedAppTheme) {
    monaco.editor.setTheme(isLightResolvedTheme(appTheme) ? "wave-theme-light" : "wave-theme-dark");
}

window.MonacoEnvironment = {
    getWorker(_, label) {
        if (label === "json") {
            return new jsonWorker();
        }
        if (label === "css" || label === "scss" || label === "less") {
            return new cssWorker();
        }
        if (label === "yaml" || label === "yml") {
            return new ymlWorker();
        }
        if (label === "html" || label === "handlebars" || label === "razor") {
            return new htmlWorker();
        }
        if (label === "typescript" || label === "javascript") {
            return new tsWorker();
        }
        return new editorWorker();
    },
};

export function loadMonaco() {
    if (monacoConfigured) {
        return;
    }
    monacoConfigured = true;
    monaco.editor.defineTheme("wave-theme-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [],
        colors: {
            "editor.background": "#00000000",
            "editorStickyScroll.background": "#00000055",
            "minimap.background": "#00000077",
            focusBorder: "#00000000",
        },
    });
    monaco.editor.defineTheme("wave-theme-light", {
        base: "vs",
        inherit: true,
        rules: [],
        colors: {
            // ponytail: transparent so the editor inherits the app's current light theme background
            // (mirrors wave-theme-dark). No solid color needed; follows window:bgcolor automatically.
            "editor.background": "#00000000",
            // light-tint backplates for sticky scroll / minimap so they read as distinct panels
            // (parity with wave-theme-dark's #00000055 / #00000077, inverted for light)
            "editorStickyScroll.background": "#ffffff55",
            "minimap.background": "#ffffff77",
            focusBorder: "#00000000",
        },
    });
    configureMonacoYaml(monaco, {
        validate: true,
        schemas: [],
    });
    registerMarkdownFolding(monaco);
    // 主题来自轻量桩记录的目标值：启动期可能已切过主题，但当时 Monaco 还没加载。
    setMonacoTheme(getPendingMonacoTheme());
    markMonacoLoaded();
    // Disable default validation errors for typescript and javascript
    monaco.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
    });
    monaco.json.jsonDefaults.setDiagnosticsOptions({
        validate: true,
        allowComments: false,
        enableSchemaRequest: true,
        schemas: MonacoSchemas,
    });
}
