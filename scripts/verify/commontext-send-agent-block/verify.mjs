#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// CommonText Send 目标选择器真机验证（v2：真实指针 + 可见性命中）：
//   1. Send split button（单壳主段 + caret 段 + 分隔线）存在；
//   2. caret 真实指针点击 → popover 渲染，且 elementFromPoint 命中的确实在 popover 内
//      （旧版只断言 DOM 存在 → 弹层被 .modal-wrapper 遮住时仍然假绿）；
//   3. 无 agent block 时聚焦行禁用并显示提示；
//   4. Agents chip 真实点击切换 → 主按钮 hint 跟着变；
//   5. Type 下拉：真实点击触发行 → 二级菜单可见可命中 → 真实点选「新建 Tab」→ 主行回写；
//   6. Folder 下拉：同上，真实点选一个候选目录 → 主行回写「已选」；
//   7. 面板外真实点击 / Escape 都能关；
//   8. 点「发送」→ 弹窗关闭 + 新 agent block 建立 + pending input 在 TUI 就绪后自动注入。
//
//   node scripts/verify/commontext-send-agent-block/verify.mjs            # 干净实例 → 跑 → 自动关
//   node scripts/verify/commontext-send-agent-block/verify.mjs --attach   # 复用已起实例
//   node scripts/verify/commontext-send-agent-block/verify.mjs --keep-open
//   node scripts/verify/commontext-send-agent-block/verify.mjs --dry
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { DEFAULTS, ensureInstance } from "../lib/launch.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep, waitForProbe } from "../lib/probes.mjs";
import { createReporter } from "../lib/report.mjs";

const AREA = "commontext-send-agent-block";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

const reporter = createReporter({ area: AREA, mode: attach ? "attach" : "launch+reset" });
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

