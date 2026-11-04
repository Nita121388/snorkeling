// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 最小 CDP 客户端（基于 ws）。只实现验证台需要的四件事：
//   evaluate(js)            在页面里跑 JS 拿 JSON（支持 await）
//   screenshot(clip)        按 CSS 像素裁切截图，返回 PNG buffer
//   dblclick(x, y)          真实指针双击（Input.dispatchMouseEvent，不走合成事件）
//   pressKey(key)           真实键盘事件（Esc 退出编辑用）
//
// 为什么不用 scripts/inspect-electron-ui.mjs：它是 CLI，内部函数没导出；
// 而且它没有 clip 截图与真实双击，正是本任务需要的能力。

import http from "node:http";
import WebSocket from "ws";

const DEFAULT_TIMEOUT_MS = 30000;

function httpGetJson(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, { timeout: 5000 }, (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (c) => (body += c));
            res.on("end", () => {
                try {
                    resolve(JSON.parse(body));
                } catch (err) {
                    reject(new Error(`CDP 返回非 JSON: ${body.slice(0, 120)}`));
                }
            });
        });
        req.on("timeout", () => {
            req.destroy(new Error("CDP http 超时"));
        });
        req.on("error", reject);
    });
}

export async function listPageTargets(endpoint) {
    const all = await httpGetJson(`${endpoint}/json/list`);
    return Array.isArray(all) ? all.filter((t) => t.type === "page") : [];
}

/** 找一个 app 主窗口页面（dev 实例是 .../index.html）。 */
export async function findAppTarget(endpoint) {
    const pages = await listPageTargets(endpoint);
    const app = pages.find((t) => /index\.html/.test(t.url ?? "")) ?? pages[0];
    if (app == null) {
        throw new Error(`CDP ${endpoint} 上没有任何 page target（app 还没起来？）`);
    }
    return app;
}

/**
 * 连到"真的是 app 主窗口"的那个 page target。
 * 多窗口/残留 target 时，直接取第一个会连到空白页 → waitForReady 永远不满足（实测假超时）。
 * 这里对每个候选做一次 smoke test（有 .block 且有 markdown 或 workspace 根）。
 */
export async function connect(endpoint) {
    const pages = (await listPageTargets(endpoint)).filter((t) => /index\.html/.test(t.url ?? ""));
    const candidates = pages.length > 0 ? pages : await listPageTargets(endpoint);
    if (candidates.length === 0) {
        throw new Error(`CDP ${endpoint} 上没有任何 page target（app 还没起来？）`);
    }
    let picked = null;
    for (const candidate of candidates) {
        const probe = await trySmokeTest(candidate.webSocketDebuggerUrl).catch(() => false);
        if (probe) {
            picked = candidate;
            break;
        }
    }
    const target = picked ?? candidateWithFallback(candidates);
    return connectToTarget(endpoint, target);
}

function candidateWithFallback(candidates) {
    return candidates[0];
}

async function trySmokeTest(wsUrl) {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
    try {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("smoke connect timeout")), 5000);
            ws.once("open", () => {
                clearTimeout(timer);
                resolve();
            });
            ws.once("error", (err) => {
                clearTimeout(timer);
                reject(err);
            });
        });
        const value = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("smoke eval timeout")), 5000);
            ws.on("message", (raw) => {
                const msg = JSON.parse(raw.toString());
                if (msg.id === 1) {
                    clearTimeout(timer);
                    resolve(msg.result?.result?.value);
                }
            });
            ws.send(
                JSON.stringify({
                    id: 1,
                    method: "Runtime.evaluate",
                    params: {
                        expression:
                            "document.readyState === 'complete' && document.querySelectorAll('.block').length > 0",
                        returnByValue: true,
                    },
                })
            );
        });
        return value === true;
    } finally {
        try {
            ws.close();
        } catch {
            /* ignore */
        }
    }
}

