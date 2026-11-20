#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 会话详情块绑定错位验证台（11-20-aisessions-detail-binding-mismatch）。
//
//   node scripts/verify/aisessions-detail-binding/verify.mjs             # 干净实例 → 跑 → 自动关
//   node scripts/verify/aisessions-detail-binding/verify.mjs --attach     # 复用已起实例
//   node scripts/verify/aisessions-detail-binding/verify.mjs --keep-open  # 留着手工看
//   node scripts/verify/aisessions-detail-binding/verify.mjs --dry        # 只解析依赖
//
// 判据（机器判定，不靠肉眼）：
//   1. 双击一个「非列表第一行」的会话 → 打开的详情块面板的
//      [data-detail-session-key] 必须逐字等于被点行的 [data-session-key]。
//      （修前 bug：绑定解析结果被「列表第一行」覆盖，点旧行打开的是最新会话。）
//   2. 已有详情块时再双击另一行 → 面板 key 切到新点的行（并成 Tab / 聚焦路径）。
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误（本机 session 索引为空属环境问题）。

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { DEFAULTS, ensureInstance } from "../lib/launch.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep } from "../lib/probes.mjs";
import { createReporter } from "../lib/report.mjs";

const AREA = "aisessions-detail-binding";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

const reporter = createReporter({ area: AREA, mode: attach ? "attach" : "launch+reset" });
let instance = null;

// 行快照：只取可见、带 key 的行（__new__ 占位不算会话）。
const ROWS_FN = `(() => {
    const rows = Array.from(document.querySelectorAll('[data-session-key]'));
    return rows
        .map((el) => {
            const br = el.getBoundingClientRect();
            return {
                key: el.dataset.sessionKey || '',
                x: Math.round(br.left + br.width / 2),
                y: Math.round(br.top + br.height / 2),
                visible: br.width > 40 && br.height > 12,
            };
        })
        .filter((r) => r.key !== '' && r.key !== '__new__' && r.visible);
})()`;

// 面板快照：所有已挂载详情面板渲染的会话 key。
const PANES_FN = `(() =>
    Array.from(document.querySelectorAll('[data-detail-session-key]')).map((el) => ({
        key: el.dataset.detailSessionKey || '',
        w: Math.round(el.getBoundingClientRect().width),
    }))
)()`;

// 真实指针双击（React onDoubleClick 需要真实的两次 press/release，clickCount=2）。
async function realDblClick(client, pt) {
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

/** 轮询到面板集合包含 targetKey。返回最终面板快照。 */
async function waitPaneHasKey(client, targetKey, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    last = await client.evaluate(PANES_FN);
    if (last.some((p) => p.key === targetKey)) return last;
    await sleep(700);
  }
  return last;
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

  // 列表要真的渲染出会话行（本地 session 索引）。
  let rows = [];
  const rowsDeadline = Date.now() + 45000;
  while (Date.now() < rowsDeadline) {
    rows = await client.evaluate(ROWS_FN);
    if (rows.length >= 2) break;
    await sleep(800);
  }
  if (rows.length < 2) {
    reporter.fatal(
      new Error(
        `本机 session 索引不足（rows=${rows.length}，需要 ≥2 才能验证「点的不是第一行」）。属环境问题，不是断言失败。`
      )
    );
  }
  reporter.check("sessions-list-rendered", true, `rows=${rows.length}`);

  // ── 判据 1：双击非第一行 → 面板 key 逐字等于被点行，不等于列表第一行 ──
  const firstKey = rows[0].key;
  const target1 = rows[1];
  reporter.log(`dblclick row[1] key=${target1.key.slice(0, 24)}… (first=${firstKey.slice(0, 24)}…)`);
  await realDblClick(client, target1);
  const panes1 = await waitPaneHasKey(client, target1.key, 30000);
  await reporter.shot(client, "01-detail-opened");
  reporter.check(
    "pane-key-equals-clicked-row",
    panes1.some((p) => p.key === target1.key),
    `clicked=${target1.key.slice(0, 32)} panes=${JSON.stringify(panes1.map((p) => p.key.slice(0, 24)))}`
  );
  reporter.check(
    "pane-key-not-list-first-row",
    target1.key !== firstKey && panes1.some((p) => p.key === target1.key) && !panes1.some((p) => p.key === firstKey),
    "面板显示的是被点的第二行，不是列表第一行（修前 bug：点旧行打开最新会话）"
  );

  // ── 判据 2：已有详情块，再双击另一行 → 面板切到新点的行 ──
  const target2 = rows[Math.min(2, rows.length - 1)];
  if (target2.key === target1.key || target2.key === firstKey) {
    reporter.log(`rows 不足以再挑一个不同的目标行（rows=${rows.length}），跳过判据 2`);
    reporter.finish({
      skipped: [`判据 2（再点另一行切换面板）：本机会话行不足（rows=${rows.length}）`],
      cleanup: () => {
        client.close?.();
        if (instance?.spawned && !keepOpen) instance.cleanup?.();
      },
    });
  }
  reporter.log(`dblclick rows[2] key=${target2.key.slice(0, 24)}…`);
  await realDblClick(client, target2);
  const panes2 = await waitPaneHasKey(client, target2.key, 30000);
  await reporter.shot(client, "02-detail-switched");
  reporter.check(
    "pane-key-switches-to-second-clicked-row",
    panes2.some((p) => p.key === target2.key),
    `clicked=${target2.key.slice(0, 32)} panes=${JSON.stringify(panes2.map((p) => p.key.slice(0, 24)))}`
  );

  reporter.finish({
    skipped: [
      "bound-id-not-found 端到端（A5）：无 UI 入口可直接绑定伪造 id，该分支由 detail-binding.test.ts 的 detailFallbackDecision 纯单测机器判定",
    ],
    cleanup: () => {
      client.close?.();
      if (instance?.spawned && !keepOpen) instance.cleanup?.();
    },
  });
} catch (err) {
  reporter.fatal(err, { cleanup: () => instance?.cleanup?.() });
}
