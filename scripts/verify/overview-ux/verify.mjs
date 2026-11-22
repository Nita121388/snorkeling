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