async function connectToTarget(endpoint, target) {
    const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
    const pending = new Map();
    let seq = 0;

    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("CDP websocket 连接超时")), 10000);
        ws.once("open", () => {
            clearTimeout(timer);
            resolve();
        });
        ws.once("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });

    ws.on("message", (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw.toString());
        } catch {
            return;
        }
        if (msg.id != null && pending.has(msg.id)) {
            const { resolve, reject, timer } = pending.get(msg.id);
            pending.delete(msg.id);
            clearTimeout(timer);
            if (msg.error != null) {
                reject(new Error(`${msg.error.message ?? "CDP error"}${msg.error.data ? `: ${msg.error.data}` : ""}`));
            } else {
                resolve(msg.result);
            }
        }
    });

    function send(method, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
        const id = ++seq;
        ws.send(JSON.stringify({ id, method, params }));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`CDP ${method} 超时 (${timeoutMs}ms)`));
            }, timeoutMs);
            pending.set(id, { resolve, reject, timer });
        });
    }

    // 让页面"以为"自己是焦点窗口：窗口在后台时 Chromium 会丢焦点，
    // 真实指针事件（Input.dispatchMouseEvent）也就进不到 React 处理器里
    // （实测：CDP 点击点不中弹窗按钮，而 JS click 有效）。
    async function activate() {
        await send("Page.bringToFront").catch(() => {});
        await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
        try {
            await send("Runtime.evaluate", { expression: "window.focus()" });
        } catch {
            /* ignore */
        }
    }

    async function evaluate(expression) {
        const result = await send("Runtime.evaluate", {
            expression,
            returnByValue: true,
            awaitPromise: true,
        });
        if (result.exceptionDetails != null) {
            const detail = result.exceptionDetails;
            const desc = detail.exception?.description ?? detail.text ?? "unknown evaluate error";
            throw new Error(`页面内 JS 抛错: ${desc}`);
        }
        return result.result?.value;
    }

    /**
     * 截图。两级策略 + 重试：
     *   A. fromSurface:true + clip —— 窗口可见时最快，且尊重 clip（默认路径）
     *   B. fromSurface:false 全屏 —— 窗口被遮挡/失焦时合成器不产帧，A 会挂到超时；B 不问合成器
     *
     * 返回 { buffer, fullViewport }：fullViewport=true 表示拿到的是整张视口（clip 被忽略），
     * 调用方需要自己裁。
     */
    async function screenshot(clip) {
        const attempts = [
            { fromSurface: true, clip },
            { fromSurface: false, clip: null },
            { fromSurface: false, clip: null },
        ];
        let lastErr;
        for (const a of attempts) {
            try {
                const params = { format: "png", captureBeyondViewport: false, fromSurface: a.fromSurface };
                if (a.clip != null) {
                    const vp = await viewportSize();
                    const x = Math.max(0, Math.min(Math.round(a.clip.x), vp.w - 1));
                    const y = Math.max(0, Math.min(Math.round(a.clip.y), vp.h - 1));
                    params.clip = {
                        x,
                        y,
                        width: Math.max(1, Math.min(Math.round(a.clip.width), vp.w - x)),
                        height: Math.max(1, Math.min(Math.round(a.clip.height), vp.h - y)),
                        scale: 1,
                    };
                }
                await send("Page.bringToFront").catch(() => {});
                const { data } = await send("Page.captureScreenshot", params, 12000);
                const buffer = Buffer.from(data, "base64");
                return { buffer, fullViewport: a.clip == null };
            } catch (err) {
                lastErr = err;
            }
        }
        throw lastErr ?? new Error("截图失败");
    }

    /** 真实指针单击（关弹窗、聚焦块用）。 */
    async function click(x, y) {
        await activate();
        const base = { x, y, button: "left", pointerType: "mouse" };
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0, pointerType: "mouse" });
        await send("Input.dispatchMouseEvent", { type: "mousePressed", ...base, buttons: 1, clickCount: 1 });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base, buttons: 0, clickCount: 1 });
    }

    /** 真实指针双击：两组 press/release，第二组 clickCount=2（浏览器据此合成 dblclick）。 */
    async function dblclick(x, y) {
        await activate();
        const base = { x, y, button: "left", buttons: 1, pointerType: "mouse" };
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0, pointerType: "mouse" });
        await send("Input.dispatchMouseEvent", { type: "mousePressed", ...base, clickCount: 1 });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base, buttons: 0, clickCount: 1 });
        await send("Input.dispatchMouseEvent", { type: "mousePressed", ...base, clickCount: 2 });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base, buttons: 0, clickCount: 2 });
    }

    async function pressKey(key) {
        const map = { Escape: { code: "Escape", windowsVirtualKeyCode: 27 } };
        const info = map[key] ?? {};
        await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, ...info });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key, ...info });
    }

    async function reload() {
        await send("Page.reload", { ignoreCache: false });
    }

    return {
        endpoint,
        targetUrl: target.url,
        send,
        evaluate,
        activate,
        screenshot,
        click,
        dblclick,
        pressKey,
        reload,
        close() {
            try {
                ws.close();
            } catch {
                /* already closed */
            }
        },
    };
}

/** 轮询等待页面内条件成立；返回最后一次的求值结果。 */
export async function waitFor(client, expression, { timeoutMs = 20000, intervalMs = 150, label = expression } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
        try {
            last = await client.evaluate(expression);
        } catch {
            last = undefined;
        }
        if (last) {
            return last;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`等待超时（${timeoutMs}ms）：${label}`);
}
