#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 声明式 provider 来源验证台（11-26-aisessions-declarative-provider）。
//
//   node scripts/verify/aisessions-declarative-source/verify.mjs             # 干净实例 → 跑 → 自动关
//   node scripts/verify/aisessions-declarative-source/verify.mjs --attach     # 复用已起实例
//   node scripts/verify/aisessions-declarative-source/verify.mjs --keep-open  # 留着手工看
//   node scripts/verify/aisessions-declarative-source/verify.mjs --dry        # 只解析依赖
//
// 判据（机器判定，不靠肉眼）：
//   1. AI Sessions 列表出现声明式来源的会话行（key 前缀 antigravity:，本机 ≥2 条）。
//   2. 来源筛选面板出现 "Antigravity" 选项（label 来自 provider 配置，非硬编码）。
//   3. 选中后列表只剩 antigravity 会话，且数量 ≥2。
//   4. 双击一条 antigravity 会话 → 详情面板按 key 打开（消息体是 protobuf，MVP 无正文，
//      只要求不崩：面板挂载即算通过）。
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误（本机无 antigravity 会话数据属环境问题）。

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { DEFAULTS, ensureInstance } from "../lib/launch.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep } from "../lib/probes.mjs";
import { createReporter } from "../lib/report.mjs";

const AREA = "aisessions-declarative-source";
const DECL_SOURCE = "antigravity";
const DECL_LABEL = "Antigravity";

const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

const reporter = createReporter({ area: AREA, mode: attach ? "attach" : "launch+reset" });
let instance = null;

// 行快照：可见、带 key 的会话行（__new__ 占位不算）。
const ROWS_FN = `(() => {
    const rows = Array.from(document.querySelectorAll('[data-session-key]'));
    return rows
        .map((el) => {
            const br = el.getBoundingClientRect();
            return {
                key: el.dataset.sessionKey || '',
                text: (el.textContent || '').trim().slice(0, 80),
                x: Math.round(br.left + br.width / 2),
                y: Math.round(br.top + br.height / 2),
                visible: br.width > 40 && br.height > 12,
            };
        })
        .filter((r) => r.key !== '' && r.key !== '__new__' && r.visible);
})()`;

// 详情面板快照。
const PANES_FN = `(() =>
    Array.from(document.querySelectorAll('[data-detail-session-key]')).map((el) => ({
        key: el.dataset.detailSessionKey || '',
        text: (el.textContent || '').trim().slice(0, 200),
    }))
)()`;

// 筛选面板里来源段的按钮（title/aria-label 都带 label）。
const SOURCE_BTN_FN = `((label) => {
    const btns = Array.from(document.querySelectorAll('button[aria-pressed]'));
    return btns
        .filter((b) => (b.getAttribute('title') || b.getAttribute('aria-label') || '') === label)
        .map((b) => {
            const br = b.getBoundingClientRect();
            return {
                active: b.getAttribute('aria-pressed') === 'true',
                x: Math.round(br.left + br.width / 2),
                y: Math.round(br.top + br.height / 2),
            };
        });
})(${JSON.stringify(DECL_LABEL)})`;

async function realClick(client, pt) {
    await client.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: pt.x,
        y: pt.y,
        button: "none",
        buttons: 0,
    });
    await sleep(80);
    for (const clickCount of [1, 2]) {
        await client.send("Input.dispatchMouseEvent", {
            type: "mousePressed",
            x: pt.x,
            y: pt.y,
            button: "left",
            buttons: 1,
            clickCount,
        });
        await sleep(50);
        await client.send("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: pt.x,
            y: pt.y,
            button: "left",
            buttons: 0,
            clickCount,
        });
        await sleep(90);
    }
    await sleep(600);
}

async function openAisessionsView(client, log) {
    await client.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape" }).catch(() => {});
    await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" }).catch(() => {});
    const opened = await client.evaluate(`(() => {
        const btn = document.querySelector('[aria-label="AI Sessions"], [title="AI Sessions"]');
        if (btn == null) return false;
        btn.click();
        return true;
    })()`);
    log(`open aisessions via widget button: ${opened}`);
    return opened === true;
}

