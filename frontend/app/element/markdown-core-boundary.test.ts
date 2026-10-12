// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * md-core 边界门禁（md-core 抽离 P0 · C3 → 物理抽包 10-12 改指向 `packages/md-core/src`）。
 *
 * 把「可抽离」从愿望变成**可执行的不变量**：`packages/md-core` 里的源码
 * **不得静态依赖包外的任何东西**（宿主 `@/...`、相对路径逃逸、`@md/core` 自身别名），
 * 只允许
 *   1. 相对路径且落在包内（包内一律相对导入）；
 *   2. 裸包名（第三方：react / clsx / mdast / unified …）。
 *
 * **唯一的例外是「宿主缝隙」**：`core/host.ts` 可以用**动态** `import()` 延迟加载宿主模块 ——
 * 那是 adapter 的默认实现，必须逐条登记 + 写明 reason（下面的 `HOST_SEAM_DYNAMIC_IMPORTS`）。
 * 动态入口只有这一处、静态零入口，所以「这个包依赖宿主什么」是一张可 review 的清单，
 * 而不是散落全仓的 import。
 *
 * 相对路径会被**解析**再判定，所以 `../../frontend/...` 这类绕过 alias 前缀检查的写法
 * 一样会被抓住（并且这里没有 alias 可用：包内禁止 `@/` 与 `@md/core`）。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ELEMENT_DIR = fileURLToPath(new URL("./", import.meta.url));
const REPO_ROOT = resolve(ELEMENT_DIR, "../../..");
/** 被测包源码根（repo 相对路径 `packages/md-core/src`）。 */
const PACKAGE_SRC = resolve(REPO_ROOT, "packages/md-core/src");
const PACKAGE_SRC_REL = "packages/md-core/src";
/** 宿主缝隙模块：唯一允许出现宿主动态 import 的文件（repo 相对路径）。 */
const HOST_SEAM_FILE = `${PACKAGE_SRC_REL}/core/host.ts`;

/** 禁列 1：宿主路径前缀（解析后的 repo 相对路径）——静态命中即失败。 */
const FORBIDDEN_REPO_PREFIXES = ["frontend/app/view/", "frontend/app/store/", "frontend/util/"];

/** 禁列 2：禁用包（宿主状态层）——静态或动态命中都失败。 */
const FORBIDDEN_PACKAGES = ["jotai", "wos"];

/** 禁列 3：编辑壳模块名（反向依赖它 = 抽离阻塞）。 */
const FORBIDDEN_MODULE_BASENAMES = ["markdown-inline-edit"];

/** 禁列 4：宿主 / 自身别名前缀（包内必须用相对路径，别名会让独立构建解析不到）。 */
const FORBIDDEN_SPECIFIER_PREFIXES = ["@/", "@md/core"];

/**
 * 宿主缝隙清单：`core/host.ts` 里**动态** import 的宿主模块。每条必须有 reason。
 * 这份清单就是「这个包到底依赖宿主什么」的答案 —— 新增宿主能力时，只能经 adapter 加在这里。
 */
const HOST_SEAM_DYNAMIC_IMPORTS: { module: string; reason: string }[] = [
    {
        module: "@/app/element/image-lightbox",
        reason: "灯箱是宿主 UI 组件；经 React.lazy thunk 延迟加载，首次点开图片时才求值",
    },
    {
        module: "@/app/element/markdown-util",
        reason: "图片 src / srcSet 解析需要 RPC + connection（resolveRemoteFile / resolveSrcSet），只在真正解析图片时加载",
    },
    {
        module: "@/app/store/contextmenu",
        reason: "右键菜单是 Electron 原生菜单，只在用户实际触发右键时加载",
    },
    {
        module: "@/app/store/global",
        reason: "openLink 走宿主系统默认程序打开，点链接时才加载",
    },
    {
        module: "@/app/view/preview/file-link-navigation",
        reason: "文件引用导航需要宿主 block / tab / layout；打开引用时才加载",
    },
    {
        module: "@/app/element/block-editor/components/table-block",
        reason: "WYSIWYG 表格块依赖 block-editor 运行时，无法随包搬走（10-12 R4 宿主 UI 组件）",
    },
    {
        module: "@/app/element/copybutton",
        reason: "复制按钮是宿主 UI 原语（依赖 @/util + 宿主 scss），无法随包搬走（10-12 R4）",
    },
    {
        module: "@/app/element/iconbutton",
        reason: "图标按钮是宿主 UI 原语（依赖 jotai / useLongClick / @/util），无法随包搬走（10-12 R4）",
    },
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
            continue; // 测试文件不算包的生产依赖（它们不在独立构建的入口图里）
        }
        out.push(abs);
    }
    return out;
}

function repoRelative(absPath: string): string {
    return relative(REPO_ROOT, absPath).replace(/\\/g, "/");
}

/** 解析 specifier → repo 相对路径；裸包名 / 别名返回 null。 */
function resolveSpecifier(specifier: string, fromFileAbs: string): string | null {
    if (specifier.startsWith(".")) {
        return repoRelative(resolve(dirname(fromFileAbs), specifier));
    }
    return null;
}

