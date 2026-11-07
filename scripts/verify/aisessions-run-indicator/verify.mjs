#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AI Sessions 行内「运行中」指示的验证台（真机 Electron 窗口）。
//
//   node scripts/verify/aisessions-run-indicator/verify.mjs             # 干净实例 → 跑 → 自动关
//   node scripts/verify/aisessions-run-indicator/verify.mjs --attach     # 复用已起实例
//   node scripts/verify/aisessions-run-indicator/verify.mjs --keep-open  # 结束后留着看
//   node scripts/verify/aisessions-run-indicator/verify.mjs --dry        # 只解析依赖
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。
//
// 验的是什么（全部来自这次改动）：
//   1. 左列 `RunningDot` 是单点、不再是 animate-spin 的 4 点方框（防视觉回退）
//   2. 右侧运行徽章真的在 `row-meta` 内、是最后一个子元素、`ml-auto` 贴右
//   3. 徽章高度 15px（元信息行是 11px 字），且颜色用 --agent-working-color 蓝
//   4. 没有第二个「运行中」标记：旧的 `GUI Chat` spinner 已经消失
//
// 为什么必须在真机跑：这些判据全依赖 computed style 与 getBoundingClientRect，
// jsdom 里既没有布局也没有 CSS 变量解析，单测只能锁 markup 形状。

import { listPageTargets, connectToTarget } from "../lib/cdp.mjs";
import { ensureInstance, DEFAULTS } from "../lib/launch.mjs";
import { createReporter } from "../lib/report.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep } from "../lib/probes.mjs";

const AREA = "aisessions-run-indicator";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

const reporter = createReporter({ area: AREA, mode: attach ? "attach" : "launch+reset" });
let instance = null;

if (dry) {
    reporter.log("dry-run: 依赖解析成功（未启动 GUI）");
    reporter.check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs");
    reporter.finish({ cleanup: null });
}

/**
 * 快照：一次拿齐所有判据需要的 DOM/样式值，避免多次往返导致中间态失真。
 *
 * 选择器对齐 session-row.tsx 的真实 DOM：
 *   .row-lead .session-row-live-dot-slot   ← RunningDot 按钮
 *   .row-lead .session-row-live-dot        ← 单点
 *   .row-meta .ml-auto                     ← 右侧徽章 wrapper
 *   .row-meta .session-run-badge           ← 徽章本体
 */
const SNAPSHOT_FN = `
    (() => {
        const rows = [...document.querySelectorAll("[data-session-key]")];
        const out = { rows: 0, leads: [], badges: [], guiChatSpinners: 0 };
        out.rows = rows.length;
        for (const row of rows) {
            const key = row.getAttribute("data-session-key") || "";
            const lead = row.querySelector(".row-lead");
            const slot = row.querySelector(".row-lead .session-row-live-dot-slot");
            const dot = row.querySelector(".row-lead .session-row-live-dot");
            if (slot != null) {
                const s = getComputedStyle(slot);
                const d = dot != null ? getComputedStyle(dot) : null;
                const dr = dot != null ? dot.getBoundingClientRect() : null;
                out.leads.push({
                    key,
                    slotClass: slot.className,
                    slotAnimation: s.animationName,
                    dotExists: dot != null,
                    dotW: dr != null ? Math.round(dr.width) : 0,
                    dotH: dr != null ? Math.round(dr.height) : 0,
                    dotBg: d != null ? d.backgroundColor : null,
                    dotAnimation: d != null ? d.animationName : null,
                });
            }
            const meta = row.querySelector(".row-meta");
            const wrapper = meta != null ? meta.querySelector(".ml-auto") : null;
            const badge = meta != null ? meta.querySelector(".session-run-badge") : null;
            if (badge != null) {
                const br = badge.getBoundingClientRect();
                const mr = meta.getBoundingClientRect();
                const kids = [...meta.children];
                const cs = getComputedStyle(badge);
                out.badges.push({
                    key,
                    inMeta: badge.closest(".row-meta") != null,
                    wrapperIsLastChild: wrapper != null && kids[kids.length - 1] === wrapper,
                    wrapperMarginLeft: wrapper != null ? getComputedStyle(wrapper).marginLeft : null,
                    wrapperFlexShrink: wrapper != null ? getComputedStyle(wrapper).flexShrink : null,
                    height: Math.round(br.height),
                    gapToMetaRight: Math.round(mr.right - br.right),
                    color: cs.color,
                    tone: badge.getAttribute("data-run-tone"),
                    label: (badge.querySelector(".session-run-badge-label") || {}).textContent || "",
                    runtime: (badge.querySelector(".session-run-badge-runtime") || {}).textContent || "",
                    fontSize: cs.fontSize,
                });
            }
            // 旧的第二个运行标记：行内 GUI Chat spinner 必须已经不存在
            out.guiChatSpinners += row.querySelectorAll(".row-meta .fa-spinner").length;
        }
        return out;
    })()
`;

