// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 把 fixture 打开成 preview block。
//
// 已知限制：这一版 Wave 的布局存在 DB 里（pkg/wcore/layout.go），没有 wave.lay 可预置，
// 所以"启动即就位"不可行。策略链按可靠性排序：
//   reuse  当前实例里已经打开了同一个 fixture 的 preview（迭代最常用，0 成本）
//   rpc    在渲染进程里 import app 自己的 store，调 createBlock（vite dev 下源码可直接 import）
//   ui     真实点击文件树（M2 再补，需要知道树根）
//
// 任何策略成功后都必须通过"内容哨兵"校验：打开的是这个文件，而不只是"某个 preview"。

import { waitFor } from "./cdp.mjs";

export const FIXTURE_SENTINEL = "VERIFY-FIXTURE-v1-a7f3";

/**
 * 共享的"选根"表达式：在所有含哨兵的 .markdown-render-root 里，挑
 *   1) 属于 .markdown.markdown-editable（可编辑）
 *   2) 尺寸合理、与会话视口相交
 *   3) 在它自己第一个文本点上是最顶层元素（没被别的面板盖住）
 * 找不到就返回 null —— 由调用方给出"谁盖住了"的诊断。
 */
export function bestRootJs() {
    return `(() => {
        const sentinel = ${JSON.stringify(FIXTURE_SENTINEL)};
        const roots = [...document.querySelectorAll(".markdown-render-root")]
            .filter((r) => (r.textContent || "").includes(sentinel));
        const candidates = [];
        for (const r of roots) {
            const md = r.closest(".markdown");
            const editable = md != null && md.classList.contains("markdown-editable");
            const rect = r.getBoundingClientRect();
            const sized = rect.width > 50 && rect.height > 20;
            const onScreen = rect.bottom > 8 && rect.top < innerHeight - 8;
            let point = null;
            const walker = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
            let node = null;
            while ((node = walker.nextNode()) != null) { if ((node.nodeValue || "").trim() !== "") break; }
            if (node != null) {
                const range = document.createRange();
                range.selectNodeContents(node);
                const first = range.getClientRects()[0] ?? range.getBoundingClientRect();
                point = { x: first.left + 2, y: first.top + first.height / 2 };
            }
            let topmost = false;
            let covering = null;
            if (point != null) {
                const top = document.elementFromPoint(point.x, point.y);
                topmost = top != null && r.contains(top);
                if (!topmost && top != null) {
                    covering = top.tagName + "." + String(top.className || "").slice(0, 60);
                }
            }
            candidates.push({ root: r, editable, sized, onScreen, topmost, covering, rect, point, count: roots.length });
        }
        // 只要"可编辑 + 尺寸合理"就算 fixture 已打开；遮挡/滚动交给观察层的滚动+重试。
        // （要求 topmost 会在文档被滚动时把唯一候选也排除掉。）
        const best = candidates.find((c) => c.editable && c.sized);
        if (best == null) return { ok: false, candidates: candidates.map((c) => ({ editable: c.editable, sized: c.sized, onScreen: c.onScreen, topmost: c.topmost, covering: c.covering, rect: { x: c.rect.x, y: c.rect.y, w: c.rect.width, h: c.rect.height } })) };
        const b = best.rect;
        return { ok: true, count: best.count, rect: { x: b.x, y: b.y, w: b.width, h: b.height } };
    })()`;
}

/** 页面里是否已经有一个"可见且可编辑"的哨兵 markdown 根（说明 fixture 已经打开且可用）。 */
async function findOpenPreview(client) {
    const res = await client.evaluate(bestRootJs());
    return res?.ok === true ? res : null;
}

/**
 * 通过渲染进程内的 app store 建一个 preview block。
 * 模块 URL 做候选探测：electron-vite 的 renderer root 是 frontend/，但不同启动方式路径可能不同。
 */
