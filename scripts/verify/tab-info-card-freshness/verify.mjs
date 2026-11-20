#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Tab 悬浮卡数据新鲜度（11-20 tab-info-card-freshness）。
//
// 背景：`TabInfoCard` 历史上用 `getObjectValue()` 做一次性快照读，不订阅 WOS atom。
// 非激活 Tab 的 block 首读常常是 null（被归成 `other`）或旧 meta，而 waveobj:update
// 抵达后卡片不重渲染 —— 用户必须「移开鼠标再悬浮一次」才看到正确 agent 信息。
// 修复后卡片走派生 atom 订阅，卡片打开期间的后端 meta 写入会就地刷新。
//
//   node scripts/verify/tab-info-card-freshness/verify.mjs            # 起干净实例 → 跑全流程 → 自动关
//   node scripts/verify/tab-info-card-freshness/verify.mjs --keep-open
//   node scripts/verify/tab-info-card-freshness/verify.mjs --dry      # 只解析依赖
//
// 判据：
//   1. seed-two-tabs                : 播种出 2 个 Tab，拿到非激活 Tab 的 block id
//   2. non-active-card-baseline     : hover 非激活 Tab → 卡片打开且 0 个 agent 行（term chip）
//   3. live-meta-update             : **鼠标不动**的情况下写入 agent meta → agent 行出现（本次修复核心）
//   4. provider-follows-meta        : 该行 provider 文案跟着 meta 变成 pi
//   5. active-tab-unaffected        : 切回激活 Tab hover，卡片仍正常（无回归）
//
// 覆盖说明（skipped）：
//   - inline 子块（`block.subblockids` 挂 agent）在真机上需要人工拖出 Blocks 组，
//     自动化建组路径未收进验证台 → 由 `frontend/app/tab/tab-info-card.dom.test.tsx` 覆盖。
//   - 卡片视觉/像素未断言（本次是数据层修复，样式不动）。
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { ensureInstance } from "../lib/launch.mjs";
import { createReporter } from "../lib/report.mjs";
import { dismissOnboarding, pickLiveRenderer, probeCenter, sleep, waitForProbe } from "../lib/probes.mjs";

const AREA = "tab-info-card-freshness";
// 独立档位 + 独占端口（README「新增一个 area」第 6 条）：避免并行 agent 抢同一个 profile。
const PROFILE = "verify-tab-info-card-freshness";
const CDP_PORT = 9247;
const VITE_PORT = 51841;

const TAB_SELECTOR = ".tab-bar .tab[data-tab-id]";
const TAB_COUNT = `document.querySelectorAll(${JSON.stringify(TAB_SELECTOR)}).length`;
const TAB_IDS = `[...document.querySelectorAll(${JSON.stringify(TAB_SELECTOR)})].map((e) => e.getAttribute("data-tab-id"))`;
const ACTIVE_TAB_ID = `(() => {
    const el = document.querySelector(".tab-bar .tab.active[data-tab-id]");
    return el ? el.getAttribute("data-tab-id") : null;
})()`;
/** 激活 Tab 里第一个 block 的 id（用来写 meta）。 */
const ACTIVE_BLOCK_ID = `(() => {
    const el = document.querySelector("[data-blockid]");
    return el ? el.getAttribute("data-blockid") : null;
})()`;
/** 悬浮卡内的 agent 行（TabInfoCard 的 .tab-card-agent-list）。 */
const CARD_OPEN = `document.querySelector(".info-card-portal .tab-card") != null`;
const CARD_AGENT_ROWS = `document.querySelectorAll(".info-card-portal .tab-card-agent-row").length`;
const CARD_PROVIDERS = `[...document.querySelectorAll(".info-card-portal .tab-card-agent-name")].map((e) => e.textContent.trim())`;
const CARD_TEXT = `(document.querySelector(".info-card-portal .tab-card")?.textContent ?? "")`;

/**
 * Add Tab 按钮坐标：**不按 title 文案找**（本机语言是中文时 title 是「新建 Tab」，
 * 英文 selector 直接 null → "按钮不可达"）。按按钮里的 plus 图标识别，语言无关。
 */