/** 打开 AI Sessions 视图（走命令面板，不依赖已有布局）。 */
async function openAisessionsView(client, log) {
    // 关掉可能存在的其他弹窗
    await client.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape" }).catch(() => {});
    await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" }).catch(() => {});

    const opened = await client.evaluate(`(() => {
        const btn = document.querySelector('[aria-label="AI Sessions"], [title="AI Sessions"]');
        if (btn == null) return false;
        btn.click();
        return true;
    })()`);
    log(`open aisessions via widget button: ${opened}`);
    return opened;
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

    const opened = await openAisessionsView(client, reporter.log);
    reporter.check("aisessions-view-opened", opened === true, "右侧 WidgetsBar 上找到 AI Sessions 入口");

    // 列表要真的渲染出行（读本地 session 索引，可能需要一点时间）
    let snapshot = null;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
        snapshot = await client.evaluate(SNAPSHOT_FN);
        if (snapshot != null && snapshot.rows > 0) break;
        await sleep(800);
    }
    reporter.check(
        "sessions-list-rendered",
        snapshot != null && snapshot.rows > 0,
        `rows=${snapshot?.rows ?? 0}（本地没有 session 索引会导致这条红，属于环境问题）`
    );
    await reporter.shot(client, "01-sessions-list");

    // ── 判据 1：左列不再有 animate-spin 的 4 点方框 ──
    // 只有「有活跃块」的行才会渲染 RunningDot，所以 leads 可能为空。
    const leads = snapshot?.leads ?? [];
    if (leads.length === 0) {
        reporter.log("当前没有任何活跃块 → 左列 RunningDot 与右侧 agent 徽章分支无法覆盖");
    } else {
        for (const lead of leads) {
            reporter.check(
                `running-dot-single-node[${lead.key.slice(0, 24)}]`,
                lead.dotExists === true && lead.dotW === 6 && lead.dotH === 6,
                `dot=${lead.dotW}x${lead.dotH}`
            );
            reporter.check(
                `running-dot-no-spin[${lead.key.slice(0, 24)}]`,
                !lead.slotClass.includes("animate-spin") && lead.slotAnimation === "none",
                `slotAnim=${lead.slotAnimation}`
            );
            reporter.check(
                `running-dot-uses-working-color[${lead.key.slice(0, 24)}]`,
                isWorkingBlue(lead.dotBg),
                `bg=${lead.dotBg}`
            );
            reporter.check(
                `running-dot-breathes[${lead.key.slice(0, 24)}]`,
                lead.dotAnimation === "session-row-live-dot-breathe",
                `anim=${lead.dotAnimation}`
            );
        }
    }

    // ── 判据 2/3：右侧徽章的位置、高度、颜色 ──
    const badges = snapshot?.badges ?? [];
    if (badges.length === 0) {
        reporter.log("当前没有渲染任何运行徽章 → 右侧分支无法覆盖（没有活跃块且没有 GUI 对话）");
    } else {
        for (const badge of badges) {
            const tag = badge.key.slice(0, 24);
            reporter.check(`badge-in-row-meta[${tag}]`, badge.inMeta === true, "badge.closest(.row-meta)");
            reporter.check(
                `badge-wrapper-last-child[${tag}]`,
                badge.wrapperIsLastChild === true,
                `wrapper 必须是 row-meta 的最后一个子元素`
            );
            reporter.check(
                `badge-wrapper-ml-auto[${tag}]`,
                badge.wrapperMarginLeft === "auto",
                `marginLeft=${badge.wrapperMarginLeft}`
            );
            reporter.check(`badge-height-15[${tag}]`, badge.height === 15, `h=${badge.height}px`);
            reporter.check(
                `badge-hugs-right-edge[${tag}]`,
                Math.abs(badge.gapToMetaRight) <= 2,
                `gap=${badge.gapToMetaRight}px`
            );
            if (badge.tone === "agent" || badge.tone === "live") {
                reporter.check(`badge-working-blue[${tag}]`, isWorkingBlue(badge.color), `color=${badge.color}`);
            }
            if (badge.tone === "agent" && badge.label !== "Idle" && badge.label !== "Done") {
                // working/stale 才带跑时；具体文案随 phase 变，这里只要求非空
                reporter.check(
                    `badge-has-runtime[${tag}]`,
                    badge.runtime.length > 0,
                    `label=${badge.label} runtime="${badge.runtime}"`
                );
            }
        }
    }

    // ── 判据 4：没有第二个「运行中」标记 ──
    reporter.check(
        "no-second-running-marker",
        (snapshot?.guiChatSpinners ?? 0) === 0,
        `row-meta 内 .fa-spinner 数量 = ${snapshot?.guiChatSpinners ?? "?"}`
    );

    const coveredLeft = leads.length > 0;
    const coveredRight = badges.length > 0;
    await reporter.shot(client, "02-final");

    reporter.finish({
        skipped: [
            !coveredLeft ? "左列 RunningDot：本机当前没有活跃块，未覆盖" : null,
            !coveredRight ? "右侧运行徽章：本机当前没有活跃块或 GUI 对话，未覆盖" : null,
        ].filter(Boolean),
        cleanup: () => {
            client.close?.();
            if (instance?.spawned && !keepOpen) instance.cleanup?.();
        },
    });
} catch (err) {
    reporter.fatal(err, { cleanup: () => instance?.cleanup?.() });
}

/** 黑色主题 #3b82f6 = rgb(59,130,246)；亮色主题 #2563eb = rgb(37,99,235)。 */
function isWorkingBlue(value) {
    if (typeof value !== "string") return false;
    return value === "rgb(59, 130, 246)" || value === "rgb(37, 99, 235)";
}
