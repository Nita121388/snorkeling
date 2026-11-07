// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 原型自检：把 index.html 装进真实 Chromium（Edge headless）跑机器断言。
//
// 为什么不是"我看了一眼没问题"：原型里 3 个交互（Move/Copy 分段联动、New tab 行 spinner→toast、
// 主题切换）都是 JS 驱动，只有跑起来才能判定。断言全部是 DOM/样式取值，可机器判定。
//
// 出口：0 全绿 / 1 断言失败 / 2 环境错误
//
// 用法：node design/prototypes/move-block-modal-v3/selfcheck.mjs
//       node design/prototypes/move-block-modal-v3/selfcheck.mjs --keep-open   （留浏览器窗口，需手工关）

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { connectToTarget, listPageTargets, waitFor } from "../../../scripts/verify/lib/cdp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const pageUrl = pathToFileURL(path.join(here, "index.html")).href;
const runDir = path.join(repoRoot, "verify-runs", "prototype-move-block-modal-v3");
const PORT = Number(process.env.PROTO_CDP_PORT || 9541);
const keepOpen = process.argv.includes("--keep-open");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function browserExe() {
    if (process.env.PROTO_BROWSER) return process.env.PROTO_BROWSER;
    return process.platform === "win32" ? EDGE : "google-chrome";
}