async function openViaRpc(client, absPath) {
    const result = await client.evaluate(`(async () => {
        const file = ${JSON.stringify(absPath)};
        // 实测：只有 /frontend/app/store/global.ts 是 app 真正实例化的那个模块
        // （/app/store/*.ts 在 dev 服务器上是 404；重复 import 会拿到"另一份"模块实例，
        // 其中的 staticTabId 是 undefined → createBlock 直接抛错）。
        const candidates = ["/frontend/app/store/global.ts"];
        const tried = [];
        for (const url of candidates) {
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const mod = await import(url);
                    if (typeof mod.createBlock !== "function") {
                        tried.push(url + ":no-createBlock");
                        break;
                    }
                    await mod.createBlock({ meta: { view: "preview", file } }, false, false);
                    return { ok: true, via: url, tried };
                } catch (err) {
                    const msg = String(err && err.message ? err.message : err).slice(0, 120);
                    tried.push(url + "#" + attempt + ":" + msg);
                    // 启动早期 tab 可能还没就绪 → 稍等重试
                    await new Promise((r) => setTimeout(r, 400));
                }
            }
        }
        return { ok: false, tried };
    })()`);
    return result;
}

/**
 * 打开 fixture 并返回 { openedBy, rect }。
 * 失败时抛错并附带诊断（策略链每一级的失败原因 + 页面现状）。
 */
export async function ensureFixtureOpen(client, absPath) {
    const reuse = await findOpenPreview(client);
    if (reuse != null) {
        return { openedBy: "reuse", rect: reuse.rect };
    }

    const diagnostics = [];

    const rpc = await openViaRpc(client, absPath).catch((err) => ({ ok: false, tried: [String(err.message)] }));
    if (rpc?.ok) {
        const rect = await waitForMarkdownWithSentinel(client).catch(() => null);
        if (rect != null) return { openedBy: "rpc", rect };
        diagnostics.push("rpc: createBlock 成功但没等到带哨兵的 .markdown-render-root");
    } else {
        diagnostics.push(`rpc: ${JSON.stringify(rpc?.tried ?? [])}`);
    }

    // 诊断：把页面上的块列出来，方便判断"打开了但内容不对 / 根本没打开"
    const bestRoot = await client.evaluate(bestRootJs()).catch(() => null);
    const snapshot = await client
        .evaluate(`(() => {
            const roots = [...document.querySelectorAll(".markdown-render-root")];
            return {
                markdownRoots: roots.length,
                firstText: (roots[0]?.textContent || "").slice(0, 120),
                blocks: document.querySelectorAll(".block").length,
                view: location.href,
            };
        })()`)
        .catch(() => null);

    throw new Error(
        `打开 fixture 失败。\n策略链诊断:\n  - ${diagnostics.join("\n  - ")}\n` +
            `页面现状: ${JSON.stringify(snapshot)}\n` +
            `文件: ${absPath}\n` +
            `提示: 若 rpc 策略全部 no-createBlock，说明 dev 服务器模块路径变了，改 lib/open.mjs 的 candidates。`
    );
}

async function waitForMarkdownWithSentinel(client, timeoutMs = 25000) {
    const found = await waitFor(client, `(() => { const r = ${bestRootJs()}; return r.ok ? r.rect : null; })()`, {
        timeoutMs,
        label: "可见且可编辑的哨兵 .markdown-render-root",
    }).catch(() => null);
    if (found == null) return null;
    // 让列表/标题排版稳定（字体、折叠控件）后再交给观察层
    await new Promise((r) => setTimeout(r, 250));
    return found;
}

/** 把 fixture 的渲染区滚到视口上半部，保证截图裁切范围内元素完整可见。 */
export async function bringFixtureIntoView(client) {
    await client.evaluate(`(() => {
        const sentinel = ${JSON.stringify(FIXTURE_SENTINEL)};
        const hit = [...document.querySelectorAll(".markdown-render-root")]
            .find((r) => (r.textContent || "").includes(sentinel));
        if (hit == null) return false;
        hit.scrollIntoView({ block: "start", behavior: "auto" });
        return true;
    })()`);
    await new Promise((r) => setTimeout(r, 200));
}
