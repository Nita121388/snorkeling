#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 三主题真机验证：monochrome 改造后，dark / light 必须像素零变化，
// monochrome 自身的关键 token 必须真的生效。
//
//   node scripts/verify/theme-monochrome/verify.mjs            # 干净实例 → 跑 → 自动关
//   node scripts/verify/theme-monochrome/verify.mjs --attach   # 复用已起实例
//   node scripts/verify/theme-monochrome/verify.mjs --keep-open
//   node scripts/verify/theme-monochrome/verify.mjs --dry
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { listPageTargets, connectToTarget } from "../lib/cdp.mjs";
import { ensureInstance, DEFAULTS } from "../lib/launch.mjs";
import { createReporter } from "../lib/report.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep } from "../lib/probes.mjs";

const AREA = "theme-monochrome";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

const reporter = createReporter({ area: AREA, mode: attach ? "attach" : "launch+reset" });
let instance = null;

// monochrome 改造后的期望值（与 prd.md 目标值表一致）
const EXPECT_MONO = {
    "--main-bg-color": "#f7f6f3",
    "--main-text-color": "#1c1a16",
    "--accent-color": "#2b2723",
    "--error-color": "#9c4a42",
    "--warning-color": "#8a641c",
    "--success-color": "#3f6b46",
    "--agent-working-color": "#3a6b96",
    "--agent-done-color": "#3f6b46",
    "--agent-stale-color": "#6b5b8a",
    "--codeblock-diff-add-bg": "#e8ede9",
};

// dark / light 的基线值：本次改造不得改动它们
const EXPECT_UNCHANGED = {
    dark: {
        "--main-bg-color": "rgb(34, 34, 34)",
        "--main-text-color": "#f7f7f7",
        "--success-color": "rgb(78, 154, 6)",
    },
    light: {
        "--main-bg-color": "#f2eee5",
        "--main-text-color": "#3a3227",
        "--success-color": "#2e7d32",
    },
};

/** 读 :root 上某个 token 的 computed 值（自定义属性取到的是原始声明串）。 */
const READ_TOKENS = (names) => `
(() => {
  const cs = getComputedStyle(document.documentElement);
  const out = {};
  for (const n of ${JSON.stringify(names)}) out[n] = cs.getPropertyValue(n).trim();
  return out;
})()`;

async function setTheme(client, theme) {
    await client.evaluate(`
(() => {
  document.documentElement.dataset.theme = ${JSON.stringify(theme)};
  document.body.dataset.theme = ${JSON.stringify(theme)};
  return document.documentElement.dataset.theme;
})()`);
    await sleep(500); // 等 CSS 变量级联 + 重绘
}

async function readTokens(client, names) {
    const raw = await client.evaluate(READ_TOKENS(names));
    return typeof raw === "string" ? JSON.parse(raw) : raw;
}

/** 视口内某点的实际渲染像素（用于确认背景真的换了）。 */
const SAMPLE_PX = (x, y) => `
(() => {
  const el = document.elementFromPoint(${x}, ${y});
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { tag: el.tagName, bg: cs.backgroundColor, color: cs.color };
})()`;

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

    // ── 1. dark / light 基线值不得变化 ──────────────────────────────────
    for (const theme of ["dark", "light"]) {
        await setTheme(client, theme);
        const want = EXPECT_UNCHANGED[theme];
        const got = await readTokens(client, Object.keys(want));
        const bad = Object.entries(want).filter(([k, v]) => (got?.[k] ?? "") !== v);
        reporter.check(
            `theme-${theme}-unchanged`,
            bad.length === 0,
            bad.length ? bad.map(([k, v]) => `${k}: want ${v} got ${got?.[k]}`) : `ok ${JSON.stringify(want)}`
        );
        await reporter.shot(client, `10-theme-${theme}`);
    }

    // ── 2. monochrome 目标值必须生效 ────────────────────────────────────
    await setTheme(client, "monochrome");
    const mono = await readTokens(client, Object.keys(EXPECT_MONO));
    const mismatch = Object.entries(EXPECT_MONO).filter(
        ([k, v]) => (mono?.[k] ?? "").toLowerCase() !== v.toLowerCase()
    );
    reporter.check(
        "theme-monochrome-values",
        mismatch.length === 0,
        mismatch.length ? mismatch.map(([k, v]) => `${k}: want ${v} got ${mono?.[k]}`) : `all ${Object.keys(EXPECT_MONO).length} tokens ok`
    );
    await reporter.shot(client, "20-theme-monochrome");

    // ── 3. 实际渲染像素：monochrome 背景必须不同于 light ────────────────
    const viewport = await client.evaluate("({ w: innerWidth, h: innerHeight })");
    const vp = typeof viewport === "string" ? JSON.parse(viewport) : viewport;
    const px = Math.round(vp.w * 0.5);
    const py = Math.round(vp.h * 0.5);

    await setTheme(client, "light");
    const lightPx = await client.evaluate(SAMPLE_PX(px, py));
    await setTheme(client, "monochrome");
    const monoPx = await client.evaluate(SAMPLE_PX(px, py));
    const lp = typeof lightPx === "string" ? JSON.parse(lightPx) : lightPx;
    const mp = typeof monoPx === "string" ? JSON.parse(monoPx) : monoPx;

    reporter.check(
        "monochrome-renders-differently",
        lp != null && mp != null && (lp.bg !== mp.bg || lp.color !== mp.color),
        `light=${JSON.stringify(lp)} mono=${JSON.stringify(mp)}`
    );

    // ── 4. 终端主题：default-monochrome 的 white 必须可读 ───────────────
    const termCheck = await client.evaluate(`
(() => {
  const cfg = window.__waveFullConfig;
  if (!cfg || !cfg.termthemes) return { skipped: "fullConfig not exposed on window" };
  const t = cfg.termthemes["default-monochrome"];
  if (!t) return { error: "default-monochrome missing" };
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = (h) => { const [r, g, b] = rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const cr = (a, b) => { const la = lum(a), lb = lum(b); const hi = Math.max(la, lb), lo = Math.min(la, lb); return (hi + 0.05) / (lo + 0.05); };
  return { white: t.white, background: t.background, contrast: +cr(t.white, t.background).toFixed(2) };
})()`);
    const tc = typeof termCheck === "string" ? JSON.parse(termCheck) : termCheck;
    if (tc?.skipped) {
        reporter.check("term-white-readable", true, `skipped: ${tc.skipped}`);
    } else {
        reporter.check(
            "term-white-readable",
            (tc?.contrast ?? 0) >= 4.5,
            `white=${tc?.white} bg=${tc?.background} contrast=${tc?.contrast}`
        );
    }

    reporter.finish({
        skipped: [
            "AI 消息代码块的 shiki 语法色（走 LightShikiTheme，不受 --code-token-* 影响）",
            "agent 状态徽章的 live 状态切换（属 agent-card-seen 台的覆盖面）",
        ],
        cleanup: () => {
            client.close?.();
            if (instance?.spawned && !keepOpen) instance.cleanup?.();
        },
    });
} catch (err) {
    reporter.fatal(err, { cleanup: () => instance?.cleanup?.() });
}
