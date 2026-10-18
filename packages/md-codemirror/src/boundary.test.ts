// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment node

/**
 * 包边界门禁：`md-codemirror` 必须零 React / 零 Monaco / 零宿主静态依赖。
 *
 * 与 md-core 的边界测试同一手法：**静态扫描源码**，不靠「能不能跑」证明。
 * 因为「能跑」只能证明当前 node_modules 里恰好都有；扫描能锁死未来。
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const SRC_DIR = resolve(__dirname);

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = resolve(dir, entry);
        if (statSync(full).isDirectory()) {
            out.push(...walk(full));
        } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

describe("包边界（静态扫描源码）", () => {
    const sources = walk(SRC_DIR);
    const all = sources.map((f) => readFileSync(f, "utf8")).join("\n");

    it("零 React：不出现 react / react-dom / react-markdown 导入", () => {
        const re = /import\s+.*\bfrom\s+["'](react|react-dom|react-markdown)["']/g;
        const hits = [...all.matchAll(re)].map((m) => m[0]);
        expect(hits, `md-codemirror 必须是框架无关的：\n${hits.join("\n")}`).toEqual([]);
    });

    it("零宿主：不出现宿主 `@/` 路径", () => {
        const re = /from\s+["']@\/[^"']+["']/g;
        const hits = [...all.matchAll(re)].map((m) => m[0]);
        expect(hits, "md-codemirror 必须零宿主静态依赖（宿主能力经 host adapter 注入）").toEqual([]);
    });

    it("零 Monaco：不引用 monaco 相关包", () => {
        const re = /from\s+["'][^"']*monaco[^"']*["']/gi;
        const hits = [...all.matchAll(re)].map((m) => m[0]);
        expect(hits).toEqual([]);
    });

    it("只允许裸包名与 @snorkeling/md-core 的纯子路径", () => {
        const bad: string[] = [];
        for (const file of sources) {
            const src = readFileSync(file, "utf8");
            for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
                const spec = m[1];
                // 允许：裸包名（@codemirror/*, @lezer/*, @snorkeling/md-core, 等）
                if (spec.startsWith(".") || spec.startsWith(".")) continue; // 相对
                if (!spec.startsWith("@snorkeling/md-core")) continue; // 裸包名
                if (/^@snorkeling\/md-core\/(core\/markdown-refs|shared\/|transform\/|remark\/|blocks\/|render\/|index)$/.test(spec)) {
                    continue;
                }
                bad.push(`${file.replace(SRC_DIR, "")}: ${spec}`);
            }
        }
        expect(bad, `md-core 子路径必须是纯模块（无 React/宿主）:\n${bad.join("\n")}`).toEqual([]);
    });

    it("源码文件不包含 React JSX 语法（无 .tsx）", () => {
        expect(sources.filter((f) => f.endsWith(".tsx"))).toEqual([]);
    });
});