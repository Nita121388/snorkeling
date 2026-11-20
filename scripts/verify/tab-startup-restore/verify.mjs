#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 重启恢复：主栏应恢复上次打开的全部 Tab（顺序 + 激活 + 不灰化），而不是只显示激活那一个，
// 且用户手动「收起到更多」的选择要跨重启保留（2026-11-20 修复 D：主进程落盘 userData/tab-collapse.json）。
//
//   node scripts/verify/tab-startup-restore/verify.mjs              # 干净实例 → 播种 5 Tab → 同 profile 重启 → 收起 → 再重启 → 断言 → 自动关
//   node scripts/verify/tab-startup-restore/verify.mjs --keep-open  # 结束后留着手工看
//   node scripts/verify/tab-startup-restore/verify.mjs --dry        # 只解析依赖，不起 GUI
//
// 判据（重启后 · 水平 Tab 栏）：
//   1. restart-tab-count : 主栏 Tab 数 = 播种数（5），而不是只有激活的 1 个
//   2. restart-order     : 主栏 data-tab-id 序列 = 重启前捕获的序列
//   3. restart-active    : .tab.active = 重启前激活的那个 Tab
//   4. restart-notch     : 没有 Tab 带 .unopened-this-launch（不灰化）
//   5. collapse-hidden-before-restart : 收起 2 个 Tab 后主栏不再渲染它们
//   6. collapse-persist-after-restart : 第二次重启后这 2 个仍不在主栏、其余 3 个顺序不变、不灰化
//   7. collapse-truth-after-restart   : window.api.getCollapsedTabIds() 含这 2 个 id（落盘被读回，而非内存残留）
//   8. collapse-more-rows            : 「更多」下拉里这 2 行存在且 data-hidden=true
//   9. collapse-expand-on-open       : 展开其中一个 → 主栏重新露出（4 个）、主进程集合只减不增
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。
//
// 不支持 --attach：本台必须走完整「结束 electron → 同 profile 重启」路径，复用实例没有意义。

import { listPageTargets, connectToTarget } from "../lib/cdp.mjs";
import { ensureInstance, findPidByPort, killPid } from "../lib/launch.mjs";
import { createReporter } from "../lib/report.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep, waitForProbe } from "../lib/probes.mjs";

const AREA = "tab-startup-restore";
// 独立档位 + 独占端口（README「新增一个 area」第 6 条）：避免并行 agent 抢同一个 profile
// 或被别人的实例污染；本台会 rm -rf 自己的 .runcfg/verify-tab-startup-restore。
const PROFILE = "verify-tab-startup-restore";
const CDP_PORT = 9236;
const VITE_PORT = 51830;
const SEED_TABS = 5;
const ACTIVE_INDEX = 2; // 播种后激活第 3 个 Tab

const TAB_SELECTOR = ".tab-bar .tab[data-tab-id]";
const TAB_IDS = `[...document.querySelectorAll(${JSON.stringify(TAB_SELECTOR)})].map((e) => e.getAttribute("data-tab-id"))`;
const TAB_COUNT = `document.querySelectorAll(${JSON.stringify(TAB_SELECTOR)}).length`;
const ACTIVE_TAB_ID = `(() => {
    const el = document.querySelector(".tab-bar .tab.active[data-tab-id]");
    return el ? el.getAttribute("data-tab-id") : null;
})()`;
const UNOPENED_COUNT = `document.querySelectorAll(".tab-bar .tab.unopened-this-launch").length`;
const MAIN_TRUTH = `(window.api && typeof window.api.getCollapsedTabIds === "function") ? window.api.getCollapsedTabIds() : null`;
const MORE_TRIGGER = `document.querySelector('[aria-haspopup="menu"]')`;
const MORE_ROWS = `[...document.querySelectorAll('[role="menuitem"][data-tabid]')].map((e) => ({
    id: e.getAttribute("data-tabid"),
    hidden: e.getAttribute("data-hidden"),
}))`;

/** 可见元素中心点（用于 CDP 点击）。 */
const CENTER_OF = (selector) => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
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

async function waitPortFree(port, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (findPidByPort(port) == null) return true;
        await sleep(300);
    }
    return false;
}

/**
 * 「关掉 App 再打开」= 结束 electron 主进程 + dev-isolated 的 vite 兄弟进程，再用同一个
 * profile 重新起。必须同 profile：重启后要读到同一份 workspace 数据。
 */
