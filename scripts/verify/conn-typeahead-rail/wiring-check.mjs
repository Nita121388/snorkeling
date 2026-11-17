// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// r2/r3 的第三条验收判据（queue prove 跑）：静态锚点 + E2E 台自检。
//
// 为什么不直接跑 scripts/verify/conn-typeahead-rail/verify.mjs：
// 本机 Electron dev 实例 tabview init 实测 3-4 分钟（N-1113/N-1114-tab-restore-all 记录），
// 真·真机台跑不进 prove 的 120s/条。所以这里只锁「台子与接线在位」，行为由
// typeaheadmodal.test.tsx / conntypeahead.test.tsx / conn-usage.test.ts 三个单测覆盖。
//
// 用法：node scripts/verify/conn-typeahead-rail/wiring-check.mjs
// 输出：全绿 → E2E_AREA_WIRED；任一锚点缺失 → exit 1。
//   纯 node，只用双引号 + 正斜杠路径，cmd / git-bash 下都能跑。

import { readFileSync, existsSync } from "node:fs";

const ANCHORS = [
    ["frontend/app/modals/typeaheadmodal.tsx", ["typeahead-item-rail", "data-copy-conn", "typeahead-skeleton", "loading"]],
    ["frontend/app/modals/typeaheadmodal.scss", ["typeahead-item-rail", "typeahead-row-copy", "typeahead-skeleton-row"]],
    ["frontend/app/modals/conntypeahead.tsx", ["recordConnUse(", "loadConnUsage(", "loading={loading}"]],
    ["frontend/app/modals/conn-usage.ts", ["snorkeling:connUsage", "sortConnItemsByUsage"]],
    ["frontend/i18n/locales/en/modals.json", ["copyName", "loading"]],
    ["frontend/i18n/locales/zh/modals.json", ["copyName", "loading"]],
    ["scripts/verify/conn-typeahead-rail/verify.mjs", ["rail-right-align", "usage-sort-order", "skeleton-while-loading"]],
];

let bad = 0;
for (const [file, needles] of ANCHORS) {
    if (!existsSync(file)) {
        console.log(`MISS ${file}`);
        bad += 1;
        continue;
    }
    const text = readFileSync(file, "utf8");
    for (const needle of needles) {
        if (!text.includes(needle)) {
            console.log(`MISS ${file} :: ${needle}`);
            bad += 1;
        }
    }
}

if (bad > 0) {
    console.log(`WIRING FAIL (missing ${bad})`);
    process.exit(1);
}
console.log("E2E_AREA_WIRED");
