// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * md-core 边界门禁（md-core 抽离 P0 · C3）。
 *
 * 把「可抽离」从愿望变成**可执行的不变量**：这 4 个目录（+ `markdown-core/` 宿主缝隙）
 * 不得依赖宿主（`@/view`、`@/store`、`@/util`、`@/app/view`、`@/app/store`、`jotai`、`wos`），
 * 也不得反向依赖编辑壳（`markdown-inline-edit`）。
 *
 * 判定规则（对每个非测试源文件、每条 import specifier）：
 *   1. 裸包名（第三方：react / clsx / mdast / unified …）→ 允许。
 *   2. 解析后落在 4 个核心目录内 → 允许（核心内部互相引用）。
 *   3. 解析后落在 `markdown-core/`（宿主缝隙：host adapter / 纯引用解析 / classnames）→ 允许。
 *   4. 解析后落在其它任何地方（`frontend/app/element/markdown-util.ts`、
 *      `block-editor/**`、UI 原语、`../markdown-task-toggle` …）→ **必须**进白名单，
 *      且白名单每条都要有 `reason`。白名单 = Phase B 的搬移/保留决策清单。
 *   5. 命中禁列（宿主路径前缀 / 禁用包 / 编辑壳）→ **无条件失败**（白名单不能豁免）。
 *
 * 相对路径会被**解析**再判定，所以 `../../store/contextmenu` 这类绕过 alias 前缀检查的写法
 * 一样会被抓住。
 *
 * 为什么单独一个文件而不是搬进 packages：见任务 10-12-md-core-extract 的 design.md ——
 * 本任务只让边界**成立且可验证**，物理抽包是下一个任务。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** 待抽离的 4 个目录（Phase B 将成为 md-core/src/{transform,block-model,remark,render}）。 */
const CORE_DIRS = ["markdown-transform", "block-model", "remark", "markdown-render"] as const;

/** 宿主缝隙目录：允许被核心目录依赖（adapter / 纯引用解析 / classnames），自身不得有静态宿主 import。 */
const HOST_SEAM_DIR = "markdown-core";

const ELEMENT_DIR = fileURLToPath(new URL("./", import.meta.url));
const REPO_ROOT = resolve(ELEMENT_DIR, "../../..");

/** 禁列 1：宿主路径前缀（解析后的 repo 相对路径）。 */
const FORBIDDEN_REPO_PREFIXES = ["frontend/app/view/", "frontend/app/store/", "frontend/util/"];

/** 禁列 2：禁用包（宿主状态层）。 */
const FORBIDDEN_PACKAGES = ["jotai", "wos"];

/** 禁列 3：编辑壳模块名（核心层反向依赖它 = 抽离阻塞，见 C1）。 */
const FORBIDDEN_MODULE_BASENAMES = ["markdown-inline-edit"];

/**
 * 白名单：解析后落在核心目录之外的**非宿主**共享依赖（Phase B 的搬移/保留决策清单）。
 * 每条必须带 reason；不得包含任何禁列项（下面的用例会断言这一点）。
 * 键是 repo 相对路径（不含扩展名/`/index` 归一化前的原始解析结果）。
 */
const CORE_SHARED_ALLOWLIST: { module: string; reason: string }[] = [
    {
        module: "frontend/app/element/markdown-util",
        reason: "Phase B：纯 markdown/image/表格语法 helper 随 md-core 移入；图片 src 解析（resolveRemoteFile/resolveSrcSet）已改走 host adapter",
    },
    {
        module: "frontend/app/element/markdown-task-toggle",
        reason: "Phase B：task checkbox 文本变换是纯逻辑，移入 md-core/src/transform",
    },
    {
        module: "frontend/app/element/markdown-ordered-list",
        reason: "Phase B：有序列表重编号是纯逻辑，移入 md-core/src/transform",
    },
    {
        module: "frontend/app/element/markdown-contentblock-plugin",
        reason: "Phase B：内容块（contentblock）remark 插件依赖宿主 contentblock 模型，保留宿主侧或单独抽 plugin 包",
    },
    {
        module: "frontend/app/element/remark-mermaid-to-tag",
        reason: "Phase B：mermaid→tag 是纯 remark 语法变换，随 remark 插件集移入 md-core",
    },
    {
        module: "frontend/app/element/block-editor/flags",
        reason: "Phase B：block-editor 特性开关是宿主集成点，registry 拆分后移出 md-core",
    },
    {
        module: "frontend/app/element/block-editor/components/table-block",
        reason: "Phase B：表格 WYSIWYG 组件保留宿主侧（依赖 block-editor 运行时）",
    },
    {
        module: "frontend/app/element/copybutton",
        reason: "Phase B：UI 原语保留宿主侧（或移入 md-core/ui）",
    },
    {
        module: "frontend/app/element/iconbutton",
        reason: "Phase B：UI 原语保留宿主侧（或移入 md-core/ui）",
    },
];

