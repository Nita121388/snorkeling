#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 预览编辑自验证台 —— 唯一对外契约。
//
// 目标：让 agent 自己能回答"样式效果实现了没有"，不需要人看图。
// 真实 app + 真实指针 + 像素证据 + 可机器读的 verdict。
//
// 用法:
//   node scripts/verify/preview-edit/run.mjs --expect=fixed
//   node scripts/verify/preview-edit/run.mjs --expect=fixed --attach        # 复用已起的 9231 实例
//   node scripts/verify/preview-edit/run.mjs --expect=broken --legacy-css   # 证明实验能抓到旧 bug
//   node scripts/verify/preview-edit/run.mjs --against=verify-runs/<ts>/report.json
//   node scripts/verify/preview-edit/run.mjs --case=ol-collapsible --json
//
// 退出码: 0 = 符合预期；1 = 不符合预期；2 = 环境/脚本错误

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    ensureInstance,
    enableInlineEditLog,
    injectStabilityCss,
    dismissOverlays,
    removeInjectedStyles,
    DEFAULTS,
} from "./lib/launch.mjs";
import { ensureFixtureOpen } from "./lib/open.mjs";
import { observeCase } from "./lib/observe.mjs";
import { loadRules, runRules } from "./lib/oracle.mjs";
import { cropPng, compareInkProfiles, compareInkStructure, diffPng, diffRatio, readPng, writePng } from "./lib/pixel.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const casesDir = path.join(here, "cases");
const fixturesDir = path.join(repoRoot, "fixtures", "verify", "preview-edit");
const runsDir = path.join(repoRoot, "verify-runs");

const LEGACY_CSS = `
/* 旧实现（f2661b96 之前）的列表几何：缩进叠两层 + 原生 marker。
   用于 --expect=broken：实验台必须能在这套样式下跑红。 */
.inline-edit-overlay[data-block-kind="wysiwyg"] .wysiwyg-list > ul,
.inline-edit-overlay[data-block-kind="wysiwyg"] .wysiwyg-list > ol {
    margin: .357em 0 .857em 1.5em !important;
    padding-left: .25em !important;
    list-style: decimal !important;
}
.inline-edit-overlay[data-block-kind="wysiwyg"] .wysiwyg-list > ul > li,
.inline-edit-overlay[data-block-kind="wysiwyg"] .wysiwyg-list > ol > li {
    margin: .214em 0 !important;
    padding-left: .143em !important;
}
.inline-edit-overlay[data-block-kind="wysiwyg"] .wysiwyg-list > ul > li::before,
.inline-edit-overlay[data-block-kind="wysiwyg"] .wysiwyg-list > ol > li::before {
    content: none !important;
}
`;

function usage() {
    return `预览编辑自验证台

用法:
  node scripts/verify/preview-edit/run.mjs [选项]

选项:
  --expect=fixed|broken   预期结果（默认 fixed）。broken 表示"应当跑红"，用于验证实验台本身
  --attach                复用已存在的 verify 实例（CDP ${DEFAULTS.cdpPort}），不重新启动
  --case=<id>             只跑指定 case（可重复）
  --legacy-css            注入旧实现的 CSS，重现修复前的效果（配合 --expect=broken）
  --against=<report.json> 与上一轮 report 对比，输出 fixed / newFailures / stillFailing
  --json                  只输出机器可读 JSON（不打印人读摘要）
  --keep-open             结束后不关闭自己启动的实例（便于接着手工看）
  --help                  显示本帮助

产物:
  verify-runs/<时间戳>/report.json   机器读
  verify-runs/<时间戳>/report.md     人读（内嵌截图与 diff）
  verify-runs/<时间戳>/*.png         每个 case 的 before / during / afterEsc / diff

退出码: 0 符合预期 / 1 不符合预期 / 2 环境错误`;
}

function parseArgs(argv) {
    const opts = {
        expect: "fixed",
        attach: false,
        cases: [],
        legacyCss: false,
        against: null,
        json: false,
        keepOpen: false,
        help: false,
    };
    for (const raw of argv) {
        if (raw === "--help" || raw === "-h") opts.help = true;
        else if (raw === "--attach") opts.attach = true;
        else if (raw === "--legacy-css") opts.legacyCss = true;
        else if (raw === "--json") opts.json = true;
        else if (raw === "--keep-open") opts.keepOpen = true;
        else if (raw.startsWith("--expect=")) opts.expect = raw.slice("--expect=".length);
        else if (raw.startsWith("--case=")) opts.cases.push(raw.slice("--case=".length));
        else if (raw.startsWith("--against=")) opts.against = raw.slice("--against=".length);
        else throw new Error(`未知参数: ${raw}（--help 看用法）`);
    }
    if (!["fixed", "broken"].includes(opts.expect)) {
        throw new Error(`--expect 只支持 fixed / broken，收到: ${opts.expect}`);
    }
    return opts;
}

