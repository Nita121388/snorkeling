#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// CommonText Send 目标选择器真机验证（v3：命名 Agent + 模型 + 可见路径）：
//   1. Send split button（单壳主段 + caret 段 + 分隔线）存在；
//   2. caret 真实指针点击 → popover 渲染，且 elementFromPoint 命中的确实在 popover 内
//      （旧版只断言 DOM 存在 → 弹层被 .modal-wrapper 遮住时仍然假绿）；
//   3. 无 agent block 时只显示「新建」chip（不再有冗余提示句）；
//   4. Agents chip 真实点击切换 → 主按钮 hint 跟着变；
//   5. Type 下拉：真实点击触发行 → 二级菜单可见可命中 → 真实点选「新建 Tab」→ 主行回写；
//   6. 模型目录真实加载 → 原生 select 键盘选择具体模型 → 强制新建；切 Agent 后回到自动；
//   7. 可见路径列表真实点选 → footer 摘要回写；切到播种 Tab 后候选整体替换并回到默认行；
//   7. 面板外真实点击 / Escape 都能关；
//   8. 点「发送」→ 弹窗关闭 + 新 agent block 建立 + **文本真的送达**（后端 agentsend；
//      2026-11-23 起 create 路径不再走前端 pending-input，事件断言换成端到端送达）；
//   9. 送达证据三件套：派发回执 state=confirmed（submittedat>0）/ TUI xterm buffer 里出现
//      标记串 / waveapp.log 出现 `[agentsend] <blockid> submit confirm … confirmed=true`；
//      反证：`snorkeling:pending-input-injected` 事件一条都不出现（前端 paste 链已退役）。
//
//   node scripts/verify/commontext-send-agent-block/verify.mjs            # 干净实例 → 跑 → 自动关
//   node scripts/verify/commontext-send-agent-block/verify.mjs --attach   # 复用已起实例
//   node scripts/verify/commontext-send-agent-block/verify.mjs --log=<path>  # 覆盖后端日志路径
//   node scripts/verify/commontext-send-agent-block/verify.mjs --keep-open
//   node scripts/verify/commontext-send-agent-block/verify.mjs --dry
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { DEFAULTS, ensureInstance } from "../lib/launch.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep, waitForProbe } from "../lib/probes.mjs";
import { createReporter } from "../lib/report.mjs";

const AREA = "commontext-send-agent-block";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
// 后端日志：本台实例的 WAVETERM_DATA_HOME 被 dev-isolated 重定向到 .runcfg/<profile>/data，
// 不是 %LOCALAPPDATA%\snorkeling。--attach 到别的 profile 时用 --log=<path> 覆盖。
const logArg = argv.find((a) => a.startsWith("--log="));
const logPath =
  logArg != null ? logArg.slice("--log=".length) : path.join(repoRoot, ".runcfg", DEFAULTS.profile, "data", "waveapp.log");

const reporter = createReporter({
  area: AREA,
  mode: attach ? "attach" : "launch+reset",
  meta: { profile: DEFAULTS.profile, cdpPort: DEFAULTS.cdpPort, vitePort: DEFAULTS.vitePort, logPath },
});
let instance = null;

const MARKER = `VERIFY-CSAB-${Date.now()}`;

const POPOVER = "[data-commontext-send-popover]";
const PICKER = "[data-commontext-send-picker]";
const MENU = "[data-split-button-menu]";

// ─────────── 真实指针 ───────────
// 合成 element.click() 会绕过命中测试：弹层被别的层叠上下文盖住时照样"点得到"，
// 这正是昨晚 14/14 假绿的来源。这里一律走 Input.dispatchMouseEvent。
async function realClick(client, pt) {
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y, button: "none", buttons: 0 });
  await sleep(80);
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: pt.x,
    y: pt.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await sleep(60);
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: pt.x,
    y: pt.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  await sleep(450);
}

async function pressKey(client, key, code, windowsVirtualKeyCode) {
  await client.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code,
    windowsVirtualKeyCode,
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode,
  });
  await sleep(180);
}

async function pressEscape(client) {
  await pressKey(client, "Escape", "Escape", 27);
  await sleep(350);
}

// ─────────── 探针 ───────────
const OPEN_MODAL = `(() => {
    window.dispatchEvent(new CustomEvent("snorkeling:common-text:open-search", { detail: {} }));
    return true;
})()`;

const SEND_BUTTON_STATE = `(() => {
    const el = document.querySelector("[data-commontext-send-button]");
    if (!el) return null;
    const buttons = [...el.querySelectorAll("button")];
    const shell = el.querySelector(".wave-split-button");
    return {
        count: buttons.length,
        title: buttons[0]?.getAttribute("title") ?? "",
        hasShell: shell != null,
        divider: shell?.querySelector(".wave-split-button__divider") != null,
        expanded: buttons[1]?.getAttribute("aria-expanded") ?? "",
    };
})()`;

