#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// F-1122-overview-tab-grouping 真机验证台：Overview 列表视图的 Tab 分组 **tab-first** 化。
//
// 为什么需要一个真机台子：本包的三个历史缺陷全部在"组被删掉"这一层——空组被
// `blocks.length > 0` 过滤、块未解析时组为空同样被删、`agentsOnly` 先过滤组内行再删空组。
// 单测（`overview-tab-groups.test.ts`）只锁纯函数，锁不到「真机上组头 DOM 是否真的常驻」
// 「每块单发 GetObject 的首帧是不是全 null」「汇总行的 N/M 是否真的等于 workspace.tabids /
// 渲染组数」——这些只有数 DOM 和服务调用次数才说得清。
//
// 断言（7 条，全部走真实 DOM + CDP）：
//   1. tab-group-count-matches-tabids   组头 DOM 数 == workspace.tabids 数（👁 关时）
//   2. agents-only-keeps-groups         🤖 开关前后组头数不变（且按钮真的按下去）
//   3. empty-tab-group-shows-no-blocks  只含 Overview 块的 Tab：组存在 + status=empty + 可见 noBlocks
//   4. hide-unopened-only-deletes-unopened 👁 开只删 unopened 组（empty/live 不受影响）
//   5. tab-summary-consistent           汇总行 N == tabids 数、M == 渲染组数
//   6. firstpaint-groups-fast           刷新后 1.2s 内组头数 == tabids 数（tab-first 首帧不缺席）
//   7. firstpaint-getobjects-le3        首屏批量 prime：GetObjects 服务调用 1..3 次（旧路径是 ~190 次单件 GetObject）
//   8. new-tab-toolbar-entry-creates-empty-tab  工具栏「＋ 新建 Tab」→ 空 Tab：tabids +1、组头数 +1、激活 Tab 不变
//   9. new-tab-tail-entry-creates-agent-tab     组尾「＋ 新建 Tab」→ 空 Tab + Agent：blockids = 1 且块 meta 含 agent:*、不抢焦点
//      （8/9 = F-1122-overview-new-tab 的真机入口，弹窗走 ReactDOM portal 挂 #main，不在 block 容器里）
//  10. card-expand-focus                        点 agent 行主体 → 展开体 + composer 出现且焦点在 textarea；Esc 收起
//  11. card-send-replied                        勾「发送后等回复」发 CARD_OK → 徽章「收到回复」+ 卡片内出现 CARD_OK
//  12. card-send-no-wait                        取消勾选再发 NOWAIT_SECOND → ≤3s 徽章「已提交/未确认提交」（非回复）；另一行仍可展开
//      （10-12 = F-1122-overview-card-send 的真机入口；可对话 agent 由台内自起：AgentLaunchCommand + ControllerResync）
//
// 组头标记（实现已落地，本台子只读）：
//   `[data-overview-tab-group="<tabId>"]` + `data-overview-tab-status="live|empty|unopened|loading"`
//   汇总行 `[data-overview-tab-summary]`
//
// 用法：
//   node scripts/verify/overview-ux/verify.mjs               # 起干净实例 → 全流程 → 自动关
//   node scripts/verify/overview-ux/verify.mjs --attach      # 复用已起实例（迭代主力）
//   node scripts/verify/overview-ux/verify.mjs --keep-open   # 结束后不关实例
//   node scripts/verify/overview-ux/verify.mjs --dry         # 只解析参数/依赖，不启动 GUI
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误

import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { ensureInstance } from "../lib/launch.mjs";
import { createReporter } from "../lib/report.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep } from "../lib/probes.mjs";

const AREA = "overview-ux";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

// 独立 profile + 独立端口：不与别的 area 抢默认实例，也不碰用户正在跑的主实例（9222）。
const PROFILE = "verify-overview-ux";
const CDP_PORT = 9261;
const VITE_PORT = 51862;
const ENDPOINT = `http://127.0.0.1:${CDP_PORT}`;

const here = path.dirname(fileURLToPath(import.meta.url));

// 播种规模：1（初始 tab） + 1 空 tab + 1 只含 Overview 块的 tab + 4 live tab + 1 agent tab = 8
const LIVE_TAB_COUNT = 4;
// PRD 判据「首屏 GetObjects ≤ 3」（Phase A tab + Phase B block，>400 oref 才分批）。
const MAX_FIRSTPAINT_GETOBJECTS = 3;
// 首屏组头补齐窗口（PRD：刷新 Overview 后 1.2s 内组头齐）。
const FIRSTPAINT_WINDOW_MS = 1200;

const reporter = createReporter({
    area: AREA,
    endpoint: ENDPOINT,
    mode: attach ? "attach" : "launch+reset",
    meta: { profile: PROFILE, cdpPort: CDP_PORT, vitePort: VITE_PORT },
});
const { log, check, shot } = reporter;
const skipped = [];
let instance = null;
let client = null;

const createdTabIds = [];
let overviewBlockId = "";
let overviewOnlyTabId = "";
let emptyTabId = "";
let workspaceId = "";

// ── 通用等待 ────────────────────────────────────────────────────────────────

const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 页内探针重试：dev 模式偶发「模块管道抽风 / 上下文销毁」，单次失败不该把整轮打成 FATAL。
 * 只吞异常重试，**不**改变断言语义（重试耗尽仍抛，由外层报错）。
 */
async function evalRetry(expression, { tries = 5, waitMs = 500 } = {}) {
    let lastErr = null;
    for (let i = 0; i < tries; i++) {
        try {
            return await client.evaluate(expression);
        } catch (err) {
            lastErr = err;
            await sleep2(waitMs);
        }
    }
    throw lastErr;
}

async function waitFor(client, probe, ready, timeoutMs = 30000, intervalMs = 400) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        last = await client.evaluate(probe).catch(() => null);
        if (ready(last)) return last;
        await sleep(intervalMs);
    }
    return last;
}

/**
 * 挑一个"真的有工作区"的 renderer，并且**重试**。
 *
 * 为什么不能只调一次 pickLiveRenderer：多 renderer（主窗口 + 每个 Tab 一个 BrowserView）下
 * 页面列表是动态的；attach 到残留实例、或刚 reload 完时可能所有 target 都还是 0 块 / 0 宽，
 * 单次挑会把整轮直接打成「环境错误」（实测踩过）。
 */
async function pickRenderer({ tries = 40, intervalMs = 1500 } = {}) {
    let lastErr = null;
    for (let i = 0; i < tries; i++) {
        const pages = await listPageTargets(ENDPOINT).catch(() => []);
        if (pages.length > 0) {
            try {
                return await pickLiveRenderer(pages, connectToTarget, ENDPOINT);
            } catch (err) {
                lastErr = err;
            }
        }
        await sleep(intervalMs);
    }
    throw new Error(`没有可用的 renderer（${tries} 次尝试后仍失败）：${String(lastErr?.message ?? lastErr ?? "")}`);
}

// ── 页面探针 ────────────────────────────────────────────────────────────────

/**
 * 页内 global.ts 导入重试器（嵌入每个需要它的探针）。
 *
 * 为什么不能直接 `await import(...)` 就完事：dev 模式下 vite 的模块管道偶发抽风
 * （实测同一探针上一秒 PASS、下一秒抛 `reading 'workspace'`，g.atoms undefined），
 * 单次导入直接把整轮打成 FATAL。页内重试 + 页外重试双层兑底。
 */
const VG_PREAMBLE = `
const __vimp = async (url, required) => {
    let lastErr = null;
    for (let i = 0; i < 12; i++) {
        try {
            const m = await import(url);
            if (required.every((k) => m && m[k] != null)) return m;
            lastErr = new Error(url + " exports missing: " + required.join(","));
        } catch (err) {
            lastErr = err;
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw lastErr;
};
const __vg = () => __vimp("/frontend/app/store/global.ts", ["atoms", "globalStore", "WOS"]);`

/** 面板全量快照：组头（含状态）、过滤器按钮、汇总行、workspace.tabids、每个 Tab 的 blockids。 */
function panelProbe(blockId) {
    return `(async () => {
        ${VG_PREAMBLE}
        const g = await __vg();
        const ws = g.globalStore.get(g.atoms.workspace);
        const tabIds = (ws && ws.tabids) ? ws.tabids.slice() : [];
        const blk = document.querySelector('[data-blockid="' + ${JSON.stringify(blockId)} + '"]');
        if (blk == null) return { found: false, tabIds };
        const groups = [...blk.querySelectorAll("[data-overview-tab-group]")].map((el) => ({
            tabId: el.getAttribute("data-overview-tab-group"),
            status: el.getAttribute("data-overview-tab-status"),
            classes: String(el.className || ""),
            badgeCount: (el.querySelector(".session-overview-tab-title strong")?.textContent || "").trim(),
            expanded: el.querySelector(".session-overview-tab-toggle")?.getAttribute("aria-expanded") ?? null,
            muted: [...el.querySelectorAll(".session-overview-muted")].map((m) => (m.textContent || "").replace(/\\s+/g, " ").trim()),
            skeleton: el.querySelector(".session-overview-tab-skeleton") != null,
        }));
        const filterButtons = [...blk.querySelectorAll(".session-overview-filter-group button")].map((b) => ({
            icons: [...b.querySelectorAll("i")].map((i) => String(i.className || "")),
            pressed: b.getAttribute("aria-pressed"),
            text: (b.textContent || "").replace(/\\s+/g, " ").trim(),
        }));
        const summaryEl = blk.querySelector("[data-overview-tab-summary]");
        const viewModes = [...blk.querySelectorAll("[data-overview-view]")].map((b) => ({
            mode: b.getAttribute("data-overview-view"),
            pressed: b.getAttribute("aria-pressed"),
        }));
        const tabInfo = {};
        for (const tabId of tabIds) {
            let tab = null;
            try {
                tab = g.WOS.getObjectValue("tab:" + tabId);
            } catch (err) {
                tab = null;
            }
            tabInfo[tabId] = tab == null ? null : { name: tab.name ?? "", blockids: (tab.blockids ?? []).slice() };
        }
        return {
            found: true,
            tabIds,
            groups,
            filterButtons,
            summary: summaryEl ? (summaryEl.textContent || "").replace(/\\s+/g, " ").trim() : null,
            viewModes,
            tabInfo,
        };
    })()`;
}

