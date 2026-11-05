#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Agent 卡片 "Done 跟随 seen" —— 真机 CDP 验证（全自动 UI 流程，无人值守）。
//
// 为什么要有这个台子：`Done 不跟随 seen` 这个 bug 的判据是"用户看到的那一眼对不对"，
// 单测只覆盖了 read 判定表，覆盖不到「悬浮卡/标签卡真的换色了吗」。所以这里用真实
// 指针 + 真实键盘输入，跑完一整条链路：
//
//   1. 新建 Pi agent block（New Agent 面板 → Pi → TUI → 当前 Tab）→ 跑 pi 默认模型
//      iceman-contributor-free（provider: cc-switch-open-code-go，见 ~/.pi/agent/settings.json）。
//   2. 往 TUI 里发一句最小 prompt，等 agentstatus 走 working → Done。
//   3. 断言「未读 Done」在真实产品面上成立：
//        头部徽章      .agent-status-header.is-done-unread + 文案 "Done 3m"
//        悬浮卡 (E)    .agent-card-status-chip[data-agent-read=unread] + .agent-card-status-dot.is-done-unread
//        Tab 悬浮卡(G) .tab-card-agent-row[data-agent-read=unread] + pill 文案带 elapsed
//   4. 真实点击头部徽章 ack → 三个面同帧变 seen（is-acked / data-agent-read=seen / 文案回到 "Done"），
//      且 window.__diagDoneAck 里落下该 block 的 doneAckedAt。
//   5. 截图 + report.json / report.md。
//
// inline tab 圆点（B 面）与 Tab「更多」紧凑行（F 面）需要"同组多 tab / agent ≥2"的
// 工作区形态，这里不强行造场景 —— 它们的 read 一致性由
// frontend/app/agent-status/agent-status-cross-surface-read.test.ts 的契约用例覆盖，
// 报告里会写明。
//
// 用法：
//   node scripts/verify/agent-card-seen/verify.mjs              # 起干净实例 → 全流程 → 收尾关掉
//   node scripts/verify/agent-card-seen/verify.mjs --attach     # 复用已起实例（循环迭代用）
//   node scripts/verify/agent-card-seen/verify.mjs --keep-open  # 结束后不关实例
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误

import { readFileSync } from "node:fs";
import path from "node:path";
import { listPageTargets, connectToTarget } from "../lib/cdp.mjs";
import { ensureInstance, DEFAULTS } from "../lib/launch.mjs";
import { createReporter } from "../lib/report.mjs";
import {
    CLEAN_TEXT_FN,
    dismissOnboarding,
    hoverUntil,
    normalizeText,
    pickLiveRenderer,
    probeButtonByText,
    sleep,
    typeTextAndEnter,
} from "../lib/probes.mjs";

const AREA = "agent-card-seen";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");
const userHome = process.env.USERPROFILE || process.env.HOME || "";

const reporter = createReporter({
    area: AREA,
    endpoint: `http://127.0.0.1:${DEFAULTS.cdpPort}`,
    mode: attach ? "attach" : "launch+reset",
    meta: { piDefaultModel: readPiDefaultModel() },
});
const { log, check, shot, runDir } = reporter;
let instance = null;

if (dry) {
    log("dry-run: 依赖解析成功（未启动 GUI）");
    check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs");
    reporter.finish({ cleanup: null, ledger: false });
}

/** pi 的默认 provider/model（报告里记录"本次跑的是哪个模型"）。 */
function readPiDefaultModel() {
    try {
        const raw = readFileSync(path.join(userHome, ".pi", "agent", "settings.json"), "utf8");
        const cfg = JSON.parse(raw);
        return `${cfg.defaultProvider ?? "?"}/${cfg.defaultModel ?? "?"}`;
    } catch {
        return "unknown";
    }
}

// ── 页面内探针 ──────────────────────────────────────────────────────────────

const VISIBLE = (el) => {
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    return r.width > 4 && r.height > 4 && cx > 0 && cx < innerWidth - 2 && cy > 0 && cy < innerHeight - 2;
};

const DismissProbe = `(() => {
    const visible = ${VISIBLE.toString()};
    for (const el of document.querySelectorAll("button, [role=button]")) {
        const t = (el.textContent || "").trim();
        if (!/^(continue|next|next step|get started|got it|skip|not now)$/i.test(t)) continue;
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), t };
    }
    return null;
})()`;

const ExpandWidgetsProbe = `(() => {
    const b = document.querySelector('[aria-label="Expand widgets bar"], [title="Expand widgets bar"]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    if (r.width < 5) return null;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`;

