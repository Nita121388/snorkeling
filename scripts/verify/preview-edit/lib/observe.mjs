// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 观察层：一次 case 采样 = 编辑前 → 真实双击 → 编辑中 → Esc → 退出后，三态截图 + 结构化几何。
// 产出是 oracle 的唯一输入，也是 report 的证据。

import { writeFileSync } from "node:fs";
import path from "node:path";
import { waitFor } from "./cdp.mjs";
import { FIXTURE_SENTINEL, bringFixtureIntoView } from "./open.mjs";
import { cropPng, readPng, writePng } from "./pixel.mjs";

const SENTINEL = JSON.stringify(FIXTURE_SENTINEL);

/**
 * 找到"真正可见、可编辑、且在最顶层"的哨兵 markdown 根。
 * 只匹配哨兵是不够的：dev 实例的旧布局里可能还有面板盖在 markdown 上，
 * 那时双击坐标会落到遮挡物上 → 编辑器打不开（实测踩到）。
 */
function rootExpr() {
    return `(() => {
        const roots = [...document.querySelectorAll(".markdown-render-root")]
            .filter((r) => (r.textContent || "").includes(${SENTINEL}));
        // 只要求"可编辑 + 尺寸合理"。不再要求"在最顶层 / 在视口内"：
        // 文档很长时目标常在折叠线以下，顶层判定会把所有候选都排除掉（踩过）。
        // 遮挡问题由"滚到视口中央 + 双击重试 + 失败诊断"兜。
        for (const r of roots) {
            const md = r.closest(".markdown");
            if (md == null || !md.classList.contains("markdown-editable")) continue;
            const rect = r.getBoundingClientRect();
            if (rect.width <= 50 || rect.height <= 20) continue;
            return r;
        }
        return null;
    })()`;
}

function probeTargetJs(caseDef) {
    const target = caseDef.target ?? {};
    return `(() => {
        const root = ${rootExpr()};
        if (root == null) return { error: "no-markdown-root-with-sentinel" };
        // within 是「限定搜索范围」：可以就是 root 本身（.markdown-render-root），也可以是 root 的后代。
        // 旧实现直接在 root 里 querySelector(".markdown-render-root") → 永远是 null。
        const withinSel = ${JSON.stringify(target.within ?? null)};
        let scope = root;
        if (withinSel != null && withinSel !== "") {
            scope = root.matches(withinSel) ? root : (root.querySelector(withinSel) ?? root);
        }
        let el = scope.querySelector(${JSON.stringify(target.selector)});
        if (el == null) return { error: "no-target", selector: ${JSON.stringify(target.selector)} , scopeText: (scope.textContent||"").slice(0,80) };
        // 复刻 markdown.tsx 的锚点提升规则：li 内部还有子列表时，点击实际锚定到父级 ol/ul。
        // 探针必须同规则，否则"第一个文本节点"会取到被点条目的文字，
        // 而编辑器锚在整个列表的第一项上 → 量出 24px 的假偏移（实测假红）。
        if (el.tagName === "LI" && el.querySelector("ol, ul") != null) {
            const parentList = el.parentElement?.closest("ol, ul");
            if (parentList != null) el = parentList;
        }
        const rect = el.getBoundingClientRect();
        // 第一个非空文本节点的"第一行"墨迹矩形：双击点与零位移基准都取它。
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node = null;
        while ((node = walker.nextNode()) != null) { if ((node.nodeValue || "").trim() !== "") break; }
        let ink = null;
        if (node != null) {
            const range = document.createRange();
            range.selectNodeContents(node);
            const rects = range.getClientRects();
            const first = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
            ink = { x: first.left, y: first.top, w: first.width, h: first.height };
        }
        return {
            tag: el.tagName,
            cls: el.className,
            rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height, right: rect.right },
            ink,
            scrollHeight: el.scrollHeight,
            overlayPresent: document.querySelector(".inline-edit-overlay") != null,
        };
    })()`;
}

