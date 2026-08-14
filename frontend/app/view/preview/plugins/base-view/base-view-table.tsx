// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Base 视图只读表格组件（Phase 1）。
// 数据流：.base 文件路径 → 读内容 → 解析配置 → 按 filters 扫描目录 → 读 frontmatter → 求值 → 表格。
// 设计原则：只依赖文件系统（RPC），与 Obsidian 解耦；不实现公式/排序/分组（Phase 1 明确范围）。

import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import type { PreviewEnv } from "@/app/view/preview/previewenv";
import type { PreviewModel } from "@/app/view/preview/preview-model";
import { fireAndForget, base64ToString } from "@/util/util";
import { formatRemoteUri } from "@/util/waveutil";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { parseBaseConfig, BaseConfig } from "./base-config";
import { collectScanFolders, evalFilter, NoteMeta, parseFrontmatter } from "./base-filter";
import "./base-view-table.scss";

type Row = {
    [key: string]: string;
};

const MAX_ROWS = 1000;
const MAX_SCAN_FILES = 5000;

export function BaseViewTable({ model }: { model: PreviewModel }) {
    const env = useWaveEnv<PreviewEnv>();
    const filePath = useAtomValue(model.metaFilePath);
    const connection = useAtomValue(model.connection);
    const [rows, setRows] = useState<Row[] | null>(null);
    const [columns, setColumns] = useState<{ property: string; displayName: string }[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (filePath == null) {
            return;
        }
        setLoading(true);
        setError(null);
        fireAndForget(async () => {
            try {
                const { rows: r, columns: c, error: e } = await loadBaseView(env, connection, filePath);
                setRows(r);
                setColumns(c);
                setError(e);
            } catch (e) {
                setError(`加载失败: ${e}`);
            } finally {
                setLoading(false);
            }
        });
        // env 引用稳定；依赖 filePath/connection 触发重载即可。
    }, [filePath, connection]);

    if (loading) {
        return <div className="base-view-status">加载中…</div>;
    }
    if (error != null) {
        return <div className="base-view-status">{error}</div>;
    }
    if (rows == null || rows.length === 0) {
        return <div className="base-view-status">（空：没有匹配的笔记）</div>;
    }

    return (
        <div className="base-view-wrap">
            <table className="base-view-table">
                <thead>
                    <tr>
                        {columns.map((col) => (
                            <th key={col.property}>{col.displayName}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => (
                        <tr key={i}>
                            {columns.map((col) => (
                                <td key={col.property} className={isFormulaColumn(col.property) ? "base-view-formula" : undefined}>
                                    {isFormulaColumn(col.property) ? "公式暂不支持" : row[col.property] ?? ""}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function isFormulaColumn(property: string): boolean {
    return property.startsWith("formula.") || property.startsWith("file.mtime") || property.startsWith("file.ctime");
}

// 从 .base 文件路径推断扫描根：Phase 1 简化为 .base 所在目录（递归扫描其所有子目录）。
// ponytail: 覆盖了主流用法（base 文件是某文件夹的“总览”，inFolder 引用其子目录）。
// 上限：不推断 vault 根，因此 base 引用祖先目录（vault 根级路径）的用例暂不支持，|（绝少出现）。
function inferScanRoot(basePath: string): string {
    const idx = basePath.replace(/\\/g, "/").lastIndexOf("/");
    return idx >= 0 ? basePath.slice(0, idx) : basePath;
}

async function loadBaseView(
    env: PreviewEnv,
    connection: string,
    basePath: string
): Promise<{ rows: Row[]; columns: { property: string; displayName: string }[]; error: string | null }> {
    // 1. 读 .base 内容
    const remoteBase = formatRemoteUri(basePath, connection);
    const baseFile = await env.rpc.FileReadCommand(TabRpcClient, { info: { path: remoteBase, mimetype: "" } });
    const baseContent = base64ToString(baseFile?.data64) ?? "";
    const parsed = parseBaseConfig(baseContent);
    if (!parsed.ok) {
        return { rows: [], columns: [], error: (parsed as { ok: false; error: string }).error };
    }
    const config: BaseConfig = parsed.config;

    // 2. 扫描范围：Phase 1 简化为 .base 所在目录（递归），不推断 vault 根。
    const scanRoot = inferScanRoot(basePath);

    // 3. 扫描 md 文件（递归），读 frontmatter
    const metas: NoteMeta[] = [];
    await scanDir(env, connection, scanRoot, metas);

    // 4. filters 求值
    const matched = metas.filter((meta) => evalFilter(config.filters, meta)).slice(0, MAX_ROWS);

    // 5. 组装列：properties 顺序 + 未在 properties 但出现在 order 的属性
    const order = config.views[0]?.order ?? [];
    const colMap = new Map(config.columns.map((c) => [c.property, c.displayName]));
    for (const prop of order) {
        if (!colMap.has(prop)) {
            colMap.set(prop, prop);
        }
    }
    const columns = [...colMap.entries()].map(([property, displayName]) => ({ property, displayName }));

    const rows: Row[] = matched.map((meta) => {
        const row: Row = {};
        for (const col of columns) {
            const property = col.property;
            if (property === "file.name") {
                row[property] = meta.fileName;
            } else if (property === "file.folder") {
                const folder = meta.filePath.slice(0, meta.filePath.lastIndexOf("/"));
                // 相对 scanRoot 显示目录（与 Obsidian 的相对 vault 根显示一致的基础）。
                const rel = folder.startsWith(scanRoot) ? folder.slice(scanRoot.length) : folder;
                row[property] = rel.replace(/^\//, "") || "/";
            } else if (property.startsWith("file.")) {
                row[property] = "";
            } else {
                const val = meta.frontmatter[property.startsWith("note.") ? property.slice(5) : property];
                row[property] = formatCellValue(val);
            }
        }
        return row;
    });

    return { rows, columns, error: null };
}
function formatCellValue(val: unknown): string {
    if (val == null) {
        return "";
    }
    if (Array.isArray(val)) {
        return val.join(", ");
    }
    if (typeof val === "object") {
        return JSON.stringify(val);
    }
    return String(val);
}

async function scanDir(env: PreviewEnv, connection: string, dirPath: string, acc: NoteMeta[]): Promise<void> {
    const remotePath = formatRemoteUri(dirPath, connection);
    const stream = env.rpc.FileListStreamCommand(TabRpcClient, { path: remotePath }, null);
    const files: FileInfo[] = [];
    const subdirs: string[] = [];
    try {
        for await (const chunk of stream) {
            for (const fi of chunk?.fileinfo ?? []) {
                if (fi.isdir) {
                    subdirs.push(fi.path);
                } else if (fi.name?.endsWith(".md")) {
                    files.push(fi);
                }
            }
        }
    } catch {
        // 目录不可读则跳过
    }
    for (const fi of files) {
        if (acc.length >= MAX_SCAN_FILES) {
            return;
        }
        try {
            const remote = formatRemoteUri(fi.path, connection);
            const file = await env.rpc.FileReadCommand(TabRpcClient, { info: { path: remote, mimetype: fi.mimetype ?? "" } });
            const content = base64ToString(file?.data64) ?? "";
            const frontmatter = parseFrontmatter(content);
            const name = fi.name ?? "";
            acc.push({
                filePath: fi.path,
                fileName: name,
                ext: name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "",
                frontmatter,
            });
        } catch {
            // 单个文件读失败跳过
        }
    }
    for (const sub of subdirs) {
        if (acc.length >= MAX_SCAN_FILES) {
            return;
        }
        await scanDir(env, connection, sub, acc);
    }
}
