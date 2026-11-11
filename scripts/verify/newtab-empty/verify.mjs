#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 新建 Tab 不自动创建 Terminal（方案 B：一律空 Tab）。
//
//   node scripts/verify/newtab-empty/verify.mjs             # 干净实例 → 跑 → 自动关
//   node scripts/verify/newtab-empty/verify.mjs --attach     # 复用已起实例
//   node scripts/verify/newtab-empty/verify.mjs --keep-open  # 结束后留着手工看
//   node scripts/verify/newtab-empty/verify.mjs --dry        # 只解析参数/依赖，不启动 GUI
//
// 判据：
//   1. 点击 [title="Add Tab"] 后，新 Tab 处于激活态，页面出现 [data-testid="empty-tab"]
//      的「暂无 Block」引导，且全页 [data-blockid] 数量为 0（没有偷偷建 term）。
//   2. 点击 [data-testid="empty-tab-new-terminal"] 后，出现 1 个 term block（可出门）。
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { listPageTargets, connectToTarget } from "../lib/cdp.mjs";
import { ensureInstance, DEFAULTS } from "../lib/launch.mjs";
import { createReporter } from "../lib/report.mjs";
import { dismissOnboarding, pickLiveRenderer, probeText, sleep, waitForProbe } from "../lib/probes.mjs";

const AREA = "newtab-empty";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

const reporter = createReporter({ area: AREA, mode: attach ? "attach" : "launch+reset" });
let instance = null;

/** 全页唯一 [data-blockid] 数量（同一 block 可能在 DOM 里多处渲染，按 id 去重）。 */
const COUNT_BLOCKS = `new Set([...document.querySelectorAll("[data-blockid]")].map((e) => e.getAttribute("data-blockid"))).size`;

/** 可见元素中心点（用于 CDP 点击）。 */
const CENTER_OF = (selector) => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`;

// 真实指针序列：先 mouseMoved 再 press/release。只发 press/release 会被当成
// “鼠标从外部瞬移进按钮” 而产生 hover intent 抖动，实测不触发 onClick。
async function clickPoint(client, point) {
    await client.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: point.x,
        y: point.y,
        button: "none",
        buttons: 0,
    });
    await sleep(120);
    await client.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: point.x,
        y: point.y,
        button: "left",
        buttons: 1,
        clickCount: 1,
    });
    await sleep(60);
    await client.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: point.x,
        y: point.y,
        button: "left",
        buttons: 0,
        clickCount: 1,
    });
    await sleep(400);
}

if (dry) {
    reporter.log("dry-run: 依赖解析成功（未启动 GUI）");
    reporter.check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs");
    reporter.finish({ cleanup: null });
}

try {
    const endpoint = `http://127.0.0.1:${DEFAULTS.cdpPort}`;
    instance = await ensureInstance({ attach, resetProfile: !attach });
    let client = instance.client;

    const pages = await listPageTargets(endpoint);
    if (pages.length > 1) {
        client = (await pickLiveRenderer(pages, connectToTarget, endpoint)).client;
    }
    await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    reporter.log(`instance ready (${attach ? "attach" : "launch"})`);

    await dismissOnboarding(client, { log: reporter.log });

    // 基线：起始 Tab 应有 block（starter layout）。
    const blocksBefore = await client.evaluate(COUNT_BLOCKS);
    reporter.check("baseline-has-blocks", blocksBefore > 0, `starter tab has ${blocksBefore} blocks`);

    // 点击 tabbar 的「Add Tab」按钮。
    const addTabBtn = await waitForProbe(
        client,
        CENTER_OF('[title="Add Tab"]'),
        (p) => p != null,
        { timeoutMs: 20000 }
    );
    if (addTabBtn == null) {
        throw new Error("Add Tab button not found");
    }
    await clickPoint(client, addTabBtn);
    reporter.log(`clicked Add Tab at (${addTabBtn.x}, ${addTabBtn.y})`);

    // 判据 1：空 Tab 引导出现 + 全页 0 个 block。
    const hint = await waitForProbe(
        client,
        probeText('[data-testid="empty-tab"]'),
        (t) => t != null && t.includes("暂无 Block"),
        { timeoutMs: 20000 }
    );
    reporter.check("newtab-empty-hint", hint != null, hint ?? "no empty-tab hint");

    await sleep(500); // 等 term controller 若被误建，其 block 会晚几百 ms 挂载
    const blocksAfter = await client.evaluate(COUNT_BLOCKS);
    reporter.check("newtab-no-blocks", blocksAfter === 0, `[data-blockid] count = ${blocksAfter}`);
    await reporter.shot(client, "01-newtab-empty");

    // 判据 2：引导按钮可出门 —— 点「新建 Terminal」出现 1 个 block。
    const newTermBtn = await waitForProbe(
        client,
        CENTER_OF('[data-testid="empty-tab-new-terminal"]'),
        (p) => p != null,
        { timeoutMs: 10000 }
    );
    if (newTermBtn == null) {
        throw new Error("empty-tab new-terminal button not found");
    }
    await clickPoint(client, newTermBtn);

    const blocksAfterCreate = await waitForProbe(
        client,
        COUNT_BLOCKS,
        (n) => Number(n) >= 1,
        { timeoutMs: 20000 }
    );
    reporter.check(
        "empty-tab-new-terminal-works",
        Number(blocksAfterCreate) >= 1,
        `[data-blockid] count = ${blocksAfterCreate}`
    );
    await reporter.shot(client, "02-term-created");

    reporter.finish({
        skipped: ["左栏 tabbar（app:tabbar=left）未覆盖，默认 top 已覆盖主路径"],
        cleanup: () => {
            client.close?.();
            if (instance?.spawned && !keepOpen) instance.cleanup?.();
        },
    });
} catch (err) {
    reporter.fatal(err, { cleanup: () => instance?.cleanup?.() });
}