const RECT_OF = (selector) => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
})()`;

const HIT_IN = (point, selector) => `(() => {
    const pt = ${JSON.stringify(point)};
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el || !pt || pt.x == null || pt.y == null) return { inside: false, hit: null };
    const hit = document.elementFromPoint(pt.x, pt.y);
    return { inside: hit === el || el.contains(hit), hit: hit ? (hit.getAttribute("data-commontext-path-row") || hit.className || hit.tagName) : null };
})()`;

const ITEM_POINT = (text, _minLength = 20) => `(() => {
    const menu = document.querySelector(${JSON.stringify(PICKER)});
    if (!menu) return null;
    const wanted = ${JSON.stringify(text)};
    const item = [...menu.querySelectorAll("button")].find((b) => (b.textContent || "").includes(wanted));
    if (!item) return null;
    const r = item.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: (item.textContent || "").trim() };
})()`;

const MODEL_STATE = `(() => {
    const p = document.querySelector(${JSON.stringify(POPOVER)});
    const control = p?.querySelector("[data-commontext-model-select]");
    if (!control) return null;
    const submit = p.querySelector("[data-commontext-send-submit]");
    return {
        kind: control.tagName.toLowerCase(),
        value: control.value ?? "",
        options: [...control.querySelectorAll("option")].map((o) => o.value),
        submit: (submit?.textContent || "").replace(/\\s+/g, " ").trim(),
        createSelected: p.querySelector("[data-commontext-send-mode=create]")?.getAttribute("aria-pressed") === "true",
    };
})()`;

const PATH_STATE = `(() => {
    const p = document.querySelector(${JSON.stringify(POPOVER)});
    const list = p?.querySelector("[data-commontext-path-list]");
    if (!list) return null;
    const rows = [...list.querySelectorAll("[data-commontext-path-row]")];
    const selected = rows.find((row) => row.getAttribute("aria-selected") === "true");
    return {
        paths: rows.map((row) => row.getAttribute("data-commontext-path-row")),
        selected: selected?.getAttribute("data-commontext-path-row") ?? "",
        defaultText: rows[0]?.textContent?.includes("默认") ?? false,
        footer: (p.querySelector("[data-commontext-send-footer]")?.textContent || "").replace(/\\s+/g, " ").trim(),
        browse: [...p.querySelectorAll("button")].some((b) => (b.textContent || "").includes("浏览其他目录")),
    };
})()`;

const PANEL_LAYOUT = `(() => {
    const p = document.querySelector(${JSON.stringify(POPOVER)});
    const menu = document.querySelector(${JSON.stringify(MENU)});
    const list = p?.querySelector("[data-commontext-path-list]");
    const header = p?.firstElementChild;
    const footer = p?.querySelector("[data-commontext-send-footer]");
    if (!p || !menu || !list || !header || !footer) return null;
    const pr = p.getBoundingClientRect();
    const mr = menu.getBoundingClientRect();
    const hr = header.getBoundingClientRect();
    const fr = footer.getBoundingClientRect();
    const lr = list.getBoundingClientRect();
    const ls = getComputedStyle(list);
    return {
        menuHeight: Math.round(mr.height),
        panelHeight: Math.round(pr.height),
        panelWidth: Math.round(pr.width),
        panelScrollWidth: p.scrollWidth,
        panelClientWidth: p.clientWidth,
        panelScrollHeight: p.scrollHeight,
        panelClientHeight: p.clientHeight,
        menuRect: [Math.round(mr.left), Math.round(mr.top), Math.round(mr.right), Math.round(mr.bottom)],
        headerTop: Math.round(hr.top),
        headerBottom: Math.round(hr.bottom),
        footerTop: Math.round(fr.top),
        footerBottom: Math.round(fr.bottom),
        panelTop: Math.round(pr.top),
        panelBottom: Math.round(pr.bottom),
        listHeight: Math.round(lr.height),
        listClientHeight: list.clientHeight,
        listScrollHeight: list.scrollHeight,
        overflowY: ls.overflowY,
        overflowX: ls.overflowX,
        overscrollY: ls.overscrollBehaviorY,
        pathRows: list.querySelectorAll("[data-commontext-path-row]").length,
        modelRows: p.querySelectorAll("[data-commontext-model-row]").length,
        targetCards: p.querySelectorAll("[data-commontext-send-target-card]").length,
        folderTriggers: p.querySelectorAll("[data-commontext-dir-trigger]").length,
    };
})()`;

const POPOVER_TEXT = `(() => {
    const p = document.querySelector(${JSON.stringify(POPOVER)});
    if (!p) return null;
    return p.textContent.replace(/\\s+/g, " ").trim();
})()`;

const PICKER_TEXT = `(() => {
    const menus = [...document.querySelectorAll(${JSON.stringify(PICKER)})];
    return menus.map((m) => (m.textContent || "").replace(/\\s+/g, " ").trim());
})()`;

const PICKER_COUNT = `document.querySelectorAll(${JSON.stringify(PICKER)}).length`;

const SET_EDITOR_TEXT = (text) => `(() => {
    const ta = document.querySelector("[data-commontext-composer]");
    if (!ta) return "no-editor";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return ta.value;
})()`;

const NEW_TERM_PROBE = `(() => {
    const tw = window.term;
    if (!tw) return null;
    return { blockId: tw.blockId ?? "" };
})()`;

// pending input 注入的可观测信号：term.tsx 在注入成功时派发 snorkeling:pending-input-injected。
const ARM_INJECT_EVENTS = `(() => {
    window.__csabInjected = [];
    window.addEventListener("snorkeling:pending-input-injected", (e) => {
        window.__csabInjected.push(e.detail ?? {});
    });
    window.__csabFallback = [];
    window.addEventListener("snorkeling:pending-input-fallback", (e) => {
        window.__csabFallback.push(e.detail ?? {});
    });
    return true;
})()`;

const INJECT_EVENTS = `(() => ({
    injected: window.__csabInjected ?? [],
    fallback: window.__csabFallback ?? [],
}))()`;

const setThemeProbe = (theme) => `(async () => {
    const { RpcApi } = await import("/frontend/app/store/wshclientapi.ts");
    const { TabRpcClient } = await import("/frontend/app/store/wshrpcutil.ts");
    await RpcApi.SetConfigCommand(TabRpcClient, { "app:theme": ${JSON.stringify(theme)} });
    return true;
})()`;

// 为 Tab 联动播种一个独立 cwd：不激活该 Tab，避免 CommonText 所在 renderer 被切走。
const seedTabProbe = (cwd) => `(async () => {
    const __vimp = async (url, required) => {
        let lastErr = null;
        for (let i = 0; i < 12; i++) {
            try {
                const m = await import(url);
                if (required.every((k) => m && m[k] != null)) return m;
                lastErr = new Error(url + " exports missing");
            } catch (err) {
                lastErr = err;
            }
            await new Promise((r) => setTimeout(r, 250));
        }
        throw lastErr;
    };
    try {
        const g = await __vimp("/frontend/app/store/global.ts", ["atoms", "globalStore"]);
        const services = await __vimp("/frontend/app/store/services.ts", ["WorkspaceService", "ObjectService"]);
        const ws = g.globalStore.get(g.atoms.workspace);
        if (!ws?.oid) throw new Error("workspace unavailable");
        const name = "verify-ct-path-" + Date.now().toString(36);
        const tabId = await services.WorkspaceService.CreateEmptyTab(ws.oid, name, false);
        await services.ObjectService.CreateBlockInTab(
            tabId,
            { meta: { view: "term", "frame:title": "CommonText path fixture", "cmd:cwd": ${JSON.stringify(cwd)} } },
            { termsize: { rows: 25, cols: 80 } },
            false,
            false
        );
        return { ok: true, tabId, name, cwd: ${JSON.stringify(cwd)} };
    } catch (err) {
        return { ok: false, error: String(err?.message ?? err) };
    }
})()`;

const cleanupSeedTabProbe = (tabId) => `(async () => {
    try {
        const g = await import("/frontend/app/store/global.ts");
        const services = await import("/frontend/app/store/services.ts");
        const ws = g.globalStore.get(g.atoms.workspace);
        if (ws?.oid) await services.WorkspaceService.CloseTab(ws.oid, ${JSON.stringify(tabId)}, false);
        return true;
    } catch {
        return false;
    }
})()`;

// 送达证据（替代旧的 injected 事件断言）：
//   1) 派发回执（后端状态机）：AgentDispatchListCommand 里有我们这条文本的记录，state=confirmed；
//   2) TUI 真实回显：window.term.getScrollbackContent() 里出现标记串；
//   3) 后端日志：waveapp.log 里该块出现 submit confirm confirmed=true。
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

const TERM_TAIL = `(() => {
    try {
        const text = window.term?.getScrollbackContent?.() ?? "";
        return text.length > 8000 ? text.slice(-8000) : text;
    } catch (e) {
        return "";
    }
})()`;

const decodeText64 = (text64) => {
  try {
    return Buffer.from(String(text64 ?? ""), "base64").toString("utf8");
  } catch {
    return "";
  }
};

const findDispatch = (records, marker) =>
  (records ?? []).find((rec) => decodeText64(rec?.text64).includes(marker)) ?? null;

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

if (dry) {
  reporter.log(`dry-run: 依赖解析成功（未启动 GUI）；日志路径 ${logPath}`);
  reporter.check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs");
  reporter.check("log-path-resolved", logPath.endsWith("waveapp.log"), logPath);
  // dry 只解析依赖，不进台账（台账记的是「真验过一次」）。
  reporter.finish({ cleanup: null, ledger: false });
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

  const previousTheme = await client.evaluate(`document.documentElement.dataset.theme || "dark"`);
  await client.evaluate(setThemeProbe("dark"));
  const darkTheme = await waitForProbe(client, `document.documentElement.dataset.theme`, (theme) => theme === "dark", {
    timeoutMs: 8000,
  });
  reporter.check("dark-theme-active", darkTheme === "dark", String(darkTheme));

  const seedCwd = path.join(repoRoot, ".runcfg", "verify-commontext-send-path");
  const seededTab = await client.evaluate(seedTabProbe(seedCwd));
  reporter.check("tab-linkage-fixture", seededTab?.ok === true, JSON.stringify(seededTab ?? {}));

  // 1. 打开 CommonText 弹窗，确认 split button 是「单壳两段」
  await client.evaluate(OPEN_MODAL);
  const sendButton = await waitForProbe(client, SEND_BUTTON_STATE, (s) => s != null && s.count === 2, {
    timeoutMs: 20000,
  });
  reporter.check(
    "send-split-button",
    sendButton != null && sendButton.count === 2 && sendButton.hasShell === true,
    JSON.stringify(sendButton)
  );
  reporter.check("send-splitbutton-divider", sendButton?.divider === true, `divider=${sendButton?.divider}`);
  await reporter.shot(client, "01-send-button");

  // 2. caret 真实指针点击 → popover 渲染且真实可见（命中测试）
  const caretPoint = await client.evaluate(
    `(() => { const el = document.querySelector("[data-commontext-send-button]"); if (!el) return null; const b = el.querySelectorAll("button")[1]; const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`
  );
  reporter.check("caret-point", caretPoint != null, JSON.stringify(caretPoint ?? null));
  await realClick(client, caretPoint);
  const popText = await waitForProbe(client, POPOVER_TEXT, (t) => typeof t === "string" && t.length > 0, {
    timeoutMs: 10000,
  });
  // 新信息架构：标题 / Agent / 模型 / Tab / 路径 / 后台执行 / 取消全部常显。
  const sections = ["发送目标", "新建", "Agent", "模型", "Tab", "取消"];
  const missingSections = sections.filter((s) => !(popText ?? "").includes(s));
  reporter.check(
    "popover-sections",
    missingSections.length === 0,
    missingSections.length === 0 ? sections.join(" / ") : `missing: ${missingSections.join(", ")}`
  );

  const panelLayout = await client.evaluate(PANEL_LAYOUT);
  reporter.check(
    "panel-model-path-dom",
    panelLayout != null && panelLayout.modelRows === 1 && panelLayout.pathRows >= 2,
    JSON.stringify(panelLayout ?? {})
  );
  reporter.check(
    "panel-old-controls-removed",
    panelLayout?.targetCards === 0 && panelLayout?.folderTriggers === 0,
    `targetCards=${panelLayout?.targetCards ?? "null"} folderTriggers=${panelLayout?.folderTriggers ?? "null"}`
  );

  // 冗余文字验收：UI 已表达的信息不再加描述句。
  const redundant = ["二选一", "默认 =", "目录候选来自", "不跳转", "目标 =", "均跟随聚焦块"].filter((w) =>
    (popText ?? "").includes(w)
  );
  reporter.check(
    "panel-no-redundant-text",
    redundant.length === 0,
    redundant.length === 0 ? "无冗余描述句" : `redundant: ${redundant.join(" / ")}`
  );

  // 新高度预算：menu ≤560px（根节点 max-height 552px + 8px padding/border）。
  reporter.check(
    "panel-height",
    panelLayout != null && panelLayout.menuHeight <= 560 && panelLayout.panelHeight <= 552,
    `menuHeight=${panelLayout?.menuHeight ?? "null"}px panelHeight=${panelLayout?.panelHeight ?? "null"}px`
  );
  reporter.check(
    "panel-fixed-header-footer",
    panelLayout != null &&
      panelLayout.headerTop >= panelLayout.panelTop &&
      panelLayout.footerBottom <= panelLayout.panelBottom &&
      panelLayout.footerTop > panelLayout.headerBottom &&
      panelLayout.panelScrollHeight <= panelLayout.panelClientHeight,
    JSON.stringify(panelLayout ?? {})
  );
  reporter.check(
    "path-list-internal-scroll",
    panelLayout?.overflowY === "auto" &&
      panelLayout?.overflowX === "hidden" &&
      panelLayout?.overscrollY === "contain" &&
      panelLayout?.listHeight <= 150,
    JSON.stringify(panelLayout ?? {})
  );
  // 目标模式行（聚焦块 / 新建 二选一）：干净实例无聚焦 agent block → 只有「新建」可选且为选中态
  const modeRows = await client.evaluate(`(() => {
        const p = document.querySelector(${JSON.stringify("[data-commontext-send-popover]")});
        if (!p) return null;
        return [...p.querySelectorAll("[data-commontext-send-mode]")].map((b) => ({
            mode: b.getAttribute("data-commontext-send-mode"),
            pressed: b.getAttribute("aria-pressed"),
            text: (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24),
        }));
    })()`);
  const createRow = (modeRows ?? []).find((r) => r.mode === "create");
  reporter.check(
    "send-target-mode-rows",
    createRow != null && createRow.pressed === "true",
    JSON.stringify(modeRows ?? [])
  );

  // 可见性：popover 中心点必须真的落在 popover 内（被 modal 盖住时这里必红）
  const popRect = await client.evaluate(RECT_OF(MENU));
  const popHit = await client.evaluate(HIT_IN(popRect, MENU));
  reporter.check(
    "popover-visible-above-modal",
    popHit?.inside === true,
    `menu=${JSON.stringify(popRect?.rect ?? null)} hit=${popHit?.hit} inside=${popHit?.inside}`
  );
  // 无 agent block 的干净实例：只有「新建」chip（旧版多出的「当前聚焦块不是 Agent Block」提示已按无冗余文字原则删除）
  reporter.check(
    "non-agent-focused-no-hint",
    !(popText ?? "").includes("当前聚焦块不是 Agent Block"),
    "无聚焦块时不显示多余提示，仅隐藏「聚焦块」chip"
  );
  await reporter.shot(client, "02-popover");

  // 3. 命名 Agent chip 真实点击（Codex → Claude Code）→ 主按钮 hint 必须跟着变。
  const beforeTitle = sendButton.title;
  const claudePoint = await client.evaluate(`(() => {
        const b = document.querySelector(${JSON.stringify('[data-commontext-send-popover] [data-commontext-agent-chip="claude"]')});
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), text: (b.textContent || "").trim(), height: Math.round(r.height) };
    })()`);
  if (claudePoint != null) await realClick(client, claudePoint);
  const afterTitles = await client.evaluate(SEND_BUTTON_STATE);
  reporter.check(
    "agent-chip-select",
    claudePoint != null &&
      claudePoint.text.includes("Claude Code") &&
      claudePoint.height === 30 &&
      afterTitles?.title?.includes("Claude Code") &&
      afterTitles?.title !== beforeTitle,
    `before="${beforeTitle}" after="${afterTitles?.title ?? ""}" chip=${JSON.stringify(claudePoint ?? {})}`
  );

  // 3b. 模型目录与 New Agent 同源；真实点击原生 select + 键盘选择具体模型。
  const claudeModel = await waitForProbe(
    client,
    MODEL_STATE,
    (state) => state?.kind === "select" && state.options.length > 1 && state.value === "",
    { timeoutMs: 15000 }
  );
  reporter.check(
    "model-catalog-select",
    claudeModel?.kind === "select" && claudeModel.options.length > 1,
    JSON.stringify(claudeModel ?? {})
  );
  const modelPoint = await client.evaluate(RECT_OF("[data-commontext-model-select]"));
  if (modelPoint != null) await realClick(client, modelPoint);
  await pressKey(client, "ArrowDown", "ArrowDown", 40);
  await pressKey(client, "Enter", "Enter", 13);
  const chosenModel = await waitForProbe(
    client,
    MODEL_STATE,
    (state) => state?.value !== "" && state.createSelected === true && state.submit.includes("新建并发送"),
    { timeoutMs: 8000 }
  );
  reporter.check(
    "model-choice-forces-create",
    chosenModel != null && chosenModel.value !== "" && chosenModel.createSelected === true,
    JSON.stringify(chosenModel ?? {})
  );

  // 3c. 切回 Codex 必须清空模型，避免把 Claude 模型 ID 带给新 profile。
  const codexPoint = await client.evaluate(RECT_OF('[data-commontext-send-popover] [data-commontext-agent-chip="codex"]'));
  if (codexPoint != null) await realClick(client, codexPoint);
  const resetModel = await waitForProbe(client, MODEL_STATE, (state) => state?.value === "", { timeoutMs: 8000 });
  reporter.check(
    "agent-switch-resets-model",
    resetModel?.value === "" &&
      JSON.stringify(resetModel.options) !== JSON.stringify(chosenModel?.options ?? []),
    `before=${JSON.stringify(chosenModel?.options ?? [])} after=${JSON.stringify(resetModel?.options ?? [])}`
  );

  // 4. Type 二级下拉：真实点击触发行 → 菜单可见可命中 → 真实点选「新建 Tab」
  const typeTrigger = await client.evaluate(RECT_OF("[data-commontext-tab-trigger]"));
  reporter.check(
    "type-trigger-found",
    typeTrigger != null && typeTrigger.x != null,
    JSON.stringify(typeTrigger ?? null)
  );
  await realClick(client, typeTrigger);
  const pickerText = await waitForProbe(client, PICKER_TEXT, (t) => Array.isArray(t) && t.length > 0, {
    timeoutMs: 8000,
  });
  reporter.check(
    "type-menu-open",
    Array.isArray(pickerText) && pickerText.some((t) => t.includes("新建 Tab")),
    JSON.stringify(pickerText ?? [])
  );
  const pickerRect = await client.evaluate(RECT_OF(PICKER));
  const pickerHit = await client.evaluate(HIT_IN(pickerRect, PICKER));
  reporter.check(
    "type-menu-visible",
    pickerHit?.inside === true,
    `picker=${JSON.stringify(pickerRect?.rect ?? null)} hit=${pickerHit?.hit} inside=${pickerHit?.inside}`
  );
  await reporter.shot(client, "03-picker-open");

  const newTabPoint = await client.evaluate(ITEM_POINT("新建 Tab", 40));
  reporter.check(
    "type-menu-item-point",
    newTabPoint != null && newTabPoint.x != null,
    JSON.stringify(newTabPoint ?? null)
  );
  if (newTabPoint != null && newTabPoint.x != null) await realClick(client, newTabPoint);
  const pickerCountAfter = await client.evaluate(PICKER_COUNT);
  const tabTriggerText = await client.evaluate(
    `(document.querySelector("[data-commontext-tab-trigger]")?.textContent || "").replace(/\\s+/g, " ").trim()`
  );
  reporter.check(
    "type-picker-new-tab",
    pickerCountAfter === 0 && tabTriggerText.includes("将创建"),
    `pickerClosed=${pickerCountAfter === 0} tab=${tabTriggerText}`
  );

  // 5. 可见路径列表：无需打开下拉，默认第一行 + 浏览入口常显。
  const initialPaths = await client.evaluate(PATH_STATE);
  reporter.check(
    "path-list-visible-default",
    initialPaths != null &&
      initialPaths.paths.length >= 2 &&
      initialPaths.selected === initialPaths.paths[0] &&
      initialPaths.defaultText === true &&
      initialPaths.browse === true,
    JSON.stringify(initialPaths ?? {})
  );

  // 5b. 切到播种 Tab：路径候选必须整体替换，默认行随 Tab 更新。
  await realClick(client, await client.evaluate(RECT_OF("[data-commontext-tab-trigger]")));
  await waitForProbe(client, PICKER_TEXT, (t) => Array.isArray(t) && t.length > 0, { timeoutMs: 8000 });
  const seededTabPoint = await client.evaluate(ITEM_POINT(seededTab.name, 40));
  reporter.check("seeded-tab-menu-point", seededTabPoint != null, JSON.stringify(seededTabPoint ?? {}));
  if (seededTabPoint != null) await realClick(client, seededTabPoint);
  const seededCwdValue = seedCwd.replace(/\\/g, "/");
  const seededPaths = await waitForProbe(
    client,
    PATH_STATE,
    (state) => state?.paths.includes(seededCwdValue) && state.selected === seededCwdValue,
    { timeoutMs: 8000 }
  );
  reporter.check(
    "tab-change-replaces-path-candidates",
    seededPaths != null &&
      JSON.stringify(seededPaths.paths) !== JSON.stringify(initialPaths.paths) &&
      seededPaths.selected === seededCwdValue &&
      seededPaths.defaultText === true,
    `before=${JSON.stringify(initialPaths?.paths ?? [])} after=${JSON.stringify(seededPaths?.paths ?? [])}`
  );

  // 5c. 真实点击第二条路径 → 显式选择 + footer 单一落点摘要更新。
  const secondPathPoint = await client.evaluate(`(() => {
        const rows = [...document.querySelectorAll("[data-commontext-path-row]")];
        const row = rows[1];
        if (!row) return null;
        const r = row.getBoundingClientRect();
        return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), path: row.getAttribute("data-commontext-path-row") };
    })()`);
  if (secondPathPoint != null) await realClick(client, secondPathPoint);
  const chosenPath = await waitForProbe(
    client,
    PATH_STATE,
    (state) => state?.selected !== "" && state.selected !== seededCwdValue && state.footer.includes(state.selected),
    { timeoutMs: 8000 }
  );
  reporter.check(
    "path-row-explicit-selection",
    chosenPath != null && chosenPath.selected === secondPathPoint?.path,
    JSON.stringify(chosenPath ?? {})
  );
  await reporter.shot(client, "04-model-path-selected");

  // 5d. 切回当前 Tab：候选恢复、folder 重置为默认推荐行（后续建块也落在 current tab）。
  await realClick(client, await client.evaluate(RECT_OF("[data-commontext-tab-trigger]")));
  await waitForProbe(client, PICKER_TEXT, (t) => Array.isArray(t) && t.length > 0, { timeoutMs: 8000 });
  const currentTabPoint = await client.evaluate(ITEM_POINT("当前", 20));
  if (currentTabPoint != null) await realClick(client, currentTabPoint);
  const resetPaths = await waitForProbe(
    client,
    PATH_STATE,
    (state) =>
      state?.paths.length > 0 &&
      !state.paths.includes(seededCwdValue) &&
      state.selected === state.paths[0] &&
      state.defaultText === true,
    { timeoutMs: 8000 }
  );
  reporter.check(
    "tab-back-resets-default-path",
    resetPaths != null && resetPaths.selected === resetPaths.paths[0],
    JSON.stringify(resetPaths ?? {})
  );

  // 6. 窄视口：390×844 下弹层不出屏、无横向溢出，header/footer 仍完整。
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(350);
  const narrowLayout = await client.evaluate(PANEL_LAYOUT);
  reporter.check(
    "narrow-viewport-no-overflow",
    narrowLayout != null &&
      narrowLayout.menuRect[0] >= -1 &&
      narrowLayout.menuRect[2] <= 391 &&
      narrowLayout.panelScrollWidth <= narrowLayout.panelClientWidth + 1 &&
      narrowLayout.headerTop >= narrowLayout.panelTop &&
      narrowLayout.footerBottom <= narrowLayout.panelBottom,
    JSON.stringify(narrowLayout ?? {})
  );
  await reporter.shot(client, "05-narrow-viewport");
  await client.send("Emulation.clearDeviceMetricsOverride");
  await sleep(350);

  // 7. 面板外真实点击 → 关闭；重开；Escape → 关闭
  // 取点规则：必须在 **弹窗内部**（否则点到 .modal-backdrop 会把整个弹窗关掉）、
  // 且在面板契约之外（编辑器 textarea 在工具栏上方，不会与面板重叠）。
  const outsidePoint = await client.evaluate(`(() => {
        const ta = document.querySelector("[data-commontext-composer]");
        if (!ta) return null;
        const r = ta.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
  reporter.check("outside-point", outsidePoint != null, JSON.stringify(outsidePoint ?? null));
  if (outsidePoint != null) await realClick(client, outsidePoint);
  const closedByOutside = await waitForProbe(
    client,
    `document.querySelector(${JSON.stringify(POPOVER)}) == null`,
    (closed) => closed === true,
    { timeoutMs: 6000 }
  );
  reporter.check("close-on-outside-click", closedByOutside === true, String(closedByOutside));

  const caretPointFn = () =>
    client.evaluate(
      `(() => { const el = document.querySelector("[data-commontext-send-button]"); if (!el) return null; const b = el.querySelectorAll("button")[1]; const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`
    );
  await realClick(client, await caretPointFn());
  await waitForProbe(client, POPOVER_TEXT, (t) => typeof t === "string" && t.length > 0, { timeoutMs: 8000 });
  await pressEscape(client);
  const closedByEsc = await waitForProbe(
    client,
    `document.querySelector(${JSON.stringify(POPOVER)}) == null`,
    (closed) => closed === true,
    { timeoutMs: 6000 }
  );
  reporter.check("close-on-escape", closedByEsc === true, String(closedByEsc));

  // 7. 写入发送文本并真实点击「发送」→ 弹窗关闭 + 新块出现
  // 编辑器折叠（600ms）会移动工具栏，坐标必须重取
  await realClick(client, await caretPointFn());
  const readyForSend = await waitForProbe(client, POPOVER_TEXT, (t) => typeof t === "string" && t.length > 0, {
    timeoutMs: 8000,
  });
  if (readyForSend == null) {
    await realClick(client, await caretPointFn());
    await waitForProbe(client, POPOVER_TEXT, (t) => typeof t === "string" && t.length > 0, { timeoutMs: 8000 });
  }
  const editorValue = await client.evaluate(SET_EDITOR_TEXT(`请回复这一行：${MARKER}`));
  reporter.check(
    "editor-text-set",
    typeof editorValue === "string" && editorValue.includes(MARKER),
    String(editorValue)
  );

  await client.evaluate(ARM_INJECT_EVENTS);
  const preSendLogOffset = logSize();
  const beforeTerm = await client.evaluate(NEW_TERM_PROBE);
  const baselineBlockId = beforeTerm?.blockId ?? "";
  const sendPoint = await client.evaluate(`(() => {
        const p = document.querySelector(${JSON.stringify(POPOVER)});
        if (!p) return null;
        const b = p.querySelector("[data-commontext-send-submit]");
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
    })()`);
  // 断言细节要带数字：失败时给出「popover 是否在 + 按钮清单 + caret 坐标」三件套，别只报 null。
  const sendPointDebug = await client.evaluate(`(() => {
        const p = document.querySelector(${JSON.stringify(POPOVER)});
        const el = document.querySelector("[data-commontext-send-button]");
        const caret = el?.querySelectorAll("button")[1];
        const cr = caret?.getBoundingClientRect();
        return {
            popover: p != null,
            popoverButtons: p ? [...p.querySelectorAll("button")].map((b) => (b.textContent || "").trim().slice(0, 16)) : [],
            caretRect: cr ? [Math.round(cr.left), Math.round(cr.top), Math.round(cr.width), Math.round(cr.height)] : null,
            editorFocused: document.activeElement?.getAttribute("data-commontext-composer") != null,
        };
    })()`);
  reporter.check(
    "send-button-point",
    sendPoint != null,
    `point=${JSON.stringify(sendPoint ?? null)} debug=${JSON.stringify(sendPointDebug)}`
  );
  if (sendPoint != null) await realClick(client, sendPoint);
  const modalClosed = await waitForProbe(
    client,
    `document.querySelector(${JSON.stringify(POPOVER)}) == null && document.querySelector("[data-commontext-send-button]") == null`,
    (closed) => closed === true,
    { timeoutMs: 20000 }
  );
  reporter.check("send-closes-modal", modalClosed === true, String(modalClosed));
  await reporter.shot(client, "04-after-send");

  // 8. 新 term 块建立（window.term.blockId 变化）
  const newTerm = await waitForProbe(
    client,
    NEW_TERM_PROBE,
    (probe) => probe != null && probe.blockId !== "" && probe.blockId !== baselineBlockId,
    { timeoutMs: 30000, intervalMs: 500 }
  );
  reporter.check(
    "new-agent-block-created",
    newTerm != null && newTerm.blockId !== "" && newTerm.blockId !== baselineBlockId,
    `baseline=${baselineBlockId} new=${newTerm?.blockId ?? "(none)"}`
  );
  const newBlockId = newTerm?.blockId ?? "";

  // 9. 文本真的送达（2026-11-23 起 create 路径走后端 agentsend：就绪门 + paste + 回车 +
  //    confirmSubmit）。旧的 `snorkeling:pending-input-injected` 事件断言已失效——前端 paste
  //    链对这一路彻底退役，所以换成更强的端到端证据：派发回执 confirmed + TUI 回显 + 后端日志；
  //    同时把旧事件保留为**反证**（一条都不该出现）。
  // 后端日志基线在发送前采样（preSendLogOffset）。
  const dispatchProbe = await waitForProbe(
    client,
    DISPATCH_LIST,
    (res) => {
      if (res?.ok !== true) return false;
      const rec = findDispatch(res.records, MARKER);
      return rec != null && rec.state === "confirmed";
    },
    { timeoutMs: 240000, intervalMs: 2000 }
  );
  const dispatchRecord = findDispatch(dispatchProbe?.records ?? [], MARKER);
  reporter.check(
    "send-dispatch-confirmed",
    dispatchRecord != null && dispatchRecord.state === "confirmed" && (dispatchRecord.submittedat ?? 0) > 0 && !dispatchRecord.error,
    JSON.stringify({
      dispatchid: dispatchRecord?.dispatchid ?? "",
      blockid: dispatchRecord?.blockid ?? "",
      state: dispatchRecord?.state ?? "",
      submittedat: dispatchRecord?.submittedat ?? 0,
      submitretries: dispatchRecord?.submitretries ?? 0,
      error: dispatchRecord?.error ?? "",
      listError: dispatchProbe?.error ?? "",
    })
  );
  reporter.check(
    "send-dispatch-targets-new-block",
    dispatchRecord != null && dispatchRecord.blockid === newBlockId,
    `recordBlock=${dispatchRecord?.blockid ?? ""} newBlock=${newBlockId}`
  );

  const termTail = await waitForProbe(client, TERM_TAIL, (text) => String(text ?? "").includes(MARKER), {
    timeoutMs: 240000,
    intervalMs: 2000,
  });
  reporter.check(
    "send-text-visible-in-tui",
    String(termTail ?? "").includes(MARKER),
    `markerHits=${String(termTail ?? "").split(MARKER).length - 1} tailLen=${String(termTail ?? "").length}`
  );
  await reporter.shot(client, "06-delivered");

  // 反证：前端 pending-input 链一条事件都不该出现（修复前这里是主判据）。
  const pendingEvents = await client.evaluate(INJECT_EVENTS);
  reporter.check(
    "pending-input-chain-not-used",
    (pendingEvents?.injected ?? []).length === 0 && (pendingEvents?.fallback ?? []).length === 0,
    `injected=${JSON.stringify(pendingEvents?.injected ?? [])} fallback=${JSON.stringify(pendingEvents?.fallback ?? [])}`
  );

  // 后端日志：本次修复的核心证据（create 路径此前根本不经过后端，[agentsend] 0 条）。
  const logSegment = readLogTail(preSendLogOffset);
  reporter.check("agentsend-log-readable", logSegment.length > 0, `${logPath}（新写入 ${logSegment.length} 字节）`);
  reporter.check(
    "agentsend-log-injected",
    newBlockId !== "" && new RegExp(`\\[agentsend\\] ${newBlockId} injected \\d+ bytes`).test(logSegment),
    `block=${newBlockId}`
  );
  const submitLine = newBlockId === ""
    ? null
    : new RegExp(`\\[agentsend\\] ${newBlockId} submit confirm retries=(\\d+) confirmed=(\\w+)`).exec(logSegment);
  reporter.check(
    "agentsend-log-submit-confirmed",
    submitLine != null && submitLine[2] === "true",
    submitLine != null ? submitLine[0] : `no submit confirm line for block ${newBlockId}`
  );

  if (seededTab?.ok === true) {
    const seedCleaned = await client.evaluate(cleanupSeedTabProbe(seededTab.tabId));
    reporter.check("tab-linkage-fixture-cleanup", seedCleaned === true, String(seedCleaned));
  }
  await client.evaluate(setThemeProbe(previousTheme)).catch(() => {});

  reporter.finish({
    skipped: [
      "existing（已存在聚焦 agent block 直接注入）路径：干净实例默认无 agent block，未覆盖；由单测 resolveSendTarget 覆盖",
      "远程 connection 目标：本轮为本地-only",
      "agent 回复内容：本台只断言「文本真的进了 TUI + 派发回执 confirmed + 后端日志提交确认」；回复正文由 commontext-create-send 台断言（需要独立 profile 与更长预算）",
      "暗色主题：本轮全部交互与布局断言均在深色主题完成；浅色/单色由 theme-monochrome area 覆盖",
    ],
    cleanup: () => {
      client.close?.();
      if (instance?.spawned && !keepOpen) instance.cleanup?.();
    },
  });
} catch (err) {
  reporter.fatal(err, { cleanup: () => instance?.cleanup?.() });
}