async function launchBrowser() {
    const args = [
        "--headless=new",
        `--remote-debugging-port=${PORT}`,
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--force-device-scale-factor=1",
        "--window-size=1280,1600",
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
            const hit = pages.find((p) => /move-block-modal-v3\/index\.html/.test(p.url ?? ""));
            if (hit != null) return hit;
        } catch {
            /* not up yet */
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    return null;
}

// ── 断言器 ──
const results = [];
function check(name, ok, detail) {
    results.push({ name, ok: !!ok, detail });
}

const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const css = (sel, prop) =>
    `getComputedStyle(${q(sel)}).getPropertyValue(${JSON.stringify(prop)}).trim()`;

async function main() {
    mkdirSync(runDir, { recursive: true });
    let child = null;
    let client = null;
    try {
        child = await launchBrowser();
        const target = await waitForEndpoint();
        if (target == null) {
            console.error(`✗ 环境错误：CDP ${PORT} 上没有加载到原型页（浏览器没起来？）`);
            process.exit(2);
        }
        client = await connectToTarget(`http://127.0.0.1:${PORT}`, target);
        await waitFor(client, `document.readyState === 'complete'`, { timeoutMs: 15000, label: "readyState" });

        const rec = "#stage-rec ";
        const sel = (s) => `${rec}${s}`;

        // ── 1. 结构：New tab 行是列表首行，且永远可用 ──
        const firstRow = await client.evaluate(
            `(() => { const l = ${q(sel("[data-list]"))}; const r = l.firstElementChild; return {
                 isNewTab: r.hasAttribute("data-new-tab"),
                 ariaDisabled: r.getAttribute("aria-disabled"),
                 name: r.querySelector(".row-name").textContent.trim(),
                 hint: r.querySelector(".row-hint").textContent.trim(),
                 icons: [...r.querySelectorAll(".row-icon-btn")].map((b) => b.dataset.act),
             }; })()`
        );
        check("New tab 行是列表首行", firstRow?.isNewTab === true, JSON.stringify(firstRow));
        check("New tab 行可用（aria-disabled=false）", firstRow?.ariaDisabled === "false", JSON.stringify(firstRow));
        check("New tab 行文案", firstRow?.name === "New tab" && /Named after/.test(firstRow?.hint ?? ""), `${firstRow?.name} / ${firstRow?.hint}`);

        // ── 2. 结构：行容器不是 <button>（图标按钮不能嵌套在按钮里） ──
        const rowShape = await client.evaluate(
            `(() => { const r = ${q(sel("[data-new-tab]"))}; const icons = [...r.querySelectorAll(".row-icon-btn")];
               return {
                 tag: r.tagName.toLowerCase(),
                 role: r.getAttribute("role"),
                 tabindex: r.getAttribute("tabindex"),
                 iconCount: icons.length,
                 iconActs: icons.map((b) => b.dataset.act),
                 bothLabeled: icons.every((b) => b.getAttribute("title") && b.getAttribute("aria-label")),
               }; })()`
        );
        check("行容器是 div[role=button] 而非 <button>", rowShape?.tag === "div" && rowShape?.role === "button", JSON.stringify(rowShape));
        check("行内正好两个图标动作 → / ⧉", rowShape?.iconCount === 2 && JSON.stringify(rowShape?.iconActs) === JSON.stringify(["move", "copy"]), JSON.stringify(rowShape));
        check("两个图标都写了 title + aria-label", rowShape?.bothLabeled === true, JSON.stringify(rowShape));

        // ── 3. 结构：New tab 行之后有分隔线，再后面才是 tab 行 ──
        const order = await client.evaluate(
            `(() => { const kids = [...${q(sel("[data-list]"))}.children];
               return kids.map((k) => k.classList.contains("new-tab-row") ? "newtab"
                 : k.classList.contains("list-divider") ? "divider"
                 : k.hasAttribute("data-tab-row") ? "tab" : "other"); })()`
        );
        check("列表顺序 newtab → divider → tab…", JSON.stringify(order) === JSON.stringify(["newtab", "divider", "tab", "tab", "tab"]), JSON.stringify(order));

        // ── 4. 结构：没有模式切换（分段控件已移除，标题固定 Move Block） ──
        const noModeUi = await client.evaluate(
            `(() => ({
                 seg: ${q(sel("[data-seg]"))} != null,
                 modeBtns: ${q(sel("[data-mode-btn]"))} != null,
                 title: ${q(sel("[data-title]"))}.textContent.trim(),
             }))()`
        );
        check("无模式切换控件（无 seg / 无 mode 按钮）", noModeUi?.seg === false && noModeUi?.modeBtns === false, JSON.stringify(noModeUi));
        check("标题固定 Move Block（无模式状态）", noModeUi?.title === "Move Block", noModeUi?.title);

        // ── 5. 菜单层：新版只有 1 条 Move 入口（旧版 4 条） ──
        const menuCount = await client.evaluate(
            `(() => { const menus = [...document.querySelectorAll(".menu")];
               const labels = menus.map((m) => [...m.querySelectorAll(".menu-item .label")].map((e) => e.textContent.trim()));
               return labels; })()`
        );
        const current = menuCount?.[0] ?? [];
        const proposed = menuCount?.[1] ?? [];
        const countOf = (arr, re) => arr.filter((s) => re.test(s)).length;
        check("现状菜单：4 条移动/复制入口", countOf(current, /^(Move|Copy) to /) === 4, current.join(" | "));
        check("新菜单：1 条 Move to Tab…", countOf(proposed, /^Move to Tab/) === 1 && countOf(proposed, /^(Move|Copy) to /) === 1, proposed.join(" | "));

        // ── 6. 交互：点行体 = Move ──
        await client.evaluate(`${q(sel("[data-list] [data-tab-row]"))}.click()`);
        await waitFor(client, `${q(sel("[data-toast]"))}.textContent.includes("Design")`, {
            timeoutMs: 4000,
            label: "row-body toast",
        });
        const bodyToast = await client.evaluate(`${q(sel("[data-toast]"))}.textContent.trim()`);
        check("点行体 → Move 到该 tab", /^Move/.test(bodyToast) && /Design/.test(bodyToast), bodyToast);

        // ── 7. 交互：点 ⧉ 图标 = Copy（同一个行，动作不同） ──
        await client.evaluate(
            `${q(sel("[data-list] [data-tab-row] [data-act='copy']"))}.click()`
        );
        await waitFor(client, `/^Copy/.test(${q(sel("[data-toast]"))}.textContent.trim())`, {
            timeoutMs: 4000,
            label: "copy toast",
        });
        const copyToast = await client.evaluate(`${q(sel("[data-toast]"))}.textContent.trim()`);
        check("点 ⧉ → Copy 到该 tab（无模式切换）", /^Copy/.test(copyToast) && /Design/.test(copyToast), copyToast);

        // ── 8. 交互：点 New tab 行的 → 图标 → working → 其它行禁用 → 恢复 + toast ──
        // 先清掉上一条 toast：否则"上一条还亮着"会被当成这次操作成功（实测误判过一次）。
        await client.evaluate(`${q(sel("[data-toast]"))}.classList.remove("show")`);
        await client.evaluate(`${q(sel("[data-new-tab] [data-act='move']"))}.click()`);
        const working = await client.evaluate(
            `(() => { const row = ${q(sel("[data-new-tab]"))};
               return {
                 working: row.classList.contains("is-working"),
                 spinner: row.querySelector(".tab-target-spinner") != null,
                 othersDisabled: [...${q(sel("[data-list]"))}.querySelectorAll("[data-tab-row]")].every(
                   (r) => r.getAttribute("aria-disabled") === "true"
                 ),
                 iconDisabled: [...row.querySelectorAll(".row-icon-btn")].every((b) => b.disabled),
               }; })()`
        );
        check("New tab → 点击 → 行进入 working", working?.working === true, JSON.stringify(working));
        check("New tab → 点击 → 被点图标换 spinner", working?.spinner === true, JSON.stringify(working));
        check("New tab → 点击 → 其它行 aria-disabled=true", working?.othersDisabled === true, JSON.stringify(working));
        check("New tab → 点击 → 两个图标都被禁用（不能点第二次）", working?.iconDisabled === true, JSON.stringify(working));

        await waitFor(client, `${q(sel("[data-toast]"))}.classList.contains("show")`, {
            timeoutMs: 4000,
            label: "toast",
        });
        const recovered = await client.evaluate(
            `(() => { const row = ${q(sel("[data-new-tab]"))};
               return {
                 toast: ${q(sel("[data-toast]"))}.textContent.trim(),
                 working: row.classList.contains("is-working"),
                 spinner: row.querySelector(".tab-target-spinner") != null,
                 iconCount: row.querySelectorAll(".row-icon-btn").length,
                 iconActs: [...row.querySelectorAll(".row-icon-btn")].map((b) => b.dataset.act),
               }; })()`
        );
        check("反馈 toast 出现", /Created new tab/.test(recovered?.toast ?? ""), recovered?.toast);
        check("working 结束回到静止态（两个图标都回来）",
            recovered?.working === false && recovered?.spinner === false &&
            recovered?.iconCount === 2 && JSON.stringify(recovered?.iconActs) === JSON.stringify(["move", "copy"]),
            JSON.stringify(recovered));

        // ── 9. 视觉：图标默认不可见，hover 行才浮现 ──
        const iconVisibility = await client.evaluate(
            `(() => { const row = ${q(sel("[data-new-tab]"))};
               const icons = row.querySelector(".row-icons");
               return { opacity: getComputedStyle(icons).opacity }; })()`
        );
        check("行未 hover 时图标区 opacity=0（不噪音）", iconVisibility?.opacity === "0", JSON.stringify(iconVisibility));

        // 真实指针 hover：opacity 挂在 CSS `:hover` 伪类上，dispatchEvent 触不到伪类（实测），
        // 必须走 CDP 的 Input.dispatchMouseEvent 真移动。
        const rowCenter = await client.evaluate(
            `(() => { const r = ${q(sel("[data-new-tab]"))}.getBoundingClientRect();
               return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`
        );
        await client.move(rowCenter.x, rowCenter.y);
        // opacity 有 120ms 过渡：必须等它跑完再取值，否则读到过渡中间态（实测读到 0 / 0.16）。
        const hoverExpr = `getComputedStyle(${q(sel("[data-new-tab] .row-icons"))}).opacity === "1"`;
        await waitFor(client, hoverExpr, { timeoutMs: 2000, label: "hover opacity" }).catch(() => {});
        const hoveredOpacity = await client.evaluate(
            `(() => getComputedStyle(${q(sel("[data-new-tab] .row-icons"))}).opacity)()`
        );
        check("真实指针 hover 行 → 图标区 opacity=1", hoveredOpacity === "1", `opacity=${hoveredOpacity}`);

        // 指针移开 → 回到 0（不残留）
        await client.move(rowCenter.x, rowCenter.y + 400);
        const unhoverExpr = `getComputedStyle(${q(sel("[data-new-tab] .row-icons"))}).opacity === "0"`;
        await waitFor(client, unhoverExpr, { timeoutMs: 2000, label: "unhover opacity" }).catch(() => {});
        const unhoveredOpacity = await client.evaluate(
            `(() => getComputedStyle(${q(sel("[data-new-tab] .row-icons"))}).opacity)()`
        );
        check("指针移开 → 图标区 opacity 回到 0", unhoveredOpacity === "0", `opacity=${unhoveredOpacity}`);

        // ── 7. 主题：light 切换改变 modal 底色 ──
        const darkBg = await client.evaluate(`${css(sel(".modal"), "background-color")}`);
        await client.evaluate(`document.querySelector("[data-theme-btn='light']").click()`);
        const lightBg = await client.evaluate(`${css(sel(".modal"), "background-color")}`);
        const bodyTheme = await client.evaluate(`document.body.dataset.theme`);
        check("主题切换：body[data-theme=light]", bodyTheme === "light", bodyTheme);
        check("主题切换：modal 底色变化", darkBg !== lightBg && /^rgb/.test(lightBg ?? ""), `${darkBg} → ${lightBg}`);
        await client.evaluate(`document.querySelector("[data-theme-btn='dark']").click()`);

        // ── 8. 布局：弹窗宽度 420px + 列表未溢出 ──
        const box = await client.evaluate(
            `(() => { const m = ${q(sel(".modal"))}.getBoundingClientRect();
               const l = ${q(sel("[data-list]"))};
               return { w: Math.round(m.width), listW: Math.round(l.getBoundingClientRect().width), scrollH: l.scrollHeight, clientH: l.clientHeight }; })()`
        );
        check("弹窗宽度 420px（真实壳宽度）", box?.w === 420, JSON.stringify(box));
        check("列表在弹窗内宽度受控（≤ 弹窗内容宽）", box?.listW > 0 && box.listW <= 420 - 32, JSON.stringify(box));

        // ── 截图证据 ──
        const shot = await client.screenshot({ x: 0, y: 0, width: 1280, height: 1600 });
        writeFileSync(path.join(runDir, "full.png"), shot.buffer);

        // 弹窗局部截图（§2）。注意 sel() 已经带 `#stage-rec ` 前缀，这里要取 stage 自身，
        // 用裸选择器（写成 sel(".stage") 会变成 `#stage-rec .stage` → null，实测踩到）。
        const modalRect = await client.evaluate(
            `(() => { const r = ${q("#stage-rec")}.getBoundingClientRect();
               return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`
        );
        const shot2 = await client.screenshot(modalRect);
        writeFileSync(path.join(runDir, "modal.png"), shot2.buffer);

        // hover 态单独一张：两个图标必须在这一帧里可见（评审主要看这个）
        await client.move(rowCenter.x, rowCenter.y);
        await waitFor(client, `getComputedStyle(${q(sel("[data-new-tab] .row-icons"))}).opacity === "1"`, {
            timeoutMs: 2000,
            label: "hover shot",
        }).catch(() => {});
        const shot4 = await client.screenshot(modalRect);
        writeFileSync(path.join(runDir, "modal-hover.png"), shot4.buffer);

        const shot3 = await client.screenshot({ x: 0, y: 0, width: 1280, height: 900 });
        writeFileSync(path.join(runDir, "top.png"), shot3.buffer);
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
    console.log(`\n${passed}/${total} · 证据截图 → verify-runs/prototype-move-block-modal-v3/`);
    if (forcedExitCode != null) process.exit(forcedExitCode);
    if (total === 0) process.exit(2);
    process.exit(passed === total ? 0 : 1);
}

main();