const AgentWidgetProbe = `(() => {
    const visible = ${VISIBLE.toString()};
    for (const el of document.querySelectorAll(".text-xxs")) {
        if ((el.textContent || "").trim() !== "agent") continue;
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }
    return null;
})()`;

const findButtonProbe = (label) => `(() => {
    const visible = ${VISIBLE.toString()};
    const wanted = ${JSON.stringify(label)};
    for (const el of document.querySelectorAll("button, [role=button], [role=tab]")) {
        if ((el.textContent || "").trim() !== wanted) continue;
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }
    return null;
})()`;

const findPathRowProbe = `(() => {
    const visible = ${VISIBLE.toString()};
    for (const el of document.querySelectorAll("[role=button]")) {
        const t = (el.textContent || "").trim();
        if (!t.includes("snorkeling")) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 100) continue;
        if (!visible(el)) continue;
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }
    return null;
})()`;

const blockIdsProbe = `(() => [...document.querySelectorAll(".block[data-blockid]")].map((el) => el.getAttribute("data-blockid")))()`;

/** 关键展示面的快照（一次 eval 取全，避免多次往返读到不同帧）。 */
const surfacesProbe = (blockId) => `(() => {
    const clean = (s) => (s || "").replace(/[\\u200b-\\u200f\\ufeff]/g, "").trim();
    const block = document.querySelector('.block[data-blockid="' + ${JSON.stringify(blockId)} + '"]');
    const header = block?.querySelector(".agent-status-header") || document.querySelector(".agent-status-header");
    const dot = document.querySelector(".inline-tab-block-tab-statusdot");
    const chip = document.querySelector(".agent-card-status-chip");
    const chipDot = document.querySelector(".agent-card-status-dot");
    const tabRow = document.querySelector(".tab-card-agent-row");
    let doneAcked = null;
    try { doneAcked = window.__diagDoneAck ? window.__diagDoneAck.get() : null; } catch (e) { doneAcked = null; }
    return {
        header: header ? {
            text: clean(header.textContent),
            cls: header.className,
            unread: header.classList.contains("is-done-unread"),
            acked: header.classList.contains("is-acked"),
        } : null,
        dot: dot ? { cls: dot.className, doneUnread: dot.classList.contains("is-done-unread"), acked: dot.classList.contains("is-acked") } : null,
        chip: chip ? {
            text: clean(chip.textContent),
            read: chip.getAttribute("data-agent-read"),
            seen: chip.classList.contains("is-seen"),
            pulsing: chipDot ? chipDot.classList.contains("is-done-unread") : null,
        } : null,
        tabRow: tabRow ? {
            read: tabRow.getAttribute("data-agent-read"),
            pill: clean(tabRow.querySelector(".tab-card-agent-pill")?.textContent),
        } : null,
        doneAcked,
    };
})()`;

const badgeCenterProbe = (blockId) => `(() => {
    const block = document.querySelector('.block[data-blockid="' + ${JSON.stringify(blockId)} + '"]');
    const el = block?.querySelector(".agent-status-header");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 4) return null;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`;

const appTabCenterProbe = `(() => {
    const tabs = [...document.querySelectorAll(".tab-bar-wrapper .tab, .tab-bar-wrapper [role=tab]")];
    const el = tabs[tabs.length - 1];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 10) return null;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: (el.textContent || "").trim().slice(0, 20) };
})()`;