if (dry) {
    reporter.log("dry-run: 依赖解析成功（未启动 GUI）");
    reporter.check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs");
    reporter.finish({ ledger: false, cleanup: null });
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

    if (!(await openAisessionsView(client, reporter.log))) {
        reporter.fatal(new Error("右侧 WidgetsBar 上找不到 AI Sessions 入口"));
    }
    reporter.check("aisessions-view-opened", true, "widget 入口点击成功");

    // 判据 1：声明式来源的会话行出现在列表里。
    let rows = [];
    const rowsDeadline = Date.now() + 60000;
    while (Date.now() < rowsDeadline) {
        rows = await client.evaluate(ROWS_FN);
        if (rows.some((r) => r.key.startsWith(`${DECL_SOURCE}:`)) && rows.length >= 2) break;
        await sleep(1000);
    }
    const declRows = rows.filter((r) => r.key.startsWith(`${DECL_SOURCE}:`));
    if (declRows.length < 1) {
        reporter.fatal(
            new Error(
            `列表未出现 ${DECL_SOURCE}: 会话（rows=${rows.length}）。` +
                "本机需存在 ~/.gemini/antigravity-cli/conversation_summaries.db 且扫描完成，属环境问题。"
          )
        );
    }
    reporter.check(
        "declarative-source-rows-present",
        declRows.length >= 2,
        `antigravity rows=${declRows.length} total=${rows.length}; first=${declRows[0]?.text?.slice(0, 40)}`
    );

    // 判据 2：筛选面板出现 Antigravity 选项（label 来自配置）。
    const filterToggleClicked = await client.evaluate(`(() => {
        const btn = document.querySelector('button[aria-pressed][title^="Filters"], button[aria-pressed][title^="筛选"]');
        if (btn == null) return false;
        btn.click();
        return true;
    })()`);
    if (!filterToggleClicked) {
        reporter.fatal(new Error("找不到筛选面板开关（button[title^='Filters'|'筛选']）"));
    }
    await sleep(600);
    let sourceBtns = [];
    const btnDeadline = Date.now() + 20000;
    while (Date.now() < btnDeadline) {
        sourceBtns = await client.evaluate(SOURCE_BTN_FN);
        if (sourceBtns.length > 0) break;
        await sleep(700);
    }
    reporter.check(
        "filter-source-option-present",
        sourceBtns.length > 0,
        `label="${DECL_LABEL}" buttons=${sourceBtns.length}（label 来自 provider 配置，非前端硬编码）`
    );
    if (sourceBtns.length === 0) {
        reporter.finish({
            skipped: ["判据 3/4（筛选与详情）：无来源按钮可点"],
            cleanup: () => {
                client.close?.();
                if (instance?.spawned && !keepOpen) instance.cleanup?.();
            },
        });
    }
    await reporter.shot(client, "01-filter-source-option");

    // 判据 3：选中后只剩 antigravity 会话。
    await realClick(client, sourceBtns[0]);
    let filteredRows = [];
    const filterDeadline = Date.now() + 30000;
    while (Date.now() < filterDeadline) {
        filteredRows = await client.evaluate(ROWS_FN);
        if (filteredRows.length > 0 && filteredRows.every((r) => r.key.startsWith(`${DECL_SOURCE}:`))) break;
        await sleep(700);
    }
    const allDecl = filteredRows.length > 0 && filteredRows.every((r) => r.key.startsWith(`${DECL_SOURCE}:`));
    reporter.check(
        "filter-applies-to-declarative-source",
        allDecl && filteredRows.length >= Math.min(declRows.length, 2),
        `filtered rows=${filteredRows.length} all=${DECL_SOURCE}:${allDecl} (expect ≥2)`
    );
    await reporter.shot(client, "02-filtered-list");

    // 判据 4：双击 antigravity 会话 → 详情挂载不崩（无正文是已知降级，不作为失败）。
    const target = filteredRows[0] ?? declRows[0];
    await realClick(client, target);
    let panes = [];
    const paneDeadline = Date.now() + 30000;
    while (Date.now() < paneDeadline) {
        panes = await client.evaluate(PANES_FN);
        if (panes.some((p) => p.key === target.key)) break;
        await sleep(700);
    }
    const paneOk = panes.some((p) => p.key === target.key);
    reporter.check(
        "detail-pane-opens-without-crash",
        paneOk,
        paneOk
            ? `pane key=${target.key.slice(0, 40)}… 挂载成功（消息体 protobuf 不支持属已知降级）`
            : `pane 未挂载：panes=${JSON.stringify(panes.map((p) => p.key.slice(0, 24)))}`
    );
    await reporter.shot(client, "03-detail-pane");

    reporter.finish({
        skipped: [
            "消息正文渲染（protobuf 解码）：MVP 明确不支持，LoadMessages 返回空由 Go 单测覆盖",
            "自定义（非 antigravity）声明式 provider 的 UI 面：走 Go 单测 + 配置合并单测覆盖",
        ],
        cleanup: () => {
            client.close?.();
            if (instance?.spawned && !keepOpen) instance.cleanup?.();
        },
    });
} catch (err) {
    reporter.fatal(err, { cleanup: () => instance?.cleanup?.() });
}
