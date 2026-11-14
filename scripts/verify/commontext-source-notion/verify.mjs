#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// CommonText 来源筛选 + Notion 式详情 —— 真机 CDP 验证（全自动，无人值守）。
//
// 为什么单独开一个 area 而不是塞进 commontext-meta-sort：那个台子钉的是「列表元信息列 /
// 排序 / 搜索相关度」，本台钉的是「来源筛选（创建者 + 设备）与 Notion 页面头」。两者的
// 夹具（要不要预置带 origin 的条目）和失败含义都不同，混在一起会让红灯指不清是哪一层。
//
// 覆盖的判据（都只有真实布局 + 真实指针才说得清）：
//   1. 来源筛选行存在，三档计数与数据一致；筛选后行数与 creator 判定一致。
//   2. 设备下拉在多设备时出现，选中后行数按 origin.deviceid 收敛；单设备时不出现。
//   3. 空结果文案按起因分流：查询无命中 vs 筛选清空。
//   4. 列表行来源徽标存在且 kind 与数据一致（agent / human）。
//   5. Notion 页面头：page icon 槽存在、标题为大字号、属性区默认折叠成一行 icon 摘要，
//      chevron 展开后属性网格含 5 行且 Computer 值形如 `设备名 platform · deviceId`。
//   6. 筛选是硬过滤：creator=agent 时行数等于数据里 agent 条目数（不被 limit 挤掉）。
//   7. Editor 收起按钮：多行草稿聚焦展开后一键收起，手动收起态下聚焦不再自动弹开。
//
// 用法：
//   node scripts/verify/commontext-source-notion/verify.mjs              # 起干净实例 → 跑 → 自动关
//   node scripts/verify/commontext-source-notion/verify.mjs --attach      # 复用本 area 的实例
//   node scripts/verify/commontext-source-notion/verify.mjs --keep-open   # 跑完留着人工看
//   node scripts/verify/commontext-source-notion/verify.mjs --dry         # 只解析依赖
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { ensureInstance, findPidByPort, killPid } from "../lib/launch.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep, waitForProbe } from "../lib/probes.mjs";
import { createReporter } from "../lib/report.mjs";

const AREA = "commontext-source-notion";
// 空白切分：Computer 值用 &nbsp;(U+00A0) 做分隔，只写 \s+ 会漏掉它。
const SPLIT_WS = new RegExp("[\\s" + String.fromCharCode(0xa0) + "]+");
const PROFILE = "commontext-source-notion";
const CDP_PORT = 9252;
const VITE_PORT = 51812;
const MODAL = ".commontext-compose-modal";
const COMPOSER = "[data-commontext-composer]";
const ADD_BUTTON = `${MODAL} [title="Add new common text item (edit on the right)"]`;
const SEARCH_INPUT = `${MODAL} input[placeholder^="Search common text"]`;

// 与 commontext-meta-sort 同区间：来源徽标是行内小 chip，不允许把行高顶出这个范围。
const ROW_HEIGHT_MIN = 36;
const ROW_HEIGHT_MAX = 46;

const ITEMS = [
  { title: "Alpha standup", body: "Alpha standup\nalpha notes" },
  { title: "Bravo refund", body: "Bravo refund\nbravo refund processed" },
  { title: "Charlie deploy", body: "Charlie deploy\ncharlie deploy notes" },
];

const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

const reporter = createReporter({
  area: AREA,
  endpoint: `http://127.0.0.1:${CDP_PORT}`,
  mode: attach ? "attach" : "launch+reset",
  meta: { profile: PROFILE, cdpPort: CDP_PORT, vitePort: VITE_PORT },
});
let instance = null;

/**
 * 弹窗内一次性快照。
 * 只读真实 DOM：行、徽标 kind、筛选控件状态、计数、Notion 页面头、属性网格。
 */
