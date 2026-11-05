#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 验证台索引 / 自查（"这个需求验证过没有" 的机器答案）。
//
//   node scripts/verify/index.mjs                 # 人读表格：每个 area 的入口 + 最近一次结论
//   node scripts/verify/index.mjs --json          # 机器读（给 CI / agent 用）
//   node scripts/verify/index.mjs --strict        # 任一 area 最近一次**失败** → exit 1
//                                                 # （"从未跑过"只警告，不算失败 — 新 area 常见）
//   node scripts/verify/index.mjs --area <name>   # 只看一个
//
// 数据来源是入库的 `docs/project/verify-ledger.md`（verify-runs/ 是 gitignore 的），
// 所以换机器、换 clone 之后仍然知道"上次是谁在哪个 commit 上绿过"。

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const ledgerPath = path.join(repoRoot, "docs", "project", "verify-ledger.md");
const SKIP = new Set(["lib", "_template", "node_modules"]);

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const strict = argv.includes("--strict");
const onlyArea = argv.includes("--area") ? argv[argv.indexOf("--area") + 1] : null;

function listAreas() {
    return readdirSync(here)
        .filter((name) => {
            if (SKIP.has(name)) return false;
            const full = path.join(here, name);
            return statSync(full).isDirectory();
        })
        .map((name) => {
            const dir = path.join(here, name);
            const entry = ["verify.mjs", "run.mjs"].map((f) => path.join(dir, f)).find((f) => existsSync(f));
            return { area: name, entry: entry ? path.relative(repoRoot, entry).replace(/\\/g, "/") : null };
        })
        .filter((a) => a.entry != null)
        .sort((a, b) => a.area.localeCompare(b.area));
}

function readLedger() {
    if (!existsSync(ledgerPath)) return [];
    const rows = [];
    for (const line of readFileSync(ledgerPath, "utf8").split(/\r?\n/)) {
        if (!line.startsWith("| ") || line.startsWith("| 时间") || line.startsWith("| ---")) continue;
        const cells = line
            .split("|")
            .slice(1, -1)
            .map((c) => c.trim());
        if (cells.length < 6) continue;
        const [at, area, verdict, mode, runRef, commit] = cells;
        const m = verdict.match(/(\d+)\s*\/\s*(\d+)/);
        const passed = m ? Number(m[1]) : 0;
        const total = m ? Number(m[2]) : 0;
        rows.push({
            at,
            area,
            ok: total > 0 && passed === total,
            passed,
            total,
            mode,
            run: runRef.replace(/`/g, ""),
            commit,
        });
    }
    return rows;
}

function ageLabel(at) {
    const then = Date.parse(at.replace(" ", "T") + "Z");
    if (!Number.isFinite(then)) return "?";
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 60) return `${mins}m`;
    if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
    return `${Math.round(mins / 60 / 24)}d`;
}

const rows = readLedger();
const areas = listAreas().filter((a) => onlyArea == null || a.area === onlyArea);

const report = areas.map((a) => {
    const runs = rows.filter((r) => r.area === a.area);
    const last = runs[runs.length - 1] ?? null;
    return {
        area: a.area,
        entry: a.entry,
        runs: runs.length,
        lastRun: last
            ? { at: last.at, ok: last.ok, passed: last.passed, total: last.total, commit: last.commit, run: last.run }
            : null,
        age: last ? ageLabel(last.at) : null,
        status: last == null ? "never" : last.ok ? "green" : "failed",
    };
});

if (asJson) {
    console.log(JSON.stringify({ ledger: path.relative(repoRoot, ledgerPath), areas: report }, null, 2));
} else {
    const pad = (s, n) => String(s ?? "").padEnd(n);
    console.log(`${pad("area", 20)} ${pad("结论", 12)} ${pad("最近", 6)} ${pad("commit", 8)} 入口`);
    console.log("-".repeat(96));
    for (const r of report) {
        const verdict =
            r.status === "never"
                ? "— 未跑过"
                : `${r.status === "green" ? "✅" : "❌"} ${r.lastRun.passed}/${r.lastRun.total}`;
        console.log(`${pad(r.area, 20)} ${pad(verdict, 12)} ${pad(r.age ?? "-", 6)} ${pad(r.lastRun?.commit ?? "-", 8)} ${r.entry}`);
    }
    console.log("");
    console.log(`共 ${report.length} 个 area；台账：${path.relative(repoRoot, ledgerPath)}（明细在 verify-runs/，gitignore）`);
}

if (strict) {
    const failed = report.filter((r) => r.status === "failed");
    const never = report.filter((r) => r.status === "never");
    if (never.length > 0) {
        // “从未跑过”只警告：新 area 很常见，不应该让门禁永远红。
        console.warn(`warn: 从没跑过的 area——${never.map((n) => n.area).join(", ")}`);
    }
    if (failed.length > 0) {
        console.error(`strict: 最近一次失败的 area——${failed.map((f) => f.area).join(", ")}`);
        process.exit(1);
    }
}