const ADD_TAB_POINT = `(() => {
    function __visible(el) {
        const r = el.getBoundingClientRect();
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        return r.width > 4 && r.height > 4 && cx > 0 && cx < innerWidth - 2 && cy > 0 && cy < innerHeight - 2;
    }
    const buttons = [...document.querySelectorAll(".tab-bar-wrapper button, .tab-bar button")];
    const el = buttons.find((b) => b.querySelector("i.fa-plus"));
    if (!el || !__visible(el)) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`;

/** 失败诊断：把 tab 栏附近的按钮 title / 图标 / 可见性抓出来，省一次 6 分钟的盲跑。 */
const TABBAR_DIAG = `(() => {
    const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 4 && r.height > 4;
    };
    return {
        lang: document.documentElement.lang,
        tabbar: document.querySelectorAll(".tab-bar").length,
        tabs: document.querySelectorAll(".tab-bar .tab[data-tab-id]").length,
        buttons: [...document.querySelectorAll(".tab-bar-wrapper button, .tab-bar button")].map((b) => ({
            title: b.getAttribute("title"),
            icon: b.querySelector("i")?.className ?? "",
            visible: vis(b),
        })),
        overlays: [...document.querySelectorAll(".modal, .modal-wrapper, [role=dialog]")].map((e) => e.className),
    };
})()`;

const centerOfTab = (index) => `(() => {
    const el = document.querySelectorAll(${JSON.stringify(TAB_SELECTOR)})[${index}];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    if (r.width < 4 || r.height < 4) return null;
    return { x, y };
})()`;

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
    await client.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: point.x,
        y: point.y,
        button: "left",
        buttons: 0,
        clickCount: 1,
    });
    await sleep(250);
}

/**
 * 写 block meta（走 renderer 内的真实 RPC 入口 object.UpdateObjectMeta）。
 * 不用 wsh CLI：它依赖 WAVETERM_JWT / 域套接字，外层 shell 拿不到隔离 profile 的凭据。
 */
const writeAgentMeta = (blockId) => `(async () => {
    const endpoint = await window.api.getEnv("WAVE_SERVER_WEB_ENDPOINT");
    const resp = await fetch("http://" + endpoint + "/wave/service?service=object&method=UpdateObjectMeta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            service: "object",
            method: "UpdateObjectMeta",
            args: ["block:${blockId}", { "agent:provider": "pi", "agent:sessionid": "verify-sess-1" }],
            uicontext: null,
        }),
    });
    const text = await resp.text();
    return { status: resp.status, body: text.slice(0, 200) };
})()`;

function parseArgs(argv) {
    return {
        keepOpen: argv.includes("--keep-open"),
        dry: argv.includes("--dry"),
    };
}

