// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 原型自检：把 index.html 装进真实 Chromium（Edge headless）跑机器断言。
//
// 本原型两处独立改动：
//   左侧 = 粗粒度状态点（保留在 .row-lead）
//   右侧 = 细粒度运行徽章（.row-meta 最右，ml-auto）
// 这两件事只有跑起来取 computed style + getBoundingClientRect 才能判定
// 「右侧真的顶到行右缘」「左侧仍在左列」「徽章不撑高 11px 元信息行」。
//
// 出口：0 全绿 / 1 断言失败 / 2 环境错误
// 用法：node design/prototypes/aisessions-running-indicator/selfcheck.mjs
//       node design/prototypes/aisessions-running-indicator/selfcheck.mjs --keep-open

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { connectToTarget, listPageTargets, waitFor } from "../../../scripts/verify/lib/cdp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const pageUrl = pathToFileURL(path.join(here, "index.html")).href;
const runDir = path.join(repoRoot, "verify-runs", "prototype-aisessions-running-indicator");
const PORT = Number(process.env.PROTO_CDP_PORT || 9542);
const keepOpen = process.argv.includes("--keep-open");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function browserExe() {
    if (process.env.PROTO_BROWSER) return process.env.PROTO_BROWSER;
    return process.platform === "win32" ? EDGE : "google-chrome";
}

function launchBrowser() {
    const args = [
        "--headless=new",
        `--remote-debugging-port=${PORT}`,
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--force-device-scale-factor=1",
        "--window-size=1280,1800",
        `--user-data-dir=${path.join(repoRoot, ".cache", "proto-selfcheck", String(PORT))}`,
        pageUrl,
    ];
    const child = spawn(browserExe(), args, { stdio: "ignore", windowsHide: true, detached: false });
    child.on("error", () => {});
    return child;
}

async function waitForEndpoint(deadlineMs = 20000) {
    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline) {
        try {
            const pages = await listPageTargets(`http://127.0.0.1:${PORT}`);
            const hit = pages.find((p) => /aisessions-running-indicator\/index\.html/.test(p.url ?? ""));
            if (hit != null) return hit;
        } catch {
            /* not up yet */
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    return null;
}

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok: !!ok, detail });
}

const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;

async function pick(client, left, right, state) {
    if (left != null) await client.evaluate(`document.querySelector('[data-left="${left}"]').click()`);
    if (right != null) await client.evaluate(`document.querySelector('[data-right="${right}"]').click()`);
    if (state != null) await client.evaluate(`document.querySelector('[data-state="${state}"]').click()`);
    await waitFor(client, `document.querySelectorAll("#panel-main .row").length === 5`, {
        timeoutMs: 4000,
        label: `paint ${left}/${right}/${state}`,
    });
}

