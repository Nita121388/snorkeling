#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// TypeScript 错误数基线闸门。
//
// 背景：本仓库有一批**既有**类型错误（历史欠债），所以 "tsc 必须 0 error" 不现实；
// 但"不能变多"是硬要求，而且过去只有人肉记着"基线 69"。这个脚本把它变成可机器判定：
//
//   node scripts/check-tsc-baseline.mjs            # 超过基线 → exit 1
//   node scripts/check-tsc-baseline.mjs --verbose  # 打印当前所有错误
//   node scripts/check-tsc-baseline.mjs --update   # 用当前错误数刷新基线（修完债要手动跑）
//
// 基线落在 `docs/project/tsc-baseline.json`（入库，跨机器一致）。
// 退出码：0 = 未超过基线 / 1 = 错误变多 / 2 = 环境错误（tsc 跑不起来）。

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const baselinePath = path.join(repoRoot, "docs", "project", "tsc-baseline.json");
const args = new Set(process.argv.slice(2));

function loadBaseline() {
    if (!existsSync(baselinePath)) return null;
    try {
        return JSON.parse(readFileSync(baselinePath, "utf8"));
    } catch {
        return null;
    }
}

let output = "";
try {
    output = execFileSync("npx", ["tsc", "--noEmit", "-p", "tsconfig.json"], {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
} catch (err) {
    // tsc 有错误时以非 0 退出，错误文本在 stdout
    output = `${err.stdout ?? ""}`;
    if (output.trim() === "") {
        console.error("tsc 无法执行（环境错误）：", err.message);
        process.exit(2);
    }
}

const errorLines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /error TS\d+/.test(line));

const count = errorLines.length;
const baseline = loadBaseline();
const baselineCount = typeof baseline?.count === "number" ? baseline.count : null;

if (args.has("--verbose") || args.has("--update")) {
    for (const line of errorLines) console.log(line);
}

if (args.has("--update") || baselineCount == null) {
    writeFileSync(
        baselinePath,
        `${JSON.stringify(
            {
                count,
                updatedAt: new Date().toISOString(),
                note: "既有类型债基线。只允许变小：修完一批错误后用 --update 手动下调，不要在功能 PR 里抬高这个数。",
            },
            null,
            4
        )}\n`
    );
    console.log(`tsc 基线已写入：${count}（${path.relative(repoRoot, baselinePath)}）`);
    process.exit(0);
}

if (count > baselineCount) {
    const newOnes = errorLines.slice(0, 20);
    console.error(`tsc 错误数 ${count} > 基线 ${baselineCount}（新增 ${count - baselineCount} 条）：`);
    for (const line of newOnes) console.error(`  ${line}`);
    if (count > 20) console.error(`  … 其余 ${count - 20} 条用 --verbose 查看`);
    process.exit(1);
}

if (count < baselineCount) {
    console.log(
        `tsc 错误数 ${count} < 基线 ${baselineCount}（修好了 ${baselineCount - count} 条，可执行 --update 下调基线）`
    );
    process.exit(0);
}

console.log(`tsc 错误数 ${count} = 基线 ${baselineCount}`);
process.exit(0);