async function main() {
    const { keepOpen, dry } = parseArgs(process.argv.slice(2));
    const reporter = createReporter({
        area: AREA,
        endpoint: `http://127.0.0.1:${CDP_PORT}`,
        mode: dry ? "dry" : "launch+reset",
        meta: { fix: "TabInfoCard 快照读 → 派生 atom 订阅" },
    });

    if (dry) {
        reporter.log("dry: 依赖解析完成（cdp/lib launch/probes/report）");
        reporter.check("dry-deps", true, "libs resolved");
        reporter.finish({ ledger: false, skipped: ["dry run 不起 GUI"] });
        return;
    }

    let client = null;
    let cleanup = null;
    try {
        const inst = await ensureInstance({
            cdpPort: CDP_PORT,
            vitePort: VITE_PORT,
            profile: PROFILE,
        });
        cleanup = () => {
            inst.cleanup?.();
            client?.close?.();
        };
        client = inst.client;
        const endpoint = `http://127.0.0.1:${CDP_PORT}`;
        // 多 Tab 时 ensureInstance 连到的可能是空壳 renderer —— 重新挑一个真工作区。
        const pages = await listPageTargets(endpoint);
        if (pages.length > 1) {
            client = (await pickLiveRenderer(pages, connectToTarget, endpoint)).client;
        }
        await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
        await dismissOnboarding(client, { log: reporter.log });

        // ── 1 播种两个 Tab ──
        for (let target = 2; target <= 2; target++) {
            let point = await waitForProbe(client, ADD_TAB_POINT, (p) => p != null, { timeoutMs: 30000 });
            if (point == null) {
                const diag = await client.evaluate(TABBAR_DIAG);
                reporter.log(`tabbar diag: ${JSON.stringify(diag)}`);
                throw new Error(`Add Tab 按钮不可达（诊断见上）`);
            }
            await clickPoint(client, point);
            await waitForProbe(client, TAB_COUNT, (n) => n >= target, { timeoutMs: 20000 });
        }
        const tabIds = await client.evaluate(TAB_IDS);
        reporter.check("seed-two-tabs", tabIds.length === 2, `${tabIds.length} tabs: ${tabIds.join(", ")}`);
        if (tabIds.length < 2) throw new Error("播种 Tab 数不足，后续断言不可信");

        // 第 2 个 Tab 激活 → 读它的 block id → 切回第 1 个 Tab（让它变成非激活）
        await clickPoint(client, await waitForProbe(client, centerOfTab(1), (p) => p != null, { timeoutMs: 15000 }));
        await waitForProbe(client, ACTIVE_TAB_ID, (id) => id === tabIds[1], { timeoutMs: 20000 });
        const targetBlockId = await waitForProbe(client, ACTIVE_BLOCK_ID, (id) => typeof id === "string" && id !== "", {
            timeoutMs: 20000,
        });
        await clickPoint(client, await waitForProbe(client, centerOfTab(0), (p) => p != null, { timeoutMs: 15000 }));
        await waitForProbe(client, ACTIVE_TAB_ID, (id) => id === tabIds[0], { timeoutMs: 20000 });
        const nonActiveTabId = tabIds[1];

        // ── 2 hover 非激活 Tab：基线（0 个 agent 行） ──
        const tabPoint = await waitForProbe(client, centerOfTab(1), (p) => p != null, { timeoutMs: 15000 });
        await client.move(tabPoint.x, tabPoint.y);
        const cardOpened = await waitForProbe(client, CARD_OPEN, (v) => v === true, { timeoutMs: 15000 });
        reporter.check("non-active-card-baseline-open", cardOpened === true, `tab=${nonActiveTabId}`);
        const rowsBefore = await client.evaluate(CARD_AGENT_ROWS);
        const textBefore = await client.evaluate(CARD_TEXT);
        reporter.check(
            "non-active-card-baseline-no-agent",
            rowsBefore === 0,
            `rows=${rowsBefore} text=${String(textBefore).slice(0, 80)}`
        );

        // ── 3 鼠标不动，写入 agent meta → 卡片就地刷新（本次修复核心） ──
        const writeResult = await client.evaluate(writeAgentMeta(targetBlockId));
        reporter.log(`meta write: ${JSON.stringify(writeResult)}`);
        let rowsAfter = 0;
        try {
            rowsAfter = await waitForProbe(client, CARD_AGENT_ROWS, (n) => n >= 1, { timeoutMs: 20000 });
        } catch {
            rowsAfter = await client.evaluate(CARD_AGENT_ROWS);
        }
        reporter.check(
            "live-meta-update-without-rehover",
            rowsAfter >= 1,
            `rows ${rowsBefore} → ${rowsAfter}（鼠标未移动）`
        );

        // ── 4 provider 文案跟随 meta ──
        const providers = await client.evaluate(CARD_PROVIDERS);
        reporter.check(
            "provider-follows-meta",
            Array.isArray(providers) && providers.includes("pi"),
            JSON.stringify(providers)
        );

        await reporter.shot(client, "non-active-tab-card");

        // ── 5 激活 Tab 的卡片无回归 ──
        await client.move(2, 2); // 移开，让卡片收起
        await sleep(600);
        const activePoint = await waitForProbe(client, centerOfTab(0), (p) => p != null, { timeoutMs: 15000 });
        await client.move(activePoint.x, activePoint.y);
        const cardOnActive = await waitForProbe(client, CARD_OPEN, (v) => v === true, { timeoutMs: 15000 });
        reporter.check("active-tab-card-ok", cardOnActive === true, "hovering active tab still opens card");

        reporter.finish({
            cleanup: keepOpen
                ? () => {
                      client?.close?.();
                      reporter.log("--keep-open：实例保留，手工检查后自行关闭");
                  }
                : cleanup,
            extra: { tabIds, nonActiveTabId, targetBlockId },
            skipped: [
                "inline 子块（subblockids 挂 agent）真机建组未自动化 → 由 tab-info-card.dom.test.tsx 覆盖",
                "卡片像素/视觉未断言（数据层修复，样式不动）",
            ],
        });
    } catch (err) {
        reporter.fatal(err, { cleanup });
    }
}

main();
