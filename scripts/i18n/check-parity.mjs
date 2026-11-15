#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// i18n en/zh 键对齐闸门（C4：en 唯一真源，zh 是镜像）。
//
// 用法：
//   node scripts/i18n/check-parity.mjs          # en/zh 每命名空间键集合 diff，非 0 diff → exit 1
//   node scripts/i18n/check-parity.mjs --json   # 机器可读输出

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const localesDir = path.join(repoRoot, "frontend/i18n/locales");

function flatten(obj, prefix = "", out = []) {
    for (const key of Object.keys(obj).sort()) {
        const val = obj[key];
        const id = prefix ? `${prefix}.${key}` : key;
        if (val && typeof val === "object" && !Array.isArray(val)) flatten(val, id, out);
        else out.push(id);
    }
    return out;
}

function loadLocaleSet(locale) {
    const dir = path.join(localesDir, locale);
    const result = {};
    if (!existsSync(dir)) return result;
    for (const name of readdirSync(dir)) {
        if (!name.endsWith(".json")) continue;
        const ns = name.replace(/\.json$/, "");
        const json = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
        result[ns] = new Set(flatten(json));
    }
    return result;
}

const json = process.argv.includes("--json");
const en = loadLocaleSet("en");
const zh = loadLocaleSet("zh");

const diffs = [];
const allNs = new Set([...Object.keys(en), ...Object.keys(zh)]);
for (const ns of allNs) {
    const enKeys = en[ns] ?? new Set();
    const zhKeys = zh[ns] ?? new Set();
    for (const k of enKeys) if (!zhKeys.has(k)) diffs.push({ ns, key: k, issue: "missing-in-zh" });
    for (const k of zhKeys) if (!enKeys.has(k)) diffs.push({ ns, key: k, issue: "missing-in-en" });
}

if (json) {
    console.log(JSON.stringify({ diffCount: diffs.length, diffs }, null, 2));
} else {
    console.error(`en 命名空间: ${Object.keys(en).join(", ")} · zh 命名空间: ${Object.keys(zh).join(", ")}`);
    console.error(`键 parity diff: ${diffs.length}`);
    for (const d of diffs.slice(0, 60)) console.error(`  [${d.ns}] ${d.key} → ${d.issue}`);
    if (diffs.length > 60) console.error(`  … 其余 ${diffs.length - 60} 条用 --json 看`);
}
process.exit(diffs.length > 0 ? 1 : 0);
