// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * agent 路径引用的三级打开链：preview → search-in-files → none。
 *
 * - `preview`：`openFileLinkInPreview`（链接管线，与 markdown 面板同一套解析）
 * - `search`：`parseFileReference` + `searchSelectionInFiles`（跨 Tab Files 树 + stat 验证管线）
 * - `external`：http(s) 链接交 `openLink`
 * - `none`：识别不出 / 白名单外 scheme，交调用方决定（终端静默，AI 面板退 `openLink`）
 *
 * 默认依赖通过动态 import 拿到，保持本模块可被纯单测直接加载；测试通过
 * `opts.deps` 注入 mock 断言分流，不触发 Electron / store 侧效应。
 */

import { parseAgentPathRef } from "./agent-path-ref";
import type { ParsedFileReference } from "./selection-reference-parser";

export type OpenAgentPathResult = "preview" | "search" | "external" | "none";

export type AgentPathPreviewOptions = {
    connection?: string | null;
    baseDir?: string | null;
    lineNumber?: number | null;
};

export type AgentPathSearchOptions = {
    onFeedback?: (msg: string, kind: string) => void;
};

export type AgentPathOpenDeps = {
    openFileLinkInPreview: (href: string, opts?: AgentPathPreviewOptions) => Promise<boolean>;
    searchSelectionInFiles: (reference: ParsedFileReference, options?: AgentPathSearchOptions) => Promise<void>;
    openLink: (uri: string) => void;
};

export type OpenAgentPathOptions = {
    connection?: string | null;
    baseDir?: string | null;
    onFeedback?: (msg: string, kind: string) => void;
    /** 调用方已先行尝试过 preview（如 markdown Link.onClick 的既有调用）时跳过第一级。 */
    skipPreview?: boolean;
    /** 测试注入；缺省时延迟加载真实实现。 */
    deps?: AgentPathOpenDeps;
};

async function loadDefaultDeps(): Promise<AgentPathOpenDeps> {
    const [navigation, searchModule, globalModule] = await Promise.all([
        import("@/app/view/preview/file-link-navigation"),
        import("./selection-search-in-files"),
        import("@/store/global"),
    ]);
    return {
        openFileLinkInPreview: (href, opts) => navigation.openFileLinkInPreview(href, opts),
        searchSelectionInFiles: (reference, options) => searchModule.searchSelectionInFiles(reference, options),
        openLink: (uri) => {
            void globalModule.openLink(uri);
        },
    };
}

/**
 * 打开一个 agent 路径引用（链接 href / 选区文本）。返回实际走到的通道；
 * `"none"` 表示调用方需要自行兜底（终端静默，AI 面板退 `openLink`）。
 */
export async function openAgentPathRef(raw: string, opts?: OpenAgentPathOptions): Promise<OpenAgentPathResult> {
    const ref = parseAgentPathRef(raw);
    if (ref == null) {
        return "none";
    }
    if (ref.kind === "http") {
        const deps = opts?.deps ?? (await loadDefaultDeps());
        deps.openLink(ref.url ?? raw);
        return "external";
    }
    if (ref.kind !== "file") {
        return "none";
    }

    const deps = opts?.deps ?? (await loadDefaultDeps());
    const previewOptions: AgentPathPreviewOptions = {
        connection: opts?.connection,
        baseDir: opts?.baseDir,
        lineNumber: ref.lineNumber ?? null,
    };
    if (opts?.skipPreview !== true) {
        let opened = false;
        try {
            opened = await deps.openFileLinkInPreview(ref.filePath, previewOptions);
        } catch {
            opened = false;
        }
        if (opened) {
            return "preview";
        }
    }

    // 兜底：跨 Tab Files 树 + stat 验证 + 打分（searchSelectionInFiles 内部负责打开与反馈）。
    const reference: ParsedFileReference = {
        rawText: ref.refText,
        filePath: ref.filePath,
        lineNumber: ref.lineNumber,
        columnNumber: ref.columnNumber,
    };
    try {
        await deps.searchSelectionInFiles(reference, { onFeedback: opts?.onFeedback });
    } catch {
        // 兜底链是 best-effort：失败不再上抛，交调用方按 "search" 结果自行决定。
    }
    return "search";
}