function loadCases(filterIds) {
    const all = readdirSync(casesDir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => ({ file: path.join(casesDir, f), def: JSON.parse(readFileSync(path.join(casesDir, f), "utf8")) }));
    if (filterIds.length === 0) return all.map((c) => c.def);
    const picked = all.filter((c) => filterIds.includes(c.def.id));
    const missing = filterIds.filter((id) => !picked.some((c) => c.def.id === id));
    if (missing.length > 0) throw new Error(`未知 case id: ${missing.join(", ")}`);
    return picked.map((c) => c.def);
}

function timestamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function relImage(from, to) {
    return path.relative(from, to).split(path.sep).join("/");
}

function writeMarkdownReport(file, report, runDir) {
    const lines = [];
    lines.push(`# 预览编辑验证报告`);
    lines.push("");
    lines.push(`- 时间: ${report.startedAt}`);
    lines.push(`- 目标实例: ${report.endpoint}（openedBy=${report.openedBy}）`);
    lines.push(`- 预期: \`${report.expect}\`${report.legacyCss ? "（已注入旧实现 CSS）" : ""}`);
    lines.push(`- **判定: ${report.verdict.toUpperCase()}**`);
    lines.push("");
    lines.push(`| case | 结果 | 失败规则 |`);
    lines.push(`|---|---|---|`);
    for (const c of report.cases) {
        const failed = c.checks.filter((k) => !k.pass).map((k) => k.id);
        lines.push(`| ${c.id} | ${c.pass ? "PASS" : "FAIL"} | ${failed.length ? failed.join(", ") : "—"} |`);
    }
    lines.push("");
    for (const c of report.cases) {
        lines.push(`## ${c.id} — ${c.pass ? "PASS" : "FAIL"}`);
        if (c.note != null) lines.push(`> ${c.note}`);
        lines.push("");
        lines.push(`| 规则 | 结果 | 详情 |`);
        lines.push(`|---|---|---|`);
        for (const k of c.checks) {
            lines.push(`| ${k.id} | ${k.pass ? "ok" : "**fail**"} | ${escapeCell(k.detail)} |`);
        }
        lines.push("");
        if (c.images != null) {
            lines.push(`编辑前 / 编辑中 / 退出后（同一裁切区域）:`);
            lines.push("");
            lines.push(`![before](${relImage(runDir, c.images.before)}) ![during](${relImage(runDir, c.images.during)}) ![afterEsc](${relImage(runDir, c.images.afterEsc)})`);
            lines.push("");
            const diffPath = c.images.before.replace(/-before\.png$/, "-diff.png");
            lines.push(`像素差异（红=不同）: ![diff](${relImage(runDir, diffPath)})`);
            lines.push("");
        }
    }
    writeFileSync(file, lines.join("\n") + "\n");
}