async function hardRestart(instance, reporter) {
    instance?.cleanup?.();
    const cdpFreed = await waitPortFree(CDP_PORT);
    reporter.log(`electron stop → cdp port freed=${cdpFreed}`);
    await sleep(500);
    const vitePid = findPidByPort(VITE_PORT);
    if (vitePid != null) {
        killPid(vitePid);
        const viteFreed = await waitPortFree(VITE_PORT);
        reporter.log(`vite stop (pid ${vitePid}) → vite port freed=${viteFreed}`);
    }
}

const argv = process.argv.slice(2);
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

const reporter = createReporter({ area: AREA, mode: "launch+reset+restart" });
let instance = null;

if (dry) {
    reporter.log("dry-run: 依赖解析成功（未启动 GUI）");
    reporter.check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs");
    reporter.finish({ cleanup: null });
}

try {
    // ── 第一段：干净 profile 启动，播种 5 个 Tab ───────────────────────────
    const endpoint = `http://127.0.0.1:${CDP_PORT}`;
    instance = await ensureInstance({ attach: false, resetProfile: true, profile: PROFILE, cdpPort: CDP_PORT, vitePort: VITE_PORT });
    let client = instance.client;

    const pages = await listPageTargets(endpoint);
    if (pages.length > 1) {
        client = (await pickLiveRenderer(pages, connectToTarget, endpoint)).client;
    }
    await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    reporter.log("seed instance ready (launch+reset)");

    await dismissOnboarding(client, { log: reporter.log });

    const addTabPoint = await waitForProbe(client, CENTER_OF('[title="Add Tab"]'), (p) => p != null, {
        timeoutMs: 20000,
    });
    reporter.check("seed-add-tab-reachable", addTabPoint != null, addTabPoint ? "ok" : "Add Tab 按钮不可达");
    if (addTabPoint == null) throw new Error("Add Tab 按钮不可达");

    for (let target = 2; target <= SEED_TABS; target++) {
        const point = await waitForProbe(client, CENTER_OF('[title="Add Tab"]'), (p) => p != null, {
            timeoutMs: 15000,
        });
        await clickPoint(client, point);
        await waitForProbe(client, TAB_COUNT, (n) => n >= target, { timeoutMs: 20000 });
    }
    const idsBefore = await client.evaluate(TAB_IDS);
    reporter.check("seed-tab-count", idsBefore.length === SEED_TABS, `${idsBefore.length}/${SEED_TABS} tabs rendered`);

    // 激活第 3 个 Tab，构造「激活项 ≠ 物理序第一个」的场景。
    const activeTarget = idsBefore[ACTIVE_INDEX];
    const targetPoint = await waitForProbe(client, CENTER_OF_TAB(ACTIVE_INDEX), (p) => p != null, {
        timeoutMs: 15000,
    });
    await clickPoint(client, targetPoint);
    const activeBefore = await waitForProbe(client, ACTIVE_TAB_ID, (id) => id === activeTarget, {
        timeoutMs: 20000,
    });
    reporter.check("seed-active", activeBefore === activeTarget, `active=${activeBefore}`);

    // ── 第二段：关 App（同 profile）再打开 ────────────────────────────────
    await hardRestart(instance, reporter);
    instance = null;

    instance = await ensureInstance({ attach: false, resetProfile: false, profile: PROFILE, cdpPort: CDP_PORT, vitePort: VITE_PORT });
    client = instance.client;
    const pages2 = await listPageTargets(endpoint);
    if (pages2.length > 1) {
        client = (await pickLiveRenderer(pages2, connectToTarget, endpoint)).client;
    }
    await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    reporter.log("restarted instance ready (same profile)");

    // 重启后必须先有至少一个 Tab 渲染出来，count 才可信。
    await waitForProbe(client, TAB_COUNT, (n) => n >= 1, { timeoutMs: 60000 });

    const idsAfter = await client.evaluate(TAB_IDS);
    const activeAfter = await client.evaluate(ACTIVE_TAB_ID);
    const unopened = await client.evaluate(UNOPENED_COUNT);

    reporter.check(
        "restart-tab-count",
        idsAfter.length === SEED_TABS,
        `after restart ${idsAfter.length}/${SEED_TABS} tabs in main bar`
    );
    reporter.check(
        "restart-order",
        JSON.stringify(idsAfter) === JSON.stringify(idsBefore),
        `before=${idsBefore.join(",")} after=${idsAfter.join(",")}`
    );
    reporter.check(
        "restart-active",
        activeAfter === activeTarget,
        `expected=${activeTarget} actual=${activeAfter}`
    );
    reporter.check("restart-notch", unopened === 0, `${unopened} tab(s) with .unopened-this-launch`);

    await reporter.shot(client, "01-after-restart");

    // ── 第三段：手动「收起到更多」→ 第二次重启 → 收起状态应还在 ────────────────
    const collapseTargets = [idsAfter[0], idsAfter[3]]; // 两个非激活 Tab
    await client.evaluate(`window.api.collapseTabIds(${JSON.stringify(collapseTargets)})`);
    const barAfterCollapse = await waitForProbe(
        client,
        TAB_IDS,
        (ids) => Array.isArray(ids) && collapseTargets.every((id) => !ids.includes(id)),
        { timeoutMs: 20000 }
    );
    reporter.check(
        "collapse-hidden-before-restart",
        Array.isArray(barAfterCollapse) && barAfterCollapse.length === SEED_TABS - collapseTargets.length,
        `bar=${(barAfterCollapse ?? []).join(",")} expected hidden=${collapseTargets.join(",")}`
    );

    await hardRestart(instance, reporter);
    instance = null;

    instance = await ensureInstance({ attach: false, resetProfile: false, profile: PROFILE, cdpPort: CDP_PORT, vitePort: VITE_PORT });
    client = instance.client;
    const pages3 = await listPageTargets(endpoint);
    if (pages3.length > 1) {
        client = (await pickLiveRenderer(pages3, connectToTarget, endpoint)).client;
    }
    await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    await waitForProbe(client, TAB_COUNT, (n) => n >= 1, { timeoutMs: 60000 });
    reporter.log("second restart ready (same profile)");

    const idsAfterSecond = await client.evaluate(TAB_IDS);
    const truthAfterSecond = await client.evaluate(MAIN_TRUTH);
    const unopenedSecond = await client.evaluate(UNOPENED_COUNT);
    const expectedVisible = idsAfter.filter((id) => !collapseTargets.includes(id));

    reporter.check(
        "collapse-persist-after-restart",
        JSON.stringify(idsAfterSecond) === JSON.stringify(expectedVisible) && unopenedSecond === 0,
        `bar=${idsAfterSecond.join(",")} expected=${expectedVisible.join(",")} notch=${unopenedSecond}`
    );
    reporter.check(
        "collapse-truth-after-restart",
        Array.isArray(truthAfterSecond) && collapseTargets.every((id) => truthAfterSecond.includes(id)),
        `truth=${JSON.stringify(truthAfterSecond)} expected to contain=${collapseTargets.join(",")}`
    );
    await reporter.shot(client, "02-after-second-restart");

    const triggerPoint = await waitForProbe(client, CENTER_OF(MORE_TRIGGER), (p) => p != null, { timeoutMs: 15000 });
    if (triggerPoint != null) {
        await clickPoint(client, triggerPoint);
    }
    const moreRows = triggerPoint == null ? [] : await client.evaluate(MORE_ROWS);
    reporter.check(
        "collapse-more-rows",
        triggerPoint != null && collapseTargets.every((id) => moreRows.some((r) => r.id === id && r.hidden === "true")),
        `rows=${JSON.stringify(moreRows)}`
    );
    await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(300);

    const expandTarget = collapseTargets[0];
    await client.evaluate(`window.api.expandCollapsedTabId(${JSON.stringify(expandTarget)})`);
    const barAfterExpand = await waitForProbe(client, TAB_IDS, (ids) => Array.isArray(ids) && ids.includes(expandTarget), {
        timeoutMs: 20000,
    });
    const truthAfterExpand = await client.evaluate(MAIN_TRUTH);
    reporter.check(
        "collapse-expand-on-open",
        Array.isArray(barAfterExpand) && barAfterExpand.length === SEED_TABS - collapseTargets.length + 1 && !(truthAfterExpand ?? []).includes(expandTarget),
        `bar=${(barAfterExpand ?? []).join(",")} truth=${JSON.stringify(truthAfterExpand)}`
    );

    reporter.finish({
        skipped: [
            "垂直栏（app:tabbar=left）变体未在本台覆盖：两栏共用同一可见性模型（selectBarVisibleTabIds），由 tab/emain 单测锁定；垂直栏需人工回归",
            "「更多」触发器计数=0 未单独断言：主栏渲染数=workspace 全部 Tab 数已隐含该结论",
            "右键菜单「从 Tab 栏隐藏」不可 CDP 点击（Electron 原生菜单）；本台用 window.api.collapseTabIds 走同一条 IPC 写路径",
            "关闭已收起 Tab 的落盘清理由 emain/emain-window.test.ts 覆盖，本台未跑「收起后关闭再重启」链路",
        ],
        cleanup: () => {
            client.close?.();
            if (instance?.spawned && !keepOpen) instance.cleanup?.();
        },
    });
} catch (err) {
    reporter.fatal(err, { cleanup: () => instance?.cleanup?.() });
}