function describeDuringJs() {
    return `(() => {
        const ov = document.querySelector(".inline-edit-overlay");
        if (ov == null) return { error: "no-overlay" };
        const ovRect = ov.getBoundingClientRect();
        const root = ov.querySelector(".wysiwyg-editor");
        const firstList = ov.querySelector(".wysiwyg-list > ul, .wysiwyg-list > ol, .wysiwyg-editor > ul, .wysiwyg-editor > ol");
        const firstLi = ov.querySelector(".wysiwyg-list > ul > li, .wysiwyg-list > ol > li, .wysiwyg-editor > ul > li, .wysiwyg-editor > ol > li");
        const cs = (el, prop, pseudo) => (el == null ? null : getComputedStyle(el, pseudo ?? null).getPropertyValue(prop));
        // 编辑器中第一个文本节点的第一行墨迹
        let ink = null;
        const host = root ?? ov.querySelector("textarea");
        if (host != null) {
            const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
            let node = null;
            while ((node = walker.nextNode()) != null) { if ((node.nodeValue || "").trim() !== "") break; }
            if (node != null) {
                const range = document.createRange();
                range.selectNodeContents(node);
                const rects = range.getClientRects();
                const first = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
                ink = { x: first.left, y: first.top, w: first.width, h: first.height };
            }
        }
        // marker（::before）没有直接 rect：用 computed width + li 左边缘反推，够做"是否落在 overlay 内"判定。
        let marker = null;
        if (firstLi != null) {
            const liRect = firstLi.getBoundingClientRect();
            const width = parseFloat(cs(firstLi, "width", "::before")) || 0;
            marker = {
                content: cs(firstLi, "content", "::before"),
                width,
                position: cs(firstLi, "position", "::before"),
                rect: { x: liRect.left - width, y: liRect.top, w: width, h: liRect.height },
            };
        }
        const padBox = {
            left: ovRect.left,
            top: ovRect.top,
            right: ovRect.left + ov.clientWidth,
            bottom: ovRect.top + ov.clientHeight,
        };
        // 所有子元素是否都在 overlay 的可视区内（裁剪判定）
        let maxChildBottom = -Infinity;
        let maxChildRight = -Infinity;
        for (const child of ov.querySelectorAll("*")) {
            const r = child.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            if (r.bottom > maxChildBottom) maxChildBottom = r.bottom;
            if (r.right > maxChildRight) maxChildRight = r.right;
        }
        return {
            editorKind: ov.getAttribute("data-block-kind"),
            hasTextarea: ov.querySelector("textarea") != null,
            overlay: {
                x: ovRect.x, y: ovRect.y, w: ovRect.width, h: ovRect.height,
                right: ovRect.right, bottom: ovRect.bottom,
                scrollHeight: ov.scrollHeight,
                clientHeight: ov.clientHeight,
                clientWidth: ov.clientWidth,
                overflowY: cs(ov, "overflow-y"),
                contain: cs(ov, "contain"),
                padBox,
            },
            editorRoot: root == null ? null : {
                tag: root.tagName,
                cls: root.className,
                paddingLeft: cs(root, "padding-left"),
                whiteSpace: cs(root, "white-space"),
                overflow: cs(root, "overflow"),
            },
            firstList: firstList == null ? null : {
                tag: firstList.tagName,
                marginLeft: cs(firstList, "margin-left"),
                paddingLeft: cs(firstList, "padding-left"),
                listStyleType: cs(firstList, "list-style-type"),
            },
            firstLi: firstLi == null ? null : {
                paddingLeft: cs(firstLi, "padding-left"),
                marginTop: cs(firstLi, "margin-top"),
                position: cs(firstLi, "position"),
            },
            marker,
            ink,
            childExtent: { maxChildBottom, maxChildRight },
            inlineEditLog: (window.__inlineEditLog || []).slice(-40).map((e) => ({ msg: e.msg, t: e.t })),
        };
    })()`;
}

function escapeAndDescribeJs() {
    return `(() => {
        const ov = document.querySelector(".inline-edit-overlay");
        if (ov != null) {
            const editable = ov.querySelector("textarea, .wysiwyg-editor, [contenteditable]") || ov;
            editable.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        }
        return document.querySelector(".inline-edit-overlay") != null;
    })()`;
}