const SNAPSHOT_FN = `(() => {
    const modal = document.querySelector(${JSON.stringify(MODAL)});
    if (modal == null) return null;
    const rows = [...modal.querySelectorAll("[data-commontext-title]")];
    const h = (el) => (el == null ? 0 : Math.round(el.getBoundingClientRect().height));
    const text = (el) => (el == null ? "" : (el.textContent || "").trim());
    const creatorButtons = [...modal.querySelectorAll("[data-commontext-creator]")];
    const deviceSelect = modal.querySelector("[data-commontext-device]");
    const iconButton = modal.querySelector("[data-commontext-page-icon]");
    const titleInput = modal.querySelector("[data-commontext-detail-title]");
    const propRows = [...modal.querySelectorAll("[data-commontext-property]")];
    const propsToggle = modal.querySelector("[data-commontext-properties-toggle]");
    const propsSummary = [...modal.querySelectorAll("[data-commontext-properties-summary]")];
    const editorToggle = modal.querySelector("[data-commontext-editor-toggle]");
    const composer = modal.querySelector("[data-commontext-composer]");
    const props = {};
    for (const row of propRows) {
        const label = row.getAttribute("data-commontext-property");
        const value = row.lastElementChild;
        props[label] = text(value);
    }
    return {
        rowCount: rows.length,
        titles: rows.map((r) => r.getAttribute("data-commontext-title")),
        rowHeights: rows.map((r) => h(r)),
        badgeKinds: rows.map((r) => r.querySelector("[data-commontext-creator-badge]")?.getAttribute("data-commontext-creator-badge") ?? null),
        badgeTexts: rows.map((r) => text(r.querySelector("[data-commontext-creator-badge]"))),
        creatorKeys: creatorButtons.map((b) => b.getAttribute("data-commontext-creator")),
        creatorCounts: Object.fromEntries(creatorButtons.map((b) => [
            b.getAttribute("data-commontext-creator"),
            text(b.querySelector("[data-commontext-creator-count]")),
        ])),
        activeCreator: modal.querySelector('[data-commontext-creator][aria-pressed="true"]')?.getAttribute("data-commontext-creator") ?? null,
        deviceShown: deviceSelect != null,
        deviceValue: deviceSelect?.value ?? null,
        deviceOptions: deviceSelect == null ? [] : [...deviceSelect.options].map((o) => ({ value: o.value, label: o.textContent })),
        // 空结果提示块：用属性选择器匹配 Tailwind 类名，避免 [ ] 被 querySelector 当语法。
        emptyText: (() => {
            const rows = new Set(modal.querySelectorAll("[data-commontext-title]"));
            for (const el of modal.querySelectorAll("div")) {
                const cls = el.className?.toString?.() ?? "";
                if (cls.includes("min-h-[80px]") && !rows.has(el)) return text(el);
            }
            return "";
        })(),
        iconPresent: iconButton != null,
        iconText: text(iconButton),
        titleFontSize: titleInput == null ? null : getComputedStyle(titleInput).fontSize,
        propertyLabels: propRows.map((r) => r.getAttribute("data-commontext-property")),
        properties: props,
        propsState:
            modal.querySelector("[data-commontext-properties]")?.getAttribute("data-commontext-properties") ?? null,
        propsSummaryKeys: propsSummary.map((s) => s.getAttribute("data-commontext-properties-summary")),
        propsSummaryText: propsSummary.map((s) => text(s)),
        composerHeight: composer == null ? 0 : h(composer),
        tagsValueText: text(modal.querySelector("[data-commontext-tags-value]")),
        detailTextValue: (modal.querySelector("textarea:not([data-commontext-composer])")?.value ?? ""),
        allTagsPanelPresent: [...modal.querySelectorAll("div")].some((d) => (d.textContent ?? "").trim() === "All tags"),
        tagsPopoverOpen: document.querySelector('[data-testid="property-tag-editor"]') != null,
        draftStatus:
            modal.querySelector("[data-commontext-draft-status]")?.getAttribute("data-commontext-draft-status") ?? null,
        draftText: (() => {
            try {
                return JSON.parse(localStorage.getItem("commontext:editorDraft") ?? "null")?.text ?? null;
            } catch {
                return null;
            }
        })(),
    };
})()`;

const probeSnapshot = () => SNAPSHOT_FN;

const rowSelector = (title) => `${MODAL} [data-commontext-title="${title}"]`;
const sameOrder = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

