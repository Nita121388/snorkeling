// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 可复用的页面探针与等待器。
//
// 为什么单独一个文件：这些是**每个验证台都会重写一遍**的东西，而每一份手抄版都曾独立
// 踩过同样的坑（LRM、hover 延迟、视口外元素、Just now 两段词）。集中一处后，修一次全台受益。
//
// 约定：
// - `probe*` 返回**字符串**，由调用方 `client.evaluate(...)` 求值（CDP 只吃字符串表达式）。
// - `hoverUntil` / `waitForProbe` 是 node 侧循环，负责"重试到成立"，不吃页面内定时器。
// - 断言优先看语义属性（class / data-* / 文案），**不要**看颜色。

/** 页面内可见性判定（含视口内），注入到各 probe 里用。 */
export const VISIBLE_FN = `function __visible(el) {
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    return r.width > 4 && r.height > 4 && cx > 0 && cx < innerWidth - 2 && cy > 0 && cy < innerHeight - 2;
}`;

/** 页面内文本归一化：block header 常带 LRM 等不可见字符，直接 `^Done` 会匹配不上。 */
export const CLEAN_TEXT_FN = `function __clean(s) {
    return (s || "").replace(/[\\u200b-\\u200f\\ufeff]/g, "").trim();
}`;

/** node 侧同一条归一化规则（断言里用）。 */
export function normalizeText(value) {
    return (value ?? "").replace(/[\u200b-\u200f\ufeff]/g, "").trim();
}

/** 找第一个"可见且文本完全匹配"的 button/[role=button]/[role=tab] 中心点。 */
export function probeButtonByText(label) {
    return `(() => {
        ${VISIBLE_FN}
        const wanted = ${JSON.stringify(label)};
        for (const el of document.querySelectorAll("button, [role=button], [role=tab]")) {
            if ((el.textContent || "").trim() !== wanted) continue;
            if (!__visible(el)) continue;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        }
        return null;
    })()`;
}

/** 按 aria-label / title 找元素中心点（WidgetsBar 展开按钮这类）。 */
export function probeByLabel(label) {
    return `(() => {
        ${VISIBLE_FN}
        const el = document.querySelector('[aria-label="' + ${JSON.stringify(label)} + '"], [title="' + ${JSON.stringify(label)} + '"]');
        if (!el || !__visible(el)) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`;
}

/** 元素中心点（不存在/不可见返回 null）。 */
export function probeCenter(selector) {
    return `(() => {
        ${VISIBLE_FN}
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el || !__visible(el)) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`;
}

/** 某个选择器的归一化文本（不存在返回 null）。 */
export function probeText(selector) {
    return `(() => {
        ${CLEAN_TEXT_FN}
        const el = document.querySelector(${JSON.stringify(selector)});
        return el ? __clean(el.textContent) : null;
    })()`;
}

/** 反复把指针移到 point 直到 ready(snapshot) 成立（浮层有 hover intent 延迟）。 */
export async function hoverUntil(client, point, probe, ready, { tries = 14, waitMs = 700 } = {}) {
    let last = null;
    for (let i = 0; i < tries; i++) {
        await client.move(point.x, point.y);
        await sleep(waitMs);
        last = await client.evaluate(probe);
        if (ready(last)) return last;
    }
    return last;
}

/** 轮询 probe 直到 predicate 成立；返回最后一次快照（可能不满足，由调用方断言）。 */
export async function waitForProbe(client, probe, predicate, { timeoutMs = 60000, intervalMs = 800, onTick } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        last = await client.evaluate(probe);
        onTick?.(last);
        if (predicate(last)) return last;
        await sleep(intervalMs);
    }
    return last;
}

/** 真实键盘输入：一段文本 + 回车（xterm / textarea 都适用）。 */
export async function typeTextAndEnter(client, text) {
    await client.send("Input.insertText", { text });
    await sleep(300);
    for (const type of ["rawKeyDown", "char", "keyUp"]) {
        await client.send("Input.dispatchKeyEvent", {
            type,
            key: "Enter",
            code: "Enter",
            text: type === "char" ? "\r" : undefined,
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13,
        });
    }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 第一次启动的引导向导 / 各种"下一步"弹窗：按文案循环点掉。 */
export function probeOnboardingButton() {
    return `(() => {
        ${VISIBLE_FN}
        ${CLEAN_TEXT_FN}
        for (const el of document.querySelectorAll("button, [role=button]")) {
            const t = __clean(el.textContent);
            if (!/^(continue|next|next step|get started|got it|skip|not now|allow|i agree)$/i.test(t)) continue;
            if (!__visible(el)) continue;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), t };
        }
        return null;
    })()`;
}

/** 循环点掉引导弹窗（最多 steps 轮）。 */
export async function dismissOnboarding(client, { steps = 10, waitMs = 700, log = () => {} } = {}) {
    for (let i = 0; i < steps; i++) {
        const btn = await client.evaluate(probeOnboardingButton());
        if (btn == null) return;
        await client.click(btn.x, btn.y);
        log(`dismissed onboarding: ${btn.t}`);
        await sleep(waitMs);
    }
}

/**
 * 选一个"真的有工作区"的 renderer。多 Tab 时每个 Tab 一个 BrowserView，
 * 非激活的可能 innerWidth === 0；直接取第一个 page target 会连到空壳。
 *
 * @param {(page)=>Promise<any>} connectTarget  由 area 注入（一般就是 cdp.mjs 的 connectToTarget）
 */
export async function pickLiveRenderer(pages, connectTarget, endpoint) {
    const probed = [];
    for (const page of pages) {
        const client = await connectTarget(endpoint, page).catch(() => null);
        if (client == null) continue;
        const info = await client
            .evaluate(`(() => ({ w: innerWidth, h: innerHeight, blocks: document.querySelectorAll(".block").length }))()`)
            .catch(() => null);
        probed.push({ client, page, info });
    }
    const usable = probed.filter((p) => (p.info?.blocks ?? 0) > 0 && (p.info?.w ?? 0) > 0);
    const best = usable.sort((a, b) => b.info.w * b.info.h - a.info.w * a.info.h)[0];
    for (const p of probed) if (p !== best) p.client.close();
    if (best == null) {
        throw new Error(`没有可用的 app renderer（probed=${JSON.stringify(probed.map((p) => p.info))}）`);
    }
    return best;
}
