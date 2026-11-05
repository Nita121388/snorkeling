// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 统一的验证结论（verdict）落地器。
//
// 目标：所有 area 的验证台说同一种语言 —— 同一份 report.json 结构、同一套退出码、
// 同一行可追踪的台账。这样"这个需求验证过没有"变成可机器回答的问题，而不是翻聊天记录。
//
// 契约：
//   退出码 0 = 全绿 / 1 = 断言失败 / 2 = 环境错误（起不来、连不上）
//   verify-runs/<ts>-<area>/report.json  机器读（每次覆盖自己的目录，不追改历史）
//   verify-runs/<ts>-<area>/report.md    人读
//   docs/project/verify-ledger.md        台账（**入库**，跨机器可查；verify-runs 是 gitignore 的）
//
// 台账为什么单独一份：`verify-runs/` 被 .gitignore 忽略（20MB 截图不能进库），
// 但"某个 commit 上这个 area 全绿过"必须能查。所以只把一行结论入库。

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../../..");
const runsRoot = path.join(repoRoot, "verify-runs");
const ledgerPath = path.join(repoRoot, "docs", "project", "verify-ledger.md");

const LEDGER_HEADER = [
    "# 真机验证台账",
    "",
    "> 由 `scripts/verify/lib/report.mjs` 自动追加，**不要手改历史行**。",
    "> 明细与截图在 `verify-runs/<ts>-<area>/`（gitignore），这里只留结论。",
    "> 查看索引：`node scripts/verify/index.mjs`",
    "",
    "| 时间 | area | 结论 | 模式 | 证据目录 | commit |",
    "| --- | --- | --- | --- | --- | --- |",
].join("\n");

function currentCommit() {
    try {
        return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
            cwd: repoRoot,
            encoding: "utf8",
            timeout: 10000,
            windowsHide: true,
        }).trim();
    } catch {
        return "unknown";
    }
}

function stamp(date = new Date()) {
    return date.toISOString().replace(/[-:.]/g, "").slice(0, 14);
}

/** 刷新/创建台账（不追加行，仅保证表头存在）。 */
export function ensureLedger() {
    if (!existsSync(ledgerPath)) {
        mkdirSync(path.dirname(ledgerPath), { recursive: true });
        writeFileSync(ledgerPath, `${LEDGER_HEADER}\n`);
    }
}

export function appendLedgerRow({ at, area, passed, total, mode, runName, commit }) {
    ensureLedger();
    const verdict = passed === total ? `✅ ${passed}/${total}` : `❌ ${passed}/${total}`;
    appendFileSync(
        ledgerPath,
        `| ${at.slice(0, 16).replace("T", " ")} | ${area} | ${verdict} | ${mode} | \`${runName}\` | ${commit} |\n`
    );
}

/**
 * 创建一个验证台 reporter。
 *
 * @param {object} opts
 * @param {string} opts.area        台账里的 area 名（kebab-case，与目录名一致）
 * @param {string} [opts.endpoint]  CDP endpoint（可空：纯离线台）
 * @param {string} [opts.mode]      launch+reset / attach / offline …
 * @param {object} [opts.meta]      额外固定字段（模型、profile、端口…）
 */
