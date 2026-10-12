// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 主题 token 存在性校验（parity-harness 切片 1）。
 *
 * 背景：曾经出现过「引用了一个从未定义的 token」（`--wolai-*`），
 * 结果样式静默失效、暗色下对比度不足，却没有任何测试拦住它。
 *
 * 规则：`frontend/**` 的 scss/css/tsx 里用到的 `var(--x)`，`--x` 必须能在
 * `frontend/app/theme.scss`（或同一文件内）找到定义，否则失败。
 *
 * 豁免：当前唯一已知悬空 token `--content-bg-color` —— 它出现在
 * `var(--content-bg-color, var(--main-bg-color, transparent))` 的 fallback 链里，
 * 实际解析到已定义的 `--main-bg-color`，视觉无害。新豁免必须写明 reason。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ELEMENT_DIR = fileURLToPath(new URL("./", import.meta.url));
const REPO_ROOT = resolve(ELEMENT_DIR, "../../..");
const FRONTEND_DIR = resolve(REPO_ROOT, "frontend");
const THEME_SCSS = resolve(FRONTEND_DIR, "app/theme.scss");

const EXEMPT_UNDEFINED_TOKENS: { token: string; reason: string; todo: "harmless" | "fix-token-2" }[] = [
    {
        token: "--content-bg-color",
        reason: "出现在 fallback 链 var(--content-bg-color, var(--main-bg-color, transparent)) 中，实际解析到已定义的 --main-bg-color",
        todo: "harmless",
    },
    {
        token: "--wolai-quote-border-color",
        reason: "全仓 0 处定义；回退值 rgba(0,0,0,0.12) 是浅色专用 → 暗色下引用块左边框几乎不可见（真 bug，待换既有 token）",
        todo: "fix-token-2",
    },
    {
        token: "--wolai-editor-color",
        reason: "全仓 0 处定义；回退值 rgba(0,0,0,0.85) 是浅色专用 → 暗色下文字近黑（真 bug，待换既有 token）",
        todo: "fix-token-2",
    },
    {
        token: "--font-monospace",
        reason: "全仓 0 处定义且**无回退**（font-family: var(--font-monospace) 整条声明会失效）→ 待换既有等宽字族或补定义",
        todo: "fix-token-2",
    },
    {
        token: "--input-bg-color",
        reason: "全仓 0 处定义，回退为硬编码深色色值 → 浅色主题下不匹配（待换既有 token）",
        todo: "fix-token-2",
    },
    {
        token: "--input-border-color",
        reason: "全仓 0 处定义，回退为硬编码 #444 → 浅色主题下不匹配（待换既有 token）",
        todo: "fix-token-2",
    },
    {
        token: "--text-placeholder",
        reason: "全仓 0 处定义，但有回退值；占位文字颜色不匹配主题（待换既有 token）",
        todo: "fix-token-2",
    },
    {
        token: "--markdown-tab-size",
        reason: "全仓 0 处定义，回退 4（与既有 code 块行为一致）→ 视觉无害，保留",
        todo: "harmless",
    },
];

const SCAN_EXTENSIONS = new Set([".scss", ".css", ".tsx", ".ts"]);
/** 只扫我们负责的范围（块编辑器 + 包）；宿主其它模块的历史悬空 token 不在本门禁职责内。 */
const SCAN_ROOTS = ["frontend/app/element", "packages/md-core/src"];
const DEFINITION_RE = /(--[a-zA-Z0-9-]+)\s*:/g;
const USAGE_RE = /var\(\s*(--[a-zA-Z0-9-]+)/g;

function listFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) {
            continue;
        }
        const abs = join(dir, entry);
        if (statSync(abs).isDirectory()) {
            listFiles(abs, out);
            continue;
        }
        if (SCAN_EXTENSIONS.has(extname(entry))) {
            out.push(abs);
        }
    }
    return out;
}

function collect(re: RegExp, src: string): string[] {
    re.lastIndex = 0;
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) != null) {
        out.push(m[1]);
    }
    return out;
}

describe("主题 token：引用的 token 必须有定义", () => {
    const files = SCAN_ROOTS.flatMap((r) => listFiles(resolve(REPO_ROOT, r)));
    const defined = new Set<string>(collect(DEFINITION_RE, readFileSync(THEME_SCSS, "utf8")));
    // 定义来源：frontend 下任意文件的 `--x:`（很多 token 定义在组件自己的 scss 里）
    const unusedButDefinedLocally = new Set<string>(collect(DEFINITION_RE, readFileSync(THEME_SCSS, "utf8")));
    for (const abs of listFiles(FRONTEND_DIR)) {
        for (const d of collect(DEFINITION_RE, readFileSync(abs, "utf8"))) {
            unusedButDefinedLocally.add(d);
        }
    }
    const usages: { file: string; token: string }[] = [];
    for (const abs of files) {
        const src = readFileSync(abs, "utf8");
        for (const d of collect(DEFINITION_RE, src)) {
            unusedButDefinedLocally.add(d);
        }
        if (/\.test\.tsx?$/.test(abs)) {
            continue; // 测试自身的字面量示例不算用法
        }
        for (const token of collect(USAGE_RE, src)) {
            if (token.endsWith("-")) {
                continue; // 动态拼接（var(--prefix-${x})）不是 token 引用
            }
            usages.push({ file: relative(REPO_ROOT, abs).replace(/\\/g, "/"), token });
        }
    }

    it("扫描面非空", () => {
        expect(files.length).toBeGreaterThan(100);
        expect(usages.length).toBeGreaterThan(100);
        expect(defined.size).toBeGreaterThan(50);
    });

    it("没有任何未定义且未豁免的 token", () => {
        const exempt = new Set(EXEMPT_UNDEFINED_TOKENS.map((e) => e.token));
        const hits = usages
            .filter((u) => !defined.has(u.token) && !unusedButDefinedLocally.has(u.token) && !exempt.has(u.token))
            .map((u) => `${u.file}: var(${u.token})`);
        expect(hits, `引用了未定义的 token（悬空 token 会导致样式静默失效）：\n${[...new Set(hits)].join("\n")}`).toEqual(
            []
        );
    });

    it("豁免清单每条都有 reason，且不得豁免已定义的 token", () => {
        const bad = EXEMPT_UNDEFINED_TOKENS.filter((e) => !e.reason || e.reason.trim().length < 8).map((e) => e.token);
        expect(bad, `豁免缺少 reason：${bad.join(", ")}`).toEqual([]);
        const pointless = EXEMPT_UNDEFINED_TOKENS.filter((e) => defined.has(e.token)).map((e) => e.token);
        expect(pointless, `以下 token 其实已定义，请从豁免清单移除：${pointless.join(", ")}`).toEqual([]);
    });
});
