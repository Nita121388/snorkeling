#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// CommonText 列表元信息 / 排序控件 —— 真机 CDP 验证（全自动，无人值守）。
//
// 为什么要有这个台子：本轮改动的判据是"列表行看起来对不对、排序点下去有没有真的重排"，
// 单测只能钉住排序语义与控件契约，覆盖不到「行高有没有被新增的元信息列顶高」「搜索态
// 排序控件是不是真的被关掉」「搜索后 Enter 打开的是不是相关度第一名」这类只有真实布局
// 与真实指针才说得清的问题。所以这里跑完整链路：
//
//   1. 干净实例 → 派发 `snorkeling:common-text:open-search` 打开 Compose 弹窗。
//   2. 用真实 UI 新建 Standup / Refund → 真实点击行内插入 Standup（计数 +1、刷新 lastusedat）
//      → 再新建 Zulu。次序若为 [Zulu, Standup, Refund] 同时证明两件事：新建**刷新**
//      lastusedat（否则 Zulu 无 lastusedat 会落到最后），新建**不计数**（Zulu 次数为 0）。
//   3. 断言元信息列存在、行高仍落在改造前的绝对值区间、相对时间可读。
//   4. 点 title-asc → 行序按标题升序，偏好落 localStorage。
//   5. 搜索 "refund processed" → 排序控件全部 aria-disabled + 相关度图标亮起；
//      且第 0 行必须是高亮行、按 Enter 打开的是相关度第一名的 Refund reply
//      （回归锁：曾经有个 effect 会在过滤变化时把高亮拽回 detailId，导致 Enter 打开错条目）。
//   6. 点某行 → 详情页脚四组元信息；详情 Copy 也是一次使用（本轮新增写入点）。
//   7. 截图 + report.json / report.md + 台账一行。
//
// 所有点击都走 CDP `Input.dispatchMouseEvent`（client.click），不用 dispatchEvent 合成事件。
//
// 用法：
//   node scripts/verify/commontext-meta-sort/verify.mjs              # 起干净实例 → 跑 → 自动关
//   node scripts/verify/commontext-meta-sort/verify.mjs --attach      # 复用本 area 的实例（迭代用）
//   node scripts/verify/commontext-meta-sort/verify.mjs --keep-open   # 跑完留着人工看
//   node scripts/verify/commontext-meta-sort/verify.mjs --dry         # 只解析依赖，不起 GUI
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { ensureInstance, findPidByPort, killPid } from "../lib/launch.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep, waitForProbe } from "../lib/probes.mjs";
import { createReporter } from "../lib/report.mjs";

const AREA = "commontext-meta-sort";
// 独立 profile + 独立端口：默认 profile 是共享的，resetProfile 会整个 rmSync 掉它，
// 并行开发时抢用等于踩掉别人正在跑的实例（也抢 Electron 的 SingletonLock）。
const PROFILE = "commontext-meta-sort";
const CDP_PORT = 9251;
const VITE_PORT = 51811;
const MODAL = ".commontext-compose-modal";
const COMPOSER = "[data-commontext-composer]";
const ADD_BUTTON = `${MODAL} [title="Add new common text item (edit on the right)"]`;
const SEARCH_INPUT = `${MODAL} input[placeholder^="Search common text"]`;

// 改造前列表行实测高度 41px（title 12px + 摘要 11px + py-1.5）；元信息列是固定 28px 槽，
// 一旦它开始定行高，行高会掉到 28 或涨到 30+ 之外。
const ROW_HEIGHT_MIN = 36;
const ROW_HEIGHT_MAX = 46;
const META_SLOT_HEIGHT = 28;