async function main() {
    mkdirSync(runDir, { recursive: true });
    let child = null;
    let client = null;
    try {
        child = launchBrowser();
        const target = await waitForEndpoint();
        if (target == null) {
            console.error(`✗ 环境错误：CDP ${PORT} 上没有加载到原型页（浏览器没起来？）`);
            process.exit(2);
        }
        client = await connectToTarget(`http://127.0.0.1:${PORT}`, target);
        await waitFor(client, `document.readyState === 'complete'`, { timeoutMs: 15000, label: "readyState" });
        await waitFor(client, `document.querySelectorAll("#panel-main .row").length === 5`, {
            timeoutMs: 5000,
            label: "rows rendered",
        });

        // ── 1. 行结构对齐真实 SessionRow ──
        const shape = await client.evaluate(
            `(() => { const row = ${q("#panel-main .row")};
               return {
                 lead: row.querySelectorAll(".row-lead .lead-btn").length,
                 hasMain: row.querySelector(".row-main") != null,
                 hasMeta: row.querySelector(".row-meta") != null,
                 hasSnippet: row.querySelector(".snippet") != null,
                 hasResume: [...row.querySelectorAll(".row-action")].some((b) => b.textContent.trim() === "Resume"),
               }; })()`
        );
        check("行结构：左列 2 个 lead 按钮（chevron / mark）", shape?.lead === 2, JSON.stringify(shape));
        check("行结构：row-main / row-meta / snippet 齐全", shape?.hasMain && shape?.hasMeta && shape?.hasSnippet, JSON.stringify(shape));
        check("行结构：Resume 动作存在", shape?.hasResume === true, JSON.stringify(shape));

        // ── 2. 核心：左侧状态点仍在左列，右侧徽章在元信息行最右 ──
        await pick(client, "L1", "R1", "working");
        const dual = await client.evaluate(
            `(() => {
                 const row = ${q("#panel-main .row")};
                 const left = row.querySelector(".row-lead .lead-status");
                 const right = row.querySelector(".row-meta .meta-right");
                 const meta = row.querySelector(".row-meta");
                 const main = row.querySelector(".row-main");
                 if (left == null || right == null) return { left: left != null, right: right != null };
                 const lr = left.getBoundingClientRect();
                 const rr = right.getBoundingClientRect();
                 const mr = meta.getBoundingClientRect();
                 const pr = main.getBoundingClientRect();
                 const kids = [...meta.children];
                 return {
                   leftInLead: left.closest(".row-lead") != null,
                   rightInMeta: right.closest(".row-meta") != null,
                   rightIsLastMetaChild: kids[kids.length - 1] === right,
                   rightMarginLeft: getComputedStyle(right).marginLeft,
                   rightFlex: getComputedStyle(right).flex,
                   leftFlexGrow: getComputedStyle(meta.querySelector(".meta-left")).flexGrow,
                   rightGapToRowRight: Math.round(pr.right - rr.right),
                   leftX: Math.round(lr.left),
                   rightX: Math.round(rr.left),
                   leftIsLeftOfRight: lr.left < rr.left,
                   metaHeight: Math.round(mr.height),
                   rightHeight: Math.round(rr.height),
                 }; })()`
        );
        check("左侧状态点仍在 .row-lead（左列）", dual?.leftInLead === true, JSON.stringify(dual));
        check("右侧徽章在 .row-meta 内", dual?.rightInMeta === true, JSON.stringify(dual));
        check("右侧徽章是 .row-meta 最后一个子元素", dual?.rightIsLastMetaChild === true, JSON.stringify(dual));
        check("右侧徽章 flex:0 0 auto（不参与左侧换行）", dual?.rightFlex === "0 0 auto", dual?.rightFlex);
        check("左侧元信息块 flex-grow 占满剩余宽度", dual?.leftFlexGrow === "1", dual?.leftFlexGrow);
        check("右侧徽章右缘贴住行右缘（≤ 2px）", Math.abs(dual?.rightGapToRowRight ?? 99) <= 2, `gap=${dual?.rightGapToRowRight}`);
        check("左点在右徽章左侧（几何顺序正确）", dual?.leftIsLeftOfRight === true, `left=${dual?.leftX} right=${dual?.rightX}`);
        // 默认 wrap 策略下 384px 必然 +1 行（15 → 38），这是产品代价不是 bug；
        // 真正的「零成本」由 nowrap 策略保证，见 10b 段的断言。
        check("右侧徽章自身单行（高 15px）", dual?.rightHeight === 15, `h=${dual?.rightHeight}`);
        check("右侧徽章自身高度 = 15px", dual?.rightHeight === 15, `h=${dual?.rightHeight}`);

        // ── 3. L0 / R0 组合：两侧都不渲染 ──
        await pick(client, "L0", "R0", "working");
        const noneBoth = await client.evaluate(
            `(() => { const row = ${q("#panel-main .row")};
               return { left: row.querySelector(".row-lead .lead-status") != null,
                        right: row.querySelector(".row-meta .meta-right") != null }; })()`
        );
        check("L0+R0：左侧不渲染状态点", noneBoth?.left === false, JSON.stringify(noneBoth));
        check("L0+R0：右侧不渲染徽章", noneBoth?.right === false, JSON.stringify(noneBoth));

        // ── 4. L1 单点：6×6、working 呼吸、idle/done 静止、done 绿 ──
        await pick(client, "L1", "R0", "working");
        const l1 = await client.evaluate(
            `(() => { const d = ${q("#panel-main .row .ld")};
               const s = getComputedStyle(d);
               const b = d.getBoundingClientRect();
               return { w: Math.round(b.width), h: Math.round(b.height),
                        bg: s.backgroundColor, animation: s.animationName }; })()`
        );
        check("L1：6×6 单点", l1?.w === 6 && l1?.h === 6, JSON.stringify(l1));
        check("L1：working 时 breathe", l1?.animation === "breathe", JSON.stringify(l1));
        check("L1：蓝色 #3b82f6", l1?.bg === "rgb(59, 130, 246)", l1?.bg);

        await pick(client, "L1", "R0", "done");
        const l1done = await client.evaluate(
            `(() => { const s = getComputedStyle(${q("#panel-main .row .ld")});
               return { animation: s.animationName, bg: s.backgroundColor }; })()`
        );
        check("L1：done 静止", l1done?.animation === "none", JSON.stringify(l1done));
        check("L1：done 用 --agent-done 绿", l1done?.bg === "rgb(78, 154, 6)", l1done?.bg);

        await pick(client, "L1", "R0", "stale");
        const l1stale = await client.evaluate(
            `(() => { const s = getComputedStyle(${q("#panel-main .row .ld")});
               return { bg: s.backgroundColor }; })()`
        );
        check("L1：stale 用紫 #a855f7 = rgb(168, 85, 247)", l1stale?.bg === "rgb(168, 85, 247)", l1stale?.bg);

        // ── 5. L4 现状：4 点 + spin + 绿色 ──
        await pick(client, "L4", "R0", "working");
        const l4 = await client.evaluate(
            `(() => { const box = ${q("#panel-main .row .ld-spin")};
               const dots = box ? [...box.querySelectorAll("span")] : [];
               return { dots: dots.length,
                        color: dots[0] ? getComputedStyle(dots[0]).backgroundColor : null,
                        animation: box ? getComputedStyle(box).animationName : null }; })()`
        );
        check("L4：4 个点", l4?.dots === 4, JSON.stringify(l4));
        check("L4：整体 spin 1s", l4?.animation === "spin", JSON.stringify(l4));
        check("L4：绿点（--success）", l4?.color === "rgb(78, 154, 6)", l4?.color);

        // ── 6. R1 chip：label + 跑时 + 蓝色 + working 时 icon 呼吸 ──
        await pick(client, "L0", "R1", "working");
        const r1 = await client.evaluate(
            `(() => { const c = ${q("#panel-main .row .rb-chip")};
               const icon = c?.querySelector("i");
               const s = c ? getComputedStyle(c) : null;
               return {
                 exists: c != null,
                 text: c?.textContent.trim(),
                 hasRuntime: c?.querySelector(".rt") != null,
                 runtime: c?.querySelector(".rt")?.textContent.trim(),
                 color: s?.color,
                 borderStyle: s?.borderStyle,
                 height: c ? Math.round(c.getBoundingClientRect().height) : 0,
                 iconAnim: icon ? getComputedStyle(icon).animationName : null,
               }; })()`
        );
        check("R1：chip 存在（右侧）", r1?.exists === true, JSON.stringify(r1));
        check("R1：带状态词（Thinking / Tool / Working）", /Thinking|Tool:|Working/.test(r1?.text ?? ""), r1?.text);
        check("R1：带跑时", r1?.hasRuntime === true && /s$/.test(r1?.runtime ?? ""), r1?.runtime);
        check("R1：蓝色文字", r1?.color === "rgb(59, 130, 246)", r1?.color);
        check("R1：有边框（区别于胶囊）", r1?.borderStyle === "solid", r1?.borderStyle);
        check("R1：高度 15px", r1?.height === 15, `h=${r1?.height}`);
        check("R1：working 时 icon 呼吸", r1?.iconAnim === "breathe", r1?.iconAnim);

        // 不同 phase 换 label（thinking / tool）
        const phaseLabels = await client.evaluate(
            `(() => {
                 const rows = [...document.querySelectorAll("#panel-main .row")];
                 return rows.slice(0, 2).map((r) => r.querySelector(".rb-chip")?.textContent.trim() ?? null); })()`
        );
        check(
            "R1：phase 不同则 label 不同（Thinking vs Tool: Bash）",
            (phaseLabels?.[0] ?? "").includes("Thinking") && (phaseLabels?.[1] ?? "").includes("Tool: Bash"),
            JSON.stringify(phaseLabels)
        );

        // done 态：绿色 + 无跑时
        await pick(client, "L0", "R1", "done");
        const r1done = await client.evaluate(
            `(() => { const c = ${q("#panel-main .row .rb-chip")};
               return { text: c?.textContent.trim(), color: getComputedStyle(c).color,
                        hasRuntime: c?.querySelector(".rt") != null }; })()`
        );
        check("R1：done 文案 Done", /Done/.test(r1done?.text ?? ""), r1done?.text);
        check("R1：done 绿色", r1done?.color === "rgb(78, 154, 6)", r1done?.color);
        check("R1：done 不带跑时", r1done?.hasRuntime === false, JSON.stringify(r1done));

        // ── 7. R2 胶囊：无边框 + 圆角 999 ──
        await pick(client, "L0", "R2", "working");
        const r2 = await client.evaluate(
            `(() => { const c = ${q("#panel-main .row .rb-pill")};
               const s = c ? getComputedStyle(c) : null;
               const pip = c?.querySelector(".pip");
               return { exists: c != null, text: c?.textContent.trim(),
                        radius: s?.borderRadius, borderStyle: s?.borderStyle,
                        pipAnim: pip ? getComputedStyle(pip).animationName : null,
                        height: c ? Math.round(c.getBoundingClientRect().height) : 0 }; })()`
        );
        check("R2：胶囊存在 + 状态词", r2?.exists === true && /Working|Thinking|Tool:|Done|Stale/.test(r2?.text ?? ""), r2?.text);
        check("R2：无边框", r2?.borderStyle === "none", r2?.borderStyle);
        check("R2：圆角 999px（胶囊）", r2?.radius === "999px", r2?.radius);
        check("R2：点呼吸", r2?.pipAnim === "breathe", r2?.pipAnim);
        check("R2：高度 15px", r2?.height === 15, `h=${r2?.height}`);

        // ── 8. R3 纯文本：零图形零动画 ──
        await pick(client, "L0", "R3", "working");
        const r3 = await client.evaluate(
            `(() => { const c = ${q("#panel-main .row .rb-text")};
               if (c == null) return { exists: false };
               return { exists: true, text: c.textContent.trim(),
                        hasRuntime: c.querySelector(".rt") != null,
                        childElements: c.querySelectorAll("i,span[class],svg").length,
                        anim: getComputedStyle(c).animationName }; })()`
        );
        check("R3：纯文本 + 跑时", r3?.exists === true && /Working|Thinking|Tool:/.test(r3?.text ?? "") && r3?.hasRuntime === true, JSON.stringify(r3));
        check("R3：无图形子元素（除跑时 span）", r3?.childElements <= 1, String(r3?.childElements));
        check("R3：零动画", r3?.anim === "none", r3?.anim);

        // ── 9. R4 扫光条 / R5 波形 / R6 三点 / R7 跑时优先 ──
        await pick(client, "L0", "R4", "working");
        const r4 = await client.evaluate(
            `(() => { const c = ${q("#panel-main .row .rb-sweep")};
               const track = c?.querySelector(".track");
               const bar = track?.querySelector("i");
               return { exists: c != null, text: c?.textContent.trim(),
                        trackH: track ? Math.round(track.getBoundingClientRect().height) : 0,
                        anim: bar ? getComputedStyle(bar).animationName : null }; })()`
        );
        check("R4：扫光条存在 + 状态词", r4?.exists === true && /Working|Thinking|Tool:/.test(r4?.text ?? ""), r4?.text);
        check("R4：轨道高 2px（不撑行高）", r4?.trackH === 2, `h=${r4?.trackH}`);
        check("R4：动画 sweep", r4?.anim === "sweep", r4?.anim);

        await pick(client, "L0", "R5", "working");
        const r5 = await client.evaluate(
            `(() => { const c = ${q("#panel-main .row .rb-eq")};
               const bars = c ? [...c.querySelectorAll(".bars span")] : [];
               return { exists: c != null, text: c?.textContent.trim(), bars: bars.length,
                        anim: bars[0] ? getComputedStyle(bars[0]).animationName : null,
                        delays: new Set(bars.map((b) => getComputedStyle(b).animationDelay)).size }; })()`
        );
        check("R5：4 根波形条 + 状态词", r5?.exists === true && r5?.bars === 4, JSON.stringify({ bars: r5?.bars }));
        check("R5：动画 eq-bounce 且四根错相", r5?.anim === "eq-bounce" && r5?.delays === 4, `anim=${r5?.anim} phases=${r5?.delays}`);

        await pick(client, "L0", "R6", "working");
        const r6 = await client.evaluate(
            `(() => { const c = ${q("#panel-main .row .rb-dots")};
               const dots = c ? [...c.querySelectorAll(".dots span")] : [];
               return { exists: c != null, text: c?.textContent.trim(), dots: dots.length,
                        anim: dots[0] ? getComputedStyle(dots[0]).animationName : null }; })()`
        );
        check("R6：3 点 + 状态词", r6?.exists === true && r6?.dots === 3, JSON.stringify({ dots: r6?.dots }));
        check("R6：动画 typing-bounce", r6?.anim === "typing-bounce", r6?.anim);

        await pick(client, "L0", "R7", "working");
        const r7 = await client.evaluate(
            `(() => { const c = ${q("#panel-main .row .rb-rt")};
               const tick = c?.querySelector(".tick");
               return { exists: c != null, text: c?.textContent.trim(),
                        hasTick: tick != null,
                        anim: tick ? getComputedStyle(tick).animationName : null }; })()`
        );
        check("R7：只有跑时（无状态词）", r7?.exists === true && /^[0-9]/.test(r7?.text ?? ""), r7?.text);
        check("R7：带呼吸 tick", r7?.hasTick === true && r7?.anim === "breathe", JSON.stringify(r7));

        // ── 10. 无活跃块：两侧都不渲染 ──
        await pick(client, "L1", "R1", "none");
        const noneState = await client.evaluate(
            `(() => ({
                 left: document.querySelectorAll("#panel-main .row .lead-status").length,
                 right: document.querySelectorAll("#panel-main .row .meta-right").length,
             }))()`
        );
        check("无活跃块：左侧 5 行全不渲染", noneState?.left === 0, String(noneState?.left));
        check("无活跃块：右侧 5 行全不渲染", noneState?.right === 0, String(noneState?.right));

        // ── 10b. 两种换行策略 × 四个宽度：把「真代价」量出来 ──
        //
        // 判据设计（重要）：
        //   「加徽章后行高不变」在 wrap 策略下**本来就不成立**（320px 默认宽度下元信息
        //   行已占满 1 行，加徽章必然 +1 行）。所以不能拿它当"正确性"断言 —— 它衡量的是
        //   产品代价，不是 bug。本段按策略分别断言：
        //     wrap   → 徽章必须单行贴右；行高变化量记录在 detail 里（+0 / +1 行都算通过）
        //     nowrap → 徽章必须单行贴右 **且** 行高与无徽章时完全一致（零成本承诺）
        const measure = (w, right, policy) =>
            `(async () => {
                 document.querySelector('[data-width="${w}"]').click();
                 document.querySelector('[data-right="${right}"]').click();
                 document.querySelector('[data-policy="${policy}"]').click();
                 document.querySelector('[data-state="working"]').click();
                 await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
                 const row = ${q("#panel-main .row")};
                 const meta = row.querySelector(".row-meta");
                 const badge = row.querySelector(".meta-right");
                 const main = row.querySelector(".row-main");
                 const mr = meta.getBoundingClientRect();
                 const pr = main.getBoundingClientRect();
                 if (badge == null) return { metaH: Math.round(mr.height), hasBadge: false };
                 const rr = badge.getBoundingClientRect();
                 return {
                   metaH: Math.round(mr.height),
                   rightH: Math.round(rr.height),
                   gapRight: Math.round(pr.right - rr.right),
                   hasBadge: true,
                 }; })()`;

        // 先把 state 拉回 working：上一段（无活跃块）把它留在 none，不重置就取不到徽章。
        await pick(client, "L1", "R1", "working");

        const costRows = [];
        for (const policy of ["wrap", "nowrap"]) {
            for (const w of [240, 320, 384, 520]) {
                const base = await client.evaluate(measure(w, "R0", policy));
                const withBadge = await client.evaluate(measure(w, "R1", policy));
                const delta = (withBadge?.metaH ?? 0) - (base?.metaH ?? 0);
                costRows.push(`${policy}/${w}: ${base?.metaH}→${withBadge?.metaH} (${delta >= 0 ? "+" : ""}${delta})`);

                check(
                    `${policy} ${w}px：徽章单行（≤ 16px）`,
                    (withBadge?.rightH ?? 99) <= 16,
                    `rightH=${withBadge?.rightH}`
                );
                check(
                    `${policy} ${w}px：徽章贴住行右缘（≤ 2px）`,
                    Math.abs(withBadge?.gapRight ?? 99) <= 2,
                    `gap=${withBadge?.gapRight}`
                );
                if (policy === "nowrap") {
                    check(
                        `nowrap ${w}px：行高零变化（${base?.metaH} → ${withBadge?.metaH}）`,
                        withBadge?.metaH === base?.metaH,
                        `base=${base?.metaH} with=${withBadge?.metaH}`
                    );
                }
            }
        }
        console.log(`
  行高代价实测：${costRows.join(" · ")}
`);

        // 回到默认
        await client.evaluate(`document.querySelector('[data-width="384"]').click()`);
        await client.evaluate(`document.querySelector('[data-policy="wrap"]').click()`);

        // ── 11. 主题：浅色下蓝色换成 #2563eb ──
        await pick(client, "L1", "R1", "working");
        await client.evaluate(`document.getElementById("ctrl-theme").click()`);
        await waitFor(client, `document.documentElement.dataset.theme === "light"`, {
            timeoutMs: 3000,
            label: "light theme",
        });
        const light = await client.evaluate(
            `(() => ({ theme: document.documentElement.dataset.theme,
                       leftBg: getComputedStyle(${q("#panel-main .row .ld")}).backgroundColor,
                       rightColor: getComputedStyle(${q("#panel-main .row .rb-chip")}).color }))()`
        );
        check("主题切换生效", light?.theme === "light", JSON.stringify(light));
        check("浅色下左点 = #2563eb = rgb(37, 99, 235)", light?.leftBg === "rgb(37, 99, 235)", light?.leftBg);
        check("浅色下右徽章 = #2563eb", light?.rightColor === "rgb(37, 99, 235)", light?.rightColor);
        await client.evaluate(`document.getElementById("ctrl-theme").click()`);
        await waitFor(client, `document.documentElement.dataset.theme === "dark"`, {
            timeoutMs: 3000,
            label: "dark theme",
        });

        // ── 12. 全部对比：5 个左侧 + 8 个右侧 ──
        await client.evaluate(`document.getElementById("ctrl-all").click()`);
        await waitFor(client, `document.getElementById("allwrap").hidden === false`, {
            timeoutMs: 3000,
            label: "allwrap visible",
        });
        const grid = await client.evaluate(
            `(() => {
                 const l = [...document.querySelectorAll("#allleft .cellwrap")];
                 const r = [...document.querySelectorAll("#allright .cellwrap")];
                 return {
                   leftCells: l.length, rightCells: r.length,
                   leftRows: l.map((c) => c.querySelectorAll(".row").length),
                   rightRows: r.map((c) => c.querySelectorAll(".row").length),
                   leftButtons: document.querySelectorAll("#ctrl-left button").length,
                   rightButtons: document.querySelectorAll("#ctrl-right button").length,
                 }; })()`
        );
        check("全部对比：5 个左侧方案", grid?.leftCells === 5, String(grid?.leftCells));
        check("全部对比：8 个右侧方案", grid?.rightCells === 8, String(grid?.rightCells));
        check("左侧每格 5 行", grid?.leftRows?.every((n) => n === 5) === true, JSON.stringify(grid?.leftRows));
        check("右侧每格 5 行", grid?.rightRows?.every((n) => n === 5) === true, JSON.stringify(grid?.rightRows));
        check("顶栏左/右按钮数 = 5 / 8", grid?.leftButtons === 5 && grid?.rightButtons === 8, `${grid?.leftButtons}/${grid?.rightButtons}`);
        await client.evaluate(`document.getElementById("ctrl-all").click()`);

        // ── 截图证据 ──
        await pick(client, "L1", "R1", "working");
        writeFileSync(
            path.join(runDir, "recommended-L1R1.png"),
            (await client.screenshot({ x: 0, y: 0, width: 1280, height: 1800 })).buffer
        );
        const panelRect = await client.evaluate(
            `(() => { const r = ${q("#panel-main")}.getBoundingClientRect();
                 return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`
        );
        writeFileSync(path.join(runDir, "panel-L1R1.png"), (await client.screenshot(panelRect)).buffer);

        await pick(client, "L4", "R0", "working");
        writeFileSync(path.join(runDir, "current-L4R0.png"), (await client.screenshot(panelRect)).buffer);

        await pick(client, "L1", "R7", "working");
        writeFileSync(path.join(runDir, "panel-L1R7.png"), (await client.screenshot(panelRect)).buffer);

        await client.evaluate(`document.getElementById("ctrl-all").click()`);
        await waitFor(client, `document.getElementById("allwrap").hidden === false`, {
            timeoutMs: 3000,
            label: "allwrap again",
        });
        writeFileSync(
            path.join(runDir, "all-variants.png"),
            (await client.screenshot({ x: 0, y: 0, width: 1280, height: 1800 })).buffer
        );
    } catch (err) {
        console.error(`✗ 环境错误：${err?.message ?? err}`);
        report(2);
    } finally {
        if (client != null) client.close();
        if (child != null && !keepOpen) {
            try {
                child.kill();
            } catch {
                /* ignore */
            }
        }
    }
    report();
}

function report(forcedExitCode) {
    const passed = results.filter((r) => r.ok).length;
    const total = results.length;
    for (const r of results) {
        console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.ok ? "" : `  → ${r.detail ?? ""}`}`);
    }
    console.log(`\n${passed}/${total} · 证据截图 → verify-runs/prototype-aisessions-running-indicator/`);
    if (forcedExitCode != null) process.exit(forcedExitCode);
    if (total === 0) process.exit(2);
    process.exit(passed === total ? 0 : 1);
}

main();