async function clickSelector(client, selector) {
  const rect = await client.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el == null) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    })()`);
  if (rect == null || rect.w === 0 || rect.h === 0) return false;
  await client.click(rect.x, rect.y);
  return true;
}

function setReactValueExpression(selector, value) {
  return `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el == null) return false;
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
        setter.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
    })()`;
}

async function createItem(client, body, expectedRowCount) {
  const typed = await client.evaluate(setReactValueExpression(COMPOSER, body));
  if (!typed) return null;
  await sleep(150);
  if (!(await clickSelector(client, ADD_BUTTON))) return null;
  return waitForProbe(client, probeSnapshot(), (s) => (s?.rowCount ?? 0) >= expectedRowCount, {
    timeoutMs: 20000,
  });
}

if (dry) {
  reporter.log("dry-run: 依赖解析成功（未启动 GUI）");
  reporter.check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs");
  reporter.check(
    "pid-lookup-available",
    typeof findPidByPort === "function" && typeof killPid === "function",
    `platform=${process.platform}`
  );
  reporter.finish({ cleanup: null, ledger: false });
}

try {
  const occupied = attach ? null : findPidByPort(CDP_PORT);
  if (occupied != null) {
    throw new Error(`CDP 端口 ${CDP_PORT} 已被占用（pid=${occupied}）。要么用 --attach 复用它，要么先关掉占用进程。`);
  }

  const endpoint = `http://127.0.0.1:${CDP_PORT}`;
  let client;

  if (attach) {
    // attach 时不走 ensureInstance：它的 waitForReady 连的是 CDP 默认目标，
    // 而这个实例同时开着 devtools（一个 devtools:// page），默认目标很容易落在那边，
    // 于是 waitForReady 一直等不到 block-content 而超时——渲染器其实好着。
    // 这里自己挑渲染器目标，只等"有 block-content 且宽高 > 0"这一条。
    let picked = null;
    for (let attempt = 0; attempt < 30 && picked == null; attempt++) {
      const pages = await listPageTargets(endpoint).catch(() => []);
      if (pages.length > 0) {
        picked = await pickLiveRenderer(pages, connectToTarget, endpoint).catch(() => null);
      }
      if (picked == null) await sleep(1000);
    }
    if (picked?.client == null) {
      throw new Error("attach 失败：找不到可用的渲染器目标（实例没起好或端口被别的进程占住）");
    }
    client = picked.client;
    instance = { client, spawned: false, cleanup: () => client.close() };
  } else {
    instance = await ensureInstance({
      attach: false,
      resetProfile: true,
      profile: PROFILE,
      cdpPort: CDP_PORT,
      vitePort: VITE_PORT,
    });
    client = instance.client;
    const pages = await listPageTargets(endpoint);
    if (pages.length > 0) {
      const picked = await pickLiveRenderer(pages, connectToTarget, endpoint);
      if (picked?.client != null) {
        client.close?.();
        client = picked.client;
      }
    }
  }
  await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  reporter.log(`instance ready (${attach ? "attach" : "launch"})`);
  await dismissOnboarding(client, { log: reporter.log });

  // ── 0. 清空现有条目：attach 复用同一实例时上一轮的条目仍在库里（实测 first=2）。
  // 不清理就会得到脏起点，后面所有行数断言都失去意义。
  //
  // 这里不调内部 RPC，而是走产品自己的删除入口：打开弹窗 → 逐行 Delete 直到列表为空。
  // 好处是即使库里有残留也能被真实 UI 清掉，且不依赖测试专用后门。
  await client.evaluate(`(() => {
        window.dispatchEvent(new CustomEvent("snorkeling:common-text:open-search", { detail: {} }));
        return true;
    })()`);
  await waitForProbe(client, `document.querySelector(${JSON.stringify(MODAL)}) != null`, (v) => v === true, {
    timeoutMs: 20000,
  });
  for (let i = 0; i < 30; i++) {
    const remaining = await client.evaluate(
      `(() => document.querySelectorAll(${JSON.stringify(`${MODAL} [data-commontext-title]`)}).length)()`
    );
    if (remaining === 0) break;
    const deleted = await clickSelector(client, `${MODAL} [title="Delete this text"]`);
    if (!deleted) break;
    await sleep(250);
  }
  const cleared = await client.evaluate(
    `(() => document.querySelectorAll(${JSON.stringify(`${MODAL} [data-commontext-title]`)}).length)()`
  );
  reporter.check("precondition-list-empty", cleared === 0, { remaining: cleared });
  await client.evaluate(`(() => { localStorage.removeItem("commontext:sortKey"); return true; })()`);

  // ── 1. 打开弹窗 + 建三条（全部由本机人创建，origin 走默认设备） ──────────────
  await client.evaluate(`(() => {
        window.dispatchEvent(new CustomEvent("snorkeling:common-text:open-search", { detail: {} }));
        return true;
    })()`);
  const modalUp = await waitForProbe(
    client,
    `document.querySelector(${JSON.stringify(MODAL)}) != null`,
    (v) => v === true,
    { timeoutMs: 20000 }
  );
  if (!reporter.check("modal-open", modalUp === true, { modalUp })) {
    throw new Error("Compose 弹窗没打开，后续断言无意义（环境问题，不是产品断言失败）");
  }

  const first = await createItem(client, ITEMS[0].body, 1);
  const second = await createItem(client, ITEMS[1].body, 2);
  const third = await createItem(client, ITEMS[2].body, 3);
  reporter.check("seed-three", third?.rowCount === 3, {
    first: first?.rowCount,
    second: second?.rowCount,
    third: third?.rowCount,
  });

  // 清空 editor，否则编辑器过滤会干扰计数
  await client.evaluate(setReactValueExpression(COMPOSER, ""));
  await sleep(200);

  const base = await waitForProbe(client, probeSnapshot(), (s) => (s?.rowCount ?? 0) === 3, { timeoutMs: 15000 });
  reporter.check("rows-rendered", base?.rowCount === 3, base?.titles);

  // ── 2. 来源筛选控件 ─────────────────────────────────────────────────────
  reporter.check("creator-filters-three", sameOrder(base?.creatorKeys, ["all", "human", "agent"]), base?.creatorKeys);
  reporter.check("creator-default-all", base?.activeCreator === "all", base?.activeCreator);
  reporter.check(
    "creator-counts-match-rows",
    base?.creatorCounts?.all === "3" && base?.creatorCounts?.human === "3" && base?.creatorCounts?.agent === "0",
    base?.creatorCounts
  );
  // 单设备时下拉不出现（避免只有一个选项的假控件）
  reporter.check("device-hidden-when-single", base?.deviceShown === false, base?.deviceShown);

  // ── 3. 行内来源徽标：本地新建的都是 human ─────────────────────────────────
  reporter.check(
    "row-badges-all-human",
    Array.isArray(base?.badgeKinds) && base.badgeKinds.length === 3 && base.badgeKinds.every((k) => k === "human"),
    base?.badgeKinds
  );
  reporter.check(
    "row-height-unchanged-by-badge",
    Array.isArray(base?.rowHeights) && base.rowHeights.every((h) => h >= ROW_HEIGHT_MIN && h <= ROW_HEIGHT_MAX),
    { rowHeights: base?.rowHeights, allowed: [ROW_HEIGHT_MIN, ROW_HEIGHT_MAX] }
  );
  await reporter.shot(client, "01-list-with-badges");

  // ── 4. creator=agent 是硬过滤：行数 0，且文案按起因分流 ─────────────────────
  await clickSelector(client, `${MODAL} [data-commontext-creator="agent"]`);
  const agentFiltered = await waitForProbe(client, probeSnapshot(), (s) => s?.activeCreator === "agent", {
    timeoutMs: 15000,
  });
  reporter.check("creator-agent-applied", agentFiltered?.activeCreator === "agent", agentFiltered?.activeCreator);
  reporter.check("creator-agent-zero-rows", agentFiltered?.rowCount === 0, agentFiltered?.rowCount);
  reporter.check(
    "empty-text-says-filter",
    (agentFiltered?.emptyText ?? "").includes("filter"),
    agentFiltered?.emptyText
  );
  await reporter.shot(client, "02-agent-filter-empty");

  // 回到 all
  await clickSelector(client, `${MODAL} [data-commontext-creator="all"]`);
  await waitForProbe(client, probeSnapshot(), (s) => s?.activeCreator === "all" && (s?.rowCount ?? 0) === 3, {
    timeoutMs: 15000,
  });

  // ── 5. 查询无命中时的文案必须与筛选空不同 ─────────────────────────────────
  await clickSelector(client, SEARCH_INPUT);
  await client.evaluate(setReactValueExpression(SEARCH_INPUT, "zzzznomatch"));
  const noMatch = await waitForProbe(client, probeSnapshot(), (s) => (s?.rowCount ?? 1) === 0, { timeoutMs: 15000 });
  reporter.check("empty-text-says-matching", (noMatch?.emptyText ?? "").includes("matching"), noMatch?.emptyText);
  await client.evaluate(setReactValueExpression(SEARCH_INPUT, ""));
  await waitForProbe(client, probeSnapshot(), (s) => (s?.rowCount ?? 0) === 3, { timeoutMs: 15000 });

  // ── 6. Notion 式详情页（属性区默认折叠，展开后验完整网格） ───────────────
  await clickSelector(client, rowSelector("Bravo refund"));
  const detailCollapsed = await waitForProbe(
    client,
    probeSnapshot(),
    (s) => (s?.propsState ?? "") === "collapsed" && (s?.propsSummaryKeys?.length ?? 0) >= 4,
    { timeoutMs: 15000 }
  );
  reporter.check(
    "props-collapsed-by-default",
    detailCollapsed?.propsState === "collapsed" && (detailCollapsed?.propsSummaryKeys?.length ?? 0) >= 4,
    { state: detailCollapsed?.propsState, summaryKeys: detailCollapsed?.propsSummaryKeys }
  );
  reporter.check(
    "props-collapse-hides-grid-rows",
    (detailCollapsed?.propertyLabels?.length ?? 0) === 0,
    detailCollapsed?.propertyLabels
  );
  reporter.check(
    "props-summary-has-values",
    Array.isArray(detailCollapsed?.propsSummaryText) && detailCollapsed.propsSummaryText.every((t) => t !== ""),
    detailCollapsed?.propsSummaryText
  );
  const propsOpened = await clickSelector(client, `${MODAL} [data-commontext-properties-toggle]`);
  const detail = await waitForProbe(client, probeSnapshot(), (s) => (s?.propertyLabels?.length ?? 0) >= 5, {
    timeoutMs: 15000,
  });
  reporter.check("props-toggle-click", propsOpened === true, propsOpened);
  reporter.check("props-expand-shows-grid", detail?.propsState === "expanded", detail?.propsState);
  reporter.check("page-icon-slot-present", detail?.iconPresent === true, detail?.iconPresent);
  reporter.check(
    "title-is-heading-sized",
    detail?.titleFontSize != null && parseFloat(detail.titleFontSize) >= 16,
    detail?.titleFontSize
  );
  reporter.check(
    "property-grid-six-rows",
    sameOrder(detail?.propertyLabels, ["Tags", "Created by", "Computer", "Created", "Updated", "Used"]),
    detail?.propertyLabels
  );
  // ── 6.5 Tags 属性行：底部 All tags 面板已移除，标签走属性浮层（Wolai 式共享编辑器）──
  reporter.check("all-tags-panel-removed", detail?.allTagsPanelPresent === false, detail?.allTagsPanelPresent);
  reporter.check("tags-value-cell-present", (detail?.tagsValueText ?? "") === "Empty", detail?.tagsValueText);
  const tagsCellClicked = await clickSelector(client, `${MODAL} [data-commontext-tags-value]`);
  reporter.check("tags-popover-opens", tagsCellClicked === true, tagsCellClicked);
  await waitForProbe(client, probeSnapshot(), (s) => s?.tagsPopoverOpen === true, { timeoutMs: 15000 });
  const tagPopover = await waitForProbe(client, probeSnapshot(), (s) => s?.tagsPopoverOpen === true, {
    timeoutMs: 15000,
  });
  reporter.check("tags-popover-editor-present", tagPopover?.tagsPopoverOpen === true, tagPopover?.tagsPopoverOpen);
  const tagInputSet = await client.evaluate(`(() => {
    const input = document.querySelector(".ptag-input");
    if (input == null) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "verifytag");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  reporter.check("tags-input-filled", tagInputSet === true, tagInputSet);
  await sleep(120);
  const tagEnter = await client.evaluate(`(() => {
    const input = document.querySelector(".ptag-input");
    if (input == null) return false;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    return true;
  })()`);
  reporter.check("tags-enter-created", tagEnter === true, tagEnter);
  const tagAdded = await waitForProbe(
    client,
    probeSnapshot(),
    (s) => (s?.detailTextValue ?? "").includes("#verifytag"),
    {
      timeoutMs: 15000,
    }
  );
  reporter.check("tags-create-appends-to-text", (tagAdded?.detailTextValue ?? "").includes("#verifytag"), {
    detailTextTail: (tagAdded?.detailTextValue ?? "").slice(-40),
  });
  reporter.check(
    "tags-value-shows-chip",
    (tagAdded?.tagsValueText ?? "").includes("verifytag"),
    tagAdded?.tagsValueText
  );
  // 清场：Backspace 删尾 chip（草稿为空时）+ Esc 关浮层，正文里的字面回退
  await client.evaluate(`(() => {
    const input = document.querySelector(".ptag-input");
    if (input == null) return false;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    return true;
  })()`);
  await sleep(200);
  await client.evaluate(`(() => {
    const input = document.querySelector(".ptag-input");
    if (input == null) return false;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    return true;
  })()`);
  const tagsCleaned = await waitForProbe(
    client,
    probeSnapshot(),
    (s) => !(s?.detailTextValue ?? "").includes("#verifytag"),
    { timeoutMs: 15000 }
  );
  reporter.check("tags-remove-strips-text", !(tagsCleaned?.detailTextValue ?? "").includes("#verifytag"), {
    detailTextTail: (tagsCleaned?.detailTextValue ?? "").slice(-40),
  });
  reporter.check("tags-popover-closed", tagsCleaned?.tagsPopoverOpen === false, tagsCleaned?.tagsPopoverOpen);
  // Computer 值必须是 `设备名 platform · deviceId` 三段，缺一段就说明 origin 快照没接上。
  // 分隔符用的是 &nbsp;(U+00A0)，所以切分要同时吃普通空白与 nbsp。
  const computerRaw = detail?.properties?.["Computer"] ?? "";
  const computerParts = computerRaw.split(SPLIT_WS).filter((p) => p !== "");
  const computer = computerParts.join(" ");
  reporter.check(
    "computer-shows-device-and-id",
    computerParts.length === 4 && computerParts[0].length > 0 && computerParts[2] === "·",
    { raw: computerRaw, normalized: computer }
  );
  reporter.check(
    "created-by-shows-kind",
    (detail?.properties?.["Created by"] ?? "").includes("human"),
    detail?.properties?.["Created by"]
  );
  await reporter.shot(client, "03-notion-detail");

  // ── 6.5 Editor 收起按钮：多行草稿一键收起，手动收起态聚焦不弹开 ───────────
  // 先把多行草稿写进 editor 并聚焦展开（多行内容在失焦判定里会一直保持展开）。
  await clickSelector(client, COMPOSER);
  await client.evaluate(setReactValueExpression(COMPOSER, "line one\nline two"));
  const expanded = await waitForProbe(client, probeSnapshot(), (s) => (s?.composerHeight ?? 0) >= 110, {
    timeoutMs: 15000,
  });
  reporter.check("editor-focus-expands-multiline", (expanded?.composerHeight ?? 0) >= 110, {
    composerHeight: expanded?.composerHeight,
  });
  // 模拟 resize-y 拖高（真实拖拽会在元素上留下浏览器写入的 inline height），
  // 收起必须显式盖掉它，否则 inline 压过 h-9、收不回一行（回归锁）。
  const dragPlanted = await client.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(COMPOSER)});
    if (!el) return false;
    el.style.height = "300px";
    return true;
  })()`);
  reporter.check("editor-drag-height-planted", dragPlanted === true, dragPlanted);
  const collapsedByButton = await clickSelector(client, `${MODAL} [data-commontext-editor-toggle]`);
  const collapsed = await waitForProbe(client, probeSnapshot(), (s) => (s?.composerHeight ?? 999) <= 45, {
    timeoutMs: 15000,
  });
  reporter.check("editor-collapse-button-clicked", collapsedByButton === true, collapsedByButton);
  reporter.check("editor-collapse-shrinks-to-single-row", (collapsed?.composerHeight ?? 999) <= 45, {
    composerHeight: collapsed?.composerHeight,
  });
  // 收起态下点正文不再自动展开（手动收起优先）；正文保留。
  await clickSelector(client, COMPOSER);
  const stillCollapsed = await waitForProbe(client, probeSnapshot(), (s) => (s?.composerHeight ?? 999) <= 45, {
    timeoutMs: 15000,
  });
  reporter.check("editor-stays-collapsed-on-focus", (stillCollapsed?.composerHeight ?? 999) <= 45, {
    composerHeight: stillCollapsed?.composerHeight,
  });
  await reporter.shot(client, "04-editor-collapsed");
  // 再点按钮展开，恢复多行。
  await clickSelector(client, `${MODAL} [data-commontext-editor-toggle]`);
  const reExpanded = await waitForProbe(client, probeSnapshot(), (s) => (s?.composerHeight ?? 0) >= 110, {
    timeoutMs: 15000,
  });
  reporter.check("editor-expand-restores-multiline", (reExpanded?.composerHeight ?? 0) >= 110, {
    composerHeight: reExpanded?.composerHeight,
  });
  // 清掉 editor，避免影响后续步骤
  await client.evaluate(setReactValueExpression(COMPOSER, ""));
  await sleep(200);

  // ── 6.6 Editor 持久草稿：停手 800ms 自动落 localStorage，橡皮清空 ───────
  // 「Draft saved」指示 1.5s 就淡回，探针轮询撞不上会假红，这里只锁持久化语义；
  // 指示显示由 dom 台（commontext-compose-modal.dom.test.tsx）锁定。
  const draftTyped = await client.evaluate(setReactValueExpression(COMPOSER, "draft autosave probe"));
  reporter.check("editor-draft-typed", draftTyped === true, draftTyped);
  const draftPersisted = await waitForProbe(client, probeSnapshot(), (s) => s?.draftText === "draft autosave probe", {
    timeoutMs: 15000,
  });
  reporter.check("editor-draft-persisted-to-localstorage", draftPersisted?.draftText === "draft autosave probe", {
    draftText: draftPersisted?.draftText,
  });
  const eraserClicked = await clickSelector(client, `${MODAL} [title="Clear editor"]`);
  reporter.check("editor-draft-eraser-clicked", eraserClicked === true, eraserClicked);
  const draftCleared = await waitForProbe(client, probeSnapshot(), (s) => s?.draftText == null, {
    timeoutMs: 15000,
  });
  reporter.check("editor-draft-cleared-on-eraser", draftCleared?.draftText == null, {
    draftText: draftCleared?.draftText,
  });

  // ── 7. 切回列表确认筛选与详情互不干扰 ───────────────────────────────────
  // 先确保没有浮层（page icon 的 emoji picker）盖住筛选行：点同一个 page icon 收起它。
  // 否则 click 打到浮层上，activeCreator 不变，断言会以「读不到行」的形式假红。
  // （用点 icon 而不是 Escape：Escape 的关闭由 picker 内部处理，契约不稳定。）
  const pickerOpen = await client.evaluate(`(() => document.querySelector("[class*='emoji']") != null)()`);
  if (pickerOpen === true) {
    await clickSelector(client, `${MODAL} [data-commontext-page-icon]`);
    await sleep(400);
  }
  const pickerStillOpen = await client.evaluate(`(() => document.querySelector("[class*='emoji']") != null)()`);
  reporter.check("precondition-no-picker-overlay", pickerStillOpen !== true, { pickerOpen, pickerStillOpen });
  const clickedHuman = await clickSelector(client, `${MODAL} [data-commontext-creator="human"]`);
  const humanFiltered = await waitForProbe(client, probeSnapshot(), (s) => s?.activeCreator === "human", {
    timeoutMs: 15000,
  });
  reporter.check("creator-human-click", clickedHuman === true, clickedHuman);
  reporter.check("creator-human-keeps-all", humanFiltered?.rowCount === 3, {
    rowCount: humanFiltered?.rowCount,
    activeCreator: humanFiltered?.activeCreator,
  });

  reporter.finish({
    skipped: [
      "设备下拉的交互（本机只有一台设备，多设备夹具需要伪造 origin，真机不便；设备过滤语义由单测 getCommonTextDeviceSummaries / commonTextItemMatchesDevice 覆盖）",
      "agent 条目的徽标颜色（像素级证据；kind 与文案已由真机属性断言覆盖）",
      "emoji picker 弹出与选图（组件复用 markdown 的 EmojiPicker，其行为由 emoji-picker.dom.test.tsx 覆盖；本台只验 page icon 槽存在）",
      "Notion 页面头的 hover 态与 inline 编辑提交（属交互细节，由 detailTitle input 的 value 断言 + 单测覆盖）",
    ],
    cleanup: () => {
      client.close?.();
      if (instance?.spawned && !keepOpen) instance.cleanup?.();
    },
  });
} catch (err) {
  reporter.fatal(err, { cleanup: () => instance?.cleanup?.() });
}