/** 点过滤器按钮（按图标类找，避免依赖 locale 文案）：`fa-robot` = 🤖 agentsOnly、`fa-eye-slash` = 👁。 */
function clickFilterProbe(blockId, iconClass) {
    return `(() => {
        const blk = document.querySelector('[data-blockid="' + ${JSON.stringify(blockId)} + '"]');
        if (blk == null) return { ok: false, reason: "no-block" };
        const buttons = [...blk.querySelectorAll(".session-overview-filter-group button")];
        const btn = buttons.find((b) => [...b.querySelectorAll("i")].some((i) => String(i.className || "").includes(${JSON.stringify(iconClass)})));
        if (btn == null) {
            return { ok: false, reason: "no-button", icons: buttons.map((b) => [...b.querySelectorAll("i")].map((i) => String(i.className || ""))) };
        }
        const before = btn.getAttribute("aria-pressed");
        btn.click();
        return { ok: true, before };
    })()`;
}

/** 点某个组的折叠 toggle（组头常驻后，empty 组默认折叠，要展开才看得到 noBlocks 行）。 */
function clickGroupToggleProbe(blockId, tabId) {
    return `(() => {
        const blk = document.querySelector('[data-blockid="' + ${JSON.stringify(blockId)} + '"]');
        if (blk == null) return { ok: false, reason: "no-block" };
        const group = blk.querySelector('[data-overview-tab-group="' + ${JSON.stringify(tabId)} + '"]');
        if (group == null) return { ok: false, reason: "no-group" };
        const toggle = group.querySelector(".session-overview-tab-toggle");
        if (toggle == null) return { ok: false, reason: "no-toggle" };
        toggle.click();
        return { ok: true, before: toggle.getAttribute("aria-expanded") };
    })()`;
}

/** 首屏计时探针：面板是否挂上、组头数、tabids 数、服务调用计数（Network 打不了就靠 fetch 计数）。 */
function firstPaintProbe(blockId) {
    return `(async () => {
        const counts = window.__verifyOverviewSvcCounts ?? null;
        const blk = document.querySelector('[data-blockid="' + ${JSON.stringify(blockId)} + '"]');
        if (blk == null) return { found: false, counts };
        let tabIds = [];
        try {
            ${VG_PREAMBLE}
            const g = await __vg();
            const ws = g.globalStore.get(g.atoms.workspace);
            tabIds = (ws && ws.tabids) ? ws.tabids.slice() : [];
        } catch (err) {
            tabIds = [];
        }
        return {
            found: true,
            counts,
            groups: blk.querySelectorAll("[data-overview-tab-group]").length,
            tabIds: tabIds.length,
            statuses: [...blk.querySelectorAll("[data-overview-tab-group]")].map((el) =>
                el.getAttribute("data-overview-tab-status")
            ),
            summary: blk.querySelector("[data-overview-tab-summary]") != null,
        };
    })()`;
}

/**
 * 首屏 fetch 计数器。用 `Page.addScriptToEvaluateOnNewDocument` 注入 —— 它在
 * document 创建时跑，早于 app 任何模块，reload 后仍然生效（页面内 patch 会被 reload 抹掉）。
 *
 * 计数口径：URL 里的 usp 是 `service=object&method=GetObject`；`GetObjects` 是批量接口。
 * 旧路径 ~190 次单件 GetObject（首帧全 null），新路径是 1 次 GetObjects(tab) + 1 次 GetObjects(block)。
 */
const FIRSTPAINT_COUNTER_SRC = `(() => {
    const counts = { GetObject: 0, GetObjects: 0, all: 0 };
    window.__verifyOverviewSvcCounts = counts;
    const orig = window.fetch;
    window.fetch = function (input, init) {
        try {
            const url = String(typeof input === "string" ? input : (input && input.url) || "");
            if (url.includes("/wave/service")) {
                counts.all += 1;
                if (/[?&]method=GetObjects\\b/.test(url)) counts.GetObjects += 1;
                else if (/[?&]method=GetObject\\b/.test(url)) counts.GetObject += 1;
            }
        } catch (err) {
            /* 计数失败不能影响真实请求 */
        }
        return orig.apply(this, arguments);
    };
})();`;

// ── 页面内动作 ──────────────────────────────────────────────────────────────

/** 清 localStorage 里的相关偏好：viewMode 回 list、两个过滤器回关。 */
const cleanseStorageProbe = `(() => {
    const keys = [
        "snorkeling.overview.viewMode",
        "snorkeling.overview.boardGroup",
        "snorkeling.overview.timelineRange",
        "snorkeling:session-overview:agents-only",
        "snorkeling:session-overview:hide-unopened-tabs",
    ];
    const removed = [];
    for (const key of keys) {
        if (localStorage.getItem(key) != null) {
            localStorage.removeItem(key);
            removed.push(key);
        }
    }
    return removed;
})()`;

/** 在当前 Tab 建一个 Overview 块（meta 照抄 SnorkelingBlockKindOverview 的写入点）。 */
const createOverviewBlockProbe = `(async () => {
    try {
        ${VG_PREAMBLE}
        const mod = await __vg();
        const blockId = await mod.createBlock(
            {
                meta: {
                    view: "sessionoverview",
                    "snorkeling:block-kind": "overview",
                    "frame:title": "Overview",
                    icon: "list-tree",
                },
            },
            false,
            false
        );
        return { ok: true, blockId };
    } catch (err) {
        return { ok: false, err: String(err && err.message ? err.message : err) };
    }
})()`;

/**
 * 播种：造 6 个 Tab（1 空 / 1 只含 Overview 块 / 4 live-term（其一带 agent meta）/ 1 agent），
 * 全部 activateTab=false —— 不切激活 Tab，否则 Overview 面板所在的 renderer 会被换掉。
 */
const seedTabsProbe = `(async () => {
    const out = { ok: false, err: "", workspaceId: "", tabs: [] };
    try {
        ${VG_PREAMBLE}
        const g = await __vg();
        const services = await __vimp("/frontend/app/store/services.ts", ["WorkspaceService", "ObjectService"]);
        const ws = g.globalStore.get(g.atoms.workspace);
        if (ws == null || !ws.oid) throw new Error("workspace 未就绪");
        out.workspaceId = ws.oid;
        const rtOpts = { termsize: { rows: 25, cols: 80 } };
        const nameBase = "verify-ux-" + Date.now().toString(36);
        const mkTab = async (suffix) =>
            services.WorkspaceService.CreateEmptyTab(out.workspaceId, nameBase + "-" + suffix, false);
        const mkBlock = async (tabId, meta) =>
            services.ObjectService.CreateBlockInTab(tabId, { meta }, rtOpts, false, false);

        // (a) 彻底空的 Tab：blockids 为空 → status=empty
        const emptyTab = await mkTab("empty");
        out.tabs.push({ tabId: emptyTab, kind: "empty-no-blocks" });

        // (b) 只含 Overview 块的 Tab：blockids 只有 sessionoverview → status=empty（历史缺陷 1）
        const ovTab = await mkTab("ovonly");
        const ovBlock = await mkBlock(ovTab, {
            view: "sessionoverview",
            "snorkeling:block-kind": "overview",
            "frame:title": "Overview",
            icon: "list-tree",
        });
        out.tabs.push({ tabId: ovTab, kind: "overview-only", blockId: ovBlock });

        // (c) live-term Tab：非 agent 块（agentsOnly 下会被滤成 0 行，但不是 0 组）
        for (let i = 0; i < ${LIVE_TAB_COUNT}; i++) {
            const tabId = await mkTab("live" + i);
            const blockId = await mkBlock(tabId, { view: "term" });
            out.tabs.push({ tabId, kind: "live-term", blockId });
        }

        // (d) 带 agent meta 的 Tab：agentsOnly 有内容可留
        const agentTab = await mkTab("agent");
        const agentBlock = await mkBlock(agentTab, {
            view: "term",
            "agent:provider": "claude",
            "agent:sessionid": "verify-overview-ux-session",
            "cmd:cwd": "/tmp/verify-overview-ux",
        });
        out.tabs.push({ tabId: agentTab, kind: "agent", blockId: agentBlock });

        out.ok = true;
    } catch (err) {
        out.err = String(err && err.message ? err.message : err);
    }
    return out;
})()`;

/** 收尾：删播种的 Tab（best-effort，失败不影响 verdict）。 */
function cleanupProbe() {
    return `(async () => {
        const out = { closed: 0, err: "" };
        try {
            ${VG_PREAMBLE}
            const g = await __vg();
            const services = await __vimp("/frontend/app/store/services.ts", ["WorkspaceService"]);
            const ws = g.globalStore.get(g.atoms.workspace);
            const workspaceId = ws && ws.oid ? ws.oid : "";
            for (const tabId of ${JSON.stringify(createdTabIds)}) {
                if (!workspaceId) break;
                try {
                    await services.WorkspaceService.CloseTab(workspaceId, tabId, false);
                    out.closed += 1;
                } catch (err) {
                    out.err = out.err || String(err && err.message ? err.message : err);
                }
            }
        } catch (err) {
            out.err = String(err && err.message ? err.message : err);
        }
        return out;
    })()`;
}

