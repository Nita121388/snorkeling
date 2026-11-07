#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Files Block header「锁存式悬停分区」真机验证台。
//
// 覆盖 PRD A3–A7：
//   A3 header-visible-no-clip    任何宽度下 header 内可见 icon 都不被硬切
//   A4 header-reach-invariant    可见 + 溢出菜单项 + （无浮层）= total（不漏功能）
//   A5 header-latch-no-flip      进入后横穿全宽（含越过中线的 icon）不翻区
//   A6 header-grace-keep/expire  宽限内回来保持方向；超过宽限才允许切换
//   A7 header-latch-independent  锁存与 isHovered 解耦（锁存变化不驱动 reveal 显隐）
//
//   node scripts/verify/header-hover-latch/verify.mjs             # 干净实例 → 跑 → 关
//   node scripts/verify/header-hover-latch/verify.mjs --attach     # 复用实例（迭代）
//   node scripts/verify/header-hover-latch/verify.mjs --keep-open  # 跑完留着看
//   node scripts/verify/header-hover-latch/verify.mjs --dry        # 只解析依赖
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { listPageTargets, connectToTarget } from "../lib/cdp.mjs";
import { ensureInstance, DEFAULTS } from "../lib/launch.mjs";
import { createReporter } from "../lib/report.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep } from "../lib/probes.mjs";

const AREA = "header-hover-latch";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

const reporter = createReporter({ area: AREA, mode: attach ? "attach" : "launch+reset" });
let instance = null;

/**
 * 找一个带 Files/Preview header 的 block，返回它的 header 矩形与统计。
 * 找不到就返回 null（调用方决定是 skipped 还是失败）。
 */
const HEADER_PROBE = `
(() => {
  const hdrs = Array.from(document.querySelectorAll('[data-role="block-header"]'))
    .filter((h) => h.offsetWidth > 0 && h.offsetHeight > 0);
  if (hdrs.length === 0) return null;
  // 优先挑带 end-icons 的（preview / files block）
  const h = hdrs.find((x) => x.querySelector(".block-frame-end-icons")) || hdrs[0];
  const r = h.getBoundingClientRect();
  return {
    x: r.x, y: r.y, w: r.width, h: r.height,
    mid: r.x + r.width / 2,
    latched: h.dataset.latched ?? "",
    endIcons: !!h.querySelector(".block-frame-end-icons"),
    total: Number(h.querySelector(".block-frame-end-icons")?.dataset.headerTotal ?? -1),
    tier: Number(h.querySelector(".block-frame-end-icons")?.dataset.headerTier ?? -1),
    yieldFlag: h.querySelector(".block-frame-end-icons")?.dataset.headerYield ?? "",
  };
})()
`;

/**
 * 这一轮的几何快照：可见 icon 数、被硬切数、以及每个 icon 中心点。
 * 判据 A3 直接读它。
 */
const ICON_PROBE = `
(() => {
  const hdrs = Array.from(document.querySelectorAll('[data-role="block-header"]'))
    .filter((h) => h.offsetWidth > 0 && h.offsetHeight > 0);
  if (hdrs.length === 0) return null;
  const h = hdrs.find((x) => x.querySelector(".block-frame-end-icons")) || hdrs[0];
  const hr = h.getBoundingClientRect();
  const btns = Array.from(h.querySelectorAll('button[aria-label], .wave-iconbutton'))
    .filter((b) => {
      const r = b.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      // 只统计 header 里真正占据空间的（排除 display:none 的祖先）
      let p = b;
      while (p && p !== h) {
        const cs = getComputedStyle(p);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        p = p.parentElement;
      }
      return true;
    });
  const items = btns.map((b) => {
    const r = b.getBoundingClientRect();
    return {
      label: b.getAttribute("aria-label") || b.className || "?",
      cx: Math.round(r.x + r.width / 2),
      cy: Math.round(r.y + r.height / 2),
      right: Math.round(r.right * 10) / 10,
    };
  });
  const clipped = items.filter((i) => i.right > hr.right - 1).length;
  return {
    latched: h.dataset.latched ?? "",
    hr: { left: Math.round(hr.left), right: Math.round(hr.right), mid: Math.round(hr.left + hr.width / 2) },
    visible: items.length,
    clipped,
    items,
  };
})()
`;