async function pressEscape(client) {
  await client.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
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

// 面板内按 title 找可点元素（split button 的引用元素在面板外，这里统一从面板里找）
const RECT_OF_TITLE = (title) => `(() => {
    const p = document.querySelector(${JSON.stringify(POPOVER)});
    if (!p) return "no-popover";
    const b = [...p.querySelectorAll("button")].find((x) => x.getAttribute("title") === ${JSON.stringify(title)});
    if (!b) return "not-found:" + [...p.querySelectorAll("button")].map((x) => x.getAttribute("title")).join("|");
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
})()`;

// 二级菜单里按文本找可点行
const ITEM_POINT = (needle, maxLen = 80) => `(() => {
    const menus = [...document.querySelectorAll(${JSON.stringify(PICKER)})];
    if (menus.length === 0) return "no-picker";
    for (const menu of menus) {
        for (const btn of menu.querySelectorAll("button")) {
            const t = (btn.textContent || "").replace(/\\s+/g, " ").trim();
            if (t.includes(${JSON.stringify(needle)}) && t.length <= ${maxLen}) {
                const r = btn.getBoundingClientRect();
                return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: t };
            }
        }
    }
    return "not-found:" + ${JSON.stringify(needle)};
})()`;

// 可见性命中：断言 elementFromPoint 落点确实在目标容器内
const HIT_IN = (point, selector) => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const hit = document.elementFromPoint(${point.x}, ${point.y});
    const desc = hit ? hit.tagName + "." + (hit.className || "").toString().slice(0, 48) : "null";
    return { exists: el != null, hit: desc, inside: el != null && hit != null && el.contains(hit) };
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

// 面板行选中态（Type/Folder 主行里的徽标文案）
const ROW_BADGES = `(() => {
    const p = document.querySelector(${JSON.stringify(POPOVER)});
    if (!p) return null;
    const rows = [...p.querySelectorAll("button")].filter((b) => b.querySelector(".fa-chevron-down") && b.getAttribute("title"));
    return rows.map((b) => (b.textContent || "").replace(/\\s+/g, " ").trim());
})()`;

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

if (dry) {
  reporter.log("dry-run: 依赖解析成功（未启动 GUI）");
  reporter.check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs");
  reporter.finish({ cleanup: null });
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
  // 2026-11-11 起第一段改为「发送目标：聚焦块 / 新建」显式二选一
  const sections = ["选择目标", "新建", "选择 Agent", "选择 Type", "选择 Folder", "取消", "发送"];
  const missingSections = sections.filter((s) => !(popText ?? "").includes(s));
  reporter.check(
    "popover-sections",
    missingSections.length === 0,
    missingSections.length === 0 ? sections.join(" / ") : `missing: ${missingSections.join(", ")}`
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
  // 无 agent block 的干净实例：聚焦行禁用 + 提示
  reporter.check(
    "non-agent-focused-hint",
    (popText ?? "").includes("当前聚焦块不是 Agent Block"),
    (popText ?? "").includes("当前聚焦块不是 Agent Block") ? "禁用提示已显示" : "未找到禁用提示"
  );
  await reporter.shot(client, "02-popover");

  // 3. Agents chip 真实点击（Codex → Claude Code）→ 主按钮 hint 必须跟着变
  const beforeTitle = sendButton.title;
  // Agents 行是纯 logo chip（无文字），按 data-commontext-agent-chip 定位
  const claudePoint = await client.evaluate(`(() => {
        const b = document.querySelector(${JSON.stringify('[data-commontext-send-popover] [data-commontext-agent-chip="claude"]')});
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
    })()`);
  if (claudePoint != null) await realClick(client, claudePoint);
  const afterTitles = await client.evaluate(SEND_BUTTON_STATE);
  reporter.check(
    "agent-chip-select",
    claudePoint != null && afterTitles?.title?.includes("Claude Code") && afterTitles?.title !== beforeTitle,
    `before="${beforeTitle}" after="${afterTitles?.title ?? ""}"`
  );

  // 4. Type 二级下拉：真实点击触发行 → 菜单可见可命中 → 真实点选「新建 Tab」
  const typeTrigger = await client.evaluate(RECT_OF_TITLE("选择目标 Tab"));
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
  const rowBadges = await client.evaluate(ROW_BADGES);
  reporter.check(
    "type-picker-new-tab",
    pickerCountAfter === 0 && JSON.stringify(rowBadges ?? []).includes("新建"),
    `pickerClosed=${pickerCountAfter === 0} rows=${JSON.stringify(rowBadges ?? [])}`
  );

  // 5. Folder 二级下拉：同上 + 真实点选一个候选目录
  const folderTrigger = await client.evaluate(RECT_OF_TITLE("选择项目目录（cwd）"));
  reporter.check(
    "folder-trigger-found",
    folderTrigger != null && folderTrigger.x != null,
    JSON.stringify(folderTrigger ?? null)
  );
  await realClick(client, folderTrigger);
  const folderMenu = await waitForProbe(
    client,
    PICKER_TEXT,
    (t) => Array.isArray(t) && t.some((line) => line.includes("/") || line.includes(":") || line.includes("~")),
    { timeoutMs: 8000 }
  );
  reporter.check(
    "folder-menu-candidates",
    Array.isArray(folderMenu) && folderMenu.length > 0,
    JSON.stringify(folderMenu ?? [])
  );
  const folderItem = await client.evaluate(`(() => {
        const m = document.querySelector(${JSON.stringify(PICKER)});
        if (!m) return "no-picker";
        const b = [...m.querySelectorAll("button")].find((x) => (x.textContent || "").trim().length > 0);
        if (!b) return "no-item";
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), text: b.textContent.trim() };
    })()`);
  if (folderItem != null && folderItem.x != null) await realClick(client, folderItem);
  const pickerCountAfterFolder = await client.evaluate(PICKER_COUNT);
  const rowBadges2 = await client.evaluate(ROW_BADGES);
  reporter.check(
    "folder-picker-selected",
    pickerCountAfterFolder === 0 && JSON.stringify(rowBadges2 ?? []).includes("已选"),
    `pickerClosed=${pickerCountAfterFolder === 0} rows=${JSON.stringify(rowBadges2 ?? [])} item=${folderItem?.text ?? "(none)"}`
  );

  // 5b. Type 切回当前 tab（后续建块落在 current tab，便于断言注入）
  const typeTrigger2 = await client.evaluate(RECT_OF_TITLE("选择目标 Tab"));
  if (typeTrigger2 != null && typeTrigger2.x != null) await realClick(client, typeTrigger2);
  await waitForProbe(client, PICKER_TEXT, (t) => Array.isArray(t) && t.length > 0, { timeoutMs: 8000 });
  const currentTabPoint = await client.evaluate(`(() => {
        const m = document.querySelector(${JSON.stringify(PICKER)});
        if (!m) return null;
        const b = [...m.querySelectorAll("button")].find((x) => (x.textContent || "").includes("当前"));
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), text: b.textContent.trim() };
    })()`);
  if (currentTabPoint != null && currentTabPoint.x != null) await realClick(client, currentTabPoint);
  const rowBadges3 = await client.evaluate(ROW_BADGES);
  reporter.check(
    "type-back-to-current",
    currentTabPoint != null && JSON.stringify(rowBadges3 ?? []).includes("当前"),
    `item=${currentTabPoint?.text ?? "(none)"} rows=${JSON.stringify(rowBadges3 ?? [])}`
  );

  // 6. 面板外真实点击 → 关闭；重开；Escape → 关闭
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

  const caretPoint2 = await client.evaluate(
    `(() => { const el = document.querySelector("[data-commontext-send-button]"); if (!el) return null; const b = el.querySelectorAll("button")[1]; const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`
  );
  await realClick(client, caretPoint2);
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
  await realClick(client, caretPoint2);
  await waitForProbe(client, POPOVER_TEXT, (t) => typeof t === "string" && t.length > 0, { timeoutMs: 8000 });
  const editorValue = await client.evaluate(SET_EDITOR_TEXT(`请回复这一行：${MARKER}`));
  reporter.check(
    "editor-text-set",
    typeof editorValue === "string" && editorValue.includes(MARKER),
    String(editorValue)
  );

  await client.evaluate(ARM_INJECT_EVENTS);
  const beforeTerm = await client.evaluate(NEW_TERM_PROBE);
  const baselineBlockId = beforeTerm?.blockId ?? "";
  const sendPoint = await client.evaluate(`(() => {
        const p = document.querySelector(${JSON.stringify(POPOVER)});
        if (!p) return null;
        const b = [...p.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "发送");
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
    })()`);
  reporter.check("send-button-point", sendPoint != null, JSON.stringify(sendPoint ?? null));
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

  // 9. pending input 在 TUI 就绪后自动注入
  const injectEvents = await waitForProbe(
    client,
    INJECT_EVENTS,
    (ev) => ev?.injected?.some((detail) => detail.blockId !== baselineBlockId),
    { timeoutMs: 90000, intervalMs: 1000 }
  );
  const injectedHit = injectEvents?.injected?.find((detail) => detail.blockId !== baselineBlockId);
  reporter.check(
    "pending-input-injected",
    injectedHit != null,
    injectedHit != null
      ? `blockId=${injectedHit.blockId} length=${injectedHit.length}`
      : `injected=${JSON.stringify(injectEvents?.injected ?? [])} fallback=${JSON.stringify(injectEvents?.fallback ?? [])}`
  );
  reporter.check(
    "pending-input-no-fallback",
    (injectEvents?.fallback ?? []).length === 0,
    JSON.stringify(injectEvents?.fallback ?? [])
  );
  await reporter.shot(client, "05-injected");

  reporter.finish({
    skipped: [
      "existing（已存在聚焦 agent block 直接注入）路径：干净实例默认无 agent block，未覆盖；由单测 resolveSendTarget 覆盖",
      "远程 connection 目标：本轮为本地-only",
      "TUI 输入框文本回显：不同 CLI 首启提示（claude 目录信任 / codex 升级提示）会吞按键，改为断言 pending-input-injected 事件；由 term.tsx + pending-input 单测共同保证",
      "暗色/单色主题截图：本轮只留亮色证据，主题切换由 theme-monochrome area 覆盖",
    ],
    cleanup: () => {
      client.close?.();
      if (instance?.spawned && !keepOpen) instance.cleanup?.();
    },
  });
} catch (err) {
  reporter.fatal(err, { cleanup: () => instance?.cleanup?.() });
}