// ── 引导弹窗（中文 locale 的按钮文案共享 dismissOnboarding 盖不住）────────────

const zhOnboardingButtonProbe = `(() => {
    const wanted = ["继续", "下一步", "开始使用", "跳过", "知道了", "开始", "完成", "好"];
    const els = [...document.querySelectorAll(".modal-backdrop button, .modal-backdrop [role=button], .modal button")];
    for (const el of els) {
        const t = (el.textContent || "").replace(/[\\u200b-\\u200f\\ufeff]/g, "").trim();
        if (!wanted.includes(t)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 5 || r.height < 5) continue;
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), t };
    }
    return null;
})()`;

async function dismissOnboardingZh(c) {
    for (let i = 0; i < 12; i++) {
        const btn = await c.evaluate(zhOnboardingButtonProbe).catch(() => null);
        if (btn == null) return;
        await c.click(btn.x, btn.y);
        log(`dismissed zh onboarding: ${btn.t}`);
        await sleep(700);
    }
}

// ── 主流程 ─────────────────────────────────────────────────────────────────

async function main() {
    if (dry) {
        const syntax = await import("node:child_process").then(
            ({ execFileSync }) =>
                new Promise((resolve) => {
                    try {
                        execFileSync(process.execPath, ["--check", path.join(here, "verify.mjs")], {
                            stdio: "pipe",
                            timeout: 30000,
                        });
                        resolve(0);
                    } catch (err) {
                        resolve(err.status ?? 1);
                    }
                })
        );
        check("dry-deps-resolve", syntax === 0, `node --check verify.mjs exit=${syntax}；lib 依赖 = cdp/launch/report/probes`);
        reporter.finish({ skipped, cleanup: null, ledger: false });
        return;
    }

    // ── 起实例 ──────────────────────────────────────────────────────────────
    instance = await ensureInstance({
        attach,
        cdpPort: CDP_PORT,
        vitePort: VITE_PORT,
        profile: PROFILE,
        resetProfile: !attach,
    }).catch((err) => {
        // attach 模式下实例可能正处于 reload / 只有 0 宽空壳页，ensureInstance 的 ready 检查会
        // 直接失败（实测踩过）；这种失败不是环境错误，后面 pickRenderer 会重试挑真工作区。
        if (!attach) throw err;
        log(`ensureInstance(attach) 未拿到 ready client（继续自己挑）：${String(err?.message ?? err).slice(0, 120)}`);
        return null;
    });
    const pickedRenderer = await pickRenderer();
    client = pickedRenderer.client;
    if (instance?.client != null && instance.client !== client) {
        instance.client.close?.();
    }
    await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    log(`instance ready (${attach ? "attach" : "launch"}) → ${client.targetUrl}`);

    await dismissOnboarding(client, { log });
    await dismissOnboardingZh(client);
    const appReady = await waitFor(
        client,
        `(() => document.querySelectorAll(".block").length)()`,
        (n) => n > 0,
        60000
    );
    if (!(appReady > 0)) throw new Error("实例里没有任何 .block（工作区没起来）");

    // 干净起点：两个过滤器回关、视图回 list，再 reload 让 atom 重新读 storage。
    const removedKeys = await client.evaluate(cleanseStorageProbe).catch(() => []);
    if (removedKeys.length > 0) log(`cleansed localStorage: ${removedKeys.join(", ")}`);
    await client.reload();
    await sleep(1200);
    await dismissOnboarding(client, { log }).catch(() => null);
    await dismissOnboardingZh(client);
    await waitFor(client, `(() => document.querySelectorAll(".block").length)()`, (n) => n > 0, 90000);
    await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});

    // ── 建 Overview 块（当前 Tab）──────────────────────────────────────────
    const overviewCreated = await evalRetry(createOverviewBlockProbe);
    if (overviewCreated?.ok !== true) throw new Error(`建 Overview 块失败: ${JSON.stringify(overviewCreated)}`);
    overviewBlockId = overviewCreated.blockId;
    const scope = `[data-blockid="${overviewBlockId}"]`;
    log(`overview block: ${overviewBlockId}`);
    const panelMounted = await waitFor(
        client,
        panelProbe(overviewBlockId),
        (st) => st?.found === true,
        45000,
        500
    );
    if (panelMounted?.found !== true) throw new Error("Overview 面板没挂上（找不到 data-blockid 容器）");

    // ── 播种 Tab ────────────────────────────────────────────────────────────
    const baseline = await evalRetry(panelProbe(overviewBlockId));
    const initialTabCount = baseline?.tabIds?.length ?? 0;
    log(`baseline tabids=${initialTabCount}`);

    const seeded = await client.evaluate(seedTabsProbe);
    if (seeded?.ok !== true) throw new Error(`播种 Tab 失败: ${seeded?.err}`);
    workspaceId = seeded.workspaceId;
    for (const tab of seeded.tabs) createdTabIds.push(tab.tabId);
    emptyTabId = seeded.tabs.find((tab) => tab.kind === "empty-no-blocks")?.tabId ?? "";
    overviewOnlyTabId = seeded.tabs.find((tab) => tab.kind === "overview-only")?.tabId ?? "";
    const expectedTabs = initialTabCount + seeded.tabs.length;
    log(`seeded ${seeded.tabs.length} tabs → expected tabids=${expectedTabs}`);

    // 等 workspace.tabids 在本 renderer 上补齐（WPS 广播），再等 prime 把每个 Tab 解析完
    const settled = await waitFor(
        client,
        panelProbe(overviewBlockId),
        (st) => (st?.tabIds?.length ?? 0) >= expectedTabs,
        30000,
        400
    );
    check(
        "workspace-tabids-seeded",
        (settled?.tabIds?.length ?? 0) === expectedTabs,
        { tabIds: settled?.tabIds?.length, expected: expectedTabs }
    );

    const resolved = await waitFor(
        client,
        panelProbe(overviewBlockId),
        (st) =>
            st?.found === true &&
            st.groups.length >= expectedTabs &&
            st.groups.every((group) => group.status !== "loading"),
        20000,
        300
    );
    check(
        "prime-all-tabs-resolved",
        resolved?.groups?.length === expectedTabs && resolved.groups.every((g) => g.status !== "loading"),
        {
            groups: resolved?.groups?.length,
            statuses: resolved?.groups?.map((g) => g.status),
            note: "两阶段 prime（GetObjects）后不应有组停在 loading 骨架",
        }
    );

    let st = resolved ?? (await evalRetry(panelProbe(overviewBlockId)));
    const listPressed = (st?.viewModes ?? []).find((m) => m.mode === "list")?.pressed;
    const hidePressedBefore = (st?.filterButtons ?? []).find((b) => b.icons.some((c) => c.includes("fa-eye-slash")))?.pressed;
    const agentsPressedBefore = (st?.filterButtons ?? []).find((b) => b.icons.some((c) => c.includes("fa-robot")))?.pressed;

    // ── 断言 1：组头数 == tabids 数（👁 关）──────────────────────────────────
    check(
        "tab-group-count-matches-tabids",
        st?.groups?.length === st?.tabIds?.length &&
            st.groups.length === expectedTabs &&
            hidePressedBefore === "false" &&
            listPressed === "true",
        {
            groups: st?.groups?.length,
            tabids: st?.tabIds?.length,
            expected: expectedTabs,
            hideUnopenedPressed: hidePressedBefore,
            viewModeListPressed: listPressed,
            statuses: st?.groups?.map((g) => g.status),
            note: `组头 = ${st?.groups?.length} / tabids = ${st?.tabIds?.length}（👁 关、list 视图）`,
        }
    );
    await shot(client, "01-all-tab-groups");

    // ── 断言 2：agentsOnly 开关前后组头数不变 ───────────────────────────────
    const groupsBeforeAgents = st?.groups?.length ?? 0;
    const clickedAgents = await client.evaluate(clickFilterProbe(overviewBlockId, "fa-robot"));
    const agentsOn = await waitFor(
        client,
        panelProbe(overviewBlockId),
        (snapshot) =>
            (snapshot?.filterButtons ?? []).find((b) => b.icons.some((c) => c.includes("fa-robot")))?.pressed === "true",
        8000,
        250
    );
    const agentsPressedAfter = (agentsOn?.filterButtons ?? []).find((b) => b.icons.some((c) => c.includes("fa-robot")))?.pressed;
    check(
        "agents-only-keeps-groups",
        clickedAgents?.ok === true &&
            agentsPressedBefore === "false" &&
            agentsPressedAfter === "true" &&
            agentsOn?.groups?.length === groupsBeforeAgents,
        {
            clicked: clickedAgents,
            pressedBefore: agentsPressedBefore,
            pressedAfter: agentsPressedAfter,
            groupsBefore: groupsBeforeAgents,
            groupsAfter: agentsOn?.groups?.length,
            statusesAfter: agentsOn?.groups?.map((g) => g.status),
            note: "agentsOnly 只过滤组内行；组头数必须一字不变（历史缺陷 3）",
        }
    );
    await shot(client, "02-agents-only-on");

    // 关回 agentsOnly（后续断言用默认态）
    await client.evaluate(clickFilterProbe(overviewBlockId, "fa-robot"));
    await waitFor(
        client,
        panelProbe(overviewBlockId),
        (snapshot) =>
            (snapshot?.filterButtons ?? []).find((b) => b.icons.some((c) => c.includes("fa-robot")))?.pressed === "false",
        8000,
        250
    );

    // ── 对照组：live 组的 toggle 必须真的能折/展 ──────────────────────────────
    // 目的：证伪「断言 3 的 FAIL 是台子的点击没吃到事件」这个借口——同一条点击链路，
    // 在 live 组上必须能把 aria-expanded 从 true 翻到 false 再翻回 true。
    const liveGroupBefore = ((await evalRetry(panelProbe(overviewBlockId)))?.groups ?? []).find(
        (g) => g.status === "live"
    );
    const liveTabId = liveGroupBefore?.tabId ?? "";
    const liveToggle1 = await client.evaluate(clickGroupToggleProbe(overviewBlockId, liveTabId));
    await sleep(500);
    const liveAfter1 = ((await evalRetry(panelProbe(overviewBlockId)))?.groups ?? []).find((g) => g.tabId === liveTabId);
    const liveToggle2 = await client.evaluate(clickGroupToggleProbe(overviewBlockId, liveTabId));
    await sleep(500);
    const liveAfter2 = ((await evalRetry(panelProbe(overviewBlockId)))?.groups ?? []).find((g) => g.tabId === liveTabId);
    check(
        "live-group-toggle-works",
        liveGroupBefore?.expanded === "true" &&
            liveAfter1?.expanded === "false" &&
            liveAfter2?.expanded === "true",
        {
            liveTabId,
            expandedBefore: liveGroupBefore?.expanded,
            toggle1: liveToggle1,
            expandedAfter1: liveAfter1?.expanded,
            toggle2: liveToggle2,
            expandedAfter2: liveAfter2?.expanded,
            note: "对照组：同一条点击链路对 live 组有效 → 断言 3 若 FAIL 就不是「点击没吃到事件」",
        }
    );

    // ── 断言 3：只含 Overview 块的 Tab → 组存在 + status=empty + noBlocks ────
    st = await evalRetry(panelProbe(overviewBlockId));
    const emptyGroup = (st?.groups ?? []).find((g) => g.tabId === overviewOnlyTabId);
    const emptyTabBlocks = st?.tabInfo?.[overviewOnlyTabId]?.blockids ?? null;
    // 先证前置：该 Tab 的 blockids 只有一个块，且就是 Overview 块（meta view=sessionoverview）
    const emptyTabIsOverviewOnly = await evalRetry(`(async () => {
        ${VG_PREAMBLE}
        const g = await __vg();
        const tab = g.WOS.getObjectValue("tab:" + ${JSON.stringify(overviewOnlyTabId)});
        if (tab == null) return { ok: false, reason: "tab 未解析" };
        const blockids = (tab.blockids ?? []).slice();
        if (blockids.length !== 1) return { ok: false, blockids };
        const block = g.WOS.getObjectValue("block:" + blockids[0]);
        return { ok: block?.meta?.view === "sessionoverview", blockids, view: block?.meta?.view ?? null };
    })()`);
    // empty 组默认折叠 → 点一下 toggle 展开，再看 noBlocks 行是否真的渲染出来
    const expandAttempt = await client.evaluate(clickGroupToggleProbe(overviewBlockId, overviewOnlyTabId));
    await sleep(600);
    const afterExpand = await evalRetry(panelProbe(overviewBlockId));
    // 再点一次：如果连点两下都不变，可以确定不是「第一次点没吃到事件」，而是折叠态推导本身卡住了
    const expandAttempt2 = await client.evaluate(clickGroupToggleProbe(overviewBlockId, overviewOnlyTabId));
    await sleep(600);
    const afterExpand2 = await evalRetry(panelProbe(overviewBlockId));
    const emptyGroupAfter = (afterExpand?.groups ?? []).find((g) => g.tabId === overviewOnlyTabId);
    const emptyGroupAfter2 = (afterExpand2?.groups ?? []).find((g) => g.tabId === overviewOnlyTabId);
    const groupExistsAsEmpty = emptyTabIsOverviewOnly?.ok === true && emptyGroup?.status === "empty";
    // noBlocks 行：empty 组默认折叠，展开（或本来就展开）后必须能看到 muted 行。
    // 若展开不了（toggle 只能写 true、写完还是默认折叠），这里会如实 FAIL —— 那正是要抓的产品缺陷。
    const mutedVisible =
        (emptyGroup?.muted ?? []).length > 0 ||
        (emptyGroupAfter?.muted ?? []).length > 0 ||
        (emptyGroupAfter2?.muted ?? []).length > 0;
    check(
        "empty-tab-group-shows-no-blocks",
        groupExistsAsEmpty && mutedVisible,
        {
            overviewOnlyTabId,
            tabBlockids: emptyTabBlocks,
            overviewOnlyProof: emptyTabIsOverviewOnly,
            groupStatus: emptyGroup?.status,
            groupExpandedBefore: emptyGroup?.expanded,
            expandAttempt,
            groupExpandedAfter: emptyGroupAfter?.expanded,
            expandAttempt2,
            groupExpandedAfter2: emptyGroupAfter2?.expanded,
            mutedAfterExpand: emptyGroupAfter?.muted,
            mutedAfterExpand2: emptyGroupAfter2?.muted,
            note: "只含 Overview 块的 Tab 必须常驻（历史缺陷 1）；noBlocks 行要能真的看到（empty 组默认折叠，click 应能展开）",
        }
    );
    await shot(client, "03-overview-only-empty-group");

    // ── 断言 4：👁 只删 unopened 组（empty 免疫）────────────────────────────
    st = await evalRetry(panelProbe(overviewBlockId));
    const statusesBeforeHide = (st?.groups ?? []).map((g) => g.status);
    const expectedAfterHide = (st?.groups ?? []).filter((g) => g.status !== "unopened").length;
    const clickedHide = await client.evaluate(clickFilterProbe(overviewBlockId, "fa-eye-slash"));
    const hiddenState = await waitFor(
        client,
        panelProbe(overviewBlockId),
        (snapshot) =>
            (snapshot?.filterButtons ?? []).find((b) => b.icons.some((c) => c.includes("fa-eye-slash")))?.pressed === "true",
        8000,
        250
    );
    const groupsAfterHide = hiddenState?.groups ?? [];
    check(
        "hide-unopened-only-deletes-unopened",
        clickedHide?.ok === true &&
            groupsAfterHide.length === expectedAfterHide &&
            groupsAfterHide.every((g) => g.status !== "unopened") &&
            groupsAfterHide.some((g) => g.status === "empty") &&
            statusesBeforeHide.includes("unopened"),
        {
            statusesBefore: statusesBeforeHide,
            expectedAfter: expectedAfterHide,
            groupsAfter: groupsAfterHide.length,
            statusesAfter: groupsAfterHide.map((g) => g.status),
            note: "👁 是唯一有删组权力的过滤器，且只删 unopened（empty/live 免疫）",
        }
    );
    // 关回 👁（断言 5/6 用默认态）
    await client.evaluate(clickFilterProbe(overviewBlockId, "fa-eye-slash"));
    await waitFor(
        client,
        panelProbe(overviewBlockId),
        (snapshot) =>
            (snapshot?.filterButtons ?? []).find((b) => b.icons.some((c) => c.includes("fa-eye-slash")))?.pressed === "false",
        8000,
        250
    );

    // ── 断言 5：汇总行 N/M 自洽 ────────────────────────────────────────────
    st = await evalRetry(panelProbe(overviewBlockId));
    const summaryText = st?.summary ?? "";
    const summaryNumbers = (summaryText.match(/\d+/g) ?? []).map(Number);
    check(
        "tab-summary-consistent",
        summaryText !== "" &&
            summaryNumbers.length >= 2 &&
            summaryNumbers[0] === st?.tabIds?.length &&
            summaryNumbers[1] === st?.groups?.length,
        {
            summary: summaryText,
            numbers: summaryNumbers,
            tabids: st?.tabIds?.length,
            groups: st?.groups?.length,
            note: "文案前两个数字必须是 (tabids 数, 渲染组数)，与 DOM 实际计数一致",
        }
    );

    // ── 断言 6/7：刷新后的首屏（1.2s 组头齐 + 批量 prime 服务调用 ≤ 3）──────
    // 先打「旧 document」标记：Page.reload 是异步下发，不等它真的换文档就去轮询，
    // 量到的会是**旧页面**（实测：elapsed=0 + counts=null 假绿/假红一场）。
    await client.evaluate(`(() => { window.__verifyPreReloadEpoch = Date.now(); return true; })()`);
    await client.send("Page.enable").catch(() => null);
    const injected = await client.send("Page.addScriptToEvaluateOnNewDocument", {
        source: FIRSTPAINT_COUNTER_SRC,
    });
    const injectedId = injected?.identifier ?? null;
    log(`firstpaint counter injected (${injectedId ?? "no-id"})`);
    try {
        client.send("Page.reload", { ignoreCache: false }).catch(() => {});
        // 等文档真的换了：旧标记消失，或因上下文销毁而 evaluate 抛错。
        const navDeadline = Date.now() + 60000;
        let navigated = false;
        let navSnap = null;
        while (Date.now() < navDeadline) {
            let snap;
            try {
                snap = await client.evaluate(
                    `(() => ({ epoch: window.__verifyPreReloadEpoch ?? null, counts: window.__verifyOverviewSvcCounts ?? null, ready: document.readyState }))()`
                );
            } catch (err) {
                navigated = true;
                break;
            }
            navSnap = snap;
            if (snap == null || snap.epoch == null) {
                navigated = true;
                break;
            }
            await sleep(80);
        }
        log(`reload navigated=${navigated} navSnap=${JSON.stringify(navSnap)}`);

        // 高频率轮询：面板一挂上就开始计时（anchor），再看组头补齐要多久
        let anchorAt = null;
        let settledAt = null;
        let firstSnap = null;
        let lastSnap = null;
        const deadline = Date.now() + 120000;
        while (Date.now() < deadline) {
            const snap = await client.evaluate(firstPaintProbe(overviewBlockId)).catch(() => null);
            if (snap?.found === true && snap.counts != null) {
                lastSnap = snap;
                if (anchorAt == null) {
                    anchorAt = Date.now();
                    firstSnap = snap;
                }
                if (snap.groups === expectedTabs && snap.tabIds === expectedTabs) {
                    settledAt = Date.now();
                    break;
                }
            }
            await sleep(100);
        }
        const elapsedMs = anchorAt != null && settledAt != null ? settledAt - anchorAt : null;
        const settledSnap = settledAt != null ? lastSnap : null;
        check(
            "firstpaint-groups-fast",
            navigated === true && elapsedMs != null && elapsedMs <= FIRSTPAINT_WINDOW_MS,
            {
                navigated,
                elapsedMs,
                window: FIRSTPAINT_WINDOW_MS,
                expectedTabs,
                firstSnap: firstSnap == null ? null : { groups: firstSnap.groups, tabIds: firstSnap.tabIds },
                settledSnap: settledSnap == null ? null : { groups: settledSnap.groups, tabIds: settledSnap.tabIds },
                note: "面板挂上后 1.2s 内组头数必须等于 tabids 数（tab-first 首帧不缺席，等不到骨架也不算过）",
            }
        );

        // 首屏服务调用计数：GetObjects 是批量 prime（1 tab 批 + 1 block 批，>400 才分批）
        const counts = settledSnap?.counts ?? lastSnap?.counts ?? null;
        check(
            "firstpaint-getobjects-le3",
            counts != null &&
                counts.GetObjects >= 1 &&
                counts.GetObjects <= MAX_FIRSTPAINT_GETOBJECTS,
            {
                counts,
                navigated,
                max: MAX_FIRSTPAINT_GETOBJECTS,
                note: "旧路径是 ~190 次单件 GetObject（首帧全 null → 组被删）；新路径批量 GetObjects",
            }
        );
        // 刷新后重新等页面稳定再截图（reload 中 captureScreenshot 会超时）
        await waitFor(client, panelProbe(overviewBlockId), (snapshot) => snapshot?.found === true, 60000, 500);
        await shot(client, "04-after-reload");
    } finally {
        if (injectedId != null) {
            await client
                .send("Page.removeScriptToEvaluateOnNewDocument", { identifier: injectedId })
                .catch(() => null);
        }
    }

    // ── 断言 14/15：Overview「＋ 新建 Tab」（F-1122-overview-new-tab）────────────
    // 14 工具栏入口 → 空 Tab：tabids +1、组头数 +1、当前激活 Tab 不变；
    // 15 组尾入口 → 空 Tab + Agent：新 Tab blockids = 1 且块 meta 含 agent:*；不抢焦点。
    // 弹窗用 ReactDOM.createPortal 挂到 #main，不在 block 容器里，所以动作探针查 document。
    function clickNewTabEntryProbe(entry) {
        return `(() => {
            const blk = document.querySelector('[data-blockid="' + ${JSON.stringify(overviewBlockId)} + '"]');
            if (blk == null) return { ok: false, reason: "no-block" };
            const btn = blk.querySelector('[data-overview-new-tab="' + ${JSON.stringify(entry)} + '"]');
            if (btn == null) return { ok: false, reason: "no-entry" };
            btn.click();
            return { ok: true };
        })()`;
    }

    /** 打开弹窗后：可选点一枚 kind radio，再点「创建」（Modal footer 里非 grey 的那个 ok 按钮）。 */
    function newTabCreateProbe(kind) {
        return `(() => {
            const modal = document.querySelector(".session-overview-new-tab-modal");
            if (modal == null) return { ok: false, reason: "no-modal" };
            if (${JSON.stringify(kind)} != null) {
                const radio = modal.querySelector('[data-new-tab-kind="' + ${JSON.stringify(kind)} + '"]');
                if (radio == null || radio.disabled) return { ok: false, reason: radio == null ? "no-radio" : "radio-disabled", kind: ${JSON.stringify(kind)} };
                radio.click();
            }
            const okBtn = [...modal.querySelectorAll(".modal-footer button")].find((b) => !String(b.className).includes("grey"));
            if (okBtn == null) return { ok: false, reason: "no-ok-btn" };
            okBtn.click();
            return { ok: true };
        })()`;
    }

    /**
     * 弹窗里的「空 Tab + Agent」radio 是否已可用。
     *
     * 为什么需要等：profile 列表是 `useDetectedAgentProfileOptions` 的**异步** FindCommand 探测
     * （use-agent-profile-options.ts）—— 弹窗刚挂上时探测还在飞，`defaultProfile == null` 于是 radio
     * disabled。这里点太快会拿到 `radio-disabled`，断言变成量「探测延迟」而不是量「组尾入口能不能建 agent Tab」。
     * 这不是放松断言：等不到仍会以 `radio-disabled` 失败，只是把**探测完成**当成前置条件。
     */
    const newTabAgentRadioProbe = `(() => {
        const modal = document.querySelector(".session-overview-new-tab-modal");
        if (modal == null) return { modal: false, radio: false, enabled: false };
        const radio = modal.querySelector('[data-new-tab-kind="agent"]');
        return {
            modal: true,
            radio: radio != null,
            enabled: radio != null && radio.disabled !== true,
            hint: (modal.querySelector(".session-overview-new-tab-hint")?.textContent || "").trim(),
        };
    })()`;

    function diffTabIds(before, after) {
        const beforeSet = new Set(before ?? []);
        return (after ?? []).filter((id) => !beforeSet.has(id));
    }

    const newTabStateProbe = `(async () => {
        ${VG_PREAMBLE}
        const g = await __vg();
        const ws = g.globalStore.get(g.atoms.workspace);
        const activeTabId = g.globalStore.get(g.atoms.staticTabId) ?? null;
        const blk = document.querySelector('[data-blockid="' + ${JSON.stringify(overviewBlockId)} + '"]');
        const groups = blk ? [...blk.querySelectorAll("[data-overview-tab-group]")].map((el) => el.getAttribute("data-overview-tab-group")) : [];
        return { tabIds: (ws && ws.tabids ? ws.tabids.slice() : []), activeTabId, groups };
    })()`;

    function newTabBlockProbe(tabId) {
        return `(async () => {
            ${VG_PREAMBLE}
            const g = await __vg();
            const tab = g.WOS.getObjectValue("tab:" + ${JSON.stringify(tabId)});
            if (tab == null) return { ok: false, reason: "tab-not-resolved" };
            const blockids = (tab.blockids ?? []).slice();
            const block = blockids.length === 1 ? g.WOS.getObjectValue("block:" + blockids[0]) : null;
            const meta = block?.meta ?? null;
            const agentMetaKeys = meta == null ? [] : Object.keys(meta).filter((k) => k.startsWith("agent:"));
            return { ok: true, blockids, agentMetaKeys };
        })()`;
    }

    // 断言 14：工具栏入口 → 空 Tab
    const beforeToolbar = await evalRetry(newTabStateProbe);
    const clickedToolbar = await client.evaluate(clickNewTabEntryProbe("toolbar"));
    const toolbarModal = await waitFor(
        client,
        `(() => document.querySelector(".session-overview-new-tab-modal") != null)()`,
        (v) => v === true,
        8000,
        200
    );
    const toolbarCreate = toolbarModal === true ? await client.evaluate(newTabCreateProbe(null)) : { ok: false, reason: "modal-never-opened" };
    const newEmptyTabId = diffTabIds(beforeToolbar.tabIds, (await waitFor(
        client,
        newTabStateProbe,
        (st) => diffTabIds(beforeToolbar.tabIds, st.tabIds).length >= 1,
        30000,
        300
    )).tabIds)[0] ?? "";
    // 组行渲染比 tabids 多一拍：等组头也带出新 Tab（不直接拿一帧快照就断言）
    const afterToolbar = newEmptyTabId === "" ? await evalRetry(newTabStateProbe) : await waitFor(
        client,
        newTabStateProbe,
        (st) => st.groups.includes(newEmptyTabId) && st.tabIds.length === beforeToolbar.tabIds.length + 1,
        15000,
        250
    );
    check(
        "new-tab-toolbar-entry-creates-empty-tab",
        clickedToolbar.ok === true &&
            toolbarModal === true &&
            toolbarCreate.ok === true &&
            newEmptyTabId !== "" &&
            afterToolbar.tabIds.length === beforeToolbar.tabIds.length + 1 &&
            afterToolbar.groups.length === beforeToolbar.groups.length + 1 &&
            afterToolbar.groups.includes(newEmptyTabId) &&
            afterToolbar.activeTabId === beforeToolbar.activeTabId,
        {
            clicked: clickedToolbar,
            modalOpened: toolbarModal,
            created: toolbarCreate,
            newTabId: newEmptyTabId,
            tabIdsBefore: beforeToolbar.tabIds.length,
            tabIdsAfter: afterToolbar.tabIds.length,
            groupsBefore: beforeToolbar.groups.length,
            groupsAfter: afterToolbar.groups.length,
            activeTabBefore: beforeToolbar.activeTabId,
            activeTabAfter: afterToolbar.activeTabId,
            note: "工具栏入口建空 Tab：workspace.tabids +1、Overview 组头 +1、当前激活 Tab 不变（不抢焦点）",
        }
    );
    if (newEmptyTabId !== "") createdTabIds.push(newEmptyTabId);
    await shot(client, "05-new-tab-toolbar-empty");

    // 断言 15：组尾入口 → 空 Tab + Agent
    const beforeTail = await evalRetry(newTabStateProbe);
    const clickedTail = await client.evaluate(clickNewTabEntryProbe("tail"));
    const tailModal = await waitFor(
        client,
        `(() => document.querySelector(".session-overview-new-tab-modal") != null)()`,
        (v) => v === true,
        8000,
        200
    );
    // 等 FindCommand 探测完成（radio 从 disabled 变可用）；等不到仍会以 radio-disabled 失败。
    const tailRadioReady = tailModal === true
        ? await waitFor(client, newTabAgentRadioProbe, (st) => st?.modal === true && st.enabled === true, 15000, 200)
        : null;
    const tailCreate = tailModal === true ? await client.evaluate(newTabCreateProbe("agent")) : { ok: false, reason: "modal-never-opened" };
    const newAgentTabId = diffTabIds(beforeTail.tabIds, (await waitFor(
        client,
        newTabStateProbe,
        (st) => diffTabIds(beforeTail.tabIds, st.tabIds).length >= 1,
        30000,
        300
    )).tabIds)[0] ?? "";
    let newAgentBlock = { blockids: [], agentMetaKeys: [] };
    if (newAgentTabId !== "") {
        newAgentBlock = (await waitFor(client, newTabBlockProbe(newAgentTabId), (b) => b.ok === true && b.blockids.length === 1, 30000, 300)) ?? newAgentBlock;
    }
    const afterTail = newAgentTabId === "" ? await evalRetry(newTabStateProbe) : await waitFor(
        client,
        newTabStateProbe,
        (st) => st.groups.includes(newAgentTabId) && st.tabIds.length === beforeTail.tabIds.length + 1,
        15000,
        250
    );
    check(
        "new-tab-tail-entry-creates-agent-tab",
        clickedTail.ok === true &&
            tailModal === true &&
            tailCreate.ok === true &&
            newAgentTabId !== "" &&
            newAgentBlock.blockids.length === 1 &&
            newAgentBlock.agentMetaKeys.length > 0 &&
            afterTail.activeTabId === beforeTail.activeTabId &&
            afterTail.groups.includes(newAgentTabId),
        {
            clicked: clickedTail,
            modalOpened: tailModal,
            radioReadyAfterWait: tailRadioReady == null ? null : { enabled: tailRadioReady.enabled, hint: tailRadioReady.hint },
            created: tailCreate,
            newTabId: newAgentTabId,
            blockids: newAgentBlock.blockids.length,
            agentMetaKeys: newAgentBlock.agentMetaKeys,
            activeTabBefore: beforeTail.activeTabId,
            activeTabAfter: afterTail.activeTabId,
            note: "组尾入口 + 「空 Tab + Agent」：新 Tab blockids = 1 且块 meta 含 agent:*（默认 provider）+ 不抢焦点",
        }
    );
    if (newAgentTabId !== "") createdTabIds.push(newAgentTabId);
    await shot(client, "06-new-tab-tail-agent");

    // ── 断言 10-12：卡片展开 + composer 发送（F-1122-overview-card-send）─────────
    // 10 点 agent 行主体 → 展开体 + composer 出现且焦点在 textarea；Esc 收起
    // 11 勾「发送后等回复」发 CARD_OK → 徽章「收到回复」+ 卡片内出现 CARD_OK
    // 12 取消勾选再发 NOWAIT_SECOND → ≤3s 徽章「已提交/未确认提交」（非回复）；另一行仍可展开
    //
    // 稳定钩子（实现已落地，本台子只读；phase 不上 DOM，按徽章 tone + 新回复块判定）：
    //   行       .session-overview-block-row[data-overview-card-expandable="true"]（按组定位）
    //   展开体   [data-overview-card-send-body] / composer [data-overview-card-send-input|wait|submit]
    //   徽章     .session-overview-card-send-badge.is-{pending|ok|warn|danger}
    //   新回复   [data-overview-card-send-reply]（replied 才渲染 → 「收到回复」的唯一可判钩子）
    //
    // 可对话 agent 的来源：播种的 agent 行是假会话（发不出去，只用来验展开/聚焦）。
    // 真发送用台内自起 agent 块：AgentLaunchCommand（`agent launch` 的 in-app 双胞胎，走 agent catalog）
    // + ControllerResyncCommand（后台 Tab 的块不挂载 term view，控制器要显式起）。
    // 起不来（catalog 无模型 / agent 回不了话）= 环境问题 → 断言 11/12 记 skipped，不假装通过。

    function cardSendGroupProbe(tabId) {
        return `(() => {
            const blk = document.querySelector('[data-blockid="' + ${JSON.stringify(overviewBlockId)} + '"]');
            if (blk == null) return { found: false, reason: "no-block" };
            const group = blk.querySelector('[data-overview-tab-group="' + ${JSON.stringify(tabId)} + '"]');
            if (group == null) return { found: false, reason: "no-group" };
            const toggle = group.querySelector(".session-overview-tab-toggle");
            const row = group.querySelector('.session-overview-block-row[data-overview-card-expandable="true"]');
            const body = group.querySelector("[data-overview-card-send-body]");
            const input = group.querySelector("[data-overview-card-send-input]");
            const badge = group.querySelector(".session-overview-card-send-badge");
            const reply = group.querySelector("[data-overview-card-send-reply]");
            const alert = group.querySelector(".session-overview-card-send-alert");
            const submit = group.querySelector("[data-overview-card-send-submit]");
            const wait = group.querySelector("[data-overview-card-send-wait]");
            const active = document.activeElement;
            return {
                found: true,
                toggleExpanded: toggle == null ? null : toggle.getAttribute("aria-expanded"),
                rowExpandable: row != null,
                bodyBlockId: body == null ? null : body.getAttribute("data-overview-card-send-body"),
                hasInput: input != null,
                focusedIsInput: input != null && active === input,
                focusedTag: active == null ? null : String(active.tagName || ""),
                badgeClass: badge == null ? null : String(badge.className || ""),
                badgeText: badge == null ? "" : (badge.textContent || "").replace(/\\s+/g, " ").trim(),
                replyText: reply == null ? "" : (reply.textContent || "").replace(/\\s+/g, " ").trim(),
                replyTurn: reply == null ? null : reply.getAttribute("data-overview-card-send-reply"),
                alertText: alert == null ? "" : (alert.textContent || "").replace(/\\s+/g, " ").trim(),
                submitDisabled: submit == null ? null : submit.disabled === true,
                waitChecked: wait == null ? null : wait.checked === true,
            };
        })()`;
    }

    function clickCardRowProbe(tabId) {
        return `(() => {
            const blk = document.querySelector('[data-blockid="' + ${JSON.stringify(overviewBlockId)} + '"]');
            if (blk == null) return { ok: false, reason: "no-block" };
            const group = blk.querySelector('[data-overview-tab-group="' + ${JSON.stringify(tabId)} + '"]');
            if (group == null) return { ok: false, reason: "no-group" };
            const row = group.querySelector('.session-overview-block-row[data-overview-card-expandable="true"]');
            if (row == null) return { ok: false, reason: "no-expandable-row" };
            row.click();
            return { ok: true };
        })()`;
    }

    function setCardDraftProbe(tabId, text) {
        return `(() => {
            const blk = document.querySelector('[data-blockid="' + ${JSON.stringify(overviewBlockId)} + '"]');
            const group = blk == null ? null : blk.querySelector('[data-overview-tab-group="' + ${JSON.stringify(tabId)} + '"]');
            if (group == null) return { ok: false, reason: "no-group" };
            const input = group.querySelector("[data-overview-card-send-input]");
            if (input == null) return { ok: false, reason: "no-input" };
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
            setter.call(input, ${JSON.stringify(text)});
            input.dispatchEvent(new Event("input", { bubbles: true }));
            return { ok: true, value: input.value };
        })()`;
    }

    function clickCardSubmitProbe(tabId) {
        return `(() => {
            const blk = document.querySelector('[data-blockid="' + ${JSON.stringify(overviewBlockId)} + '"]');
            const group = blk == null ? null : blk.querySelector('[data-overview-tab-group="' + ${JSON.stringify(tabId)} + '"]');
            if (group == null) return { ok: false, reason: "no-group" };
            const btn = group.querySelector("[data-overview-card-send-submit]");
            if (btn == null) return { ok: false, reason: "no-submit" };
            if (btn.disabled) return { ok: false, reason: "disabled" };
            btn.click();
            return { ok: true };
        })()`;
    }

    function clickCardWaitProbe(tabId) {
        return `(() => {
            const blk = document.querySelector('[data-blockid="' + ${JSON.stringify(overviewBlockId)} + '"]');
            const group = blk == null ? null : blk.querySelector('[data-overview-tab-group="' + ${JSON.stringify(tabId)} + '"]');
            if (group == null) return { ok: false, reason: "no-group" };
            const cb = group.querySelector("[data-overview-card-send-wait]");
            if (cb == null) return { ok: false, reason: "no-wait-checkbox" };
            cb.click();
            return { ok: true, checked: cb.checked };
        })()`;
    }

    // 等回复超时的提示条里 [继续等] 在前、[取消] 在后；取消 = 清行程（不重发）。
    function clickCardCancelWaitProbe(tabId) {
        return `(() => {
            const blk = document.querySelector('[data-blockid="' + ${JSON.stringify(overviewBlockId)} + '"]');
            const group = blk == null ? null : blk.querySelector('[data-overview-tab-group="' + ${JSON.stringify(tabId)} + '"]');
            if (group == null) return { ok: false, reason: "no-group" };
            const alert = group.querySelector(".session-overview-card-send-alert.is-warn");
            if (alert == null) return { ok: false, reason: "no-warn-alert" };
            const buttons = [...alert.querySelectorAll(".session-overview-card-send-alert-button")];
            if (buttons.length === 0) return { ok: false, reason: "no-buttons" };
            buttons[buttons.length - 1].click();
            return { ok: true, buttons: buttons.length };
        })()`;
    }

    // 徽章 tone → phase（与 overview-card-send.ts 的 CardSendPhaseTone 一一对应）。
    function cardSendPhase(snapshot) {
        const cls = snapshot == null ? null : snapshot.badgeClass;
        if (typeof cls !== "string" || !cls.includes("session-overview-card-send-badge")) return null;
        if (cls.includes("is-pending")) return null;
        if (cls.includes("is-danger")) return "failed";
        if (cls.includes("is-warn")) return (snapshot.alertText ?? "") !== "" ? "timeout" : "unconfirmed";
        if (cls.includes("is-ok")) return (snapshot.replyText ?? "") !== "" ? "replied" : "submitted";
        return null;
    }

    // 写草稿 → 等「发送」按钮可用 → 点它（React 受控组件：原生 setter + input 事件）。
    async function cardSendSubmitOnce(tabId, text) {
        const set = await client.evaluate(setCardDraftProbe(tabId, text));
        if (set?.ok !== true) return { ok: false, stage: "set-draft", detail: set };
        const enabled = await waitFor(
            client,
            cardSendGroupProbe(tabId),
            (st) => st?.found === true && st.submitDisabled === false,
            5000,
            150
        );
        if (enabled?.submitDisabled !== false) return { ok: false, stage: "submit-disabled", detail: enabled };
        const clicked = await client.evaluate(clickCardSubmitProbe(tabId));
        if (clicked?.ok !== true) return { ok: false, stage: "submit", detail: clicked };
        return { ok: true, at: Date.now() };
    }

    // ── 断言 10：点 agent 行 → 展开体 + composer 聚焦；Esc 收起 ─────────────────
    // 目标行用播种的 agent 行（假 sessionid 也能展开，不发送）。该组是 unopened → 默认折叠，先展开组。
    const seededAgentTabId = seeded.tabs.find((tab) => tab.kind === "agent")?.tabId ?? "";
    const agentGroupToggle = await client.evaluate(clickGroupToggleProbe(overviewBlockId, seededAgentTabId));
    const agentGroupOpen = await waitFor(
        client,
        cardSendGroupProbe(seededAgentTabId),
        (st) => st?.found === true && st.toggleExpanded === "true",
        8000,
        250
    );
    const clickedAgentRow = await client.evaluate(clickCardRowProbe(seededAgentTabId));
    const agentRowExpanded = await waitFor(
        client,
        cardSendGroupProbe(seededAgentTabId),
        (st) => st?.found === true && st.bodyBlockId != null && st.focusedIsInput === true,
        8000,
        200
    );
    // Esc 收起：真实键盘事件（焦点已在 textarea）。偶尔窗口焦点丢了，重试一次（两次都是真键）。
    let escCollapsed = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        await client.activate();
        await client.pressKey("Escape");
        escCollapsed = await waitFor(
            client,
            cardSendGroupProbe(seededAgentTabId),
            (st) => st?.found === true && st.bodyBlockId == null,
            4000,
            150
        );
        if (escCollapsed?.found === true && escCollapsed.bodyBlockId == null) break;
    }
    check(
        "card-expand-focus",
        agentGroupToggle?.ok === true &&
            agentGroupOpen?.toggleExpanded === "true" &&
            clickedAgentRow?.ok === true &&
            agentRowExpanded?.bodyBlockId != null &&
            agentRowExpanded?.hasInput === true &&
            agentRowExpanded?.focusedIsInput === true &&
            agentRowExpanded?.focusedTag === "TEXTAREA" &&
            escCollapsed?.found === true &&
            escCollapsed?.bodyBlockId == null,
        {
            groupToggle: agentGroupToggle,
            groupExpanded: agentGroupOpen?.toggleExpanded,
            clickedRow: clickedAgentRow,
            bodyBlockId: agentRowExpanded?.bodyBlockId,
            hasInput: agentRowExpanded?.hasInput,
            focusedIsInput: agentRowExpanded?.focusedIsInput,
            focusedTag: agentRowExpanded?.focusedTag,
            bodyAfterEsc: escCollapsed?.bodyBlockId,
            note: "行主体点击 = 展开（面板级互斥）；展开即聚焦 composer textarea；Esc 只收起这张卡",
        }
    );
    await shot(client, "07-card-expand-focus");

    // ── 可对话 agent（真发送的前置，不计入断言）：台内自起 + 显式起 controller ──────────
    const spawnAgentProbe = `(async () => {
        const out = { ok: false, err: "", tabId: "", blockId: "", profile: "", model: "", catalog: [] };
        try {
            ${VG_PREAMBLE}
            const g = await __vg();
            const services = await __vimp("/frontend/app/store/services.ts", ["WorkspaceService"]);
            const wshclient = await import("/frontend/app/store/wshclientapi.ts");
            const wshrpcutil = await import("/frontend/app/store/wshrpcutil.ts");
            const catalogMod = await import("/frontend/app/workspace/agent-catalog.ts");
            const ws = g.globalStore.get(g.atoms.workspace);
            if (ws == null || !ws.oid) throw new Error("workspace 未就绪");
            const catalog = (await catalogMod.loadAgentCatalog(true).catch(() => [])) ?? [];
            out.catalog = catalog.map((p) => ({ name: p.name, models: (p.models ?? []).length }));
            // pi 优先（与 agent-roundtrip 台同一条 proven 链路），其次任一配了模型的 profile。
            const profile =
                catalog.find((p) => p.name === "pi" && (p.models ?? []).length > 0) ??
                catalog.find((p) => (p.models ?? []).length > 0) ??
                null;
            if (profile == null) {
                out.err = "agent catalog 里没有带模型的 profile（无可用 agent）";
                return out;
            }
            out.profile = profile.name;
            // 先建空 Tab（activateTab=false，不抢焦点）：AgentLaunchCommand 的 tab:"new" 会
            // 激活新 Tab，把 Overview 面板所在 renderer 换掉，所以 Tab 自己建、显式传 id。
            const tabId = await services.WorkspaceService.CreateEmptyTab(
                ws.oid,
                "verify-card-send-" + Date.now().toString(36),
                false
            );
            out.tabId = tabId;
            const launch = await wshclient.RpcApi.AgentLaunchCommand(wshrpcutil.TabRpcClient, {
                profile: profile.name,
                tab: tabId,
                nofocus: true,
            });
            out.blockId = launch?.blockid ?? "";
            out.model = launch?.model ?? "";
            if (!out.blockId) {
                out.err = "agentlaunch 未返回 blockid";
                return out;
            }
            // 后台 Tab 的块不挂载 term view（渲染层挂载时才 resync）：显式起控制器
            // （block.tsx 的 warmup 同一条 RPC）。controller Start 会铸 agent:sessionid 并拉起 agent 进程。
            await wshclient.RpcApi.ControllerResyncCommand(wshrpcutil.TabRpcClient, {
                tabid: tabId,
                blockid: out.blockId,
                rtopts: { termsize: { rows: 25, cols: 80 } },
            });
            out.ok = true;
        } catch (err) {
            out.err = String(err && err.message ? err.message : err);
        }
        return out;
    })()`;

    const agentSpawn = await evalRetry(spawnAgentProbe);
    let piTabId = "";
    let piBlockId = "";
    let agentUsable = false;
    if (agentSpawn?.ok === true) {
        piTabId = agentSpawn.tabId;
        piBlockId = agentSpawn.blockId;
        createdTabIds.push(piTabId);
        // 组出现（tabids 广播）+ 块 meta 拿到 agent:sessionid（controller Start 铸，行才可展开）
        const groupShown = await waitFor(client, cardSendGroupProbe(piTabId), (st) => st?.found === true, 20000, 300);
        const metaReady = await waitFor(
            client,
            `(async () => {
                const wshclient = await import("/frontend/app/store/wshclientapi.ts");
                const wshrpcutil = await import("/frontend/app/store/wshrpcutil.ts");
                const meta = await wshclient.RpcApi.GetMetaCommand(wshrpcutil.TabRpcClient, {
                    oref: ${JSON.stringify(`block:${piBlockId}`)},
                });
                return { sessionId: typeof meta?.["agent:sessionid"] === "string" ? meta["agent:sessionid"] : "" };
            })()`,
            (st) => (st?.sessionId ?? "") !== "",
            120000,
            2000
        );
        if (groupShown?.found === true && (metaReady?.sessionId ?? "") !== "") {
            // 新 Tab 没激活过 → 组 unopened 默认折叠：展开组，行才进 DOM
            await client.evaluate(clickGroupToggleProbe(overviewBlockId, piTabId));
            const piGroupOpen = await waitFor(
                client,
                cardSendGroupProbe(piTabId),
                (st) => st?.found === true && st.toggleExpanded === "true",
                8000,
                250
            );
            const rowReady = await waitFor(
                client,
                cardSendGroupProbe(piTabId),
                (st) => st?.found === true && st.rowExpandable === true,
                30000,
                500
            );
            // 行可展开还不够：composer 只在展开体里。点行主体展开，等 textarea 真的出现。
            const rowExpandClick = await client.evaluate(clickCardRowProbe(piTabId));
            const piExpanded = await waitFor(
                client,
                cardSendGroupProbe(piTabId),
                (st) => st?.found === true && st.bodyBlockId != null && st.hasInput === true,
                10000,
                200
            );
            agentUsable =
                piGroupOpen?.toggleExpanded === "true" &&
                rowReady?.rowExpandable === true &&
                rowExpandClick?.ok === true &&
                piExpanded?.bodyBlockId != null &&
                piExpanded?.hasInput === true;
        }
        log(`agent block: tab=${piTabId} block=${piBlockId} profile=${agentSpawn.profile} model=${agentSpawn.model} usable=${agentUsable}`);
    } else {
        log(`agent spawn failed: ${JSON.stringify(agentSpawn)}`);
    }

    // 预热（环境门，不计入断言）：pi 冷启动会跑 npm 查扩展更新（实测 40s+），而 composer 的
    // 等回复窗口默认 60s。先真发一条 WARMUP_OK 并等到回复，让 agent 进入 idle —— 之后两条断言
    // 才在「热」agent 上量 UI 行为（否则 60s 窗口量到的是冷启动，不是卡片行为）。
    let warmup = { ok: false, phase: "not-run", badgeClass: null, badgeText: "", replyText: "", alertText: "", attempts: 0 };
    if (agentUsable) {
        for (let attempt = 1; attempt <= 2; attempt++) {
            const sent = await cardSendSubmitOnce(piTabId, "reply with exactly: WARMUP_OK");
            if (sent.ok !== true) {
                warmup = { ...warmup, ok: false, phase: "send-failed", attempts: attempt, detail: sent };
                break;
            }
            const settled = await waitFor(client, cardSendGroupProbe(piTabId), (st) => cardSendPhase(st) != null, 100000, 700);
            const phase = cardSendPhase(settled);
            warmup = {
                ok: phase === "replied" && String(settled?.replyText ?? "").includes("WARMUP_OK"),
                phase: phase ?? "no-terminal-state",
                badgeClass: settled?.badgeClass ?? null,
                badgeText: settled?.badgeText ?? "",
                replyText: String(settled?.replyText ?? "").slice(0, 200),
                alertText: String(settled?.alertText ?? "").slice(0, 200),
                attempts: attempt,
            };
            log(`warmup attempt ${attempt}: ${JSON.stringify(warmup)}`);
            if (warmup.ok) break;
            if (phase !== "timeout" && phase !== "failed") break;
            // 超时/启动未就绪：清行程（timeout 的 [取消]），等一拍再重发一次。
            if (phase === "timeout") await client.evaluate(clickCardCancelWaitProbe(piTabId)).catch(() => null);
            await sleep2(15000);
        }
    }

    if (!agentUsable || !warmup.ok) {
        const reason =
            agentSpawn?.ok !== true
                ? `agent 块没起起来（${String(agentSpawn?.err ?? "unknown")}）`
                : !agentUsable
                  ? `agent 块起了但行不可展开（未拿到 agent:sessionid）`
                  : `预热等不到回复（phase=${warmup.phase} alert=${warmup.alertText || "-"}）`;
        skipped.push(
            `card-send-replied / card-send-no-wait 未跑：${reason}。按环境问题记 skipped（agent 起不来不假装通过）；` +
                `profile=${agentSpawn?.profile || "-"} catalog=${JSON.stringify(agentSpawn?.catalog ?? [])}`
        );
        log(`card-send assertions skipped: ${reason}`);
    } else {
        // ── 断言 11：勾「发送后等回复」→ CARD_OK → 徽章「收到回复」+ 卡片内出现 CARD_OK ────
        const before11 = await evalRetry(cardSendGroupProbe(piTabId));
        const sent11 = await cardSendSubmitOnce(piTabId, "reply with exactly: CARD_OK");
        const settle11 = await waitFor(
            client,
            cardSendGroupProbe(piTabId),
            (st) => ["replied", "failed", "timeout"].includes(cardSendPhase(st) ?? ""),
            130000,
            500
        );
        const phase11 = cardSendPhase(settle11);
        const wall11 = Date.now() - (sent11?.at ?? Date.now());
        check(
            "card-send-replied",
            sent11?.ok === true &&
                before11?.waitChecked === true &&
                phase11 === "replied" &&
                String(settle11?.replyText ?? "").includes("CARD_OK"),
            {
                waitCheckedBefore: before11?.waitChecked,
                sent: sent11?.ok === true,
                phase: phase11,
                wallMs: wall11,
                badgeClass: settle11?.badgeClass,
                badgeText: settle11?.badgeText,
                replyText: String(settle11?.replyText ?? "").slice(0, 240),
                replyTurn: settle11?.replyTurn,
                alertText: settle11?.alertText,
                note: "勾「发送后等回复」发送：徽章到「收到回复」（is-ok + 新回复块）且卡片内出现 CARD_OK",
            }
        );
        await shot(client, "08-card-send-replied");

        // ── 断言 12：取消勾选 → NOWAIT_SECOND → ≤3s 徽章「已提交/未确认提交」；另一行仍可展开 ────
        const waitToggle = await client.evaluate(clickCardWaitProbe(piTabId));
        const waitOff = await waitFor(
            client,
            cardSendGroupProbe(piTabId),
            (st) => st?.found === true && st.waitChecked === false,
            5000,
            150
        );
        // 给 TUI 一拍安静（上一回合的回显收尾），再发不等回复的那条
        await sleep2(3000);
        const sent12 = await cardSendSubmitOnce(piTabId, "reply with exactly: NOWAIT_SECOND");
        const settle12 = await waitFor(
            client,
            cardSendGroupProbe(piTabId),
            (st) => ["submitted", "unconfirmed", "failed"].includes(cardSendPhase(st) ?? ""),
            3000,
            150
        );
        const phase12 = cardSendPhase(settle12);
        const elapsed12 = Date.now() - (sent12?.at ?? Date.now());
        // 另一行仍能展开（互斥：另一行展开 = 这张卡收起；发送的 RPC 不阻塞面板交互）
        const clickedOther = await client.evaluate(clickCardRowProbe(seededAgentTabId));
        const otherExpanded = await waitFor(
            client,
            cardSendGroupProbe(seededAgentTabId),
            (st) => st?.found === true && st.bodyBlockId != null,
            5000,
            200
        );
        const piAfter12 = await evalRetry(cardSendGroupProbe(piTabId));
        check(
            "card-send-no-wait",
            waitToggle?.ok === true &&
                waitToggle?.checked === false &&
                waitOff?.waitChecked === false &&
                sent12?.ok === true &&
                (phase12 === "submitted" || phase12 === "unconfirmed") &&
                elapsed12 <= 3000 &&
                !String(settle12?.replyText ?? "").includes("NOWAIT_SECOND") &&
                clickedOther?.ok === true &&
                otherExpanded?.bodyBlockId != null &&
                piAfter12?.found === true &&
                piAfter12?.bodyBlockId == null,
            {
                waitToggle,
                waitCheckedAfterToggle: waitOff?.waitChecked,
                sent: sent12?.ok === true,
                phase: phase12,
                elapsedMs: elapsed12,
                budgetMs: 3000,
                badgeClass: settle12?.badgeClass,
                badgeText: settle12?.badgeText,
                replyText: String(settle12?.replyText ?? "").slice(0, 200),
                alertText: settle12?.alertText,
                otherRow: clickedOther,
                otherExpandedBody: otherExpanded?.bodyBlockId,
                piRowAfter: piAfter12?.bodyBlockId,
                note: "不等回复：徽章停在「已提交/未确认提交」（is-ok/is-warn 且无新回复块），≤3s 落定；另一行仍可展开（面板不阻塞）",
            }
        );
        await shot(client, "09-card-send-nowait");
    }

    // ── 有意不覆盖的面 ─────────────────────────────────────────────────────
    skipped.push(
        "大规模场景（19 Tab × ~10 块的 190 次单件 RPC 对比）未跑：全新实例只播 8 Tab，判据用 GetObjects 计数代理"
    );
    skipped.push(
        "loading 骨架态未单独断言（只可能出现在 prime 在路上的瞬间，轮询抓不到；由单测 + prime-all-tabs-resolved 覆盖）"
    );
    skipped.push("折叠记忆持久化（collapsedTabIds 只在本 renderer 内存里）不在本包范围");
    skipped.push("board / timeline 视图不受本包影响，其 tab 分组仍以卡片来源为准，由 overview-board / overview-timeline 台覆盖");

    // 收尾：关掉播种的 Tab（best-effort；reset profile 的下一轮本来也会清干净）
    const cleaned = await client.evaluate(cleanupProbe()).catch((err) => ({ closed: 0, err: String(err) }));
    log(`cleanup: ${JSON.stringify(cleaned)}`);

    reporter.finish({
        skipped,
        extra: {
            profile: PROFILE,
            overviewBlockId,
            workspaceId,
            expectedTabs,
            seededTabs: seeded.tabs,
            summaryText,
            cardSend: {
                spawn: { profile: agentSpawn?.profile ?? "", model: agentSpawn?.model ?? "", ok: agentSpawn?.ok === true, err: agentSpawn?.err ?? "", usable: agentUsable },
                piTabId,
                piBlockId,
                warmup,
            },
            // 真机观察到的产品缺陷（若 empty-tab-group-shows-no-blocks FAIL，根因在这里）：
            // toggleTabCollapsed 只翻「显式记忆」（undefined→true→undefined），而
            // isGroupCollapsed 对 empty/unopened 默认返回 true → 默认折叠的组怎么点都不展开，
            // noBlocks 行永远不可达。对照组 live-group-toggle-works PASS，排除台子点击链路问题。
            productFinding:
                "toggleTabCollapsed(session-overview.tsx) 只翻显式折叠记忆，翻不过 isGroupCollapsed 的「empty/unopened 默认折叠」——默认折叠的组点了没反应，noBlocks 行不可达",
        },
        cleanup: () => closeInstance(),
    });
}

function closeInstance() {
    client?.close?.();
    if (instance?.spawned && !keepOpen) instance.cleanup?.();
}

try {
    await main();
} catch (err) {
    reporter.fatal(err, { cleanup: () => closeInstance() });
}
