#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// CommonText「后台异步发送」真机验证台（task 11-17-commontext-send-background）。
//
// 判据分三部分（PRD）：
//   Part 1 正常：后台发送（新建 Tab / 已有 Tab）不换激活 Tab、不抢焦点、不新增 localStorage 键，
//                注入照常发生（injected 事件），目标 Tab 以隐藏挂载出现；「后台执行」开关存在且默认开；
//                关闭开关后旧行为回归（发送会跳转）。
//   Part 2 异常：TTL 到期回退剪贴板（fallback 事件）且隐藏挂载被清理；等待中删 Tab 不崩且挂载清理；
//                发送期间焦点不被抢；连续多次发送时隐藏挂载数不超过上限（2），最终全部清理；
//                多行文本走同一条注入链路。
//   Part 3 启动安全：用过本功能后杀进程重启，窗口正常渲染、Tab 还原、localStorage 键集合不变、
//                不因本功能多挂任何 TabContent（pending 状态全内存）。
//
// 用法：
//   node scripts/verify/commontext-send-background/verify.mjs
//   node scripts/verify/commontext-send-background/verify.mjs --attach
//   node scripts/verify/commontext-send-background/verify.mjs --startup-only
//   node scripts/verify/commontext-send-background/verify.mjs --keep-open
//   node scripts/verify/commontext-send-background/verify.mjs --dry
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { DEFAULTS, ensureInstance, findPidByPort, killPid } from "../lib/launch.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep, waitForProbe } from "../lib/probes.mjs";
import { createReporter } from "../lib/report.mjs";

const AREA = "commontext-send-background";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");
const startupOnly = argv.includes("--startup-only");

const reporter = createReporter({
    area: AREA,
    mode: attach ? "attach" : startupOnly ? "launch(keep-profile)" : "launch+reset",
});
let instance = null;
let client = null;

const MARKER = `VERIFY-CSBD-${Date.now()}`;
const MULTI = `${MARKER}-L1\n${MARKER}-L2`;

const POPOVER = "[data-commontext-send-popover]";

// ─────────── 真实指针 ───────────
async function realClick(c, pt) {
    await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y, button: "none", buttons: 0 });
    await sleep(60);
    await c.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: pt.x,
        y: pt.y,
        button: "left",
        buttons: 1,
        clickCount: 1,
    });
    await sleep(50);
    await c.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: pt.x,
        y: pt.y,
        button: "left",
        buttons: 0,
        clickCount: 1,
    });
    await sleep(350);
}

// ─────────── 页面探针 ───────────
const OPEN_MODAL = `(() => {
    window.dispatchEvent(new CustomEvent("snorkeling:common-text:open-search", { detail: {} }));
    return true;
})()`;

const STATE = `(() => {
    const active = document.querySelector('[data-tab-id][data-tab-active="true"]');
    const hidden = [...document.querySelectorAll('[data-tab-id][data-tab-active="false"]')].map((el) => ({
        tabId: el.getAttribute("data-tab-id"),
        blocks: el.querySelectorAll(".block").length,
    }));
    const activeEl = document.activeElement;
    const hiddenEls = [...document.querySelectorAll('[data-tab-id][data-tab-active="false"]')];
    return {
        focusInsideHidden: hiddenEls.some((el) => el.contains(activeEl)),
        activeTabDom: active?.getAttribute("data-tab-id") ?? null,
        hiddenTabs: hidden,
        activeElement: activeEl
            ? activeEl.tagName + "." + String(activeEl.className || "").slice(0, 40)
            : null,
        blockCount: document.querySelectorAll(".block").length,
        innerWidth,
        innerHeight,
        lsKeys: Object.keys(localStorage).sort(),
        hasSendButton: document.querySelector("[data-commontext-send-button]") != null,
        hasPopover: document.querySelector(${JSON.stringify(POPOVER)}) != null,
        hasErrorCard: document.querySelector(".root-error-boundary, [data-root-error]") != null,
    };
})()`;

