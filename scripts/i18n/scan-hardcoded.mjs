#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// i18n 硬编码文案扫描闸门（R4/R7 防回潮）。
//
// 用法：
//   node scripts/i18n/scan-hardcoded.mjs                              # 全仓默认范围（CI 口径）
//   node scripts/i18n/scan-hardcoded.mjs --dir frontend/app/onboarding # 增量（每批迁移的验收口径）
//   node scripts/i18n/scan-hardcoded.mjs --json                        # 机器可读输出
//   node scripts/i18n/scan-hardcoded.mjs --update-baseline --dir <dir> # 把当前发现写进 allowlist（reason 必须人审）
//
// 判定：发现条目不在 scripts/i18n/allowlist.json（按 file+kind+内容 hash 匹配）→ exit 1。
// allowlist 每条必须带 reason（品牌名 / 终端控制序列 / 非 UI 数据等）。
//
// 用 TypeScript 自己的 parser（不写第二套 JSX 词法），三类发现：
//   jsx-text  JsxText 节点里的静态英文（≥3 连续字母）
//   attr      title/label/aria-label/placeholder/description 等常量字符串属性
//   cjk       任意字符串字面量/模板字符串里的 CJK（中英混杂治理）
//
// 排除：文件里的 JSON/测试/preview fixture 由扫描范围控制（默认只看 frontend/app、frontend/preview、emain）。

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const allowlistPath = path.join(here, "allowlist.json");

const ATTR_NAMES = new Set([
    "title",
    "label",
    "aria-label",
    "aria-labelledby",
    "aria-description",
    "placeholder",
    "description",
    "alt",
    "children",
    "tooltip",
]);

// 只扫随包发布的用户可见代码：测试断言与 preview fixture 不是产品文案（Pattern I 约束它们，不靠本闸门）。
const DEFAULT_DIRS = ["frontend/app", "emain"];
const EXCLUDE_DIRS = new Set(["node_modules", "dist", ".git", "verify-runs", ".runcfg", ".cache", "i18n"]);
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const LATIN_RE = /[A-Za-z]{3,}/;

function parseArgs(argv) {
    const args = { json: false, updateBaseline: false, dir: null };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--json") args.json = true;
        else if (argv[i] === "--dir") args.dir = argv[++i];
        else if (argv[i] === "--update-baseline") args.updateBaseline = true;
        else if (argv[i] === "--help" || argv[i] === "-h") {
            console.log("usage: scan-hardcoded.mjs [--dir <path>] [--json] [--update-baseline]");
            process.exit(0);
        } else {
            console.error(`unknown arg: ${argv[i]}`);
            process.exit(2);
        }
    }
    return args;
}

function listFiles(root, out) {
    for (const name of readdirSync(root)) {
        if (EXCLUDE_DIRS.has(name)) continue;
        const full = path.join(root, name);
        const st = statSync(full);
        if (st.isDirectory()) listFiles(full, out);
        else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\.(tsx?|jsx?)$/.test(name) && !/\.preview\.(tsx?|jsx?)$/.test(name) && !name.endsWith(".d.ts")) out.push(full);
    }
    return out;
}

function findingId(f) {
    return `${f.file}::${f.kind}::${createHash("sha1").update(f.text).digest("hex").slice(0, 12)}`;
}

function scanFile(rel, file) {
    const source = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const findings = [];
    const add = (node, kind, text, name = null) => {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        findings.push({ file: rel, line: line + 1, kind, name, text: text.replace(/\s+/g, " ").trim().slice(0, 200) });
    };
    const visit = (node) => {
        if (ts.isJsxText(node)) {
            const text = node.getText(sf).replace(/\s+/g, " ").trim();
            // 纯标点/实体/短词不算文案；≥3 连续字母才算
            if (LATIN_RE.test(text) && !/^&\w+;$/.test(text)) add(node, "jsx-text", text);
        } else if (ts.isJsxAttribute(node) && ATTR_NAMES.has(node.name.getText(sf))) {
            const init = node.initializer;
            if (init && ts.isStringLiteral(init) && LATIN_RE.test(init.text)) {
                add(init, "attr", init.text, node.name.getText(sf));
            }
        } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            if (CJK_RE.test(node.text)) add(node, "cjk", node.text);
        } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
            if (CJK_RE.test(node.text)) add(node, "cjk", node.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return findings;
}

function loadAllowlist() {
    if (!existsSync(allowlistPath)) return [];
    return JSON.parse(readFileSync(allowlistPath, "utf8"));
}

function saveAllowlist(list) {
    list.sort((a, b) => a.id.localeCompare(b.id));
    writeFileSync(allowlistPath, JSON.stringify(list, null, 4) + "\n");
}

const args = parseArgs(process.argv.slice(2));
const scanRoots = (args.dir ? [args.dir] : DEFAULT_DIRS).map((d) => path.resolve(repoRoot, d));
const files = scanRoots.flatMap((root) => {
    if (!existsSync(root)) {
        console.error(`error: scan dir not found: ${root}`);
        process.exit(2);
    }
    return statSync(root).isFile() ? [root] : listFiles(root, []);
});

const findings = files.flatMap((file) => scanFile(path.relative(repoRoot, file), file));
const allowlist = loadAllowlist();
const allowed = new Set(allowlist.map((e) => e.id));
const newFindings = findings.filter((f) => !allowed.has(findingId(f)));

if (args.updateBaseline) {
    let added = 0;
    for (const f of newFindings) {
        allowlist.push({
            id: findingId(f),
            file: f.file,
            kind: f.kind,
            text: f.text.slice(0, 120),
            reason: "UNREVIEWED — 必须人工补 reason 后才算数",
        });
        added++;
    }
    saveAllowlist(allowlist);
    console.log(`allowlist 更新：+${added} 条（reason 标记为 UNREVIEWED，必须人审）`);
    process.exit(0);
}

if (args.json) {
    console.log(
        JSON.stringify(
            {
                scope: scanRoots.map((r) => path.relative(repoRoot, r)),
                files: files.length,
                total: findings.length,
                newCount: newFindings.length,
                findings: newFindings,
            },
            null,
            2
        )
    );
} else {
    const byKind = {};
    for (const f of newFindings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
    console.error(`scan 范围: ${scanRoots.map((r) => path.relative(repoRoot, r)).join(", ")} · 文件 ${files.length} 个`);
    console.error(`发现 ${findings.length} 条（allowlist 外 ${newFindings.length} 条）${JSON.stringify(byKind)}`);
    for (const f of newFindings.slice(0, 50)) console.error(`  ${f.file}:${f.line} [${f.kind}] ${f.text.slice(0, 100)}`);
    if (newFindings.length > 50) console.error(`  … 其余 ${newFindings.length - 50} 条用 --json 看`);
}
process.exit(newFindings.length > 0 ? 1 : 0);
