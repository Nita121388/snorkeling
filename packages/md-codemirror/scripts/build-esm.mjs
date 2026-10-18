#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * 构建 `@snorkeling/md-codemirror` 的纯 ESM dist。
 *
 * 消费方：
 * - journal（零打包器 Chrome 扩展）直接 import `dist/index.js`；
 * - Snorkeling 继续走 `@md/cm` 源码别名（构建时 vite 自己处理）。
 *
 * 用 esbuild bundle 全部依赖（@codemirror/* + @lezer/*）成一个文件：
 * 浏览器扩展无法在运行时解析 node_modules，必须自带全部代码。
 *
 * 产物纪律：
 * - 单文件 ESM（`type: module`），无外部 import（除 md-core 纯模块，若被引入）；
 * - 不做压缩（扩展小、便于调试；体积对 CodeMirror 内核可接受）；
 * - 输出到 `packages/md-codemirror/dist/`。
 */

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const pkgDir = resolve(here, "..", "..", "..", "packages", "md-codemirror");

const entry = resolve(pkgDir, "src", "index.ts");
const outfile = resolve(pkgDir, "dist", "index.js");

try {
    await build({
        entryPoints: [entry],
        outfile,
        bundle: true,
        format: "esm",
        platform: "browser",
        target: ["chrome112", "safari16"],
        // CodeMirror 依赖全部打包进去；md-core 保持 external（消费方自己带 md-core dist）
        external: ["@snorkeling/md-core"],
        sourcemap: false,
        minify: false,
        logLevel: "info",
    });
    console.log(`✓ md-codemirror ESM build → ${outfile}`);
    console.log(`  （external: @snorkeling/md-core —— journal 需另行提供）`);
} catch (err) {
    console.error("md-codemirror build failed:", err);
    process.exitCode = 1;
}