// 模块图：真实激活 Tab / Tab 列表（每个 Tab 是独立 renderer，staticTabId 不变，必须读 workspace）
const WORKSPACE_STATE = `(async () => {
    const g = await import("/frontend/app/store/global.ts");
    const ws = g.globalStore.get(g.atoms.workspace);
    return {
        activetabid: ws?.activetabid ?? "",
        tabids: [...(ws?.tabids ?? [])],
        staticTabId: g.globalStore.get(g.atoms.staticTabId),
    };
})()`;

// 设置/读取 Send 配置（绕过 UI 二级菜单，专注后台行为本身）
const SET_CONFIG = (patch) => `(async () => {
    const mod = await import("/frontend/app/commontext/commontext-send-button.tsx");
    const g = await import("/frontend/app/store/global.ts");
    const store = (await import("/frontend/app/store/jotaiStore.ts")).globalStore;
    const current = store.get(mod.commontextSendConfigAtom);
    const next = Object.assign({}, current, ${JSON.stringify(patch)});
    store.set(mod.commontextSendConfigAtom, next);
    return store.get(mod.commontextSendConfigAtom);
})()`;

// 归属：blockId 落在哪个 tab（走 tab.blockids，不依赖挂载）
const BLOCK_OWNER_TAB = (blockId) => `(async () => {
    const g = await import("/frontend/app/store/global.ts");
    const WOS = await import("/frontend/app/store/wos.ts");
    const ws = g.globalStore.get(g.atoms.workspace);
    for (const tabId of ws?.tabids ?? []) {
        const oref = WOS.makeORef("tab", tabId);
        try { await WOS.loadAndPinWaveObject(oref); } catch {}
        const tab = g.globalStore.get(WOS.getWaveObjectAtom(oref));
        if ((tab?.blockids ?? []).includes(${JSON.stringify(blockId)})) return { tabId, blockids: [...(tab?.blockids ?? [])] };
    }
    return { tabId: "", blockids: [] };
})()`;

const DELETE_TAB = (tabId) => `(async () => {
    const g = await import("/frontend/app/store/global.ts");
    const services = await import("/frontend/app/store/services.ts");
    const ws = g.globalStore.get(g.atoms.workspace);
    const rtn = await services.WorkspaceService.CloseTab(ws?.oid ?? "", ${JSON.stringify(tabId)}, false);
    return rtn?.newactivetabid ?? "";
})()`;

// 模块直调 executeCommonTextSend（不弹窗）：焦点不抢 / 群发场景用，避免弹窗自身抢焦点干扰断言
const DIRECT_SEND = (text) => `(async () => {
    const mod = await import("/frontend/app/commontext/commontext-send-button.tsx");
    const al = await import("/frontend/app/workspace/agent-launch.ts");
    const g = await import("/frontend/app/store/global.ts");
    const settings = g.globalStore.get(g.atoms.settingsAtom);
    const profiles = al.getAgentProfileOptions(settings);
    if (!Array.isArray(profiles) || profiles.length === 0) return "no-profiles";
    const preferred = profiles.find((p) => p.isDefault) ?? profiles[0];
    const ok = await mod.executeCommonTextSend({
        text: ${JSON.stringify(text)},
        config: { mode: "create", background: true, profile: preferred.name, tab: { kind: "new" }, folder: null },
        focusedAgent: null,
        profiles,
    });
    return ok;
})()`;

// 在本 renderer 的 staticTabId 里建一个 shell 终端（干净 profile 的初始 Tab 可能是 preview，无 xterm）
const CREATE_SHELL_TERM = `(async () => {
    const g = await import("/frontend/app/store/global.ts");
    const blockId = await g.createBlock({ meta: { view: "term", controller: "shell" } }, false);
    return blockId;
})()`;

const WINDOW_TERM_OWNER = `(async () => {
    const WOS = await import("/frontend/app/store/wos.ts");
    const g = await import("/frontend/app/store/global.ts");
    const blockId = window.term?.blockId ?? "";
    if (blockId === "") return { blockId: "", owner: "" };
    const ws = g.globalStore.get(g.atoms.workspace);
    for (const tabId of ws?.tabids ?? []) {
        const oref = WOS.makeORef("tab", tabId);
        try { await WOS.loadAndPinWaveObject(oref); } catch {}
        const tab = g.globalStore.get(WOS.getWaveObjectAtom(oref));
        if ((tab?.blockids ?? []).includes(blockId)) return { blockId, owner: tabId };
    }
    return { blockId, owner: "" };
})()`;

