#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// CommonText「后台异步发送」真机验证台（task 11-17-commontext-send-background；
// 2026-11-23 随 11-23-commontext-create-send 改版：create 路径不再走前端 pending-input，
// 「注入照常发生」的判据从 injected/fallback 事件换成**后端派发回执 confirmed + 真实块归属**）。
//
// 判据分三部分（PRD）：
//   Part 1 正常：后台发送（新建 Tab）不换激活 Tab、不抢焦点、不新增 localStorage 键；
//                派发回执（AgentDispatchListCommand）state=confirmed（accepted→submitted→confirmed
//                三段回执，提交确认在后端），多行文本一次送达；目标 Tab 不需要隐藏预挂载
//                （pending-input 登记 0 条 + 事件 0 条）；「后台执行」开关存在且默认开；
//                关闭开关后旧行为回归（发送会跳转）。
//   Part 2 异常：等待中删目标 Tab 不崩且派发状态可观测（failed 带错误，不挂死）；
//                发送期间焦点不被抢；连续多次发送时每条都真的 confirmed（后台 worker 串行/并发均不丢）；
//                后端日志出现 [agentsend] … submit confirm confirmed=true，且无 failed 派发。
//   Part 3 启动安全：用过本功能后杀进程重启，窗口正常渲染、Tab 还原、localStorage 键集合不变、
//                不因本功能多挂任何 TabContent（pending 状态全内存）。
//
// 用法：
//   node scripts/verify/commontext-send-background/verify.mjs
//   node scripts/verify/commontext-send-background/verify.mjs --attach
//   node scripts/verify/commontext-send-background/verify.mjs --startup-only
//   node scripts/verify/commontext-send-background/verify.mjs --keep-open
//   node scripts/verify/commontext-send-background/verify.mjs --dry
//   node scripts/verify/commontext-send-background/verify.mjs --log=<path>  # 覆盖后端日志路径
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
// 后端日志：本台实例的 WAVETERM_DATA_HOME 被 dev-isolated 重定向到 .runcfg/<profile>/data，
// 不是 %LOCALAPPDATA%\snorkeling。--attach 到别的 profile 时用 --log=<path> 覆盖。
const logArg = argv.find((a) => a.startsWith("--log="));
const logPath =
    logArg != null ? logArg.slice("--log=".length) : path.join(repoRoot, ".runcfg", DEFAULTS.profile, "data", "waveapp.log");