function escapeCell(text) {
    return String(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        console.log(usage());
        return 0;
    }

    const caseDefs = loadCases(opts.cases);
    const rules = await loadRules();
    const runDir = path.join(runsDir, timestamp());
    mkdirSync(runDir, { recursive: true });

    const startedAt = new Date().toISOString();
    const envWarnings = [];
    const instance = await ensureInstance({ attach: opts.attach });
    const client = instance.client;
    let exitCode = 0;

    try {
        // 调试环（measure 事件）——attach 模式下若页面已带则不会 reload
        await enableInlineEditLog(client).catch(() => false);
        await injectStabilityCss(client);
        envWarnings.push(...(await dismissOverlays(client)));
        if (opts.legacyCss) {
            await client.evaluate(`(() => {
                const id = "verify-legacy-css";
                document.getElementById(id)?.remove();
                const style = document.createElement("style");
                style.id = id;
                style.textContent = ${JSON.stringify(LEGACY_CSS)};
                document.head.appendChild(style);
                return true;
            })()`);
        }

        const fixtureFile = path.join(fixturesDir, caseDefs[0].fixture);
        const opened = await ensureFixtureOpen(client, fixtureFile);

        const ctx = { outDir: runDir, readPng, cropPng, compareInkProfiles, compareInkStructure, diffPng, diffRatio, writePng };
        const caseResults = [];

        for (const caseDef of caseDefs) {
            let result;
            try {
                const observation = await observeCase(client, caseDef, runDir);
                const verdict = await runRules(caseDef.rules ?? [...rules.keys()], { observation, caseDef, ctx });
                const degraded = Array.isArray(observation.degradedTrace) ? observation.degradedTrace : [];
                result = {
                    id: caseDef.id,
                    note: caseDef.note,
                    pass: verdict.pass,
                    checks: verdict.checks,
                    warnings: [...(verdict.warnings ?? []), ...degraded],
                    images: observation.images,
                    editorKind: observation.during?.editorKind,
                    evidence: {
                        target: observation.target.ink,
                        duringInk: observation.during?.ink,
                        overlay: observation.during?.overlay,
                        degradedTrace: degraded,
                    },
                };
            } catch (err) {
                result = {
                    id: caseDef.id,
                    note: caseDef.note,
                    pass: false,
                    checks: [{ id: "observe", pass: false, detail: String(err?.message ?? err) }],
                    warnings: [],
                    images: null,
                };
            }
            caseResults.push(result);
            if (!opts.json) {
                console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.id}`);
                for (const k of result.checks.filter((c) => !c.pass)) {
                    console.log(`      ✗ ${k.id}: ${k.detail}`);
                }
                for (const w of result.warnings ?? []) {
                    console.log(`      ! ${w.rule}: ${w.why}`);
                }
            }
        }

        const coverage = new Map([...rules.keys()].map((id) => [id, 0]));
        for (const c of caseDefs) for (const r of c.rules ?? []) coverage.set(r, (coverage.get(r) ?? 0) + 1);
        const underCovered = [...coverage.entries()].filter(([, n]) => n < 2).map(([id, n]) => `${id}(${n})`);

        const report = {
            startedAt,
            endpoint: client.endpoint,
            openedBy: opened.openedBy,
            expect: opts.expect,
            legacyCss: opts.legacyCss,
            verdict: caseResults.every((c) => c.pass) ? "pass" : "fail",
            cases: caseResults,
            warnings: [
                ...envWarnings,
                ...(underCovered.length > 0 ? [`规则覆盖不足 2 个 case: ${underCovered.join(", ")}`] : []),
            ],
        };

        if (opts.against != null) {
            report.diff = compareWithPrevious(report, opts.against);
        }

        writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
        writeMarkdownReport(path.join(runDir, "report.md"), report, runDir);

        // 预期判定
        const expectedVerdict = opts.expect === "fixed" ? "pass" : "fail";
        exitCode = report.verdict === expectedVerdict ? 0 : 1;

        if (opts.json) {
            console.log(JSON.stringify({ ...report, runDir, exitCode }, null, 2));
        } else {
            console.log("");
            console.log(`verdict=${report.verdict}（预期 ${expectedVerdict}）→ exit ${exitCode}`);
            console.log(`run 目录: ${runDir}`);
            if (report.diff != null) {
                console.log(
                    `对比上一轮: fixed=${report.diff.fixed.length} newFailures=${report.diff.newFailures.length} stillFailing=${report.diff.stillFailing.length}`
                );
            }
            for (const w of report.warnings) console.log(`WARN ${w}`);
            console.log(`人读报告: ${path.join(runDir, "report.md")}`);
        }
    } finally {
        // 注入的样式必须撤掉，否则会污染这个窗口（caret/动画/旧 CSS 都会留下）
        await removeInjectedStyles(client).catch(() => {});
        if (!opts.keepOpen) instance.cleanup();
    }

    return exitCode;
}

function compareWithPrevious(report, againstPath) {
    const prev = JSON.parse(readFileSync(path.resolve(againstPath), "utf8"));
    const prevFail = new Set(prev.cases.filter((c) => !c.pass).flatMap((c) => c.checks.filter((k) => !k.pass).map((k) => `${c.id}:${k.id}`)));
    const nowFail = new Set(
        report.cases.filter((c) => !c.pass).flatMap((c) => c.checks.filter((k) => !k.pass).map((k) => `${c.id}:${k.id}`))
    );
    const fixed = [...prevFail].filter((k) => !nowFail.has(k));
    const newFailures = [...nowFail].filter((k) => !prevFail.has(k));
    const stillFailing = [...nowFail].filter((k) => prevFail.has(k));
    return { against: againstPath, fixed, newFailures, stillFailing };
}

try {
    const code = await main();
    process.exit(code);
} catch (err) {
    console.error(`[verify] ${err?.message ?? err}`);
    if (process.env.VERIFY_DEBUG === "1") console.error(err?.stack);
    process.exit(2);
}
