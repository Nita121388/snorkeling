#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// CommonText 列表元信息 / 排序控件 —— 真机 CDP 验证（全自动，无人值守）。
//
// 为什么要有这个台子：本轮改动的判据是"列表行看起来对不对、排序点下去有没有真的重排"，
// 单测只能钉住排序语义与控件契约，覆盖不到「行高有没有被新增的元信息列顶高」「搜索态排序
// 控件是不是真的被关掉」这类只有真实布局才说得清的问题。所以这里跑完整链路：
//
//   1. 干净实例启动 → 派发 `snorkeling:common-text:open-search` 打开 Compose 弹窗。
//   2. 用真实 UI 新建 3 条（Zulu → Alpha → Mike），等价于用户点 + 号。
//   3. 断言四条产品面：默认「最近使用」次序（新建刷新 lastusedat 但不计数）、
//      每行右侧元信息列存在且**不顶高行**、新条目次数为 0、相对更新时间可读。
//   4. 点 title-asc → 行序按标题升序，偏好落 localStorage。
//   5. 搜索框输入 → 排序控件全部 aria-disabled + 相关度图标出现；清空后恢复。
//   6. 点某行 → 详情页脚出现四组元信息。
//   7. 行内 hover 插入按钮（真实点击）→ 该条 usagecount 变 1（本轮新增的写入点）。
//   8. 截图 + report.json / report.md + 台账一行。
//
// 用法：
//   node scripts/verify/commontext-meta-sort/verify.mjs              # 起干净实例 → 跑 → 自动关
//   node scripts/verify/commontext-meta-sort/verify.mjs --attach      # 复用本 area 的实例（迭代用）
//   node scripts/verify/commontext-meta-sort/verify.mjs --keep-open   # 跑完留着人工看
//   node scripts/verify/commontext-meta-sort/verify.mjs --dry         # 只解析依赖，不起 GUI
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { listPageTargets, connectToTarget } from "../lib/cdp.mjs";
import { ensureInstance, findPidByPort, killPid } from "../lib/launch.mjs";
import { createReporter } from "../lib/report.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep, waitForProbe } from "../lib/probes.mjs";

const AREA = "commontext-meta-sort";
// 独立 profile + 独立端口：与本仓其它 area（默认 verify / 9231 / 51799）并行时应互不干扰，
// 默认 profile 会被 resetProfile 整个 rmSync 掉，抢用等于踩掉别人正在跑的实例。
const PROFILE = "commontext-meta-sort";
const CDP_PORT = 9251;
const VITE_PORT = 51811;
const MODAL = ".commontext-compose-modal";

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

