// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// W2-1（性能）：这个文件是 monaco-react 的**懒加载壳**，禁止在这里静态 import
// monaco-editor。真实实现（含 monaco-editor + 语言 contribution + workers）在
// ./monaco-react-impl，只在编辑器真正渲染时按需拉起。
//
// 为什么必须拆：codeeditor.tsx 被 waveconfig / preview-edit / onboarding / builder
// 静态引用，而这些 ViewModel 又从 builtinviews 静态进入每个终端 Tab 的入口 chunk；
// 只要 monaco-react 顶层静态 import monaco-editor，Monaco 就会重新变回启动依赖。

import type { CodeEditorProps, DiffViewerProps } from "@/app/monaco/monaco-react-impl";
import { lazy, Suspense } from "react";

const MonacoCodeEditorImpl = lazy(() =>
    import("./monaco-react-impl").then((m) => ({ default: m.MonacoCodeEditor }))
);
const MonacoDiffViewerImpl = lazy(() =>
    import("./monaco-react-impl").then((m) => ({ default: m.MonacoDiffViewer }))
);

export type { CodeEditorProps, DiffViewerProps };

// 编辑器加载期的占位：与真实编辑器容器同尺寸，避免块内布局跳变；不做额外 loading UI
// （块级挂载处已有统一加载态）。
const MonacoPlaceholder = () => <div className="flex flex-col h-full w-full" />;

export function MonacoCodeEditor(props: CodeEditorProps) {
    return (
        <Suspense fallback={<MonacoPlaceholder />}>
            <MonacoCodeEditorImpl {...props} />
        </Suspense>
    );
}

export function MonacoDiffViewer(props: DiffViewerProps) {
    return (
        <Suspense fallback={<MonacoPlaceholder />}>
            <MonacoDiffViewerImpl {...props} />
        </Suspense>
    );
}
