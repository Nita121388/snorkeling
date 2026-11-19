#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Tab「收起到更多」跨 renderer 一致性（F-1119）。
//
// 背景：每个 Tab 是独立 WebContentsView / renderer，Tab 栏在各自 renderer 各渲染一份。
// collapsed 集合若只在 renderer 本地，「在当前 Tab 收起 → 切到别的 Tab 又冒出来」。
// 修复后真源在 emain 主进程，经 IPC 广播同步到所有 renderer。
//
//   node scripts/verify/tab-collapse-cross-renderer/verify.mjs              # 起干净实例 → 跑全流程 → 自动关
//   node scripts/verify/tab-collapse-cross-renderer/verify.mjs --keep-open  # 结束后留着手工看
//   node scripts/verify/tab-collapse-cross-renderer/verify.mjs --dry        # 只解析依赖，不起 GUI
//
// 判据：
//   1. seed-tabs                   : 播种后主栏 5 个 Tab
//   2. collapse-hides-active-bar   : 收起后当前 renderer 主栏不再渲染该 Tab
//   3. main-truth                  : window.api.getCollapsedTabIds() 含该 id（真源在主进程）
//   4. all-renderers-consistent    : 遍历所有 Tab renderer，主栏都不渲染被收起 Tab（本次修复核心）
//   5. more-row-shows-collapsed    : 「更多」下拉里该 Tab 存在且 data-hidden/data-dimmed 均为 true
//   6. expand-on-open              : 下拉点开该行 → 主栏重新露出、主进程集合不再含该 id
//   7. cross-renderer-after-switch : 再次收起并切到别的 Tab 后，所有 renderer 仍一致
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。
//
// 覆盖说明（skipped）：收起动作经 window.api.collapseTabIds 驱动 —— 与右键菜单项 click 最终
// 调用的 collapseTabIds 同一条 IPC 写路径；Electron 右键菜单是 **原生菜单**（ipcRenderer
// menu-popup），DOM 里不存在，CDP 无法点击菜单项。renderer 本地乐观写由
// frontend/app/tab/tab-collapse-state.test.ts 覆盖。

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { ensureInstance } from "../lib/launch.mjs";
import { createReporter } from "../lib/report.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep, waitForProbe } from "../lib/probes.mjs";

const AREA = "tab-collapse-cross-renderer";
// 独立档位 + 独占端口（README「新增一个 area」第 6 条）：避免并行 agent 抢同一个 profile。
const PROFILE = "verify-tab-collapse-cross-renderer";
const CDP_PORT = 9246;
const VITE_PORT = 51840;
const SEED_TABS = 5;
const ACTIVE_INDEX = 2; // 播种后激活第 3 个 Tab（非折叠目标、非最后）
const COLLAPSE_INDEX = 1; // 收起第 2 个 Tab（非激活）
const SWITCH_INDEX = 4; // 切到第 5 个 Tab 验证一致性

const TAB_SELECTOR = ".tab-bar .tab[data-tab-id]";
const TAB_IDS = `[...document.querySelectorAll(${JSON.stringify(TAB_SELECTOR)})].map((e) => e.getAttribute("data-tab-id"))`;
const TAB_COUNT = `document.querySelectorAll(${JSON.stringify(TAB_SELECTOR)}).length`;
const ACTIVE_TAB_ID = `(() => {
    const el = document.querySelector(".tab-bar .tab.active[data-tab-id]");
    return el ? el.getAttribute("data-tab-id") : null;
})()`;
const MAIN_TRUTH = `(window.api && typeof window.api.getCollapsedTabIds === "function") ? window.api.getCollapsedTabIds() : null`;
const MORE_TRIGGER = `document.querySelector('[aria-haspopup="menu"]')`;
const MORE_ROWS = `[...document.querySelectorAll('[role="menuitem"][data-tabid]')].map((e) => ({
    id: e.getAttribute("data-tabid"),
    hidden: e.getAttribute("data-hidden"),
    dimmed: e.getAttribute("data-dimmed"),
}))`;

/** 可见元素中心点（用于 CDP 点击）。 */
const CENTER_OF = (selector) => `(() => {
    const el = ${selector};
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`;

/** 第 n 个 Tab 的中心点（n 从 0 起）。 */
const CENTER_OF_TAB = (index) => `(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(TAB_SELECTOR)})];
    const el = els[${Number(index)}];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`;

/** 「更多」下拉里指定 tabid 的行中心点。 */
const CENTER_OF_MORE_ROW = (tabId) => `(() => {
    const el = document.querySelector('[role="menuitem"][data-tabid="' + ${JSON.stringify(tabId)} + '"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`;