function afterEscJs(caseDef) {
    return `(() => {
        const root = ${rootExpr()};
        let el = root == null ? null : root.querySelector(${JSON.stringify((caseDef.target ?? {}).selector)});
        // 与 probe 一致地复刻"带子列表的 li 提升为父级列表"，否则退出后量的是另一个元素，
        // clean-exit 会误报 Δy≈24px（实测假红）。
        if (el != null && el.tagName === "LI" && el.querySelector("ol, ul") != null) {
            const parentList = el.parentElement?.closest("ol, ul");
            if (parentList != null) el = parentList;
        }
        const rect = el == null ? null : el.getBoundingClientRect();
        return {
            overlayGone: document.querySelector(".inline-edit-overlay") == null,
            hiddenLeft: document.querySelectorAll(".inline-edit-hidden").length,
            activeLeft: document.querySelectorAll(".inline-edit-active").length,
            rect: rect == null ? null : { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        };
    })()`;
}

function saveTemp(buf, outDir, name) {
    const file = path.join(outDir, name);
    writeFileSync(file, buf);
    return file;
}

/** 观察一次 case。返回 observation；截图写进 outDir。 */
export async function observeCase(client, caseDef, outDir) {
    await bringFixtureIntoView(client);

    // 上一次没退干净会让本次采样从一开始就错
    await client.evaluate(`(() => {
        const ov = document.querySelector(".inline-edit-overlay");
        if (ov != null) {
            const editable = ov.querySelector("textarea, .wysiwyg-editor, [contenteditable]") || ov;
            editable.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        }
        return true;
    })()`);
    await new Promise((r) => setTimeout(r, 150));

    // 先把目标滚进视口中央再量：文档很长时目标常在折叠线以下，
    // 此时 crop 会被 pngjs 夹成 1px（实测：before=0 during=0 行带、diff 全 0）。
    const scrollExpr = `(() => {
        const root = ${rootExpr()};
        if (root == null) return "no-root";
        const withinSel = ${JSON.stringify((caseDef.target ?? {}).within ?? null)};
        let scope = root;
        if (withinSel != null && withinSel !== "") scope = root.matches(withinSel) ? root : (root.querySelector(withinSel) ?? root);
        const el = scope.querySelector(${JSON.stringify((caseDef.target ?? {}).selector)});
        if (el == null) return "no-target";
        el.scrollIntoView({ block: "center", behavior: "auto" });
        return "ok";
    })()`;
    const scrollRes = await client.evaluate(scrollExpr);
    if (scrollRes !== "ok") {
        throw new Error(`目标定位/滚动失败（${caseDef.id}）: ${scrollRes}`);
    }
    await new Promise((r) => setTimeout(r, 250));

    const probe = await client.evaluate(probeTargetJs(caseDef));
    if (probe?.error != null) {
        throw new Error(`目标解析失败（${caseDef.id}）: ${JSON.stringify(probe)}`);
    }
    if (probe.overlayPresent) {
        throw new Error(`采样前页面上已有 inline-edit 覆盖层（${caseDef.id}），上一轮没退干净`);
    }
    if (probe.ink == null) {
        throw new Error(`目标没有可定位文本（${caseDef.id}）`);
    }

    // 截图裁切：包含 marker 列的宽裁切（给人看 / 给 diff 用）；
    // 规则层会再在内存里裁出"纯文本区"用于墨迹剖面。
    const pad = 40;
    // 裁切要"紧贴块"：太高会把上下相邻的段落/标题也框进来，墨迹剖面就会多出无关行带
    // （实测：段落的 1 行被判成 4 行，误报"编辑态少了 1 行"）。
    const crop = {
        x: Math.max(0, probe.rect.x - pad),
        y: Math.max(0, probe.rect.y - 2),
        width: probe.rect.w + pad + 24,
        height: probe.rect.h + 4,
    };
    const textAreaCrop = {
        x: Math.max(0, probe.ink.x - 2),
        y: Math.max(0, probe.rect.y - 2),
        width: Math.max(4, probe.rect.right - probe.ink.x + 8),
        height: probe.rect.h + 4,
    };

    const img = (name) => path.join(outDir, `${caseDef.id}-${name}.png`);
    // 全屏截一张、按 crop 裁一张：clip 在 fromSurface:false 下不可用。
    const shoot = async (name) => {
        const shot = await client.screenshot(crop);
        const buffer = Buffer.isBuffer(shot) ? shot : shot.buffer;
        const fullViewport = Buffer.isBuffer(shot) ? false : shot.fullViewport;
        const png = readPng(saveTemp(buffer, outDir, `${caseDef.id}-shot.png`));
        if (fullViewport) {
            writePng(img(name), cropPng(png, crop));
        } else if (png.width !== Math.round(crop.width) || png.height !== Math.round(crop.height)) {
            // 兜底：万一 clip 被丢弃，也按 crop 裁一次而不是直接存错区域
            writePng(img(name), cropPng(png, crop));
        } else {
            writePng(img(name), png);
        }
        return img(name);
    };
    await shoot("before");

    // 真实指针双击（不是合成事件）：坐标取第一行文本的墨迹中部
    const clickX = probe.ink.x + Math.min(3, Math.max(0, probe.ink.w - 1));
    const clickY = probe.ink.y + probe.ink.h / 2;
    // 真实双击；偶尔第一次点只"激活块"没进编辑 → 重试（最多 3 次）
    let opened = false;
    for (let attempt = 0; attempt < 3 && !opened; attempt++) {
        if (attempt > 0) {
            await new Promise((r) => setTimeout(r, 250));
        }
        await client.dblclick(clickX, clickY);
        opened = await waitFor(client, `document.querySelector(".inline-edit-overlay") != null`, {
            timeoutMs: 3000,
            label: "inline-edit 覆盖层出现",
        })
            .then(() => true)
            .catch(() => false);
    }
    if (!opened) {
        throw new Error(`双击 3 次仍未打开 inline 编辑器（${caseDef.id}）；目标可能被遮挡或该块不可编辑`);
    }
    await new Promise((r) => setTimeout(r, 250));

    // 截图前先把光标/选区从画面上抹掉：caret 是真实存在的墨迹，会污染"视觉一致性"判定。
    // 只改样式不动内容（不改 selection，避免打断编辑会话）。
    await client
        .evaluate(`(() => {
            const ov = document.querySelector(".inline-edit-overlay");
            if (ov == null) return false;
            for (const el of ov.querySelectorAll("textarea, [contenteditable]")) {
                el.style.setProperty("caret-color", "transparent", "important");
            }
            const style = document.createElement("style");
            style.id = "verify-caret-hidden";
            style.textContent = "::selection{background:transparent!important;color:inherit!important}";
            document.getElementById("verify-caret-hidden")?.remove();
            document.head.appendChild(style);
            return true;
        })()`)
        .catch(() => false);
    await new Promise((r) => setTimeout(r, 120));

    const during = await client.evaluate(describeDuringJs());
    if (during?.error != null) {
        throw new Error(`编辑态观察失败（${caseDef.id}）: ${during.error}`);
    }
    await shoot("during");

    // Esc 退出：优先真实键盘事件，兜底页内合成（真实键盘有时不落在编辑器上）
    await client.pressKey("Escape");
    const stillOpen = await client.evaluate(`document.querySelector(".inline-edit-overlay") != null`).catch(() => true);
    if (stillOpen) {
        await client.evaluate(escapeAndDescribeJs());
    }
    await waitFor(client, `document.querySelector(".inline-edit-overlay") == null`, {
        timeoutMs: 6000,
        label: "覆盖层消失",
    });
    await new Promise((r) => setTimeout(r, 200));

    const afterEsc = await client.evaluate(afterEscJs(caseDef));
    await shoot("afterEsc");

    return {
        caseId: caseDef.id,
        target: probe,
        crop,
        textAreaCrop,
        during,
        afterEsc,
        images: {
            crop,
            before: img("before"),
            during: img("during"),
            afterEsc: img("afterEsc"),
        },
    };
}