const ACTIVATE_TAB = (tabId) => `(async () => {
    const g = await import("/frontend/app/store/global.ts");
    g.getApi().setActiveTab(${JSON.stringify(tabId)});
    return true;
})()`;

const SET_EDITOR_TEXT = (text) => `(() => {
    const ta = document.querySelector("[data-commontext-composer]");
    if (!ta) return "no-editor";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return ta.value;
})()`;

const ARM_EVENTS = `(() => {
    window.__csbd = { injected: [], fallback: [] };
    if (!window.__csbdArmed) {
        window.__csbdArmed = true;
        window.addEventListener("snorkeling:pending-input-injected", (e) => window.__csbd.injected.push(e.detail ?? {}));
        window.addEventListener("snorkeling:pending-input-fallback", (e) => window.__csbd.fallback.push(e.detail ?? {}));
    }
    return true;
})()`;

const EVENTS = `(() => ({ injected: window.__csbd?.injected ?? [], fallback: window.__csbd?.fallback ?? [] }))()`;

const POINT_OF = (selector) => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

const SEND_BUTTON_POINT = `(() => {
    const p = document.querySelector(${JSON.stringify(POPOVER)});
    if (!p) return null;
    const b = [...p.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "发送");
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

const BACKGROUND_SWITCH = `(() => {
    const row = document.querySelector("[data-commontext-send-background]");
    if (!row) return null;
    const sw = row.querySelector('[role="switch"]');
    return {
        exists: sw != null,
        checked: sw?.getAttribute("aria-checked") ?? null,
        text: (row.textContent || "").replace(/\s+/g, " ").trim(),
    };
})()`;

// 隐藏挂载计数（pending 队列的可观测面）
const HIDDEN_TABS = `[...document.querySelectorAll('[data-tab-id][data-tab-active="false"]')].map((el) => el.getAttribute("data-tab-id"))`;

// ─────────── 交互封装 ───────────
async function openSendPopover(c) {
    await c.evaluate(OPEN_MODAL);
    const btn = await waitForProbe(c, `document.querySelector("[data-commontext-send-button]") != null`, (v) => v === true, {
        timeoutMs: 20000,
    });
    if (!btn) throw new Error("CommonText 弹窗未打开（[data-commontext-send-button] 不存在）");
    const caret = await c.evaluate(
        `(() => { const el = document.querySelector("[data-commontext-send-button]"); if (!el) return null; const b = el.querySelectorAll("button")[1]; if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`
    );
    if (caret == null) throw new Error("Send split button 的 caret 段不存在");
    await realClick(c, caret);
    const pop = await waitForProbe(c, `document.querySelector(${JSON.stringify(POPOVER)}) != null`, (v) => v === true, {
        timeoutMs: 10000,
    });
    if (!pop) throw new Error("Send popover 未打开");
}

/** 打开弹窗 →（可选）改配置 → 写文本 → 真点「发送」→ 等弹窗关闭。 */
async function sendViaUI(c, text, configPatch) {
    await openSendPopover(c);
    if (configPatch != null) await c.evaluate(SET_CONFIG(configPatch));
    const val = await c.evaluate(SET_EDITOR_TEXT(text));
    if (typeof val !== "string" || !val.includes(text.slice(0, 12))) {
        throw new Error(`编辑器写入失败: ${String(val).slice(0, 80)}`);
    }
    const pt = await c.evaluate(SEND_BUTTON_POINT);
    if (pt == null) throw new Error("「发送」按钮不存在");
    await realClick(c, pt);
    const closed = await waitForProbe(
        c,
        `document.querySelector(${JSON.stringify(POPOVER)}) == null && document.querySelector("[data-commontext-send-button]") == null`,
        (v) => v === true,
        { timeoutMs: 20000 }
    );
    if (!closed) throw new Error("发送后弹窗未关闭");
}

const sameKeys = (a, b) => JSON.stringify(a) === JSON.stringify(b);

if (dry) {
    reporter.log("dry-run: 依赖解析成功（未启动 GUI）");
    reporter.check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs");
    reporter.finish({ cleanup: null });
} else if (startupOnly) {
    // 只跑 Part 3：复用已有 profile（上一轮用过本功能），断言重启正常。
    try {
        instance = await ensureInstance({ attach, resetProfile: false });
        client = instance.client;
        await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
        await dismissOnboarding(client, { log: reporter.log });
        const st = await waitForProbe(client, STATE, (s) => s != null && s.blockCount > 0, { timeoutMs: 60000 });
        const ws = await client.evaluate(WORKSPACE_STATE);
        reporter.check("startup-renders", st?.blockCount > 0 && st?.innerWidth > 0, JSON.stringify({
            blockCount: st?.blockCount,
            innerWidth: st?.innerWidth,
        }));
        reporter.check("startup-no-error-card", st?.hasErrorCard === false, `hasErrorCard=${st?.hasErrorCard}`);
        // --startup-only 是「任意已有 profile 能否正常起来」的冒烟判据；
        // 与上一次运行对比的还原性断言在主跑（Part 3 restart-tabs-restored）里做。
        reporter.check(
            "startup-tabs-present",
            (ws?.tabids ?? []).length >= 1 && ws?.activetabid !== "",
            JSON.stringify(ws)
        );
        reporter.check(
            "startup-no-extra-hidden-mounts",
            (st?.hiddenTabs ?? []).length <= 3,
            `hidden=${JSON.stringify(st?.hiddenTabs ?? [])} (预挂载上限 3，pending 不计入)`
        );
        await reporter.shot(client, "startup-after-restart");
        reporter.finish({ cleanup: () => instance?.cleanup?.() });
    } catch (err) {
        reporter.fatal(err, { cleanup: () => instance?.cleanup?.() });
    }
} else {
    try {
        const endpoint = `http://127.0.0.1:${DEFAULTS.cdpPort}`;
        instance = await ensureInstance({ attach, resetProfile: !attach });
        client = instance.client;
        const pages = await listPageTargets(endpoint);
        if (pages.length > 1) {
            client = (await pickLiveRenderer(pages, connectToTarget, endpoint)).client;
        }
        await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
        reporter.log(`instance ready (${attach ? "attach" : "launch"})`);
        await dismissOnboarding(client, { log: reporter.log });
        await client.evaluate(ARM_EVENTS);

        // ─────────── Part 1 正常路径 ───────────
        const base = await client.evaluate(STATE);
        const baseWs = await client.evaluate(WORKSPACE_STATE);
        reporter.check(
            "baseline-ready",
            base != null && baseWs?.activetabid !== "" && base.lsKeys != null,
            `active=${baseWs?.activetabid} tabs=${baseWs?.tabids?.length} lsKeys=${base.lsKeys?.length}`
        );

        await sendViaUI(client, MULTI, { background: true, tab: { kind: "new" }, mode: "create" });

        // 立即断言：没换 Tab / 没抢焦点 / 没写 localStorage
        await sleep(800);
        const after = await client.evaluate(STATE);
        const afterWs = await client.evaluate(WORKSPACE_STATE);
        reporter.check(
            "background-keeps-active-tab",
            afterWs?.activetabid === baseWs?.activetabid,
            `before=${baseWs?.activetabid} after=${afterWs?.activetabid}`
        );
        // 打开 compose 弹窗本身会把焦点给弹窗编辑器（既有行为，与本功能无关）。
        // 本功能的判据是：发送后焦点绝不落进隐藏挂载的目标 Tab（隐藏块不抢焦点）。
        reporter.check(
            "background-no-focus-in-hidden-tab",
            after?.focusInsideHidden === false,
            `activeElement=${after?.activeElement} focusInsideHidden=${after?.focusInsideHidden}`
        );
        // 排除与本功能无关的既有异步写入：
        //   commontext:composeModalSize / commontext:editorDraft —— 弹窗自身的尺寸与草稿自动保存
        //   preview:expandeddirs:<blockoid>:<path>          —— 预览块目录展开状态（启动后懒写入，异步）
        // 判据：后台发送本身不得新增任何键。
        const allowPrefixes = ["commontext:composeModalSize", "commontext:editorDraft", "preview:expandeddirs:"];
        const newLsKeys = (after?.lsKeys ?? []).filter((k) => !(base?.lsKeys ?? []).includes(k));
        const unexpectedKeys = newLsKeys.filter((k) => !allowPrefixes.some((p) => k.startsWith(p)));
        reporter.check(
            "background-no-localstorage-write",
            unexpectedKeys.length === 0,
            `newKeys=${JSON.stringify(newLsKeys)} unexpected=${JSON.stringify(unexpectedKeys)}`
        );
        const newTabIds = (afterWs?.tabids ?? []).filter((id) => !(baseWs?.tabids ?? []).includes(id));
        reporter.check("background-created-new-tab", newTabIds.length === 1, JSON.stringify(newTabIds));
        const pendingTabId = newTabIds[0] ?? "";
        const mountedHidden = await client.evaluate(HIDDEN_TABS);
        reporter.check(
            "background-hidden-mount-present",
            pendingTabId !== "" && mountedHidden.includes(pendingTabId),
            `pendingTab=${pendingTabId} hidden=${JSON.stringify(mountedHidden)}`
        );
        await reporter.shot(client, "01-after-background-send");

        // 注入照常发生（TUI 就绪后），且没有 fallback
        const ev1 = await waitForProbe(client, EVENTS, (ev) => ev?.injected?.length > 0 || ev?.fallback?.length > 0, {
            timeoutMs: 120000,
            intervalMs: 1000,
        });
        const hit1 = ev1?.injected?.[0];
        reporter.check("background-injected", hit1 != null, JSON.stringify(ev1 ?? {}));
        reporter.check("background-no-fallback", (ev1?.fallback ?? []).length === 0, JSON.stringify(ev1?.fallback ?? []));
        if (hit1?.blockId != null) {
            const owner = await client.evaluate(BLOCK_OWNER_TAB(hit1.blockId));
            reporter.check(
                "background-block-lands-in-target-tab",
                owner?.tabId !== "" && owner.tabId === pendingTabId,
                `block=${hit1.blockId} owner=${owner?.tabId} target=${pendingTabId}`
            );
        }
        // 注入完成后 pending 隐藏挂载必须移除
        const hiddenAfterInject = await waitForProbe(
            client,
            HIDDEN_TABS,
            (tabs) => Array.isArray(tabs) && !tabs.includes(pendingTabId),
            { timeoutMs: 30000, intervalMs: 500 }
        );
        reporter.check(
            "background-unmounts-after-inject",
            Array.isArray(hiddenAfterInject) && !hiddenAfterInject.includes(pendingTabId),
            `hidden=${JSON.stringify(hiddenAfterInject)}`
        );

        // 开关 UI：存在、默认开、可切换
        await openSendPopover(client);
        const sw1 = await client.evaluate(BACKGROUND_SWITCH);
        reporter.check("background-switch-present", sw1?.exists === true && sw1?.checked === "true", JSON.stringify(sw1));
        const swPt = await client.evaluate(POINT_OF("[data-commontext-send-background] [role=switch]"));
        if (swPt != null) await realClick(client, swPt);
        const sw2 = await client.evaluate(BACKGROUND_SWITCH);
        reporter.check("background-switch-toggles-off", sw2?.checked === "false", JSON.stringify(sw2));
        if (swPt != null) await realClick(client, swPt);
        const sw3 = await client.evaluate(BACKGROUND_SWITCH);
        reporter.check("background-switch-toggles-on", sw3?.checked === "true", JSON.stringify(sw3));
        await reporter.shot(client, "02-background-switch");
        await client.evaluate(`document.querySelector("[data-commontext-send-button]")?.querySelectorAll("button")[1]?.click()`);
        await sleep(400);

        // 旧行为回归：关掉开关 → 发送会跳转（新建 Tab 路径）
        await sendViaUI(client, `${MARKER}-fg`, { background: false, tab: { kind: "new" }, mode: "create" });
        const fgWs = await waitForProbe(
            client,
            WORKSPACE_STATE,
            (ws) => ws?.activetabid !== "" && ws.activetabid !== baseWs?.activetabid,
            { timeoutMs: 30000 }
        );
        reporter.check(
            "foreground-regression-jumps",
            fgWs?.activetabid != null && fgWs.activetabid !== baseWs?.activetabid,
            `before=${baseWs?.activetabid} after=${fgWs?.activetabid}`
        );
        await reporter.shot(client, "03-foreground-regression");
        // 回到原 Tab，避免后续断言被跳转影响
        if (baseWs?.activetabid) await client.evaluate(ACTIVATE_TAB(baseWs.activetabid));
        await sleep(1200);

        // ─────────── Part 2 异常路径 ───────────
        // 2a. TTL：ttlMs=1 → 首次 tick 即到期，回退剪贴板 + 清理隐藏挂载
        await client.evaluate(`window.__snorkelingPendingInputOverride = { ttlMs: 1 }`);
        const before2a = await client.evaluate(WORKSPACE_STATE);
        await sendViaUI(client, `${MARKER}-ttl`, { background: true, tab: { kind: "new" }, mode: "create" });
        const ttlTabs = (await client.evaluate(WORKSPACE_STATE))?.tabids ?? [];
        const ttlTab = ttlTabs.find((id) => !(before2a?.tabids ?? []).includes(id)) ?? "";
        const evTtl = await waitForProbe(
            client,
            EVENTS,
            (ev) => (ev?.fallback ?? []).some((f) => (f?.length ?? 0) > 0 || f?.blockId != null),
            { timeoutMs: 30000, intervalMs: 500 }
        );
        const ttlFallback = (evTtl?.fallback ?? []).filter((f) => f?.blockId != null);
        reporter.check("ttl-fallback-fired", ttlFallback.length > 0, JSON.stringify(evTtl?.fallback ?? []));
        reporter.check(
            "ttl-no-injected-for-that-block",
            !(evTtl?.injected ?? []).some((i) => ttlFallback.some((f) => f.blockId === i.blockId)),
            `injected=${JSON.stringify(evTtl?.injected ?? [])}`
        );
        const ttlHidden = await waitForProbe(
            client,
            HIDDEN_TABS,
            (tabs) => Array.isArray(tabs) && (ttlTab === "" || !tabs.includes(ttlTab)),
            { timeoutMs: 30000, intervalMs: 500 }
        );
        reporter.check(
            "ttl-unmounts-hidden-tab",
            Array.isArray(ttlHidden) && (ttlTab === "" || !ttlHidden.includes(ttlTab)),
            `ttlTab=${ttlTab} hidden=${JSON.stringify(ttlHidden)}`
        );
        await client.evaluate(`delete window.__snorkelingPendingInputOverride`);
        await reporter.shot(client, "04-ttl-fallback");

        // 2b. 等待中删 Tab：不崩、隐藏挂载自愈清理
        await client.evaluate(`window.__snorkelingPendingInputOverride = { ttlMs: 60000 }`);
        const before2b = await client.evaluate(WORKSPACE_STATE);
        await sendViaUI(client, `${MARKER}-deltab`, { background: true, tab: { kind: "new" }, mode: "create" });
        const delTabs = (await client.evaluate(WORKSPACE_STATE))?.tabids ?? [];
        const delTab = delTabs.find((id) => !(before2b?.tabids ?? []).includes(id)) ?? "";
        const delMounted = await client.evaluate(HIDDEN_TABS);
        reporter.check(
            "delete-case-hidden-mount-present",
            delTab !== "" && delMounted.includes(delTab),
            `tab=${delTab} hidden=${JSON.stringify(delMounted)}`
        );
        if (delTab !== "") await client.evaluate(DELETE_TAB(delTab));
        const afterDel = await waitForProbe(
            client,
            HIDDEN_TABS,
            (tabs) => Array.isArray(tabs) && !tabs.includes(delTab),
            { timeoutMs: 20000, intervalMs: 500 }
        );
        const alive = await client.evaluate(`(() => document.querySelector(".block") != null && innerWidth > 0)()`);
        reporter.check("delete-tab-no-crash", alive === true, `alive=${alive}`);
        reporter.check(
            "delete-tab-unmounts-hidden",
            Array.isArray(afterDel) && !afterDel.includes(delTab),
            `tab=${delTab} hidden=${JSON.stringify(afterDel)}`
        );
        await client.evaluate(`delete window.__snorkelingPendingInputOverride`);
        await reporter.shot(client, "05-delete-tab");

        // 2c. 发送期间焦点不被抢：先在本 Tab 建一个 shell 终端（干净 profile 的初始 Tab 可能是
        // preview，没有 xterm），聚焦它的 helper textarea 后模块直调后台发送
        //（弹窗本身会接管焦点，走 UI 会把「弹窗抢焦点」误判成本功能的问题）。
        const shellBlockId = await client.evaluate(CREATE_SHELL_TERM);
        const focusPrereq = await waitForProbe(
            client,
            `(() => {
                const ta = document.querySelector('[data-tab-active="true"] .xterm-helper-textarea');
                if (!ta) return "no-textarea";
                ta.focus();
                return document.activeElement === ta;
            })()`,
            (v) => v === true,
            { timeoutMs: 30000, intervalMs: 500 }
        );
        reporter.check("focus-prereq", focusPrereq === true, `shell=${shellBlockId} focused=${focusPrereq}`);
        const termBeforeOwned = await client.evaluate(WINDOW_TERM_OWNER);
        await client.evaluate(`window.__snorkelingPendingInputOverride = { ttlMs: 1 }`);
        const directOk = await client.evaluate(DIRECT_SEND(`${MARKER}-focus`));
        await sleep(1500);
        const focusAfter = await client.evaluate(`(() => {
            const a = document.activeElement;
            return { tag: a?.tagName ?? "", cls: String(a?.className ?? "").slice(0, 40) };
        })()`);
        reporter.check(
            "background-does-not-steal-focus",
            directOk === true && focusAfter?.tag === "TEXTAREA" && focusAfter.cls.includes("xterm-helper-textarea"),
            `directOk=${directOk} focus=${JSON.stringify(focusAfter)}`
        );
        // 隐藏挂载的块绝不能覆盖调试全局 window.term（term.tsx 非激活守卫）：
        // 判据是 window.term 所属 Tab 必须是本 renderer 的 staticTabId（隐藏块属于别的 Tab）。
        const termAfterOwned = await client.evaluate(WINDOW_TERM_OWNER);
        const myStaticTab = await client.evaluate(`(async () => {
            const g = await import("/frontend/app/store/global.ts");
            return g.globalStore.get(g.atoms.staticTabId);
        })()`);
        reporter.check(
            "hidden-block-never-overrides-window-term",
            termAfterOwned?.blockId !== "" && termAfterOwned?.owner === myStaticTab,
            `before=${JSON.stringify(termBeforeOwned)} after=${JSON.stringify(termAfterOwned)} static=${myStaticTab}`
        );
        await client.evaluate(`delete window.__snorkelingPendingInputOverride`);

        // 2d. 连续 4 次发送：pending 隐藏挂载数从不超过 cap(2)，最终回到发送前基线
        // （hidden 里还包含既有预挂载 Tab，基线差集才是 pending 的量）
        const preBurstHidden = await client.evaluate(HIDDEN_TABS);
        await client.evaluate(`window.__snorkelingPendingInputOverride = { ttlMs: 4000 }`);
        const maxHidden = { value: 0, samples: 0 };
        const watchHidden = async (ms) => {
            const deadline = Date.now() + ms;
            while (Date.now() < deadline) {
                const hidden = await client.evaluate(HIDDEN_TABS);
                const n = Array.isArray(hidden) ? hidden.length : 0;
                maxHidden.value = Math.max(maxHidden.value, n);
                maxHidden.samples++;
                await sleep(200);
            }
        };
        for (let i = 0; i < 4; i++) {
            const burstOk = await client.evaluate(DIRECT_SEND(`${MARKER}-burst-${i}`));
            if (burstOk !== true) reporter.log(`burst send ${i} 返回 ${JSON.stringify(burstOk)}`);
            await watchHidden(600);
        }
        await watchHidden(8000);
        const hiddenFinal = await client.evaluate(HIDDEN_TABS);
        const preBurstCount = Array.isArray(preBurstHidden) ? preBurstHidden.length : 0;
        reporter.check(
            "burst-hidden-mount-cap",
            maxHidden.value <= preBurstCount + 2,
            `baseline=${preBurstCount} maxHidden=${maxHidden.value} samples=${maxHidden.samples} (cap=2)`
        );
        reporter.check(
            "burst-all-cleaned",
            Array.isArray(hiddenFinal) && hiddenFinal.length <= preBurstCount,
            `hiddenFinal=${JSON.stringify(hiddenFinal)} baseline=${JSON.stringify(preBurstHidden)}`
        );
        const aliveAfterBurst = await client.evaluate(`(() => document.querySelector(".block") != null && innerWidth > 0)()`);
        reporter.check("burst-no-crash", aliveAfterBurst === true, `alive=${aliveAfterBurst}`);
        await client.evaluate(`delete window.__snorkelingPendingInputOverride`);
        await reporter.shot(client, "06-burst");

        // ─────────── Part 3 启动安全 ───────────
        const preRestart = await client.evaluate(STATE);
        const preRestartWs = await client.evaluate(WORKSPACE_STATE);
        reporter.check(
            "pre-restart-state-captured",
            preRestart != null && (preRestartWs?.tabids ?? []).length >= 2,
            `tabs=${preRestartWs?.tabids?.length} lsKeys=${preRestart?.lsKeys?.length}`
        );
        // 杀掉实例（端口 → PID），同 profile 重新起（不 reset）
        client.close?.();
        killPid(findPidByPort(DEFAULTS.cdpPort));
        await sleep(2500);
        instance = await ensureInstance({ attach: false, resetProfile: false });
        client = instance.client;
        await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
        await dismissOnboarding(client, { log: reporter.log });
        const postRestart = await waitForProbe(client, STATE, (s) => s != null && s.blockCount > 0, { timeoutMs: 120000 });
        const postRestartWs = await client.evaluate(WORKSPACE_STATE);
        reporter.check(
            "restart-renders-blocks",
            postRestart?.blockCount > 0 && postRestart?.innerWidth > 0,
            `blocks=${postRestart?.blockCount} w=${postRestart?.innerWidth}`
        );
        reporter.check("restart-no-error-card", postRestart?.hasErrorCard === false, `hasErrorCard=${postRestart?.hasErrorCard}`);
        reporter.check(
            "restart-tabs-restored",
            (postRestartWs?.tabids ?? []).length >= (preRestartWs?.tabids ?? []).length,
            `before=${(preRestartWs?.tabids ?? []).length} after=${(postRestartWs?.tabids ?? []).length}`
        );
        reporter.check(
            "restart-localstorage-unchanged",
            sameKeys(preRestart?.lsKeys ?? [], postRestart?.lsKeys ?? []),
            `before=${JSON.stringify(preRestart?.lsKeys)} after=${JSON.stringify(postRestart?.lsKeys)}`
        );
        reporter.check(
            "restart-no-extra-hidden-mounts",
            (postRestart?.hiddenTabs ?? []).length <= 3,
            `hidden=${JSON.stringify(postRestart?.hiddenTabs ?? [])} (启动后 pending 必须为空，仅允许既有预挂载 ≤3)`
        );
        await reporter.shot(client, "07-after-restart");

        reporter.finish({
            skipped: [
                "已有 Tab 路径的隐藏挂载：本台只覆盖「新建 Tab」；已有 Tab 路径由同一套 mount/workspace 合并实现，单测覆盖合并逻辑",
                "TUI 输入框文本回显：不同 CLI 首启提示会吞按键，改断言 injected/fallback 事件（与 commontext-send-agent-block 同口径）",
                "多行文本的 bracketed paste 语义本身：由既有注入链路保证（同一 terminal.paste 路径），本台只验证多行文本也能走通注入事件",
                "远程 connection 目标：本地-only",
            ],
            cleanup: () => {
                client?.close?.();
                if (instance?.spawned && !keepOpen) instance.cleanup?.();
            },
        });
    } catch (err) {
        reporter.fatal(err, { cleanup: () => instance?.cleanup?.() });
    }
}
