// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 文件夹索引徽标（实验插件）— 脚本沙箱。
// `.index/badges.js` 是用户任意 JS：默认在 Web Worker 里执行（无 DOM / 限时），
// worker 不可用（测试环境 / CSP 拒绝 blob worker）时降级为主线程执行（同一语义）。
// 坏语法 / 无 decorate 导出 / 单条抛错 → 脚本源降级（空 map 或跳过该条），不阻塞表格源。

import type { BadgeDeco, FolderIndexEntry, RawDeco } from "./folder-index-model";
import { normalizeDeco } from "./folder-index-model";

/** worker / 主线程共用的执行结果（归一化之前的原始返回） */
interface RawScriptRun {
    compileError?: string;
    raws: [string, RawDeco][];
    errors: number;
    errorSample?: string;
}

/** 归一化后的脚本源产出 */
export interface ScriptRunResult {
    map: Record<string, BadgeDeco>;
    rows: number;
    errors: number;
    errorSample?: string;
}

export const SCRIPT_TIMEOUT_MS = 5_000;

/** 主线程执行器（worker 不可用时的降级路径；语义与 WorkerSource 完全一致） */
export function executeDecorate(code: string, entries: FolderIndexEntry[]): RawScriptRun {
    let decorate: ((entry: FolderIndexEntry) => RawDeco | null) | null = null;
    try {
        decorate = new Function(
            '"use strict";' + code + ';return typeof decorate === "function" ? decorate : null;'
        )();
    } catch (e) {
        return { compileError: `脚本编译失败：${(e as Error).message}`, raws: [], errors: 0 };
    }
    if (typeof decorate !== "function") {
        return { compileError: "脚本未定义 decorate(entry) 函数", raws: [], errors: 0 };
    }
    const raws: [string, RawDeco][] = [];
    let errors = 0;
    let errorSample: string | undefined;
    for (const entry of entries) {
        let raw: RawDeco | null = null;
        try {
            raw = decorate(entry);
        } catch (e) {
            errors++;
            if (errorSample == null) {
                errorSample = `${entry.name}: ${(e as Error).message}`;
            }
            continue; // 单条失败只跳过该条
        }
        if (raw != null) {
            raws.push([entry.relPath, raw]);
        }
    }
    return { raws, errors, errorSample };
}

/** 把原始返回归一化成渲染徽标（主线程统一做，worker 里不重复实现） */
export function normalizeScriptRun(run: RawScriptRun): ScriptRunResult {
    const map: Record<string, BadgeDeco> = {};
    if (run.compileError != null) {
        return { map, rows: 0, errors: 1, errorSample: run.compileError };
    }
    let rows = 0;
    let errors = run.errors;
    let errorSample = run.errorSample;
    for (const [relPath, raw] of run.raws) {
        const deco = normalizeDeco(raw);
        if (deco == null) {
            errors++;
            if (errorSample == null) {
                errorSample = `${relPath}: 返回值既无合法 status 也无 emoji`;
            }
            continue;
        }
        map[relPath] = deco;
        rows++;
    }
    return { map, rows, errors, errorSample };
}

/**
 * Worker 源码：自包含字符串（不 import 模块），语义与 executeDecorate 一致。
 * 只做「安全调用 decorate」，归一化留给主线程 —— 两边零逻辑分叉。
 */
const WORKER_SOURCE = `
self.onmessage = function (e) {
    var code = e.data.code, entries = e.data.entries;
    var raws = [], errors = 0, errorSample = null, compileError = null;
    var decorate = null;
    try {
        decorate = new Function('"use strict";' + code + ';return typeof decorate === "function" ? decorate : null;')();
    } catch (err) {
        compileError = "脚本编译失败：" + err.message;
    }
    if (typeof decorate !== "function" && compileError == null) {
        compileError = "脚本未定义 decorate(entry) 函数";
    }
    if (compileError == null) {
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            try {
                var raw = decorate(entry);
                if (raw != null) raws.push([entry.relPath, raw]);
            } catch (err) {
                errors++;
                if (errorSample == null) errorSample = entry.name + ": " + err.message;
            }
        }
    }
    self.postMessage({ compileError: compileError, raws: raws, errors: errors, errorSample: errorSample });
};
`;

/** 跑脚本源：worker 优先，坏环境降级主线程，超时/异常 = 脚本源空 map。 */
export async function runScriptDecorations(
    code: string | null | undefined,
    entries: FolderIndexEntry[],
    timeoutMs: number = SCRIPT_TIMEOUT_MS
): Promise<ScriptRunResult> {
    if (code == null || code.trim() === "" || entries.length === 0) {
        return { map: {}, rows: 0, errors: 0 };
    }
    if (typeof Worker === "undefined") {
        return normalizeScriptRun(executeDecorate(code, entries));
    }
    return new Promise<ScriptRunResult>((resolve) => {
        let settled = false;
        let worker: Worker | null = null;
        let url: string | null = null;
        const finish = (run: RawScriptRun) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            worker?.terminate();
            if (url != null) {
                URL.revokeObjectURL(url);
            }
            resolve(normalizeScriptRun(run));
        };
        const timer = setTimeout(
            () => finish({ raws: [], errors: 1, errorSample: `脚本超时（>${timeoutMs}ms），脚本源降级` }),
            timeoutMs
        );
        try {
            url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
            worker = new Worker(url);
            worker.onmessage = (e: MessageEvent<RawScriptRun>) => finish(e.data);
            worker.onerror = () => {
                // worker 起不来（如 CSP 拒绝 blob worker）→ 主线程同语义降级
                finish(executeDecorate(code, entries));
            };
            worker.postMessage({ code, entries });
        } catch {
            finish(executeDecorate(code, entries));
        }
    });
}
