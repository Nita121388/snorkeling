#!/usr/bin/env node
/**
 * docs/sync-audit/audit-sync.mjs — 原型与真实代码同步对账（L1 硬查）
 *
 * 扫描 .mockup 下所有 README.md，解析 PROCESS.md 约定的状态标记：
 *   > 同步状态：▲|●|▼|◐ ...
 *   > 镜像源：frontend/xxx.tsx, pkg/yyy.go（可多个）
 *   > 最后同步：YYYY-MM-DD
 *
 * 校验每个镜像源在仓库里是否仍存在，输出对账报告。
 *
 * 用法：node docs/sync-audit/audit-sync.mjs [--mockup-dir .mockup] [--json]
 * 退出码：0 = 无镜像缺失；1 = 有缺失/未标注（CI 可用）
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");

// 解析参数
const args = process.argv.slice(2);
const jsonOut = args.includes("--json");
const mockArg = args.find((a) => a.startsWith("--mockup-dir="));
const MOCKUP_DIR = resolve(
  REPO_ROOT,
  mockArg ? mockArg.split("=")[1] : ".mockup"
);

// ---------- 工具 ----------
const walk = (dir, out = []) => {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) walk(p, out);
        else out.push(p);
    }
    return out;
};

const daysSince = (dateStr) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
};

// ---------- 解析单篇 README ----------
const parse = (readmePath) => {
    const text = readFileSync(readmePath, "utf8");
    const line = (key) => {
        // 形如 "> 同步状态：▲ ..." 或 "同步状态: ..."
        const re = new RegExp(`^\\s*>?\\s*${key}[:：]\\s*(.+)$`, "m");
        const m = text.match(re);
        return m ? m[1].trim() : null;
    };
    const status = line("同步状态");
    const mirrorRaw = line("镜像源");
    const synced = line("最后同步");
    const mirrors = mirrorRaw
        ? mirrorRaw.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
        : [];
    // 没有 README 标记时，退化扫描 .html 里的源码路径引用
    if (mirrors.length === 0) {
        const re = /(frontend\/[\w./-]+\.(?:tsx?|scss|css)|pkg\/[\w./-]+\.go|Rust\/ti\/[\w./-]+\.rs)/g;
        const hits = [...text.matchAll(re)].map((m) => m[1]);
        mirrors.push(...new Set(hits));
    }
    return { status, mirrors, synced };
};

// X 述查找字头的类型 glyph
const statusGlyph = { "▲": "▲ 设计活跃", "●": "● 已落地", "▼": "▼ 过时", "◐": "◐ 部分落地" };
const displayStatus = (status) => {
    if (!status) return "— 未标注";
    const g = status.trim()[0];
    return statusGlyph[g] ? statusGlyph[g] : `⚠ ${status.trim()}`;
};
const rows = [];
let missing = 0;
let unmarked = 0;

for (const readmePath of walk(MOCKUP_DIR).filter((p) => basename(p) === "README.md")) {
    const rel = join(".mockup", readmePath.slice(MOCKUP_DIR.length + 1));
    const { status, mirrors, synced } = parse(readmePath);
    const syncedDays = daysSince(synced);

    const mirrorReport = mirrors.map((m) => {
        const ok = existsSync(join(REPO_ROOT, m.replace(/^\.\//, "")));
        if (!ok) missing++;
        return `${ok ? "✓" : "✗"} ${m}`;
    });

    if (!status && mirrors.length === 0) unmarked++;
    const missingMirrors = mirrors.filter((m) => !existsSync(join(REPO_ROOT, m.replace(/^\.\//, ""))));
    rows.push({
        rel,
        status: displayStatus(status),
        synced: synced ? `${synced}${syncedDays != null && syncedDays > 45 ? ` (${syncedDays}d ago)` : ""}` : "—",
        mirrors: mirrorReport.length ? mirrorReport.join("\n            ") : "—（无源码引用）",
        // 结构化为 JSON 输出用
        _missing: missingMirrors.map((m) => ({ mirror: m })),
        _stale: syncedDays != null && syncedDays > 45,
    });
}

// ---------- JSON 输出（供审批界面/agent）----------
if (jsonOut) {
    const issues = rows
        .filter((r) => r._missing.length > 0 || r._stale)
        .map((r, i) => ({
            id: `P${String(i + 1).padStart(2, "0")}`,
            level: r._missing.length ? "🔴" : "🟡",
            asset: r.rel,
            issue: r._missing.length
                ? `镜像源已不存在: ${r._missing.map((m) => m.mirror).join(", ")}`
                : `最后同步 ${r.synced} 已超 45 天`,
            action: "更新镜像源或确认同步",
            evidence: r._missing[0]?.mirror || `mtime ${r.synced}`,
            created: new Date().toISOString().slice(0, 10),
        }));
    console.log(JSON.stringify({ generated: new Date().toISOString().slice(0, 10), count: rows.length, missing, unmarked, issues }, null, 2));
    process.exit(issues.length ? 1 : 0);
}

// ---------- 输出 ----------
console.log(`\n.mockup 原型对账报告  ${new Date().toISOString().slice(0, 10)}`);
console.log("=".repeat(78));
for (const r of rows) {
    console.log(`\n${r.status}  ${r.rel}`);
    console.log(`  最后同步: ${r.synced}`);
    console.log(`  镜像源  : ${r.mirrors}`);
}
console.log("\n" + "=".repeat(78));
console.log(
    `共 ${rows.length} 篇 README；镜像缺失 ${missing} 处；未标注状态/镜像 ${unmarked} 篇。`
);
console.log(rows.filter((r) => r.status.includes("▲")).length && "▲ = 设计活跃（未实现）");
process.exit(missing ? 1 : 0);
