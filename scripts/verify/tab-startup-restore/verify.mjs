#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 重启恢复：主栏应恢复上次打开的全部 Tab（顺序 + 激活 + 不灰化），而不是只显示激活那一个。
//
//   node scripts/verify/tab-startup-restore/verify.mjs              # 干净实例 → 播种 5 Tab → 同 profile 重启 → 断言 → 自动关
//   node scripts/verify/tab-startup-restore/verify.mjs --keep-open  # 结束后留着手工看
//   node scripts/verify/tab-startup-restore/verify.mjs --dry        # 只解析依赖，不起 GUI
//
// 判据（重启后 · 水平 Tab 栏）：
//   1. restart-tab-count : 主栏 Tab 数 = 播种数（5），而不是只有激活的 1 个
//   2. restart-order     : 主栏 data-tab-id 序列 = 重启前捕获的序列
//   3. restart-active    : .tab.active = 重启前激活的那个 Tab
//   4. restart-notch     : 没有 Tab 带 .unopened-this-launch（不灰化）
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

    reporter.finish({
        skipped: [
            "垂直栏（app:tabbar=left）变体未在本台覆盖：两栏共用同一可见性模型（selectBarVisibleTabIds），由 tab/emain 单测锁定；垂直栏需人工回归",
            "「更多」触发器计数=0 未单独断言：主栏渲染数=workspace 全部 Tab 数已隐含该结论",
        ],
        cleanup: () => {
            client.close?.();
            if (instance?.spawned && !keepOpen) instance.cleanup?.();
        },
    });
} catch (err) {
    reporter.fatal(err, { cleanup: () => instance?.cleanup?.() });
}