const reporter = createReporter({
    area: AREA,
    mode: attach ? "attach" : startupOnly ? "launch(keep-profile)" : "launch+reset",
    meta: { profile: DEFAULTS.profile, cdpPort: DEFAULTS.cdpPort, vitePort: DEFAULTS.vitePort, logPath },
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

// pending-input 事件（旧前端 paste 链的可观测面）：保留作反证 —— create 路径一条都不该派发。
const ARM_EVENTS = `(() => {
    window.__csbd = { injected: [], fallback: [] };
    if (!window.__csbdArmed) {
        window.__csbdArmed = true;
        window.addEventListener("snorkeling:pending-input-injected", (e) => window.__csbd.injected.push(e.detail ?? {}));
        window.addEventListener("snorkeling:pending-input-fallback", (e) => window.__csbd.fallback.push(e.detail ?? {}));
    }
    return true;
})()`;

// ─────────── 送达证据（替代旧 injected 事件断言）───────────
// 派发回执：后端状态机 pending → delivering → confirmed / failed；三段回执
// acceptedat（写进 TUI 输入缓冲）→ submittedat（回车确认生效）→ confirmedat。
const DISPATCH_LIST = `(async () => {
    const { RpcApi } = await import("/frontend/app/store/wshclientapi.ts");
    const { TabRpcClient } = await import("/frontend/app/store/wshrpcutil.ts");
    try {
        const records = await RpcApi.AgentDispatchListCommand(TabRpcClient, { limit: 20 });
        return { ok: true, records: Array.isArray(records) ? records : [] };
    } catch (error) {
        return { ok: false, error: String(error?.message ?? error), records: [] };
    }
})()`;

// pending-input 队列本身（纯内存）：create 改走后端后，本地块不该再登记任何条目。
const PENDING_REGISTRY = `(async () => {
    const mod = await import("/frontend/app/commontext/pending-input.ts");
    return {
        inputs: mod.pendingInputCount(),
        tabs: mod.pendingInputTabCount(),
        injected: window.__csbd?.injected ?? [],
        fallback: window.__csbd?.fallback ?? [],
    };
})()`;

const decodeText64 = (text64) => {
    try {
        return Buffer.from(String(text64 ?? ""), "base64").toString("utf8");
    } catch {
        return "";
    }
};

const findDispatch = (records, snippet) =>
    (records ?? []).find((rec) => decodeText64(rec?.text64).includes(snippet)) ?? null;

function logSize() {
    try {
        return readFileSync(logPath).length;
    } catch {
        return 0;
    }
}

function readLogTail(fromByte) {
    try {
        return readFileSync(logPath).subarray(Math.max(0, fromByte)).toString("utf8");
    } catch {
        return "";
    }
}

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
    // 不能按文案找：create 模式下主按钮文案是「新建并发送」（646a88228 起），不是「发送」。
    const b = p.querySelector("[data-commontext-send-submit]");
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: (b.textContent || "").trim() };
})()`;

const BACKGROUND_SWITCH = `(() => {
    const row = document.querySelector("[data-commontext-send-background]");
    if (!row) return null;
    const sw = row.querySelector('[role="switch"]');
    const knob = sw?.querySelector("span");
    return {
        exists: sw != null,
        checked: sw?.getAttribute("aria-checked") ?? null,
        knobBg: knob ? getComputedStyle(knob).backgroundColor : null,
        text: (row.textContent || "").replace(/\s+/g, " ").trim(),
    };
})()`;

// 滑块必须是真白：tailwindsetup.css 把 --color-white 重定义成主文本色，
// 浅色主题下 bg-white 会变成深棕（滑块糊在 accent 轨道上）。这里锁住计算后的颜色。
function isNearWhite(cssColor) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(cssColor || ""));
    if (!m) return false;
    const [r, g, b] = m.slice(1).map(Number);
    return r >= 235 && g >= 235 && b >= 235;
}

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
    reporter.log(`dry-run: 依赖解析成功（未启动 GUI）；日志路径 ${logPath}`);
    reporter.check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs");
    reporter.check("log-path-resolved", logPath.endsWith("waveapp.log"), logPath);
    // dry 只解析依赖，不进台账（台账记的是「真验过一次」）。
    reporter.finish({ cleanup: null, ledger: false });
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

        const preSendLogOffset = logSize();
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
        const targetTabId = newTabIds[0] ?? "";
        await reporter.shot(client, "01-after-background-send");

        // 送达照常发生（2026-11-23 起：后端派发回执，而不是前端 injected 事件）。
        // confirmed = acceptedat（写进 TUI 输入缓冲）→ submittedat（回车确认生效，
        // 后端补回车直至 TUI 输出增长）→ confirmed；这是「文本真的提交进去了」的权威信号。
        const disp1 = await waitForProbe(
            client,
            DISPATCH_LIST,
            (res) => {
                if (res?.ok !== true) return false;
                const rec = findDispatch(res.records, `${MARKER}-L1`);
                return rec != null && rec.state === "confirmed";
            },
            { timeoutMs: 240000, intervalMs: 2000 }
        );
        const rec1 = findDispatch(disp1?.records ?? [], `${MARKER}-L1`);
        reporter.check(
            "background-dispatch-created",
            rec1 != null,
            rec1 == null
                ? `no record for ${MARKER}-L1; list=${JSON.stringify((disp1?.records ?? []).map((r) => r.state))} err=${disp1?.error ?? ""}`
                : `dispatchid=${rec1.dispatchid} blockid=${rec1.blockid}`
        );
        reporter.check(
            "background-dispatch-confirmed",
            rec1 != null && rec1.state === "confirmed" && (rec1?.submittedat ?? 0) > 0 && !rec1?.error,
            JSON.stringify({
                state: rec1?.state ?? "",
                submittedat: rec1?.submittedat ?? 0,
                confirmedat: rec1?.confirmedat ?? 0,
                submitretries: rec1?.submitretries ?? 0,
                error: rec1?.error ?? "",
            })
        );
        // 多行文本一次送达：回执里存的 text64 解码后两行都在（backend 一次 bracketed paste）。
        reporter.check(
            "background-multiline-delivered",
            rec1 != null && decodeText64(rec1?.text64).includes(`${MARKER}-L2`),
            `text64=${decodeText64(rec1?.text64).slice(0, 120)}`
        );
        if (rec1?.blockid != null) {
            const owner = await client.evaluate(BLOCK_OWNER_TAB(rec1.blockid));
            reporter.check(
                "background-block-lands-in-target-tab",
                owner?.tabId !== "" && owner.tabId === targetTabId,
                `block=${rec1.blockid} owner=${owner?.tabId} target=${targetTabId}`
            );
        }
        // 反证：前端 pending-input 链对本地块彻底退役 —— 队列 0 条、Tab 0 条、事件 0 条。
        const reg1 = await client.evaluate(PENDING_REGISTRY);
        reporter.check(
            "background-no-pending-input",
            (reg1?.inputs ?? 0) === 0 && (reg1?.tabs ?? 0) === 0 && (reg1?.injected ?? []).length === 0,
            JSON.stringify({ inputs: reg1?.inputs, tabs: reg1?.tabs, injected: reg1?.injected, fallback: reg1?.fallback })
        );
        // 后端日志：[agentsend] 提交确认（修复前 create 路径根本不经过后端，[agentsend] 0 条）。
        const logSeg1 = readLogTail(preSendLogOffset);
        const bgBlockId = rec1?.blockid ?? "";
        const bgSubmitLine =
            bgBlockId === ""
                ? null
                : new RegExp(`\\[agentsend\\] ${bgBlockId} submit confirm retries=(\\d+) confirmed=(\\w+)`).exec(logSeg1);
        reporter.check(
            "background-log-agentsend-submit-confirmed",
            bgSubmitLine != null && bgSubmitLine[2] === "true",
            bgSubmitLine != null ? bgSubmitLine[0] : `no submit confirm line for block ${bgBlockId}`
        );

        // 开关 UI：存在、默认开、可切换
        await openSendPopover(client);
        const sw1 = await client.evaluate(BACKGROUND_SWITCH);
        reporter.check("background-switch-present", sw1?.exists === true && sw1?.checked === "true", JSON.stringify(sw1));
        reporter.check("background-switch-knob-white", isNearWhite(sw1?.knobBg), `knobBg=${sw1?.knobBg}`);
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
        // 2a. 等待中删目标 Tab：不崩，派发落到可观测的终态。
        //     旧版断言的是「隐藏挂载自愈清理」（前端 paste 链的语义）；create 改走后端后
        //     不再产生隐藏挂载，改断言后端派发状态机不挂死：抢在投递前删块 → failed（带错误），
        //     抢在删除前就投递成功 → confirmed。两条都是可读回执，不会静默卡在 delivering。
        const before2a = await client.evaluate(WORKSPACE_STATE);
        await sendViaUI(client, `${MARKER}-deltab`, { background: true, tab: { kind: "new" }, mode: "create" });
        const delTabs = await waitForProbe(
            client,
            WORKSPACE_STATE,
            (ws) => (ws?.tabids ?? []).length > (before2a?.tabids ?? []).length,
            { timeoutMs: 30000, intervalMs: 500 }
        );
        const delTab = (delTabs?.tabids ?? []).find((id) => !(before2a?.tabids ?? []).includes(id)) ?? "";
        reporter.check("delete-case-tab-created", delTab !== "", `tab=${delTab}`);
        const delQueued = await waitForProbe(
            client,
            DISPATCH_LIST,
            (res) => res?.ok === true && findDispatch(res.records, `${MARKER}-deltab`) != null,
            { timeoutMs: 60000, intervalMs: 1000 }
        );
        reporter.check(
            "delete-case-dispatch-created",
            findDispatch(delQueued?.records ?? [], `${MARKER}-deltab`) != null,
            `records=${JSON.stringify((delQueued?.records ?? []).map((r) => r.state))}`
        );
        if (delTab !== "") await client.evaluate(DELETE_TAB(delTab));
        const delSettled = await waitForProbe(
            client,
            DISPATCH_LIST,
            (res) => {
                if (res?.ok !== true) return false;
                const rec = findDispatch(res.records, `${MARKER}-deltab`);
                return rec != null && (rec.state === "failed" || rec.state === "confirmed");
            },
            { timeoutMs: 240000, intervalMs: 2000 }
        );
        const delRecord = findDispatch(delSettled?.records ?? [], `${MARKER}-deltab`);
        const alive = await client.evaluate(`(() => document.querySelector(".block") != null && innerWidth > 0)()`);
        reporter.check("delete-tab-no-crash", alive === true, `alive=${alive}`);
        reporter.check(
            "delete-tab-dispatch-settles",
            delRecord != null &&
                (delRecord.state === "failed"
                    ? String(delRecord.error ?? "") !== ""
                    : (delRecord.submittedat ?? 0) > 0),
            JSON.stringify({
                state: delRecord?.state ?? "",
                error: delRecord?.error ?? "",
                submittedat: delRecord?.submittedat ?? 0,
            })
        );
        await reporter.shot(client, "04-delete-tab");

        // 2b. 发送期间焦点不被抢：先在本 Tab 建一个 shell 终端（干净 profile 的初始 Tab 可能是
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
        const directOk = await client.evaluate(DIRECT_SEND(`${MARKER}-focus`));
        await sleep(2000);
        const focusAfter = await client.evaluate(`(() => {
            const a = document.activeElement;
            return { tag: a?.tagName ?? "", cls: String(a?.className ?? "").slice(0, 40) };
        })()`);
        reporter.check(
            "background-does-not-steal-focus",
            directOk === true && focusAfter?.tag === "TEXTAREA" && focusAfter.cls.includes("xterm-helper-textarea"),
            `directOk=${directOk} focus=${JSON.stringify(focusAfter)}`
        );
        // 后台块在别的 Tab：绝不能覆盖本 renderer 的调试全局 window.term，也不抢焦点。
        const termAfterOwned = await client.evaluate(WINDOW_TERM_OWNER);
        reporter.check(
            "background-send-does-not-replace-window-term",
            termBeforeOwned?.blockId !== "" && termAfterOwned?.blockId === termBeforeOwned?.blockId,
            `before=${JSON.stringify(termBeforeOwned)} after=${JSON.stringify(termAfterOwned)}`
        );
        const focusDisp = await waitForProbe(
            client,
            DISPATCH_LIST,
            (res) => res?.ok === true && findDispatch(res.records, `${MARKER}-focus`) != null,
            { timeoutMs: 60000, intervalMs: 1000 }
        );
        reporter.check(
            "background-focus-case-dispatched",
            findDispatch(focusDisp?.records ?? [], `${MARKER}-focus`) != null,
            `records=${JSON.stringify((focusDisp?.records ?? []).map((r) => r.state))}`
        );
        await reporter.shot(client, "05-focus");

        // 2c. 连续 4 次后台发送：每一条都必须拿到 confirmed（派发 worker 不丢消息），
        //     且 pending-input 队列始终为 0（本地块不再经过前端注入）。
        //     旧版比的是「隐藏挂载数 ≤ cap(2) 且最终清理」；那条判据随着前端 paste 链对 create
        //     退役已不可观测，换成「每条都真的提交成功」——更严，不是更松。
        const burstTexts = [0, 1, 2, 3].map((i) => `${MARKER}-burst-${i}`);
        for (const text of burstTexts) {
            const burstOk = await client.evaluate(DIRECT_SEND(text));
            if (burstOk !== true) reporter.log(`burst send ${text} 返回 ${JSON.stringify(burstOk)}`);
        }
        const burstProbe = await waitForProbe(
            client,
            DISPATCH_LIST,
            (res) => {
                if (res?.ok !== true) return false;
                return burstTexts.every((text) => {
                    const rec = findDispatch(res.records, text);
                    return rec != null && rec.state === "confirmed";
                });
            },
            { timeoutMs: 420000, intervalMs: 3000 }
        );
        const burstRecords = burstTexts.map((text) => findDispatch(burstProbe?.records ?? [], text));
        reporter.check(
            "burst-all-confirmed",
            burstRecords.every((rec) => rec != null && rec.state === "confirmed" && (rec.submittedat ?? 0) > 0),
            JSON.stringify(
                burstRecords.map((rec) => ({
                    state: rec?.state ?? "missing",
                    submittedat: rec?.submittedat ?? 0,
                    retries: rec?.submitretries ?? 0,
                    error: rec?.error ?? "",
                }))
            )
        );
        const regBurst = await client.evaluate(PENDING_REGISTRY);
        reporter.check(
            "burst-no-pending-input",
            (regBurst?.inputs ?? 0) === 0 && (regBurst?.tabs ?? 0) === 0,
            JSON.stringify({ inputs: regBurst?.inputs, tabs: regBurst?.tabs, injected: regBurst?.injected })
        );
        const aliveAfterBurst = await client.evaluate(`(() => document.querySelector(".block") != null && innerWidth > 0)()`);
        reporter.check("burst-no-crash", aliveAfterBurst === true, `alive=${aliveAfterBurst}`);
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
            `hidden=${JSON.stringify(postRestart?.hiddenTabs ?? [])} (仅允许既有预挂载 ≤3，pending 状态全内存不重启)`
        );
        await reporter.shot(client, "07-after-restart");

        reporter.finish({
            extra: { marker: MARKER, logPath },
            skipped: [
                "已有 Tab 路径：本台只覆盖「新建 Tab」；已有 Tab 路径与新建走同一 executeCommonTextSend 分支，由单测覆盖",
                "TTL 回退剪贴板（旧 Part 2a）：前端 pending-input 链对 create 路径已退役（改后端 agentsend），本地块已无 UI 入口可驱动；模块本身保留给远端 create fallback，由 pending-input.test.ts 覆盖",
                "隐藏预挂载上限 cap(2) / 崩挂载清理（旧 Part 2d）：同一批退役语义；换成「每条发送都 confirmed」与「pending 队列恒为 0」两条更强断言",
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