/** 弹窗内的一次性快照：行序、行高、元信息列高、次数、排序控件状态。 */
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
        activeSort: modal.querySelector('[data-commontext-sort][aria-pressed="true"]')?.getAttribute("data-commontext-sort") ?? null,
        relevanceShown: modal.querySelector("[data-commontext-sort-relevance]") != null,
        detailMetaCount: modal.querySelectorAll("[data-commontext-detail-meta] > span").length,
        composerText: document.querySelector("[data-commontext-composer]")?.value ?? null,
        storedSort: (() => {
            try { return localStorage.getItem("commontext:sortKey"); } catch { return "storage-error"; }
        })(),
    };
})()`;

const probeSnapshot = () => SNAPSHOT_FN;

/** 用原生 value setter + input 事件写入 React 受控输入（比合成事件可靠）。 */
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

function clickSelectorExpression(selector) {
    return `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el == null) return false;
        el.click();
        return true;
    })()`;
}

function clickRowByTitleExpression(title) {
    return `(() => {
        const row = document.querySelector(${JSON.stringify(MODAL)} + ' [data-commontext-title="' + ${JSON.stringify(title)} + '"]');
        if (row == null) return false;
        row.click();
        return true;
    })()`;
}

function clickRowInsertExpression(title) {
    return `(() => {
        const row = document.querySelector(${JSON.stringify(MODAL)} + ' [data-commontext-title="' + ${JSON.stringify(title)} + '"]');
        const btn = row?.querySelector(".item-insert-btn");
        if (btn == null) return false;
        btn.click();
        return true;
    })()`;
}

const SORT_BUTTON = (key) => `${MODAL} [data-commontext-sort="${key}"]`;
const COMPOSER = "[data-commontext-composer]";
const ADD_BUTTON = `${MODAL} [title="Add new common text item (edit on the right)"]`;
const SEARCH_INPUT = `${MODAL} input[placeholder^="Search common text"]`;

const CREATED = ["Zulu deploy notes", "Alpha refund reply", "Mike standup summary"];
// 默认「最近使用」：每次新建刷新 lastusedat，所以次序是创建顺序的倒序。
const EXPECTED_DEFAULT_ORDER = ["Mike standup summary", "Alpha refund reply", "Zulu deploy notes"];
const EXPECTED_TITLE_ORDER = ["Alpha refund reply", "Mike standup summary", "Zulu deploy notes"];

const sameOrder = (actual, expected) =>
    Array.isArray(actual) && actual.length === expected.length && actual.every((v, i) => v === expected[i]);

async function createItem(client, text) {
    const before = await client.evaluate(probeSnapshot());
    const typed = await client.evaluate(setReactValueExpression(COMPOSER, text));
    if (!typed) return false;
    await sleep(150);
    const clicked = await client.evaluate(clickSelectorExpression(ADD_BUTTON));
    if (!clicked) return false;
    return waitForProbe(client, probeSnapshot(), (s) => (s?.rowCount ?? 0) > (before?.rowCount ?? 0), {
        timeoutMs: 20000,
    });
}

if (dry) {
    reporter.log("dry-run: 依赖解析成功（未启动 GUI）");
    reporter.check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs");
    // 跨平台收尾自检：macOS / Linux 必须能按端口找到 PID（Windows 走 powershell，同样调用同一入口）。
    reporter.check("pid-lookup-available", typeof findPidByPort === "function" && typeof killPid === "function", `platform=${process.platform}`);
    reporter.finish({ cleanup: null, ledger: false });
}

try {
    // 端口预检：本 area 独占端口。被别的进程占住时 ensureInstance 会连到别人的实例上，
    // 拿旧代码跑断言只会得到一堆假失败，所以这里直接判环境错误。
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
    await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    reporter.log(`instance ready (${attach ? "attach" : "launch"})`);
    await dismissOnboarding(client, { log: reporter.log });

    // ── 1. 打开 Compose 弹窗（走产品自己的事件总线，不碰内部 state） ──────────────
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

    // ── 2. 用真实 UI 新建 3 条 ────────────────────────────────────────────────
    const seeded = [];
    for (const text of CREATED) {
        const snap = await createItem(client, text);
        seeded.push({ text, rowCount: snap?.rowCount ?? 0 });
    }
    const seededOk = seeded.every((_, i) => seeded[i].rowCount === i + 1);
    reporter.check("seed-items-via-ui", seededOk, seeded.map((s) => `${s.text}→${s.rowCount}`).join(" | "));

    const base = await client.evaluate(probeSnapshot());
    reporter.check("rows-rendered", base?.rowCount === 3, base?.titles);
    reporter.check("sort-buttons-five", sameOrder(base?.sortKeys, [
        "lastused-desc",
        "updated-desc",
        "created-desc",
        "usage-desc",
        "title-asc",
    ]), base?.sortKeys);
    reporter.check("sort-default-recently-used", base?.activeSort === "lastused-desc", base?.activeSort);
    reporter.check(
        "default-order-is-reverse-creation",
        sameOrder(base?.titles, EXPECTED_DEFAULT_ORDER),
        base?.titles
    );
    reporter.check(
        "new-items-count-zero",
        Array.isArray(base?.usage) && base.usage.every((u) => u === "0"),
        base?.usage
    );
    reporter.check(
        "updated-time-readable",
        Array.isArray(base?.updated) &&
            base.updated.length === 3 &&
            base.updated.every((t) => /just now|^\d+(s|m|h|d) ago$/.test(t)),
        base?.updated
    );
    // 元信息列是右侧固定 28px 槽：行高必须由标题/摘要决定，不能被它顶高。
    const metaPresent = Array.isArray(base?.metaHeights) && base.metaHeights.every((h) => h > 0 && h <= 30);
    const metaDoesNotGrowRow =
        Array.isArray(base?.rowHeights) &&
        base.rowHeights.every((h, i) => h >= (base.metaHeights[i] ?? 0) + 10);
    reporter.check("meta-column-present", metaPresent, base?.metaHeights);
    reporter.check("row-height-not-driven-by-meta", metaDoesNotGrowRow, {
        rowHeights: base?.rowHeights,
        metaHeights: base?.metaHeights,
    });
    await reporter.shot(client, "01-default-order");

    // ── 3. 切 title-asc：真实点击 + 真实重排 + 偏好落盘 ─────────────────────────
    await client.evaluate(clickSelectorExpression(SORT_BUTTON("title-asc")));
    const sorted = await waitForProbe(client, probeSnapshot(), (s) => sameOrder(s?.titles, EXPECTED_TITLE_ORDER), {
        timeoutMs: 15000,
    });
    reporter.check("sort-title-asc-reorders", sameOrder(sorted?.titles, EXPECTED_TITLE_ORDER), sorted?.titles);
    reporter.check("sort-active-marked", sorted?.activeSort === "title-asc", sorted?.activeSort);
    reporter.check("sort-persisted", sorted?.storedSort === "title-asc", sorted?.storedSort);
    await reporter.shot(client, "02-title-asc");

    // ── 4. 搜索态：排序控件全部关掉 + 相关度图标亮起 ───────────────────────────
    await client.evaluate(setReactValueExpression(SEARCH_INPUT, "alpha"));
    const searching = await waitForProbe(client, probeSnapshot(), (s) => s?.relevanceShown === true, {
        timeoutMs: 15000,
    });
    reporter.check(
        "search-disables-sort-control",
        Array.isArray(searching?.sortDisabled) && searching.sortDisabled.every((v) => v === "true"),
        searching?.sortDisabled
    );
    reporter.check("search-shows-relevance-icon", searching?.relevanceShown === true, searching?.relevanceShown);
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

    // ── 5. 详情页脚元信息 ────────────────────────────────────────────────────
    await client.evaluate(clickRowByTitleExpression("Alpha refund reply"));
    const detail = await waitForProbe(client, probeSnapshot(), (s) => (s?.detailMetaCount ?? 0) >= 4, {
        timeoutMs: 15000,
    });
    reporter.check("detail-footer-meta", (detail?.detailMetaCount ?? 0) >= 4, detail?.detailMetaCount);

    // ── 6. 行内 hover 插入是一次使用（本轮新增写入点） ─────────────────────────
    // 先把焦点放到 editor：insertOrCopyCommonText 会插进当前可编辑元素，
    // 不必依赖剪贴板权限（无终端场景下复制路径在无头环境里不稳定）。
    await client.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(COMPOSER)});
        if (el == null) return false;
        el.focus();
        return document.activeElement === el;
    })()`);
    const clickedInsert = await client.evaluate(clickRowInsertExpression("Zulu deploy notes"));
    const used = await waitForProbe(
        client,
        probeSnapshot(),
        (s) => {
            const index = (s?.titles ?? []).indexOf("Zulu deploy notes");
            return index >= 0 && s.usage[index] === "1";
        },
        { timeoutMs: 20000 }
    );
    const usedIndex = (used?.titles ?? []).indexOf("Zulu deploy notes");
    reporter.check("row-insert-clicked", clickedInsert === true, clickedInsert);
    reporter.check("row-insert-counts-usage", usedIndex >= 0 && used?.usage?.[usedIndex] === "1", used?.usage);
    reporter.check(
        "row-insert-inserted-text",
        typeof used?.composerText === "string" && used.composerText.includes("Zulu deploy notes"),
        used?.composerText
    );
    await reporter.shot(client, "04-usage-counted");

    reporter.finish({
        skipped: [
            "hover 时元信息淡出 / 插入按钮接位的视觉切换（需要真实指针 hover，CDP 合成 hover 不触发 group-hover）",
            "tooltip 实际弹出（title 属性内容已由单测断言，弹出层属浏览器原生控件）",
            "排序偏好在弹窗关闭重开后的恢复（localStorage 已断言写入；跨弹窗生命周期由实现直接读取）",
        ],
        cleanup: () => {
            client.close?.();
            if (instance?.spawned && !keepOpen) instance.cleanup?.();
        },
    });
} catch (err) {
    reporter.fatal(err, { cleanup: () => instance?.cleanup?.() });
}