// 真实指针序列：只发 press/release 会被当成「鼠标从外部瞬移进按钮」，实测不触发 onClick。
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
    await sleep(350);
}

/**
 * 遍历所有 Tab renderer，收集各自主栏渲染的 tabId。
 * 注意：非激活 renderer 的 innerWidth 可能为 0，但 DOM 与 jotai store 仍在运行 ——
 * 这正是本次修复要覆盖的面（广播是否真的到达了每个 renderer）。
 */
async function collectRendererBars(endpoint, log) {
    const pages = await listPageTargets(endpoint);
    const bars = [];
    for (const page of pages) {
        const client = await connectToTarget(endpoint, page).catch(() => null);
        if (client == null) continue;
        try {
            const hasBar = await client.evaluate(`document.querySelectorAll(${JSON.stringify(TAB_SELECTOR)}).length > 0`);
            if (!hasBar) continue;
            const ids = await client.evaluate(TAB_IDS);
            const ownActive = await client.evaluate(ACTIVE_TAB_ID);
            bars.push({ targetId: page.id, ownActive, ids });
        } finally {
            client.close?.();
        }
    }
    log(`renderer bars: ${bars.map((b) => `${b.ownActive || "?"}:${b.ids.length}`).join(" ")}`);
    return bars;
}

const argv = process.argv.slice(2);
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

const reporter = createReporter({ area: AREA, mode: "launch+reset" });
let instance = null;

if (dry) {
    reporter.log("dry-run: 依赖解析成功（未启动 GUI）");
    reporter.check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs");
    reporter.finish({ cleanup: null });
    process.exit(0);
}

const endpoint = `http://127.0.0.1:${CDP_PORT}`;

