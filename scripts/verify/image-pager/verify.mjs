#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 图片预览翻页 —— 真机 CDP 验证（PRD 验收项的可执行版本）。
//
// 用法：
//   node scripts/verify/preview-edit/run.mjs --keep-open --expect=fixed   # 先起隔离实例并留着
//   node scripts/verify/image-pager/verify.mjs --attach
// 或一条命令自起实例：
//   node scripts/verify/image-pager/verify.mjs
//
// 产物：verify-runs/<ts>-imagepager/report.json + 关键状态截图
// 退出码：0 全绿 / 1 有失败 / 2 环境错误

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { connect } from "../preview-edit/lib/cdp.mjs";
import { ensureInstance, dismissOverlays, DEFAULTS } from "../preview-edit/lib/launch.mjs";
import { readPng, scalePng, writePng } from "../preview-edit/lib/pixel.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const fixtureRoot = path.join(repoRoot, ".cache", "tmp", "imgpager-fixture");
const runDir = path.join(
    repoRoot,
    "verify-runs",
    `${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 14)}-imagepager`
);
mkdirSync(runDir, { recursive: true });

// ---------------------------------------------------------------- fixture
function makePng(r, g, b, size = 24) {
    const png = new PNG({ width: size, height: size });
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (size * y + x) << 2;
            png.data[i] = r;
            png.data[i + 1] = g;
            png.data[i + 2] = b;
            png.data[i + 3] = 255;
        }
    }
    return PNG.sync.write(png);
}

// 目录树：根层 3 张（1/2/10，专测自然排序）+ 非图片 note.txt + 两个含图子目录（sub、zz）+ 深层 sub/deep
function buildFixture() {
    rmSync(fixtureRoot, { recursive: true, force: true });
    const tree = {
        "": { "1.png": [255, 0, 0], "2.png": [0, 255, 0], "10.png": [0, 0, 255], "note.txt": null },
        sub: { "a.png": [255, 255, 0], "b.png": [0, 255, 255] },
        "sub/deep": { "z.png": [255, 0, 255] },
        zz: { "last.png": [128, 128, 128] },
    };
    for (const [dir, files] of Object.entries(tree)) {
        mkdirSync(path.join(fixtureRoot, dir), { recursive: true });
        for (const [name, rgb] of Object.entries(files)) {
            writeFileSync(path.join(fixtureRoot, dir, name), rgb == null ? "not an image\n" : makePng(...rgb));
        }
    }
    return fixtureRoot;
}