async function waitForSurfaces(client, blockId, predicate, { timeoutMs = 180000, intervalMs = 1000, onTick } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        last = await client.evaluate(surfacesProbe(blockId));
        onTick?.(last);
        if (predicate(last)) return last;
        await sleep(intervalMs);
    }
    return last;
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
    const endpoint = `http://127.0.0.1:${DEFAULTS.cdpPort}`;
    instance = await ensureInstance({ attach, resetProfile: !attach });
    // 多 Tab renderer 时 ensureInstance 可能连到 0x0 的空壳，重新挑一个真工作区。
    const pages = await listPageTargets(endpoint);
    const client = pages.length > 1
        ? (await pickLiveRenderer(pages, connectToTarget, endpoint)).client
        : instance.client;
    await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    log(`instance ready (${attach ? "attach" : "launch"}), pi default model = ${readPiDefaultModel()}`);

    // 首次启动的引导向导（Welcome → … → Get Started）会盖住 WidgetsBar。
    await dismissOnboarding(client, { log });

    // WidgetsBar 收起时图标落在视口外，先展开。
    const expand = await client.evaluate(ExpandWidgetsProbe);
    if (expand != null) {
        await client.click(expand.x, expand.y);
        log("expanded widgets bar");
        await sleep(700);
    }

    // ── 1. 新建 Pi agent block ──────────────────────────────────────────────
    const before = new Set(await client.evaluate(blockIdsProbe));
    const widget = await client.evaluate(AgentWidgetProbe);
    if (widget == null) throw new Error("WidgetsBar 上找不到 agent 入口");
    await client.click(widget.x, widget.y);
    await sleep(900);
    const piBtn = await client.evaluate(findButtonProbe("Pi"));
    if (piBtn == null) throw new Error("New Agent 面板里找不到 Pi 选项");
    await client.click(piBtn.x, piBtn.y);
    await sleep(700);
    const tuiBtn = await client.evaluate(findButtonProbe("TUI 终端"));
    if (tuiBtn != null) {
        await client.click(tuiBtn.x, tuiBtn.y);
        await sleep(500);
    }
    const pathRow = await client.evaluate(findPathRowProbe);
    if (pathRow != null) {
        await client.click(pathRow.x, pathRow.y);
        await sleep(500);
    }
    const currentTab = await client.evaluate(findButtonProbe("Current Tab"));
    if (currentTab == null) throw new Error("New Agent 面板里找不到 Current Tab 按钮");
    await client.click(currentTab.x, currentTab.y);
    log("requested new Pi agent block (Current Tab)");

    // ── 2. 等新 block + pi TUI 起来 ────────────────────────────────────────
    let blockId = null;
    for (let i = 0; i < 90 && blockId == null; i++) {
        const ids = await client.evaluate(blockIdsProbe);
        blockId = ids.find((id) => !before.has(id)) ?? null;
        if (blockId == null) await sleep(1000);
    }
    if (blockId == null) throw new Error("90s 内没有出现新的 agent block");
    check("agent-block-created", true, blockId);

    let booted = false;
    for (let i = 0; i < 90; i++) {
        booted = await client.evaluate(
            `(() => {
                const b = document.querySelector('.block[data-blockid="' + ${JSON.stringify(blockId)} + '"]');
                return b != null && b.querySelector(".xterm") != null;
            })()`
        );
        if (booted) break;
        await sleep(1000);
    }
    check("pi-tui-booted", booted, booted ? "xterm mounted" : "no xterm after 90s");
    await sleep(9000); // 等 pi 载入扩展/技能
    await shot(client, "01-agent-block");

    // ── 3. 发一句最小 prompt，等 working → Done ────────────────────────────
    const term = await client.evaluate(`(() => {
        const b = document.querySelector('.block[data-blockid="' + ${JSON.stringify(blockId)} + '"]');
        const el = b?.querySelector(".xterm");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    if (term == null) throw new Error("agent block 里没有 .xterm");
    await client.click(term.x, term.y);
    await sleep(500);
    await typeTextAndEnter(client, "只回复两个字：完成");
    log("prompt sent to pi TUI");

    const seen = [];
    const record = (s) => {
        const t = s?.header?.text ?? null;
        if (t != null && seen[seen.length - 1] !== t) {
            seen.push(t);
            log(`status → ${t}`);
        }
    };
    // 先等"跑起来了"（working 系文案），再等 Done —— 否则可能读到上一轮的 Done。
    const working = await waitForSurfaces(
        client,
        blockId,
        (s) => s?.header != null && /^(Thinking|Working|Tool|Tools|Blocked|Stale)/.test(s.header.text),
        { timeoutMs: 90000, onTick: record }
    );
    check("agent-started-working", working?.header != null && !/^Done/.test(working.header.text), working?.header?.text ?? "no status");

    const done = await waitForSurfaces(client, blockId, (s) => /^Done/.test(s?.header?.text ?? ""), {
        timeoutMs: 240000,
        onTick: record,
    });
    await shot(client, "02-done-unread");
    const completed = check("agent-completed-done", /^Done/.test(done?.header?.text ?? ""), done?.header?.text ?? "never reached Done");
    if (!completed) return finish(client, { seen, blockId });

    // ── 4. 未读 Done：头部徽章 / 悬浮卡 / Tab 悬浮卡 ────────────────────────
    check("header-done-unread", done.header?.unread === true, done.header);
    check("done-label-has-elapsed", /^Done\s+\S/.test(done.header?.text ?? ""), done.header?.text);

    const badge = await client.evaluate(badgeCenterProbe(blockId));
    if (badge == null) throw new Error("找不到 agent block 头部徽章");
    const unreadChip = await hoverUntil(client, badge, surfacesProbe(blockId), (s) => s?.chip != null);
    await shot(client, "03-hover-card-unread");
    check("hover-card-visible", unreadChip?.chip != null, unreadChip?.chip ?? "no .agent-card-status-chip");
    if (unreadChip?.chip != null) {
        check("hover-card-unread", unreadChip.chip.read === "unread", unreadChip.chip);
        check("hover-card-dot-pulsing", unreadChip.chip.pulsing === true, unreadChip.chip.pulsing);
        check("hover-card-label-elapsed", /^Done\s+\S/.test(unreadChip.chip.text ?? ""), unreadChip.chip.text);
    }

    // Tab 悬浮卡（G 面）：悬停 app tab 打开标签卡，读 agent 行。
    const tabPoint = await client.evaluate(appTabCenterProbe);
    let unreadTabRow = null;
    if (tabPoint != null) {
        unreadTabRow = await hoverUntil(client, tabPoint, surfacesProbe(blockId), (s) => s?.tabRow != null);
        await shot(client, "04-tab-card-unread");
    }
    check("tab-card-visible", unreadTabRow?.tabRow != null, unreadTabRow?.tabRow ?? "no .tab-card-agent-row");
    if (unreadTabRow?.tabRow != null) {
        check("tab-card-unread", unreadTabRow.tabRow.read === "unread", unreadTabRow.tabRow);
        check("tab-card-pill-elapsed", /^Done\s+\S/.test(unreadTabRow.tabRow.pill ?? ""), unreadTabRow.tabRow.pill);
    }

    // ── 5. 真实点击头部徽章 ack ────────────────────────────────────────────
    const badge2 = await client.evaluate(badgeCenterProbe(blockId));
    await client.move(badge2.x, badge2.y);
    await sleep(200);
    await client.click(badge2.x, badge2.y);
    log("clicked header badge (ack)");
    await sleep(1200);

    const acked = await waitForSurfaces(client, blockId, (s) => s?.header?.acked === true, { timeoutMs: 15000 });
    await shot(client, "05-after-ack");
    check("header-acked", acked?.header?.acked === true, acked?.header);
    check("header-label-stays-done", (acked?.header?.text ?? "").trim() === "Done", acked?.header?.text);
    check(
        "done-acked-persisted",
        Number(acked?.doneAcked?.[blockId] ?? 0) > 0,
        acked?.doneAcked == null ? "window.__diagDoneAck missing" : `${Object.keys(acked.doneAcked).length} entries`
    );

    // ack 后再 hover 卡片：pill 必须跟着 seen
    const seenChipSnap = await hoverUntil(client, badge2, surfacesProbe(blockId), (s) => s?.chip != null);
    await shot(client, "06-hover-card-seen");
    check("hover-card-seen", seenChipSnap?.chip?.read === "seen", seenChipSnap?.chip ?? "card not visible");
    if (seenChipSnap?.chip != null) {
        check("hover-card-not-pulsing", seenChipSnap.chip.pulsing === false, seenChipSnap.chip.pulsing);
        check("hover-card-no-elapsed", (seenChipSnap.chip.text ?? "").trim() === "Done", seenChipSnap.chip.text);
    }

    if (tabPoint != null) {
        const seenTabRow = await hoverUntil(client, tabPoint, surfacesProbe(blockId), (s) => s?.tabRow != null);
        await shot(client, "07-tab-card-seen");
        check("tab-card-seen", seenTabRow?.tabRow?.read === "seen", seenTabRow?.tabRow ?? "not visible");
        if (seenTabRow?.tabRow != null) {
            check("tab-card-pill-no-elapsed", (seenTabRow.tabRow.pill ?? "").trim() === "Done", seenTabRow.tabRow.pill);
        }
    }

    return finish(client, { seen, blockId });
}

function finish(client, extra) {
    const skipped = [];
    if (reporter.results.every((r) => r.id !== "inline-dot-done-unread")) {
        skipped.push("inline tab 圆点（B 面）需要同组多 tab 的工作区形态；read 一致性由 cross-surface 契约测试覆盖");
        skipped.push("Tab「更多」紧凑行（F 面）需要同 Tab ≥2 个 agent；同上");
    }
    reporter.finish({
        extra,
        skipped,
        cleanup: () => {
            client.close?.();
            if (instance?.spawned && !keepOpen) instance.cleanup?.();
        },
    });
}

main().catch((err) => {
    reporter.fatal(err, {
        cleanup: () => {
            instance?.client?.close?.();
            if (instance?.spawned && !keepOpen) instance.cleanup?.();
        },
    });
});
