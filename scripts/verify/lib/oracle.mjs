// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 规则加载器 + 聚合器。每条规则是独立文件、纯函数、可单独启用/禁用。
//
// 规则契约：
//   export default {
//       id: "text-zero-shift",
//       why: "为什么需要这条规则（一句话，会出现在 report 里）",
//       run({ observation, caseDef, ctx }) -> { pass, detail, evidence?, skipped? }
//   }
// ctx 提供像素工具（outDir / readPng / cropPng / compareInkProfiles / diffPng / writePng）。

import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// 规则目录由**调用方**给：rules 是 area 私有的判据库（preview-edit 的 rules/ 只增不减），
// 内核不能假设自己住在某个 area 目录下。历史上这里写死 `../rules`，内核一搬就 ENOENT。
const cache = new Map();

export async function loadRules(rulesDir) {
    if (typeof rulesDir !== "string" || rulesDir === "") {
        throw new Error("loadRules(rulesDir) 缺少规则目录：请由调用方传入 path.join(here, \"rules\")");
    }
    if (cache.has(rulesDir)) return cache.get(rulesDir);
    const files = readdirSync(rulesDir)
        .filter((f) => f.endsWith(".mjs"))
        .sort();
    const map = new Map();
    for (const file of files) {
        const mod = await import(pathToFileURL(path.join(rulesDir, file)).href);
        const rule = mod.default;
        if (rule == null || typeof rule.run !== "function" || typeof rule.id !== "string") {
            throw new Error(`规则文件不符合契约: ${file}`);
        }
        map.set(rule.id, rule);
    }
    cache.set(rulesDir, map);
    return map;
}

/**
 * 跑指定规则。返回 { pass, checks[], warnings[] }。
 * 未在 case 里声明的规则不会跑；声明了但没被任何 case 覆盖的规则由 run.mjs 汇总 warn。
 */
export async function runRules(ruleIds, context) {
    const rules = await loadRules(context?.rulesDir);
    const checks = [];
    const warnings = [];
    for (const id of ruleIds) {
        const rule = rules.get(id);
        if (rule == null) {
            checks.push({ id, pass: false, detail: `未知规则 id: ${id}`, unknown: true });
            continue;
        }
        let result;
        try {
            result = await rule.run(context);
        } catch (err) {
            result = { pass: false, detail: `规则执行抛错: ${err?.message ?? err}` };
        }
        if (result?.skipped) {
            warnings.push({ rule: id, why: result.detail ?? "skipped" });
            continue;
        }
        checks.push({
            id,
            why: rule.why,
            pass: result.pass === true,
            detail: result.detail ?? "",
            evidence: result.evidence ?? null,
        });
    }
    return { pass: checks.every((c) => c.pass), checks, warnings };
}