function packageNameOf(specifier: string): string {
    const parts = specifier.split("/");
    return specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

function moduleBasename(repoPath: string): string {
    const base = repoPath.split("/").pop() ?? "";
    return base.replace(/\.(tsx?|scss|css|json)$/, "");
}

function isAliasSpecifier(specifier: string): boolean {
    return FORBIDDEN_SPECIFIER_PREFIXES.some((p) => specifier === p || specifier.startsWith(p + "/"));
}

/** 面包屑 → 是否落在包内（含包根自身）。 */
function isInsidePackage(repoPath: string): boolean {
    return repoPath === PACKAGE_SRC_REL || repoPath.startsWith(PACKAGE_SRC_REL + "/");
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

function formatHit(s: Specifier, detail: string): string {
    return `${s.file}:${s.line} [${s.kind}] "${s.specifier}" — ${detail}\n    ${s.raw}`;
}

/** 静态非法（逃出包 / 用别名 / 命中禁列）的判定，命中返回说明文案。 */
function staticViolation(s: Specifier): string | null {
    const resolved = resolveSpecifier(s.specifier, resolve(REPO_ROOT, s.file));
    if (resolved != null) {
        if (!isInsidePackage(resolved)) {
            return `静态依赖逃出包（解析为 ${resolved}）`;
        }
        if (FORBIDDEN_REPO_PREFIXES.some((p) => resolved.startsWith(p))) {
            return `宿主路径（解析为 ${resolved}）`;
        }
        if (FORBIDDEN_MODULE_BASENAMES.includes(moduleBasename(resolved))) {
            return `反向依赖编辑壳（解析为 ${resolved}）`;
        }
        return null;
    }
    if (isAliasSpecifier(s.specifier)) {
        const which = s.specifier.startsWith("@/") ? "宿主 @/" : "自身 @md/core";
        return `用了${which}别名（包内必须相对导入）`;
    }
    const pkg = packageNameOf(s.specifier);
    if (FORBIDDEN_PACKAGES.includes(pkg)) {
        return `禁用包 "${pkg}"`;
    }
    return null; // 第三方裸包名 → 允许
}

describe("md-core 边界门禁（packages/md-core）", () => {
    const specs = collectSpecifiers(listSourceFiles(PACKAGE_SRC));
    const staticSpecs = specs.filter((s) => s.kind === "static");
    const dynamicSpecs = specs.filter((s) => s.kind === "dynamic");
    const dynamicHostSpecs = dynamicSpecs.filter((s) => s.specifier.startsWith("@/"));

    it("扫描面非空（防止目录改名后门禁变成空转）", () => {
        expect(staticSpecs.length).toBeGreaterThan(50);
    });

    it("静态依赖：包内只能相对 import 包内文件或第三方裸包名（逃出包 / 用别名即失败）", () => {
        const hits = staticSpecs
            .map((s) => {
                const violation = staticViolation(s);
                return violation == null ? null : formatHit(s, violation);
            })
            .filter((x): x is string => x != null);
        expect(hits, `packages/md-core 出现静态越界依赖：\n${hits.join("\n")}`).toEqual([]);
    });

    it("包内零 `@/` 宿主静态 import，也零 `@md/core` 自身别名（物理抽包 R4 硬不变量）", () => {
        const hostHits = staticSpecs
            .filter((s) => s.specifier === "@/" || s.specifier.startsWith("@/"))
            .map((s) => formatHit(s, "包内不得静态 import 宿主路径"));
        const selfHits = staticSpecs
            .filter((s) => s.specifier === "@md/core" || s.specifier.startsWith("@md/core/"))
            .map((s) => formatHit(s, "包内自引用别名会打断独立构建"));
        const hits = [...hostHits, ...selfHits];
        expect(hits, `packages/md-core 静态 import 了宿主/自身别名：\n${hits.join("\n")}`).toEqual([]);
    });

    it("宿主缝隙：宿主 import 只允许 core/host.ts 的动态 `import()`，且不得命中禁用包", () => {
        const notInSeam = dynamicHostSpecs
            .filter((s) => s.file !== HOST_SEAM_FILE)
            .map((s) => formatHit(s, `动态宿主 import 只允许写在 ${HOST_SEAM_FILE}`));
        const forbiddenPkgs = specs
            .filter((s) => FORBIDDEN_PACKAGES.includes(packageNameOf(s.specifier)))
            .map((s) => formatHit(s, `禁用包 "${packageNameOf(s.specifier)}"（静态/动态都不允许）`));
        const hits = [...notInSeam, ...forbiddenPkgs];
        expect(hits, `宿主缝隙越界：\n${hits.join("\n")}`).toEqual([]);
    });

    it("宿主缝隙清单：每条都有 reason，且不得与禁列冲突", () => {
        const badReason = HOST_SEAM_DYNAMIC_IMPORTS.filter((e) => !e.reason || e.reason.trim().length < 8).map(
            (e) => e.module
        );
        expect(badReason, `宿主缝隙清单缺少 reason：${badReason.join(", ")}`).toEqual([]);
        const forbidden = HOST_SEAM_DYNAMIC_IMPORTS.filter((e) => FORBIDDEN_PACKAGES.includes(packageNameOf(e.module)))
            .map((e) => e.module);
        expect(forbidden, `清单里出现了禁列项（禁列不可豁免）：${forbidden.join(", ")}`).toEqual([]);
    });

    it("宿主缝隙清单不得残留未使用的条目（保持它 = 该包真实宿主依赖面的真实性）", () => {
        const used = new Set(dynamicHostSpecs.map((s) => s.specifier));
        const stale = HOST_SEAM_DYNAMIC_IMPORTS.filter((e) => !used.has(e.module)).map((e) => e.module);
        expect(stale, `以下宿主缝隙条目已无引用，请删除以免清单膨胀：${stale.join(", ")}`).toEqual([]);
    });

    it("宿主缝隙清单覆盖所有宿主动态 import（新增必须登记）", () => {
        const declared = new Set(HOST_SEAM_DYNAMIC_IMPORTS.map((e) => e.module));
        const undeclared = [...new Set(dynamicHostSpecs.map((s) => s.specifier))]
            .filter((m) => !declared.has(m))
            .map((m) => `${m}（未登记的宿主动态 import）`);
        expect(undeclared, `宿主缝隙清单缺条目：\n${undeclared.join("\n")}`).toEqual([]);
    });
});
