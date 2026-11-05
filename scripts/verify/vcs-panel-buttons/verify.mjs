#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 版本管理面板：文字按钮图标化 —— 真机 CDP 验证（11-05-vcs-panel-icon-buttons 的验收断言）。
//
//   node scripts/verify/vcs-panel-buttons/verify.mjs            # 连已开的干净实例
//   node scripts/verify/vcs-panel-buttons/verify.mjs --attach    # 同上（显式）
//   node scripts/verify/vcs-panel-buttons/verify.mjs --keep-open # 跑完留实例人工看图
//   node scripts/verify/vcs-panel-buttons/verify.mjs --dry       # 只解析依赖
//
// 前置：应用里已经打开一个「版本管理 / Version Control」块（锚点 = [data-vcs-tab]）。
// 没有就退出码 2（环境错误），不做"静默跳过"。
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { connectToTarget, listPageTargets, waitFor } from "../lib/cdp.mjs";
import { DEFAULTS } from "../lib/launch.mjs";
import { dismissOnboarding, sleep } from "../lib/probes.mjs";
import { createReporter, repoRoot } from "../lib/report.mjs";

const AREA = "vcs-panel-buttons";
const argv = process.argv.slice(2);
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");
const portArg = argv.find((a) => a.startsWith("--port=")) ?? argv[argv.indexOf("--port") + 1];
const cdpPort = Number(portArg) > 0 ? Number(portArg) : DEFAULTS.cdpPort;

const mode = "attach";
const reporter = createReporter({ area: AREA, mode });

if (dry) {
    reporter.log("dry-run: 依赖解析成功（未启动 GUI）");
    reporter.check("deps-resolve", true, "lib/{cdp,launch,probes,report}.mjs");
    reporter.finish({ cleanup: null, ledger: false });
}

/**
 * 一次性把面板的状态扫出来。
 * 统计面 = 含 [data-vcs-tab] 的那个 block frame。
 */
const SCAN_JS = `(() => {
    const anchor = document.querySelector('[data-vcs-tab="1"]');
    if (anchor == null) return null;
    const frame = anchor.closest("[data-blockid]") || anchor.closest(".block") || document.body;
    const LEGACY = [
        "Diff", "History", "Select All", "Select None", "Reset", "Apply", "Prev", "Next",
        "View Diff", "Refresh", "Create & Switch", "Update", "Pull", "Push", "Fetch", "Yes", "No",
    ];
    const clean = (s) => (s || "").replace(/\\u200e/g, "").replace(/\\s+/g, " ").trim();
    // 导航 Tab（data-vcs-tab）和图标按钮本来就不在"文字按钮"口径里
    const buttons = [...frame.querySelectorAll("button")].filter(
        (b) => b.getAttribute("data-vcs-tab") == null && b.getAttribute("data-vcs-icon-button") == null
    );
    const legacyHits = buttons
        .map((b) => ({ text: clean(b.innerText), title: b.getAttribute("title") || "" }))
        .filter((b) => b.text !== "" && LEGACY.includes(b.text));
    const iconButtons = [...frame.querySelectorAll("[data-vcs-icon-button]")];
    const missingAria = iconButtons
        .filter((b) => (b.getAttribute("aria-label") || "").trim() === "")
        .map((b) => b.getAttribute("title") || "(no title)");
    const unresolved = iconButtons
        .filter((b) => {
            const i = b.querySelector("i");
            if (i == null) return true;
            const c = getComputedStyle(i, "::before").content;
            return c === "none" || c === "normal" || c === '""' || c === "";
        })
        .map((b) => b.getAttribute("title") || "(no title)");
    const tabs = [...frame.querySelectorAll('[data-vcs-tab="1"]')].map((b) => clean(b.innerText));
    const reveal = iconButtons.filter((b) => /(^|\\s)opacity-0(\\s|$)/.test(b.className));
    const revealSample = reveal[0] ?? null;
    let revealRect = null;
    if (revealSample != null) {
        // 列表行是 w-max（可横向滚动），行尾按钮默认可能在视口外 —— 先滚进视口再量
        revealSample.scrollIntoView({ block: "nearest", inline: "center" });
        const r = revealSample.getBoundingClientRect();
        const inside =
            r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0 && r.x + r.width <= innerWidth && r.y + r.height <= innerHeight;
        revealRect = inside
            ? { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, title: revealSample.title }
            : null;
    }
    return {
        legacyHits,
        missingAria,
        unresolved,
        tabs,
        counts: {
            buttons: buttons.length,
            iconButtons: iconButtons.length,
            tabs: tabs.length,
            reveal: reveal.length,
        },
        revealOpacity: revealSample != null ? getComputedStyle(revealSample).opacity : null,
        revealRect,
    };
})()`;

