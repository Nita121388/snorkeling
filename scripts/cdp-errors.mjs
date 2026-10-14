#!/usr/bin/env node

/**
 * cdp-errors —— 打印渲染进程的未捕获异常与 console 错误。
 *
 * 为什么需要它：`inspect-electron-ui` 只看 DOM/样式，而应用**启动失败**时 DOM 是空的
 * （实测 `document.body.innerHTML.length === 67`，就是一具空壳），此时"看 DOM"什么都看不到。
 * 真正的原因在 console / exceptionThrown 里，而那是 CDP 事件域，不是 eval 能问到的。
 *
 * 用法：
 *   node scripts/cdp-errors.mjs --endpoint http://127.0.0.1:9333 [--reload] [--wait 8000]
 *
 * --reload：先 reload 再监听，用于抓**启动期**的错误（已经失败过的页面不会重放异常）。
 */

import process from "node:process";

const args = process.argv.slice(2);
function opt(name, fallback) {
    const i = args.indexOf(name);
    return i === -1 ? fallback : args[i + 1];
}
const endpoint = opt("--endpoint", process.env.SNORKELING_CDP_ENDPOINT || "http://127.0.0.1:9333");
const targetMatch = opt("--target", "Wave");
const waitMs = Number(opt("--wait", "8000"));
const doReload = args.includes("--reload");

const targets = await (await fetch(`${endpoint}/json/list`)).json();
const target =
    targets.find((t) => t.type === "page" && (t.title || "").includes(targetMatch)) ??
    targets.find((t) => t.type === "page");
if (target == null) {
    console.error("cdp-errors: no page target");
    process.exit(1);
}
console.log(`cdp-errors: ${target.title} ${target.url}`);

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
        const msgId = ++id;
        pending.set(msgId, { resolve, reject });
        ws.send(JSON.stringify({ id: msgId, method, params }));
    });

const seen = new Set();
function report(kind, text) {
    const key = `${kind}::${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    console.log(`[${kind}] ${text}`);
}

ws.addEventListener("message", (event) => {
    let msg;
    try {
        msg = JSON.parse(event.data);
    } catch {
        return;
    }
    if (msg.id != null) {
        const p = pending.get(msg.id);
        if (p) {
            pending.delete(msg.id);
            msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
        }
        return;
    }
    if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params?.exceptionDetails ?? {};
        const text = d.exception?.description ?? d.text ?? JSON.stringify(d).slice(0, 400);
        report("exception", `${text}\n    at ${d.url ?? "?"}:${d.lineNumber ?? "?"}`);
    } else if (msg.method === "Runtime.consoleAPICalled") {
        if (msg.params?.type === "error" || msg.params?.type === "warning") {
            const text = (msg.params.args ?? [])
                .map((a) => a.description ?? a.value ?? a.type)
                .join(" ")
                .slice(0, 500);
            report(`console.${msg.params.type}`, text);
        }
    } else if (msg.method === "Log.entryAdded") {
        const e = msg.params?.entry ?? {};
        if (e.level === "error") {
            report("log.error", `${e.text ?? ""} ${e.url ?? ""}`.slice(0, 400));
        }
    }
});

await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
});
await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
if (doReload) {
    await send("Page.reload", { ignoreCache: true });
}
await new Promise((r) => setTimeout(r, waitMs));
if (seen.size === 0) {
    console.log("(无异常/错误)");
}
ws.close();
process.exit(0);