const ALIAS_PREFIX_MAP: [string, string][] = [
    ["@/app/", "frontend/app/"],
    ["@/util/", "frontend/util/"],
    ["@/view/", "frontend/app/view/"],
    ["@/store/", "frontend/app/store/"],
    ["@/layout/", "frontend/layout/"],
    ["@/element/", "frontend/app/element/"],
    ["@/preview/", "frontend/preview/"],
    ["@/builder/", "frontend/builder/"],
    ["@/shadcn/", "frontend/app/shadcn/"],
];

type Specifier = { file: string; line: number; specifier: string; kind: "static" | "dynamic"; raw: string };

const STATIC_FROM_RE = /\bfrom\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

function listSourceFiles(dirAbs: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dirAbs)) {
        const abs = resolve(dirAbs, entry);
        if (statSync(abs).isDirectory()) {
            out.push(...listSourceFiles(abs));
            continue;
        }
        if (!/\.tsx?$/.test(entry)) {
            continue;
        }
        if (/\.test\.tsx?$/.test(entry)) {
            continue; // 测试文件可以引用任何东西（它们不在抽离范围内）
        }
        out.push(abs);
    }
    return out;
}

function repoRelative(absPath: string): string {
    return relative(REPO_ROOT, absPath).replace(/\\/g, "/");
}

/** 解析 specifier → repo 相对路径；裸包名返回 null。 */
function resolveSpecifier(specifier: string, fromFileAbs: string): string | null {
    if (specifier.startsWith(".")) {
        return repoRelative(resolve(dirname(fromFileAbs), specifier));
    }
    for (const [alias, target] of ALIAS_PREFIX_MAP) {
        if (specifier.startsWith(alias)) {
            return target + specifier.slice(alias.length);
        }
    }
    if (specifier.startsWith("@/")) {
        return "frontend/" + specifier.slice(2);
    }
    return null; // 裸包名（第三方）
}

function packageNameOf(specifier: string): string {
    const parts = specifier.split("/");
    return specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

/** 归一化白名单键：去掉扩展名（alias specifier 本身不带扩展名，相对 specifier 可能带）。 */
function stripExt(repoPath: string): string {
    return repoPath.replace(/\.(tsx?|scss|css|json)$/, "");
}

function moduleBasename(repoPath: string): string {
    const base = repoPath.split("/").pop() ?? "";
    return base.replace(/\.(tsx?|scss|css|json)$/, "");
}

/** 深度归一化：用于「是否落在核心目录 / markdown-core 内」的判定。 */
function normDir(repoPath: string): string {
    return repoPath.replace(/\/index\.tsx?$/, "").replace(/\.tsx?$/, "");
}

function isInCoreOrSeam(repoPath: string): boolean {
    const norm = normDir(repoPath);
    return (
        norm.startsWith("frontend/app/element/" + HOST_SEAM_DIR) ||
        CORE_DIRS.some((d) => norm === `frontend/app/element/${d}` || norm.startsWith(`frontend/app/element/${d}/`))
    );
}

function collectSpecifiers(files: string[]): Specifier[] {
    const out: Specifier[] = [];
    for (const abs of files) {
        const src = readFileSync(abs, "utf8");
        const lines = src.split("\n");
        const scan = (re: RegExp, kind: "static" | "dynamic") => {
            re.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = re.exec(src)) != null) {
                const line = src.slice(0, m.index).split("\n").length;
                out.push({ file: repoRelative(abs), line, specifier: m[1], kind, raw: (lines[line - 1] ?? "").trim() });
            }
        };
        scan(STATIC_FROM_RE, "static");
        scan(DYNAMIC_IMPORT_RE, "dynamic");
    }
    return out;
}

function coreSpecifiers(): Specifier[] {
    const files = CORE_DIRS.flatMap((d) => listSourceFiles(resolve(ELEMENT_DIR, d)));
    return collectSpecifiers(files);
}

function formatHit(s: Specifier, detail: string): string {
    return `${s.file}:${s.line} [${s.kind}] "${s.specifier}" — ${detail}\n    ${s.raw}`;
}