try {
    instance = await ensureInstance({
        attach: false,
        resetProfile: true,
        profile: PROFILE,
        cdpPort: CDP_PORT,
        vitePort: VITE_PORT,
    });
    let client = instance.client;

    const pages = await listPageTargets(endpoint);
    if (pages.length > 1) {
        client = (await pickLiveRenderer(pages, connectToTarget, endpoint)).client;
    }
    await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    reporter.log("instance ready (launch+reset)");

    await dismissOnboarding(client, { log: reporter.log });

    // ── 播种 5 个 Tab ──────────────────────────────────────────────────────
    for (let target = 2; target <= SEED_TABS; target++) {
        const point = await waitForProbe(client, CENTER_OF(`document.querySelector('[title="Add Tab"]')`), (p) => p != null, {
            timeoutMs: 20000,
        });
        if (point == null) throw new Error("Add Tab 按钮不可达");
        await clickPoint(client, point);
        await waitForProbe(client, TAB_COUNT, (n) => n >= target, { timeoutMs: 20000 });
    }
    const ids = await client.evaluate(TAB_IDS);
    reporter.check("seed-tabs", ids.length === SEED_TABS, `${ids.length}/${SEED_TABS} tabs in main bar`);
    if (ids.length !== SEED_TABS) throw new Error("播种 Tab 数不足，后续断言不可信");

    // 激活第 3 个 Tab，构造「折叠目标 ≠ 激活 Tab」的场景。
    await clickPoint(client, await waitForProbe(client, CENTER_OF_TAB(ACTIVE_INDEX), (p) => p != null, { timeoutMs: 15000 }));
    await waitForProbe(client, ACTIVE_TAB_ID, (id) => id === ids[ACTIVE_INDEX], { timeoutMs: 20000 });

    const collapsedId = ids[COLLAPSE_INDEX];
    reporter.log(`collapse target = ${collapsedId}`);

    // ── 收起（走与右键菜单 click 相同的 IPC 写路径）───────────────────────
    const collapseViaIpc = `window.api.collapseTabIds([${JSON.stringify(collapsedId)}])`;
    await client.evaluate(collapseViaIpc);
    const hiddenInActive = await waitForProbe(client, TAB_IDS, (barIds) => !barIds.includes(collapsedId), { timeoutMs: 10000 });
    reporter.check(
        "collapse-hides-active-bar",
        !hiddenInActive.includes(collapsedId),
        `active bar = ${hiddenInActive.join(",")}`
    );

    const truth = await waitForProbe(client, MAIN_TRUTH, (t) => Array.isArray(t) && t.includes(collapsedId), {
        timeoutMs: 10000,
    });
    reporter.check("main-truth", Array.isArray(truth) && truth.includes(collapsedId), `main collapsed = ${JSON.stringify(truth)}`);

    // ── 跨 renderer 一致性（本次修复核心）────────────────────────────────
    let bars = await collectRendererBars(endpoint, reporter.log);
    reporter.check(
        "all-renderers-consistent",
        bars.length > 1 && bars.every((b) => !b.ids.includes(collapsedId)),
        `${bars.length} renderer(s); offenders=${bars.filter((b) => b.ids.includes(collapsedId)).map((b) => b.ownActive).join(",") || "none"}`
    );

    // ── 「更多」下拉：被收起的 Tab 必须在这里且置灰 ────────────────────────
    const triggerPoint = await waitForProbe(client, CENTER_OF(MORE_TRIGGER), (p) => p != null, { timeoutMs: 15000 });
    if (triggerPoint == null) throw new Error("「更多」触发器不可达");
    await clickPoint(client, triggerPoint);
    const rows = await waitForProbe(client, MORE_ROWS, (r) => r.some((row) => row.id === collapsedId), {
        timeoutMs: 15000,
    });
    const collapsedRow = rows.find((row) => row.id === collapsedId);
    reporter.check(
        "more-row-shows-collapsed",
        collapsedRow != null && collapsedRow.hidden === "true" && collapsedRow.dimmed === "true",
        collapsedRow == null ? "row missing" : `hidden=${collapsedRow.hidden} dimmed=${collapsedRow.dimmed}`
    );
    await reporter.shot(client, "01-more-menu-collapsed");

    // ── 下拉点开被收起 Tab → 主栏重新露出 ─────────────────────────────────
    const rowPoint = await waitForProbe(client, CENTER_OF_MORE_ROW(collapsedId), (p) => p != null, { timeoutMs: 10000 });
    if (rowPoint == null) throw new Error("被收起 Tab 的下拉行不可点");
    await clickPoint(client, rowPoint);
    const restored = await waitForProbe(client, TAB_IDS, (barIds) => barIds.includes(collapsedId), { timeoutMs: 15000 });
    reporter.check("expand-on-open", restored.includes(collapsedId), `bar = ${restored.join(",")}`);
    const truthAfterExpand = await waitForProbe(client, MAIN_TRUTH, (t) => Array.isArray(t) && !t.includes(collapsedId), {
        timeoutMs: 10000,
    });
    reporter.check(
        "expand-clears-main-truth",
        Array.isArray(truthAfterExpand) && !truthAfterExpand.includes(collapsedId),
        `main collapsed = ${JSON.stringify(truthAfterExpand)}`
    );

    // ── 再次收起 + 切到别的 Tab：所有 renderer 仍一致（回归判据）──────────
    await client.evaluate(collapseViaIpc);
    await waitForProbe(client, TAB_IDS, (barIds) => !barIds.includes(collapsedId), { timeoutMs: 10000 });

    const switchPoint = await waitForProbe(client, CENTER_OF_TAB(SWITCH_INDEX), (p) => p != null, { timeoutMs: 15000 });
    if (switchPoint == null) throw new Error("切换目标 Tab 不可点");
    await clickPoint(client, switchPoint);
    await waitForProbe(client, ACTIVE_TAB_ID, (id) => id === ids[SWITCH_INDEX], { timeoutMs: 20000 });
    await sleep(600);

    bars = await collectRendererBars(endpoint, reporter.log);
    reporter.check(
        "cross-renderer-after-switch",
        bars.length > 1 && bars.every((b) => !b.ids.includes(collapsedId)),
        `${bars.length} renderer(s); offenders=${bars.filter((b) => b.ids.includes(collapsedId)).map((b) => b.ownActive).join(",") || "none"}`
    );
    await reporter.shot(client, "02-after-switch");

    reporter.finish({
        skipped: [
            "原生右键菜单项的真实点击未覆盖：Electron 右键菜单是原生 menu-popup（不在 DOM），CDP 无法点击；收起动作改走 window.api.collapseTabIds（菜单 click 最终调用的同一 IPC 写路径）",
            "垂直 Tab 栏（app:tabbar=left）未在本台覆盖：两栏共用 selectBarVisibleTabIds + 同一 collapsedTabIdsAtom，广播面一致；垂直栏需人工回归",
            "「收起未使用的 Tab」批量动作未单独断言：与单个收起共用 collapseTabIds 写路径",
        ],
        cleanup: () => {
            client.close?.();
            if (instance?.spawned && !keepOpen) instance.cleanup?.();
        },
    });
} catch (err) {
    reporter.fatal(err, { cleanup: () => instance?.cleanup?.() });
}