const REVEAL_OPACITY_JS = `(() => {
    const anchor = document.querySelector('[data-vcs-tab="1"]');
    if (anchor == null) return null;
    const frame = anchor.closest("[data-blockid]") || document.body;
    const btn = [...frame.querySelectorAll("[data-vcs-icon-button]")].find((b) =>
        /(^|\\s)opacity-0(\\s|$)/.test(b.className)
    );
    if (btn == null) return null;
    return getComputedStyle(btn).opacity;
})()`;

let client = null;
try {
    const endpoint = `http://127.0.0.1:${cdpPort}`;
    const pages = (await listPageTargets(endpoint).catch(() => [])).filter((t) => /index\.html/.test(t.url ?? ""));
    if (pages.length === 0) {
        throw new Error(
            `没有可连的实例（${endpoint}）。用专用 profile / 端口起一个（不会踩到别的 agent 的 .runcfg/verify）：\n` +
                `  node scripts/dev-isolated.mjs --profile vcs-icons --vite-port 51798 --cdp-port 9232\n` +
                `  node scripts/verify/vcs-panel-buttons/verify.mjs --port 9232`
        );
    }

    // 多窗口实例里，直接取第一个 page target 常连到空白窗口 —— 逐个探测，
    // 优先选"已经打开了一个版本管理块"的那个窗口。
    const probed = [];
    for (const page of pages) {
        const c = await connectToTarget(endpoint, page).catch(() => null);
        if (c == null) continue;
        const hasTab = await c.evaluate(`document.querySelector('[data-vcs-tab="1"]') != null`).catch(() => false);
        const blocks = await c.evaluate(`document.querySelectorAll("[data-blockid]").length`).catch(() => 0);
        probed.push({ client: c, page, hasTab, blocks });
    }
    if (probed.length === 0) {
        throw new Error(`CDP ${endpoint} 上的 page target 都连不上`);
    }
    let picked = probed.find((p) => p.hasTab) ?? probed.sort((a, b) => b.blocks - a.blocks)[0];
    client = picked.client;
    for (const p of probed) if (p !== picked) p.client.close();
    reporter.log(
        `instance ready (attach ${endpoint}, targets=${probed.length}, picked hasTab=${picked.hasTab} blocks=${picked.blocks})`
    );
    await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    await dismissOnboarding(client, { log: reporter.log });

    // 新鲜 profile 的实例里没有 VCS 块 → 用 app 自己的 createBlock 建一个（与 lib/open.mjs 同一套候选路径）。
    let openResult = picked.hasTab ? "reuse" : null;
    for (let attempt = 0; openResult == null && attempt < 2; attempt++) {
        openResult = await client.evaluate(`(async () => {
            if (document.querySelector('[data-vcs-tab="1"]') != null) return "reuse";
            try {
                const mod = await import("/frontend/app/store/global.ts");
                if (typeof mod.createBlock !== "function") return "no-createBlock";
                await mod.createBlock({ meta: { view: "vcs", "vcs:path": ${JSON.stringify(repoRoot)} } }, false, false);
                return "created";
            } catch (err) {
                return "error: " + String(err && err.message ? err.message : err).slice(0, 160);
            }
        })()`);
        if (openResult !== "reuse" && openResult !== "created") await sleep(500);
    }
    reporter.log(`vcs block: ${openResult}`);
    const appeared = await waitFor(client, `document.querySelector('[data-vcs-tab="1"]') != null`, {
        timeoutMs: 20000,
        label: "vcs tab bar",
    }).catch(() => false);
    if (!appeared) {
        throw new Error(`建 VCS 块失败（${openResult}）—— 手工打开一个版本管理块再跑`);
    }

    // 等首个仓库扫描完成（tab 出现后列表/按钮才会渲染）
    await sleep(1500);

    let scan = await client.evaluate(SCAN_JS);
    if (scan == null) {
        // 刚建的块可能被一次 HMR / 布局重建清掉 —— 再等一轮
        await sleep(2000);
        scan = await client.evaluate(SCAN_JS);
    }
    if (scan == null) {
        throw new Error("面板扫描不到 [data-vcs-tab] —— 版本管理块被关掉或渲染失败");
    }

    // ① 导航 Tab 仍然是 icon + 文字（导航需要自解释，刻意保留）
    reporter.check(
        "tabbar-labels",
        scan.tabs.length === 4 && scan.tabs.every((t) => t.length > 0),
        scan.tabs.join(" / ")
    );

    const TAB_ORDER = ["changes", "branches", "pipelines", "history"];
    const TAB_LABEL = { changes: "Changes", branches: "Branches", pipelines: "Pipelines", history: "History" };

    const switchTab = async (view) => {
        const wanted = TAB_LABEL[view];
        const ok = await client.evaluate(`(() => {
            const anchor = document.querySelector('[data-vcs-tab="1"]');
            const frame = (anchor && anchor.closest("[data-blockid]")) || document.body;
            const btn = [...frame.querySelectorAll('[data-vcs-tab="1"]')].find(
                (b) => (b.innerText || "").trim().startsWith(${JSON.stringify(wanted)})
            );
            if (btn == null || btn.disabled) return false;
            btn.click();
            return true;
        })()`);
        await sleep(1100);
        return ok;
    };

    const scanAndAssert = (view, s) => {
        reporter.check(
            `no-legacy-text-buttons-${view}`,
            s.legacyHits.length === 0,
            s.legacyHits.length === 0
                ? `scanned ${s.counts.buttons} text-capable buttons`
                : JSON.stringify(s.legacyHits)
        );
        reporter.check(
            `icon-buttons-aria-${view}`,
            s.missingAria.length === 0 && s.counts.iconButtons > 0,
            `${s.counts.iconButtons} icon buttons, missing=${JSON.stringify(s.missingAria)}`
        );
        reporter.check(
            `icons-resolve-${view}`,
            s.unresolved.length === 0,
            s.unresolved.length === 0 ? "all ::before content resolved" : JSON.stringify(s.unresolved)
        );
    };

    scanAndAssert("changes", scan);

    const skipped = [];
    for (const view of TAB_ORDER.slice(1)) {
        const clicked = await switchTab(view);
        if (!clicked) {
            skipped.push(`${view}（Tab 不可点击，可能是 SVN 仓库或缺数据）`);
            continue;
        }
        const s = await client.evaluate(SCAN_JS);
        if (s == null) {
            skipped.push(`${view}（切过去后找不到面板锚点）`);
            continue;
        }
        scanAndAssert(view, s);
        await reporter.shot(client, `tab-${view}`);
    }

    // ⑤ 行内动作默认隐藏，hover 后才现身（回到 Changes 再测）
    await switchTab("changes");
    const revealScan = await client.evaluate(SCAN_JS);
    if (revealScan == null || revealScan.counts.reveal === 0 || revealScan.revealRect == null) {
        skipped.push("reveal-hover（当前仓库没有落在视口内的行内动作）");
        reporter.log("skipped reveal-hover：没有可悬停的行内动作");
    } else {
        const opacityBefore = Number(revealScan.revealOpacity);
        const hx = Math.round(revealScan.revealRect.x);
        const hy = Math.round(revealScan.revealRect.y);
        // 两段移动：第一下只是移入路径上，第二下才落在按钮中心
        await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.max(1, hx - 240), y: hy });
        await sleep(140);
        await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hx, y: hy });
        await sleep(450);
        const opacityAfter = Number(await client.evaluate(REVEAL_OPACITY_JS));
        reporter.check(
            "reveal-hover",
            opacityBefore === 0 && opacityAfter === 1,
            `${revealScan.revealRect.title}: opacity ${opacityBefore} → ${opacityAfter}`
        );
    }

    await reporter.shot(client, "01-panel");
    reporter.finish({
        skipped: [...skipped, "「Commit」主按钮刻意保留文字（主 CTA 白名单，不在本台断言范围）"],
        cleanup: () => {
            if (keepOpen) return;
            client?.close?.();
        },
    });
} catch (err) {
    reporter.fatal(err, { cleanup: () => client?.close?.() });
}