// ---------------------------------------------------------------- 断言
const results = [];
function check(id, ok, detail) {
    results.push({ id, ok: !!ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail != null ? ` — ${detail}` : ""}`);
    return ok;
}

const barJs = (scope) => `[...document.querySelectorAll("${scope} div")].find((d) =>
    d.childElementCount >= 2 && [...d.children].some((c) => /^\\d+ \\/ \\d+$/.test((c.textContent || "").trim()))
)`.replace("", "")

function pagerStateJs(scope) {
    return `(() => {
        const bar = ${barJs(scope)};
        const counter = bar != null
            ? [...bar.children].map((c) => (c.textContent || "").trim()).find((t) => /^\\d+ \\/ \\d+$/.test(t)) ?? null
            : null;
        const buttons = bar != null ? [...bar.querySelectorAll("button")].map((b) => ({ text: (b.textContent || "").trim(), disabled: b.disabled })) : [];
        const hint = [...document.querySelectorAll("div")].some((d) => (d.textContent || "").includes("本层已看完"));
        const toastEl = [...document.querySelectorAll("div")].find((d) => {
            if (d.childElementCount > 0) return false;
            const t = (d.textContent || "").trim();
            return t.length > 0 && t.length < 80 &&
                (t.startsWith("已进入") || t.startsWith("已回到") || t.includes("索引已失效") || t.startsWith("翻页失败"));
        });
        const src = document.querySelector("img[class]")?.getAttribute("src") ?? null;
        return { counter, buttons, hint, toast: toastEl ? toastEl.textContent.trim() : null, src };
    })()`;
}

async function clickBarButton(client, scope, text) {
    const ok = await client.evaluate(`(() => {
        const bar = ${barJs(scope)};
        if (bar == null) return false;
        const btn = [...bar.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === ${JSON.stringify(text)} && !b.disabled);
        if (btn == null) return false;
        btn.click();
        return true;
    })()`);
    await new Promise((r) => setTimeout(r, 900));
    return ok;
}

async function hoverBarButton(client, scope, text) {
    const pos = await client.evaluate(`(() => {
        const bar = ${barJs(scope)};
        if (bar == null) return null;
        const btn = [...bar.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === ${JSON.stringify(text)});
        if (btn == null) return null;
        const r = btn.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (pos == null) return null;
    await client.move(pos.x, pos.y);
    await new Promise((r) => setTimeout(r, 750));
    const tooltip = await client.evaluate(`(() => {
        const tips = [...document.querySelectorAll(".bg-overlay")];
        const visible = tips.find((t) => {
            const s = getComputedStyle(t);
            const r = t.getBoundingClientRect();
            return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
        });
        return visible ? (visible.textContent || "").replace(/\s+/g, " ").trim() : null;
    })()`);
    return tooltip;
}

async function clickByTitle(client, title) {
    const ok = await client.evaluate(`(() => {
        const el = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("title") || "") === ${JSON.stringify(title)});
        if (el == null) return false;
        el.click();
        return true;
    })()`);
    await new Promise((r) => setTimeout(r, 500));
    return ok;
}

async function pressKey(client, opts) {
    const payload = { bubbles: true, cancelable: true, ...opts };
    await client.evaluate(`(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", ${JSON.stringify(payload)}));
        return true;
    })()`);
    await new Promise((r) => setTimeout(r, 900));
}

// Alt+→ 新增 inline tab = layout 里多一个 block 节点。全新实例上全局计数即可
// （inline tab 的隐藏副本也在 DOM 里，offscreen 定位，一并计入）。
async function countAllBlocks(client) {
    return await client.evaluate(`document.querySelectorAll(".block").length`);
}

async function shot(client, name) {
    const clip = { x: 690, y: 80, width: 650, height: 560 };
    const s = await client.screenshot(clip);
    const buf = Buffer.isBuffer(s) ? s : s.buffer;
    // readPng 读的是**文件路径**：先把原始 buffer 落到临时文件
    const rawPath = path.join(runDir, `${name}-raw.png`);
    writeFileSync(rawPath, buf);
    let png = readPng(rawPath);
    const want = Math.round(clip.width);
    if (png.width !== want) {
        const factor = s?.clip != null ? Math.max(1, Math.round(s.clip.width)) / png.width : want / png.width;
        png = scalePng(png, factor);
    }
    writePng(path.join(runDir, `${name}.png`), png);
}

// ---------------------------------------------------------------- main
async function main() {
    const fixture = buildFixture();
    const attach = process.argv.includes("--attach");
    let client;
    let spawned = false;
    if (attach) {
        client = await connect(`http://127.0.0.1:${DEFAULTS.cdpPort}`);
    } else {
        const inst = await ensureInstance({ attach: false, resetProfile: true });
        client = inst.client;
        spawned = inst.spawned;
    }

    try {
        await dismissOverlays(client).catch(() => []);

        const opened = await client.evaluate(`(async () => {
            const mod = await import("/frontend/app/store/global.ts");
            if (typeof mod.createBlock !== "function") return { ok: false, err: "global.ts 没有 createBlock" };
            const blockId = await mod.createBlock({ meta: { view: "preview", file: ${JSON.stringify(path.join(fixture, "1.png"))} } }, false, false);
            return { ok: true, blockId };
        })()`);
        if (opened?.ok !== true) throw new Error(`打开图片块失败: ${JSON.stringify(opened)}`);
        let blockId = opened.blockId;
        // 所有查询限定在本 block 内：多块场景下"取第一个翻页条"会抓错块（实测踩到）
        let scope = `.block.block-${blockId}`;
        await new Promise((r) => setTimeout(r, 4000));

        // 1) 翻页条出现 + 自然排序（1,2,10；note.txt 不入层）
        let st = await client.evaluate(pagerStateJs(scope));
        check("pager-bar-visible", st.counter != null, `counter=${st.counter}`);
        check("layer-natural-sort-1-3", st.counter === "1 / 3", `counter=${st.counter}（1.png,2.png,10.png）`);
        await shot(client, "01-initial");

        // 2) › 逐张前进
        await clickBarButton(client, scope, "›");
        st = await client.evaluate(pagerStateJs(scope));
        check("next-to-2", st.counter === "2 / 3", `counter=${st.counter}`);
        await clickBarButton(client, scope, "›");
        st = await client.evaluate(pagerStateJs(scope));
        check("next-to-10", st.counter === "3 / 3", `counter=${st.counter}（数字段排序：10 在最后）`);
        await shot(client, "02-layer-end");

        // 3) 本层末尾 → 下一站
        check("end-hint", st.hint === true, "「本层已看完 · 下一站」提示");
        check("next-button-is-station", st.buttons.some((b) => b.text === "下一站"), `buttons=${JSON.stringify(st.buttons.map((b) => b.text))}`);
        await clickBarButton(client, scope, "下一站");
        // toast 只有 1.5s：导航完成后尽早检查（counter 之后会被重建索引拖慢）
        await new Promise((r) => setTimeout(r, 350));
        st = await client.evaluate(pagerStateJs(scope));
        check("station-entered-sub", st.counter === "1 / 2", `counter=${st.counter}（sub/a.png）`);
        check("station-toast", (st.toast ?? "").startsWith("已进入"), `toast=${st.toast}`);
        await shot(client, "03-station-entered");

        // 4) 反向跨站：站尾先有本层上一张（‹），退到站首才出现「上一站」
        await clickBarButton(client, scope, "›");
        st = await client.evaluate(pagerStateJs(scope));
        check("sub-layer-end", st.counter === "2 / 2", `counter=${st.counter}`);
        check("in-layer-prev-at-station-end", await clickBarButton(client, scope, "‹"), "站尾的 ‹（本层内退一张）");
        st = await client.evaluate(pagerStateJs(scope));
        check("sub-layer-head", st.counter === "1 / 2", `counter=${st.counter}`);
        const prevStationOk = await clickBarButton(client, scope, "上一站");
        check("prev-station-clickable", prevStationOk, "站首的「上一站」按钮存在且可点");
        st = await client.evaluate(pagerStateJs(scope));
        check("back-to-root-last", st.counter === "3 / 3", `counter=${st.counter}（回到根层 10.png）`);

        // 5) 键盘 ← / →（前提：块获得焦点。用真实指针点击块内图片，
        //    JS .click() 不移动焦点，focusedBlockId() 会拒绝键盘 —— 与真用户行为一致）
        const imgCenter = await client.evaluate(`(() => {
            const img = document.querySelector("${scope} img");
            if (img == null) return null;
            const r = img.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + Math.min(20, r.height / 2) };
        })()`);
        if (imgCenter != null) {
            await client.click(imgCenter.x, imgCenter.y);
            await new Promise((r) => setTimeout(r, 600));
        }
        await pressKey(client, { key: "ArrowLeft" });
        st = await client.evaluate(pagerStateJs(scope));
        check("keyboard-prev", st.counter === "2 / 3", `counter=${st.counter}`);
        await pressKey(client, { key: "ArrowRight" });
        st = await client.evaluate(pagerStateJs(scope));
        check("keyboard-next", st.counter === "3 / 3", `counter=${st.counter}`);

        // 6) Alt+→ 在新 Tab 打开下一张（必须在"有下一张"的位置做：末张时无处可开）
        await pressKey(client, { key: "ArrowLeft" }); // 回到 2/3
        st = await client.evaluate(pagerStateJs(scope));
        check("reset-to-2-for-alt", st.counter === "2 / 3", `counter=${st.counter}`);
        await pressKey(client, { key: "ArrowRight", altKey: true });
        await new Promise((r) => setTimeout(r, 1400));
        // Alt+→ 打开新 inline tab 并激活它：原块转入后台（仍在 DOM，移到屏外）
        const tabState = await client.evaluate(`(() => {
            const visible = [...document.querySelectorAll(".block")].filter((b) => {
                const r = b.getBoundingClientRect();
                return r.x > -100 && b.querySelector("img") != null;
            });
            const active = visible[0] ?? null;
            const activeId = active ? (active.className.match(/block-([0-9a-f-]{36})/)?.[1] ?? null) : null;
            const oldStillInDom = document.querySelector(${JSON.stringify(scope)}) != null;
            const oldOffscreen = (() => {
                const el = document.querySelector(${JSON.stringify(scope)});
                if (el == null) return false;
                const r = el.getBoundingClientRect();
                return r.x < -100 || r.width === 0;
            })();
            return { activeId, oldStillInDom, oldOffscreen, title: (active?.textContent || "").slice(0, 12) };
        })()`);
        check("alt-opens-and-activates-new-tab", tabState.activeId != null && tabState.activeId !== blockId,
            `新活动块=${tabState.activeId?.slice(0, 8)} 原 blockId=${blockId.slice(0, 8)} 标题=${tabState.title}`);
        // inline tab 组建组时会重建原块的 block id，所以不能按"原 id 仍在 DOM"断言；
        // 断言用户语义：tab 条上现在有 ≥2 个 tab（原图 + 新图）
        // tab 条由 layout 组渲染（在 .block 外层），全新实例上全局计数即可
        const tabCount = await client.evaluate(`document.querySelectorAll(".inline-tab-block-tab").length`);
        check("old-tab-still-exists", tabCount >= 2, `tab 条 tab 数=${tabCount}（原图作为 tab 保留）`);
        if (tabState.activeId != null && tabState.activeId !== blockId) {
            // 后续步骤锚定到新激活的 tab（键盘缩放/站跳都在"当前活动块"上做）
            scope = `.block.block-${tabState.activeId}`;
            blockId = tabState.activeId;
        }

        // 7) 缩放≠1 时键盘不翻页（不抢缩放手势）
        st = await client.evaluate(pagerStateJs(scope));
        check("alt-tab-shows-next-image", st.counter === "3 / 3", `counter=${st.counter}（新 tab 打开的是 10.png）`);
        // 真实指针点击激活新块（键盘前提），再放大
        const imgCenter2 = await client.evaluate(`(() => {
            const blk = document.querySelector("${scope}");
            const img = blk?.querySelector("img");
            if (img == null) return null;
            const r = img.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + Math.min(20, r.height / 2) };
        })()`);
        if (imgCenter2 != null) {
            await client.click(imgCenter2.x, imgCenter2.y);
            await new Promise((r) => setTimeout(r, 600));
        }
        await clickByTitle(client, "Zoom In");
        await clickByTitle(client, "Zoom In");
        await pressKey(client, { key: "ArrowLeft" });
        st = await client.evaluate(pagerStateJs(scope));
        check("keyboard-ignored-when-zoomed", st.counter === "3 / 3", `counter=${st.counter}（放大后 ← 不应翻页）`);
        await clickByTitle(client, "Reset Zoom");
        await pressKey(client, { key: "ArrowLeft" });
        st = await client.evaluate(pagerStateJs(scope));
        check("keyboard-works-after-reset", st.counter === "2 / 3", `counter=${st.counter}`);


        await pressKey(client, { key: "ArrowRight" }); // 回到本层末张
        st = await client.evaluate(pagerStateJs(scope));
        check("back-to-layer-end", st.counter === "3 / 3", `counter=${st.counter}`);

        // Home/End 必须作用于"当前本层"（跨站后若错用锚点层会跳回另一棵子树）
        await pressKey(client, { key: "Home" });
        st = await client.evaluate(pagerStateJs(scope));
        check("home-goes-to-layer-head", st.counter === "1 / 3", `counter=${st.counter}`);
        await pressKey(client, { key: "End" });
        st = await client.evaluate(pagerStateJs(scope));
        check("end-goes-to-layer-tail", st.counter === "3 / 3", `counter=${st.counter}`);

        // Shift+R 手动重建索引（PRD 需求 6）
        await pressKey(client, { key: "r", shiftKey: true, code: "KeyR" });
        st = await client.evaluate(pagerStateJs(scope));
        check("shift-r-invalidates-index", (st.toast ?? "").includes("索引已失效"), `toast=${st.toast}`);

        // 8) 全树到底：› 置灰（不循环）。站跳按实际状态推进：当前站→下一站→…→zz
        //    （前面的步骤可能因键盘/焦点问题停在不同站，这里只断言"能一直跳到 zz"）
        let hops = 0;
        for (let i = 0; i < 20; i++) {
            const stHop = await client.evaluate(pagerStateJs(scope));
            const station = stHop.buttons.find((b) => b.text === "下一站" && !b.disabled);
            if (station != null) {
                const ok = await clickBarButton(client, scope, "下一站");
                check(`station-hop-${hops + 1}`, ok, `第 ${hops + 1} 跳`);
                hops++;
                continue;
            }
            const next = stHop.buttons.find((b) => b.text === "›" && !b.disabled);
            if (next != null) {
                await clickBarButton(client, scope, "›"); // 翻完本层才会出现「下一站」
                continue;
            }
            break; // 两样都没了：全树到底
        }
        st = await client.evaluate(pagerStateJs(scope));
        check("last-station-single", st.counter === "1 / 1", `counter=${st.counter}（zz/last.png）`);
        const endDisabled = st.buttons.find((b) => b.text === "›")?.disabled;
        check("no-wrap-at-end", endDisabled === true, `› disabled=${endDisabled}`);
        await shot(client, "04-very-end");

        // 11) 悬停提示（统一 Tooltip，禁用态也可悬停）
        const tDisabled = await hoverBarButton(client, scope, "下一站");
        check("hover-tooltip-disabled-next", typeof tDisabled === "string" && tDisabled.length > 0, `tip=${tDisabled}`);

        const failed = results.filter((r) => !r.ok);
        const report = { fixture, runDir, passed: results.length - failed.length, failed: failed.length, verdict: failed.length === 0 ? "pass" : "fail", results };
        writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2));
        console.log(`\nverdict=${report.verdict}（${report.passed}/${results.length}）`);
        console.log(`run 目录: ${runDir}`);
        process.exitCode = failed.length === 0 ? 0 : 1;
    } finally {
        if (spawned) {
            // 自起的实例：验证结束后保留页面，便于人工看截图对应的现场；
            // 进程由 cleanup 在退出时统一结束（见 launch.mjs）。
        }
        client.close();
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 2;
});
