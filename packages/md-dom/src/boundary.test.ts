// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * `md-dom` 边界门禁 —— 把「框架无关、可单独拿出去用」从愿望变成**可执行的不变量**。
 *
 * 目标（Obsidian 方案 `11-我们自己的Milkdown-架构与公开API.md`）：
 * 消费方 **journal** 是纯 ESM、零框架、无打包器的 Chrome 扩展
 * （`type: module`、`dependencies: {}`）。它不可能为了笔记编辑去引 React 运行时。
 * 所以本包必须真的能脱离 React 与宿主单独构建、单独测试、单独被依赖。
 *
 * 三条不变量（任一违反即红）：
 *   ① **零 React 运行时依赖** —— 不 import react / react-dom / react-markdown / jotai / wos…
 *      这是「非 React 消费方能用它」的全部意义。React 绑定属于 `md-react`。
 *   ② **零宿主静态依赖** —— 不 import 宿主 `@/` 路径；相对路径必须解析后仍落在包内
 *      （`../../frontend/...` 这类绕过 alias 前缀检查的写法会被抓住，因为路径是先解析再判定的）。
 *   ③ **允许的依赖只有 `@md/core` 与第三方裸包名** —— 包间依赖必须单向：md-core ← md-dom ← md-react。
 *
 * 为什么这三条要用测试而不是文档：本仓库吃过「文档写着可独立，实际悄悄 import 了宿主」的亏 ——
 * 等到真要抽离时才发现要动几十处。边界只有在有人踩线时立刻变红才守得住。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SELF_DIR, "../../..");
const PACKAGE_SRC = resolve(REPO_ROOT, "packages/md-dom/src");
const PACKAGE_SRC_REL = "packages/md-dom/src";

/** 禁列 1：React / 宿主状态层 —— 它们的出现会让本包无法被非 React 消费方使用。 */
const FORBIDDEN_PACKAGES = [
    "react",
    "react-dom",
    "react-markdown",
    "jotai",
    "wos",
    "electron",
    "@reduxjs/toolkit",
];

/** 禁列 2：宿主路径前缀（解析后的 repo 相对路径）。 */
const FORBIDDEN_REPO_PREFIXES = ["frontend/", "tsunami/", "docs/", "packages/md-react/"];

/** 允许的包内依赖（monorepo 内其它 workspace 包）：单向，md-dom 只能依赖 md-core。 */
const ALLOWED_WORKSPACE_PACKAGES = ["@md/core", "@snorkeling/md-core"];

function listSourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = resolve(dir, entry);
        if (statSync(full).isDirectory()) {
            out.push(...listSourceFiles(full));
        } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

/** 抽出文件里所有 import/export-from 说明符（含动态 import）。 */
function importSpecifiers(source: string): string[] {
    const out: string[] = [];
    const patterns = [
        /\bfrom\s*["']([^"']+)["']/g,
        /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
        /^\s*import\s+["']([^"']+)["']/gm,
    ];
    for (const re of patterns) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(source)) != null) {
            out.push(m[1]);
        }
    }
    return out;
}

const FILES = listSourceFiles(PACKAGE_SRC);

describe("md-dom 边界：框架无关、可单独拿出去用", () => {
    it("扫描面非空（防止目录改名/搬走后门禁空转）", () => {
        expect(FILES.length).toBeGreaterThan(0);
        expect(FILES.some((f) => f.endsWith("block-syntax.ts"))).toBe(true);
    });

    it("① 零 React 运行时依赖（不在包内 import react / react-dom / react-markdown）", () => {
        const violations: string[] = [];
        for (const file of FILES) {
            for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
                if (FORBIDDEN_PACKAGES.includes(spec) || FORBIDDEN_PACKAGES.some((p) => spec.startsWith(`${p}/`))) {
                    violations.push(`${relative(REPO_ROOT, file)} → ${spec}`);
                }
            }
        }
        expect(
            violations,
            `md-dom 不得依赖 React / 宿主状态层（那是 md-react 的职责）：\n${violations.join("\n")}`
        ).toEqual([]);
    });

    it("② 零宿主静态依赖（相对路径解析后必须仍落在包内）", () => {
        const violations: string[] = [];
        for (const file of FILES) {
            for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
                if (spec.startsWith("@/")) {
                    violations.push(`${relative(REPO_ROOT, file)} → ${spec}（宿主 alias）`);
                    continue;
                }
                if (!spec.startsWith(".")) {
                    continue;
                }
                const resolved = resolve(dirname(file), spec);
                const rel = relative(REPO_ROOT, resolved);
                if (rel.startsWith("..") || FORBIDDEN_REPO_PREFIXES.some((p) => rel.startsWith(p))) {
                    violations.push(`${relative(REPO_ROOT, file)} → ${spec}（逃出包外：${rel}）`);
                }
            }
        }
        expect(
            violations,
            `md-dom 不得静态依赖宿主（相对路径逃逸 / @/ alias）：\n${violations.join("\n")}`
        ).toEqual([]);
    });

    it("③ 包间依赖单向：只允许 @md/core 与第三方裸包名", () => {
        const violations: string[] = [];
        for (const file of FILES) {
            for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
                if (spec.startsWith(".") || spec.startsWith("node:")) {
                    continue;
                }
                if (ALLOWED_WORKSPACE_PACKAGES.some((p) => spec === p || spec.startsWith(`${p}/`))) {
                    continue;
                }
                // 其它 @scope/... 或 @scope 形式一律视为未授权的 workspace 包
                if (spec.startsWith("@")) {
                    violations.push(`${relative(REPO_ROOT, file)} → ${spec}`);
                }
            }
        }
        expect(
            violations,
            `md-dom 出现了未授权的包间依赖（只允许 @md/core 与第三方裸包名）：\n${violations.join("\n")}`
        ).toEqual([]);
    });

    it("包内不得出现 JSX/TSX（框架无关层不该有视图代码；视图属于 md-react）", () => {
        const tsx = FILES.filter((f) => f.endsWith(".tsx")).map((f) => relative(REPO_ROOT, f));
        expect(tsx, `md-dom 里出现了 .tsx（视图代码应在 md-react）：${tsx.join(", ")}`).toEqual([]);
    });

    it("包源码在预期路径下（防止搬走一半后门禁空转）", () => {
        expect(FILES.every((f) => relative(REPO_ROOT, f).startsWith(PACKAGE_SRC_REL))).toBe(true);
    });
});