describe("md-core 边界门禁", () => {
    const specs = coreSpecifiers();

    it("扫描面非空（防止目录改名后门禁变成空转）", () => {
        expect(specs.length).toBeGreaterThan(50);
    });

    it("禁列：4 个核心目录不得依赖宿主（@/view @/store @/util @/app/view @/app/store jotai wos）", () => {
        const hits = specs
            .map((s) => {
                const resolved = resolveSpecifier(s.specifier, resolve(REPO_ROOT, s.file));
                if (resolved == null) {
                    const pkg = packageNameOf(s.specifier);
                    if (FORBIDDEN_PACKAGES.includes(pkg)) {
                        return formatHit(s, `禁用包 "${pkg}"`);
                    }
                    return null;
                }
                if (FORBIDDEN_REPO_PREFIXES.some((p) => resolved.startsWith(p))) {
                    return formatHit(s, `宿主路径（解析为 ${resolved}）`);
                }
                return null;
            })
            .filter((x): x is string => x != null);
        expect(hits, `核心目录出现宿主依赖：\n${hits.join("\n")}`).toEqual([]);
    });

    it("禁列：4 个核心目录不得依赖编辑壳 markdown-inline-edit（反向依赖）", () => {
        const hits = specs
            .map((s) => {
                const resolved = resolveSpecifier(s.specifier, resolve(REPO_ROOT, s.file));
                if (resolved == null) {
                    return null;
                }
                if (FORBIDDEN_MODULE_BASENAMES.includes(moduleBasename(resolved))) {
                    return formatHit(s, `反向依赖编辑壳（解析为 ${resolved}）`);
                }
                return null;
            })
            .filter((x): x is string => x != null);
        expect(hits, `核心目录反向依赖编辑壳：\n${hits.join("\n")}`).toEqual([]);
    });

    it("白名单：核心目录外的一切共享依赖必须逐条登记 + reason", () => {
        const allow = new Set(CORE_SHARED_ALLOWLIST.map((e) => e.module));
        const hits = specs
            .map((s) => {
                const resolved = resolveSpecifier(s.specifier, resolve(REPO_ROOT, s.file));
                if (resolved == null || isInCoreOrSeam(resolved)) {
                    return null;
                }
                if (allow.has(stripExt(resolved))) {
                    return null;
                }
                return formatHit(s, `未登记的跨目录依赖（解析为 ${resolved}）`);
            })
            .filter((x): x is string => x != null);
        expect(
            hits,
            `出现未登记的跨目录共享依赖（请评估后加入 CORE_SHARED_ALLOWLIST 并写明 reason）：\n${hits.join("\n")}`
        ).toEqual([]);
    });

    it("白名单本身：每条都有 reason，且不得包含任何禁列项", () => {
        const badReason = CORE_SHARED_ALLOWLIST.filter((e) => !e.reason || e.reason.trim().length < 8).map(
            (e) => e.module
        );
        expect(badReason, `白名单缺少 reason：${badReason.join(", ")}`).toEqual([]);
        const forbidden = CORE_SHARED_ALLOWLIST.filter((e) => {
            if (FORBIDDEN_REPO_PREFIXES.some((p) => e.module.startsWith(p))) {
                return true;
            }
            if (FORBIDDEN_PACKAGES.includes(packageNameOf(e.module))) {
                return true;
            }
            return FORBIDDEN_MODULE_BASENAMES.includes(moduleBasename(e.module));
        }).map((e) => e.module);
        expect(forbidden, `白名单里出现了禁列项（禁列不可豁免）：${forbidden.join(", ")}`).toEqual([]);
    });

    it("白名单不得残留未使用的条目（保持它 = Phase B 搬移集的真实性）", () => {
        const used = new Set(
            specs
                .map((s) => resolveSpecifier(s.specifier, resolve(REPO_ROOT, s.file)))
                .filter((p): p is string => p != null)
                .map(stripExt)
        );
        const stale = CORE_SHARED_ALLOWLIST.filter((e) => !used.has(e.module)).map((e) => e.module);
        expect(stale, `以下白名单条目已无引用，请删除以免白名单膨胀：${stale.join(", ")}`).toEqual([]);
    });

    it("宿主缝隙 markdown-core 自身不得有静态宿主 import（默认实现只能动态 import）", () => {
        const files = listSourceFiles(resolve(ELEMENT_DIR, HOST_SEAM_DIR));
        const staticSpecs = collectSpecifiers(files).filter((s) => s.kind === "static");
        const hits = staticSpecs
            .map((s) => {
                const resolved = resolveSpecifier(s.specifier, resolve(REPO_ROOT, s.file));
                if (resolved == null) {
                    const pkg = packageNameOf(s.specifier);
                    return FORBIDDEN_PACKAGES.includes(pkg) ? formatHit(s, `禁用包 "${pkg}"`) : null;
                }
                if (FORBIDDEN_REPO_PREFIXES.some((p) => resolved.startsWith(p))) {
                    return formatHit(s, `静态宿主依赖（解析为 ${resolved}）`);
                }
                if (FORBIDDEN_MODULE_BASENAMES.includes(moduleBasename(resolved))) {
                    return formatHit(s, `反向依赖编辑壳（解析为 ${resolved}）`);
                }
                return null;
            })
            .filter((x): x is string => x != null);
        expect(hits, `markdown-core 出现静态宿主依赖：\n${hits.join("\n")}`).toEqual([]);
    });
});