const ITEMS = [
  { title: "Standup summary", body: "Standup summary\nnotes about refund policy" },
  { title: "Refund reply", body: "Refund reply\nrefund processed now" },
  { title: "Zulu deploy notes", body: "Zulu deploy notes\nzulu deploy notes" },
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

/** 弹窗内一次性快照：行序、行高、元信息列高、次数、排序控件状态、高亮行、详情标题。 */
const SNAPSHOT_FN = `(() => {
    const modal = document.querySelector(${JSON.stringify(MODAL)});
    if (modal == null) return null;
    const rows = [...modal.querySelectorAll("[data-commontext-title]")];
    const h = (el) => (el == null ? 0 : Math.round(el.getBoundingClientRect().height));
    const text = (el) => (el == null ? "" : (el.textContent || "").trim());
    const sortButtons = [...modal.querySelectorAll("[data-commontext-sort]")];
    return {
        rowCount: rows.length,
        titles: rows.map((row) => row.getAttribute("data-commontext-title")),
        rowHeights: rows.map((row) => h(row)),
        metaHeights: rows.map((row) => h(row.querySelector("[data-commontext-meta]"))),
        usage: rows.map((row) => text(row.querySelector("[data-commontext-usage]"))),
        updated: rows.map((row) => text(row.querySelector("[data-commontext-updated]"))),
        sortKeys: sortButtons.map((b) => b.getAttribute("data-commontext-sort")),
        sortDisabled: sortButtons.map((b) => b.getAttribute("aria-disabled")),
        activeSort:
            modal.querySelector('[data-commontext-sort][aria-pressed="true"]')?.getAttribute("data-commontext-sort") ?? null,
        relevanceShown: modal.querySelector("[data-commontext-sort-relevance]") != null,
        highlightedIndex: rows.findIndex((row) => row.classList.contains("bg-actionsoft")),
        detailTitle: modal.querySelector('input[placeholder^="Title (optional"]')?.value ?? null,
        detailMetaCount: modal.querySelectorAll("[data-commontext-detail-meta] > span").length,
        composerText: document.querySelector(${JSON.stringify(COMPOSER)})?.value ?? null,
        storedSort: (() => {
            try { return localStorage.getItem("commontext:sortKey"); } catch { return "storage-error"; }
        })(),
    };
})()`;

const probeSnapshot = () => SNAPSHOT_FN;

const rowSelector = (title) => `${MODAL} [data-commontext-title="${title}"]`;
const usageOf = (snap, title) => {
  const index = (snap?.titles ?? []).indexOf(title);
  return index < 0 ? null : snap.usage[index];
};
const sameOrder = (actual, expected) =>
  Array.isArray(actual) && actual.length === expected.length && actual.every((v, i) => v === expected[i]);

/** 真实指针点击（CDP mouseMoved + pressed + released）：不用 dispatchEvent 合成事件。 */
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

/** 用原生 value setter + input 事件写入 React 受控输入（比 Input.insertText 更确定）。 */
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

/** 真实按键（Enter / Escape）。先 click 目标拿焦点，再派发 keydown/char/keyup。 */
async function pressEnter(client) {
  await client.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  await client.send("Input.dispatchKeyEvent", { type: "char", text: "\r", key: "Enter", code: "Enter" });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter" });
  await sleep(250);
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
  // 跨平台收尾自检：macOS / Linux 必须能按端口找到 PID（Windows 走 powershell，同一入口）。
  reporter.check(
    "pid-lookup-available",
    typeof findPidByPort === "function" && typeof killPid === "function",
    `platform=${process.platform}`
  );
  reporter.finish({ cleanup: null, ledger: false });
}

try {
  // 端口预检：本 area 独占端口。被别的进程占住时 ensureInstance 会连到别人的实例上，
  // 拿旧代码跑断言只会得到一堆假失败，所以直接判环境错误。
  const occupied = attach ? null : findPidByPort(CDP_PORT);
  if (occupied != null) {
    throw new Error(`CDP 端口 ${CDP_PORT} 已被占用（pid=${occupied}）。要么用 --attach 复用它，要么先关掉占用进程。`);
  }

  const endpoint = `http://127.0.0.1:${CDP_PORT}`;
  instance = await ensureInstance({
    attach,
    resetProfile: !attach,
    profile: PROFILE,
    cdpPort: CDP_PORT,
    vitePort: VITE_PORT,
  });
  let client = instance.client;

  const pages = await listPageTargets(endpoint);
  if (pages.length > 1) {
    client = (await pickLiveRenderer(pages, connectToTarget, endpoint)).client;
  }
  // 窗口在后台时真实指针事件进不到 React。
  await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  reporter.log(`instance ready (${attach ? "attach" : "launch"})`);
  await dismissOnboarding(client, { log: reporter.log });

  // ── 1. 打开 Compose 弹窗（走产品自己的事件总线） ─────────────────────────────
  const opened = await client.evaluate(`(() => {
        window.dispatchEvent(new CustomEvent("snorkeling:common-text:open-search", { detail: {} }));
        return true;
    })()`);
  const modalUp = await waitForProbe(
    client,
    `document.querySelector(${JSON.stringify(MODAL)}) != null`,
    (v) => v === true,
    { timeoutMs: 20000 }
  );
  if (!reporter.check("modal-open", opened === true && modalUp === true, { opened, modalUp })) {
    throw new Error("Compose 弹窗没打开，后续断言无意义（环境问题，不是产品断言失败）");
  }

  // ── 2. 建两条 → 用一条 → 再建一条（同时钉住 lastusedat 与 usagecount 语义） ──
  const first = await createItem(client, ITEMS[0].body, 1);
  const second = await createItem(client, ITEMS[1].body, 2);
  reporter.check("seed-first-two", first?.rowCount === 1 && second?.rowCount === 2, {
    first: first?.titles,
    second: second?.titles,
  });

  // 行内插入：先把焦点放到 editor，再真实点击该行的插入按钮。
  // （无终端时 insertOrCopyCommonText 会退化成复制；当前可编辑元素存在时走插入，
  //   不依赖剪贴板权限，无头环境更稳。）
  await clickSelector(client, COMPOSER);
  const insertClicked = await clickSelector(client, `${rowSelector(ITEMS[0].title)} .item-insert-btn`);
  const afterInsert = await waitForProbe(client, probeSnapshot(), (s) => usageOf(s, ITEMS[0].title) === "1", {
    timeoutMs: 20000,
  });
  reporter.check("row-insert-clicked", insertClicked === true, insertClicked);
  reporter.check("row-insert-counts-usage", usageOf(afterInsert, ITEMS[0].title) === "1", afterInsert?.usage);
  reporter.check(
    "row-insert-inserted-text",
    typeof afterInsert?.composerText === "string" && afterInsert.composerText.includes("notes about refund policy"),
    afterInsert?.composerText
  );

  // 清空 editor（否则编辑器过滤会继续生效，干扰后续排序断言）
  await client.evaluate(setReactValueExpression(COMPOSER, ""));
  await sleep(200);

  const third = await createItem(client, ITEMS[2].body, 3);
  reporter.check("seed-third", third?.rowCount === 3, third?.titles);

  // ── 3. 列表元信息面 ─────────────────────────────────────────────────────
  const base = await waitForProbe(client, probeSnapshot(), (s) => (s?.rowCount ?? 0) === 3, { timeoutMs: 15000 });
  reporter.check("rows-rendered", base?.rowCount === 3, base?.titles);
  reporter.check(
    "sort-buttons-five",
    sameOrder(base?.sortKeys, ["lastused-desc", "updated-desc", "created-desc", "usage-desc", "title-asc"]),
    base?.sortKeys
  );
  reporter.check("sort-default-recently-used", base?.activeSort === "lastused-desc", base?.activeSort);
  // 新建刷新 lastusedat（Zulu 排第一）但**不计数**（Zulu 次数为 0，Standup 已用过 1 次）
  reporter.check(
    "new-item-refreshes-lastused-at",
    sameOrder(base?.titles, ["Zulu deploy notes", "Standup summary", "Refund reply"]),
    base?.titles
  );
  reporter.check(
    "new-item-not-counted",
    usageOf(base, "Zulu deploy notes") === "0" && usageOf(base, "Standup summary") === "1",
    base?.usage
  );
  reporter.check(
    "updated-time-readable",
    Array.isArray(base?.updated) &&
      base.updated.length === 3 &&
      base.updated.every((t) => /just now|^\d+(s|m|h|d) ago$/.test(t)),
    base?.updated
  );
  reporter.check(
    "meta-column-present",
    Array.isArray(base?.metaHeights) &&
      base.metaHeights.length === 3 &&
      base.metaHeights.every((h) => h === META_SLOT_HEIGHT),
    base?.metaHeights
  );
  // 行高钉绝对值区间：元信息列是 28px 固定槽，绝不能变成行高的决定因素。
  reporter.check(
    "row-height-unchanged",
    Array.isArray(base?.rowHeights) && base.rowHeights.every((h) => h >= ROW_HEIGHT_MIN && h <= ROW_HEIGHT_MAX),
    { rowHeights: base?.rowHeights, allowed: [ROW_HEIGHT_MIN, ROW_HEIGHT_MAX] }
  );
  await reporter.shot(client, "01-default-order");

  // ── 4. 切 title-asc：真实点击 + 真实重排 + 偏好落盘 ─────────────────────────
  await clickSelector(client, `${MODAL} [data-commontext-sort="title-asc"]`);
  const sorted = await waitForProbe(
    client,
    probeSnapshot(),
    (s) => sameOrder(s?.titles, ["Refund reply", "Standup summary", "Zulu deploy notes"]),
    { timeoutMs: 15000 }
  );
  reporter.check(
    "sort-title-asc-reorders",
    sameOrder(sorted?.titles, ["Refund reply", "Standup summary", "Zulu deploy notes"]),
    sorted?.titles
  );
  reporter.check("sort-active-marked", sorted?.activeSort === "title-asc", sorted?.activeSort);
  reporter.check("sort-persisted", sorted?.storedSort === "title-asc", sorted?.storedSort);
  await reporter.shot(client, "02-title-asc");

  // ── 5. 搜索态：排序关掉 + 相关度优先 + Enter 打开第一名（回归锁） ─────────────
  await clickSelector(client, SEARCH_INPUT);
  await client.evaluate(setReactValueExpression(SEARCH_INPUT, "refund processed"));
  const searching = await waitForProbe(
    client,
    probeSnapshot(),
    (s) => s?.relevanceShown === true && (s?.rowCount ?? 0) === 2,
    { timeoutMs: 15000 }
  );
  reporter.check(
    "search-disables-sort-control",
    Array.isArray(searching?.sortDisabled) && searching.sortDisabled.every((v) => v === "true"),
    searching?.sortDisabled
  );
  reporter.check("search-shows-relevance-icon", searching?.relevanceShown === true, searching?.relevanceShown);
  reporter.check(
    "search-ranks-relevance-first",
    sameOrder(searching?.titles, ["Refund reply", "Standup summary"]),
    searching?.titles
  );
  // 回归锁：过滤变化后高亮必须停在相关度第 0 行（曾经被 detailId 对齐 effect 拽走）
  reporter.check("search-highlight-is-top-match", searching?.highlightedIndex === 0, searching?.highlightedIndex);

  await pressEnter(client);
  const entered = await waitForProbe(client, probeSnapshot(), (s) => s?.detailTitle === "Refund reply", {
    timeoutMs: 15000,
  });
  reporter.check("search-enter-opens-top-match", entered?.detailTitle === "Refund reply", entered?.detailTitle);
  await reporter.shot(client, "03-search-relevance");

  await client.evaluate(setReactValueExpression(SEARCH_INPUT, ""));
  const restored = await waitForProbe(
    client,
    probeSnapshot(),
    (s) => Array.isArray(s?.sortDisabled) && s.sortDisabled.every((v) => v !== "true"),
    { timeoutMs: 15000 }
  );
  reporter.check(
    "clearing-search-restores-sort",
    Array.isArray(restored?.sortDisabled) && restored.sortDisabled.every((v) => v !== "true"),
    restored?.sortDisabled
  );
  reporter.check("sort-preference-survives-search", restored?.activeSort === "title-asc", restored?.activeSort);

  // ── 6. 详情页脚元信息 + 详情 Copy 计数（本轮第二个新增写入点） ────────────────
  await clickSelector(client, rowSelector("Zulu deploy notes"));
  const detail = await waitForProbe(client, probeSnapshot(), (s) => (s?.detailMetaCount ?? 0) >= 4, {
    timeoutMs: 15000,
  });
  reporter.check("detail-footer-meta", (detail?.detailMetaCount ?? 0) >= 4, detail?.detailMetaCount);

  const copyClicked = await clickSelector(client, `${MODAL} [title="Copy this text"]`);
  const copied = await waitForProbe(client, probeSnapshot(), (s) => usageOf(s, "Zulu deploy notes") === "1", {
    timeoutMs: 20000,
  });
  reporter.check("detail-copy-clicked", copyClicked === true, copyClicked);
  reporter.check("detail-copy-counts-usage", usageOf(copied, "Zulu deploy notes") === "1", copied?.usage);
  await reporter.shot(client, "04-usage-counted");

  reporter.finish({
    skipped: [
      "hover 时元信息淡出 / 插入按钮接位的视觉切换（CDP 合成 hover 不解发 group-hover，需真实指针停留，属像素级证据）",
      "tooltip 实际弹出（title 内容已由单测 + 真机属性断言覆盖，弹出层是浏览器原生控件）",
      "排序偏好在弹窗关闭重开后的恢复（localStorage 写入已断言；读取路径由 open 时 loadCommonTextSortKey 覆盖）",
      "created-asc / updated-desc / usage-desc 三个排序键的重排（语义由单测逐键覆盖，真机只验 title-asc 一条以控制时长）",
    ],
    cleanup: () => {
      client.close?.();
      if (instance?.spawned && !keepOpen) instance.cleanup?.();
    },
  });
} catch (err) {
  reporter.fatal(err, { cleanup: () => instance?.cleanup?.() });
}