/** 溢出菜单项数（点 … 之后读 ContextMenu 的 DOM）。 */
const MENU_PROBE = `
(() => {
  const nodes = Array.from(document.querySelectorAll(
    ".context-menu .context-menu-item, .context-menu li, [role='menuitem']"
  ));
  return nodes.filter((n) => n.offsetHeight > 0).length;
})()
`;

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

    // ── 前置：必须有一个带 end-icons 的 block header ─────────────────────
    let header = null;
    for (let i = 0; i < 20; i++) {
        header = await client.evaluate(HEADER_PROBE);
        if (header?.endIcons && header.total > 0) break;
        await sleep(800);
    }
    const headerReady = !!(header && header.endIcons && header.total > 0);
    reporter.check(
        "header-present",
        headerReady,
        headerReady
            ? `total=${header.total} tier=${header.tier} at ${Math.round(header.x)},${Math.round(header.y)} ${Math.round(header.w)}x${Math.round(header.h)}`
            : "没找到带 .block-frame-end-icons 的 block header（需要一个 Files/Preview 块）"
    );

    if (!headerReady) {
        reporter.finish({
            skipped: ["A3–A7 全部：没有可测的 Files/Preview block"],
            cleanup: () => {
                client.close?.();
                if (instance?.spawned && !keepOpen) instance.cleanup?.();
            },
        });
    }

    const hx = header.x;
    const hy = header.y + header.h / 2;
    const mid = header.mid;
    const total = header.total;

    // ── A5：进入右半后横穿全宽，data-latched 必须恒为 right ──────────────
    // 先离开，确保从中性开始
    await client.move(hx - 60, hy);
    await sleep(1200);

    await client.move(hx + header.w * 0.85, hy);
    await sleep(500);
    let snap = await client.evaluate(ICON_PROBE);
    const enterZone = snap?.latched ?? "";
    reporter.check("header-latch-enter-right", enterZone === "right", `进入 85% 后 data-latched="${enterZone}"`);

    const trace = [["enter@85%", enterZone]];
    let flip = null;
    // 沿全部可见 icon 逐个移过去（含已伸过中线的）
    for (const it of snap?.items ?? []) {
        await client.move(it.cx, it.cy);
        await sleep(160);
        const z = (await client.evaluate(ICON_PROBE))?.latched ?? "";
        trace.push([`move@${it.label} x=${it.cx} (mid=${mid})`, z]);
        if (z !== "right" && flip == null) {
            flip = `${it.label} @x=${it.cx} → "${z}"（mid=${mid}）`;
        }
    }
    // 再横穿到最左
    for (const frac of [0.5, 0.3, 0.1, 0.03]) {
        await client.move(hx + header.w * frac, hy);
        await sleep(140);
        const z = (await client.evaluate(ICON_PROBE))?.latched ?? "";
        trace.push([`move@${Math.round(frac * 100)}%`, z]);
        if (z !== "right" && flip == null) flip = `横穿到 ${Math.round(frac * 100)}% → "${z}"`;
    }
    reporter.check(
        "header-latch-no-flip",
        flip == null,
        flip ?? `横穿全宽（含 ${snap?.items?.length ?? 0} 个 icon）全程 data-latched="right"，未翻区`
    );

    // ── A3：此刻 header 内可见 icon 无硬切 ──────────────────────────────
    snap = await client.evaluate(ICON_PROBE);
    reporter.check(
        "header-visible-no-clip",
        (snap?.clipped ?? -1) === 0,
        `可见 ${snap?.visible} 个，被硬切 ${snap?.clipped} 个（判据必须为 0）`
    );

    // ── A4：可见 + 溢出菜单项 === total ─────────────────────────────────
    const visibleRight = snap?.visible ?? 0;
    let menuCount = 0;
    // 点 … （溢出入口）
    const overflowBtn = await client.evaluate(`
      (() => {
        const h = Array.from(document.querySelectorAll('[data-role="block-header"]'))
          .find((x) => x.querySelector(".block-frame-end-icons"));
        if (!h) return null;
        const b = h.querySelector(".hdr-icon-overflow")
          || Array.from(h.querySelectorAll("button")).find((x) => (x.getAttribute("aria-label")||"").startsWith("More"));
        if (!b) return null;
        const r = b.getBoundingClientRect();
        if (r.width <= 0) return null;
        return { cx: Math.round(r.x + r.width/2), cy: Math.round(r.y + r.height/2) };
      })()
    `);
    if (overflowBtn) {
        await client.click(overflowBtn.cx, overflowBtn.cy);
        await sleep(600);
        menuCount = await client.evaluate(MENU_PROBE);
        await reporter.shot(client, "02-overflow-menu");
        // 关掉菜单
        await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 })
            .catch(() => {});
        await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 })
            .catch(() => {});
        await sleep(300);
    }
    reporter.check(
        "header-reach-invariant",
        visibleRight + menuCount === total,
        `可见 ${visibleRight} + 溢出菜单 ${menuCount} = ${visibleRight + menuCount}，total=${total}` +
            (overflowBtn ? "" : "（未找到 … 入口，菜单项按 0 计）")
    );

    await reporter.shot(client, "03-latched-right");

    // ── A6：宽限语义 ────────────────────────────────────────────────────
    // 先确保右侧锁存
    await client.move(hx + header.w * 0.85, hy);
    await sleep(400);
    const beforeLeave = (await client.evaluate(ICON_PROBE))?.latched ?? "";
    // 离开 header（向上出界）
    await client.move(hx + header.w * 0.5, hy - header.h - 80);
    await sleep(100);
    // 宽限内（<400ms）从左侧回来
    await client.move(hx + header.w * 0.1, hy);
    await sleep(220);
    const afterGraceKeep = (await client.evaluate(ICON_PROBE))?.latched ?? "";
    reporter.check(
        "header-grace-keep",
        beforeLeave === "right" && afterGraceKeep === "right",
        `离开前 "${beforeLeave}"，宽限内从左侧 10% 回来 → "${afterGraceKeep}"（应仍为 right）`
    );

    // 离开并等过宽限，再从左侧进入 → 应切 left
    await client.move(hx + header.w * 0.5, hy - header.h - 80);
    await sleep(900);
    const afterExpire = (await client.evaluate(ICON_PROBE))?.latched ?? "";
    await client.move(hx + header.w * 0.1, hy);
    await sleep(400);
    const afterSwitch = (await client.evaluate(ICON_PROBE))?.latched ?? "";
    reporter.check(
        "header-grace-expire",
        afterExpire === "" && afterSwitch === "left",
        `超过宽限后 data-latched="${afterExpire || "(空)"}"，再从左侧 10% 进入 → "${afterSwitch}"（应 left）`
    );

    await reporter.shot(client, "04-latched-left");

    // ── A3 复测：左锁时也不硬切 ────────────────────────────────────────
    const snapLeft = await client.evaluate(ICON_PROBE);
    reporter.check(
        "header-visible-no-clip-left",
        (snapLeft?.clipped ?? -1) === 0,
        `左锁：可见 ${snapLeft?.visible} 个，被硬切 ${snapLeft?.clipped} 个`
    );

    // ── A7：锁存与 isHovered 解耦 ───────────────────────────────────────
    // isHovered 控制 .block-frame-end-icons.is-hovered；锁存控制 data-latched。
    // 断言：锁存为 left 时，容器仍有 is-hovered（因为指针在 header 内），
    // 且两者是不同属性 —— 不允许锁存变化导致 is-hovered 消失。
    const decoupled = await client.evaluate(`
      (() => {
        const h = Array.from(document.querySelectorAll('[data-role="block-header"]'))
          .find((x) => x.querySelector(".block-frame-end-icons"));
        if (!h) return null;
        const end = h.querySelector(".block-frame-end-icons");
        return {
          latched: h.dataset.latched ?? "",
          isHovered: end.classList.contains("is-hovered"),
          hasYieldAttr: end.hasAttribute("data-header-yield"),
          hasTierAttr: end.hasAttribute("data-header-tier"),
        };
      })()
    `);
    reporter.check(
        "header-latch-independent-of-hover",
        decoupled != null &&
            decoupled.latched === "left" &&
            decoupled.isHovered === true &&
            decoupled.hasYieldAttr &&
            decoupled.hasTierAttr,
        `latched="${decoupled?.latched}" isHovered=${decoupled?.isHovered} yieldAttr=${decoupled?.hasYieldAttr} tierAttr=${decoupled?.hasTierAttr}`
    );

    // ── 让位验证：右锁时左区宽度 < 中性时 ───────────────────────────────
    const leftZoneWidth = () =>
        client.evaluate(`
          (() => {
            const h = Array.from(document.querySelectorAll('[data-role="block-header"]'))
              .find((x) => x.querySelector(".block-frame-end-icons"));
            const z = h?.querySelector(".block-frame-header-left-zone");
            if (!z) return null;
            return { w: Math.round(z.getBoundingClientRect().width * 10) / 10, latched: h.dataset.latched ?? "" };
          })()
        `);
    const leftZoneNow = await leftZoneWidth();
    await client.move(hx + header.w * 0.9, hy);
    await sleep(500);
    const leftZoneRight = await leftZoneWidth();
    reporter.check(
        "header-yield-left-frees-width",
        leftZoneNow != null && leftZoneRight != null && leftZoneRight.w <= leftZoneNow.w,
        `左锁时左区宽 ${leftZoneNow?.w}px → 右锁时 ${leftZoneRight?.w}px（右锁必须 ≤ 左锁；让位生效时通常为 0）`
    );

    await reporter.log("trace: " + JSON.stringify(trace, null, 0));

    reporter.finish({
        skipped: [
            "宽松度分档（40/62/88/120/160/192/240/300/360/520 逐档）：窗口内无法可靠设置 block 尺寸，改由单测 A1 的 w∈[40..900] step 2 全覆盖",
            "term / aisessions 存量面回归：需按 view 类型造块，本台只验 Files header；由 9.2 人工确认",
        ],
        cleanup: () => {
            client.close?.();
            if (instance?.spawned && !keepOpen) instance.cleanup?.();
        },
    });
} catch (err) {
    reporter.fatal(err, { cleanup: () => instance?.cleanup?.() });
}