export function createReporter({ area, endpoint = "", mode = "launch+reset", meta = {} } = {}) {
    if (!area) throw new Error("createReporter: area 必填（与 scripts/verify/<area>/ 一致）");
    const startedAt = new Date();
    const runName = `${stamp(startedAt)}-${area}`;
    const runDir = path.join(runsRoot, runName);
    mkdirSync(runDir, { recursive: true });

    const results = [];
    const steps = [];
    let written = false;

    const log = (msg) => {
        steps.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
        console.log(msg);
    };

    const check = (id, ok, detail = null) => {
        results.push({ id, ok: !!ok, detail });
        const shown = detail == null ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
        console.log(`${ok ? "PASS" : "FAIL"}  ${id}${shown}`);
        return !!ok;
    };

    const summary = () => {
        const passed = results.filter((r) => r.ok).length;
        return { total: results.length, passed, failed: results.length - passed };
    };

    async function shot(client, name) {
        try {
            await client.send("Page.bringToFront", {}).catch(() => {});
            const { data } = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true }, 20000);
            const file = path.join(runDir, `${name}.png`);
            writeFileSync(file, Buffer.from(data, "base64"));
            log(`screenshot ${name}.png`);
            return file;
        } catch (err) {
            log(`screenshot ${name} failed: ${String(err?.message ?? err)}`);
            return null;
        }
    }

    function write({ fatal = null, extra = {}, skipped = [], ledger = true } = {}) {
        if (written) return summary();
        written = true;
        const s = summary();
        const finishedAt = new Date();
        const commit = currentCommit();
        const report = {
            area,
            runName,
            generatedAt: finishedAt.toISOString(),
            durationMs: finishedAt - startedAt,
            endpoint,
            mode,
            commit,
            meta,
            steps,
            results,
            skipped,
            summary: s,
            ...(fatal ? { fatal } : {}),
            extra,
        };
        writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2));
        writeFileSync(path.join(runDir, "report.md"), renderMarkdown(report));
        // dry-run / 只解析依赖的跑法不该污染台账（那里记的是"真验过一次"）。
        if (ledger) {
            appendLedgerRow({
                at: report.generatedAt,
                area,
                passed: s.passed,
                total: s.total,
                mode,
                runName,
                commit,
            });
        }
        return s;
    }

    /** 收尾：写 report + 台账，按失败数决定退出码。cleanup 在写完之后执行。 */
    function finish({ extra = {}, skipped = [], cleanup = null, ledger = true } = {}) {
        const s = write({ extra, skipped, ledger });
        try {
            cleanup?.();
        } catch {
            /* 收尾失败不影响 verdict */
        }
        const code = s.failed === 0 && s.total > 0 ? 0 : 1;
        console.log(`\n${code === 0 ? "ALL GREEN" : "FAILED"} — ${path.join(runDir, "report.md")}`);
        process.exit(code);
    }

    /** 环境错误：仍然落盘（把 steps 留下），退出码 2。 */
    function fatal(err, { cleanup = null } = {}) {
        const text = String(err?.stack ?? err);
        log(`FATAL: ${text}`);
        write({ fatal: text });
        try {
            cleanup?.();
        } catch {
            /* ignore */
        }
        process.exit(2);
    }

    return { area, runDir, runName, log, check, shot, summary, finish, fatal, results, steps };
}

function renderMarkdown(report) {
    const rows = report.results.map(
        (r) =>
            `| ${r.id} | ${r.ok ? "PASS" : "FAIL"} | ${
                r.detail == null ? "" : `\`${JSON.stringify(r.detail).slice(0, 180)}\``
            } |`
    );
    return [
        `# ${report.area} —— 真机验证`,
        "",
        `- 时间：${report.generatedAt}（耗时 ${Math.round(report.durationMs / 1000)}s）`,
        `- 模式：${report.mode}`,
        `- commit：${report.commit}`,
        `- 结论：**${report.summary.failed === 0 && report.summary.total > 0 ? "全绿" : `${report.summary.failed} 项失败`}**（${report.summary.passed}/${report.summary.total}）`,
        report.fatal ? `- **环境错误**：\`${report.fatal.split("\n")[0]}\`` : null,
        "",
        "## 断言",
        "",
        "| 断言 | 结果 | 证据 |",
        "| --- | --- | --- |",
        ...(rows.length > 0 ? rows : ["| （无断言） | — | — |"]),
        "",
        "## 未覆盖（有意）",
        "",
        ...(report.skipped.length > 0 ? report.skipped.map((s) => `- ${s}`) : ["- 无"]),
        "",
        "## 步骤日志",
        "",
        "```",
        ...report.steps,
        "```",
        "",
        `截图与原始数据：\`verify-runs/${report.runName}/\``,
    ]
        .filter((line) => line !== null)
        .join("\n");
}
