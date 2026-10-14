#!/usr/bin/env node

/**
 * cdp-focus-hold —— 为一个 CDP target 保持一条“长连接 + focus 模拟”的会话。
 *
 * 为什么需要它：本机沙箱的 Electron 窗口抢不到前台（每次新进程一跑就把焦点抢走），
 * 于是 `document.visibilityState` 反复回到 `hidden`，CDP 输入（点击/按键）不投递，
 * parity/交互验证全部落空。parity-check.mjs 的已知坑注释写的就是这条：
 * 「请把窗口置前，或用 Emulation.setFocusEmulationEnabled + 长连接」——
 * 置前在这台机器上不可靠（实测：单发 focus 命令返回 visible，下一条命令又回到 hidden），
 * 所以实现后半句。
 *
 * 用法（在后台持有，然后在同一窗口内跑验证命令）：
 *   node scripts/cdp-focus-hold.mjs --endpoint http://127.0.0.1:9333 --hold-ms 600000 &
 *   node scripts/parity-check.mjs --endpoint http://127.0.0.1:9333 --line 3
 *
 * 说明：`Emulation.setFocusEmulationEnabled` 是**会话级**的，连接一断就失效 ——
 * 这正是必须长连接而不是每条命令各开一次的原因。
 */

import process from "node:process";

const DEFAULTS = {
    endpoint: process.env.SNORKELING_CDP_ENDPOINT || "http://127.0.0.1:9333",
    target: process.env.SNORKELING_CDP_TARGET || "Wave Terminal",
    holdMs: Number(process.env.SNORKELING_FOCUS_HOLD_MS || 600000),
};

function parseArgs(argv) {
    const opts = { ...DEFAULTS };
    const rest = [...argv];
    while (rest.length > 0) {
        const item = rest.shift();
        if (item === "--endpoint") opts.endpoint = rest.shift();
        else if (item === "--target") opts.target = rest.shift();
        else if (item === "--hold-ms") opts.holdMs = Number(rest.shift());
        else if (item === "--help" || item === "-h") opts.help = true;
    }
    return opts;
}

/** 极简 CDP 客户端：只用到 send/close，不引第三方依赖（与 inspect-electron-ui 同风格）。 */
class CDPClient {
    constructor(url) {
        this.url = url;
        this.id = 0;
        this.pending = new Map();
        this.ws = null;
    }
    connect() {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(this.url);
            this.ws = ws;
            ws.addEventListener("open", () => resolve());
            ws.addEventListener("error", (e) => reject(new Error(String(e?.message ?? e))));
            ws.addEventListener("message", (event) => {
                let msg;
                try {
                    msg = JSON.parse(event.data);
                } catch {
                    return;
                }
                if (msg.id == null) return;
                const entry = this.pending.get(msg.id);
                if (entry == null) return;
                this.pending.delete(msg.id);
                if (msg.error) entry.reject(new Error(msg.error.message));
                else entry.resolve(msg.result);
            });
        });
    }
    send(method, params = {}) {
        const id = ++this.id;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }
    close() {
        this.ws?.close();
    }
}

async function getTargets(endpoint) {
    const res = await fetch(`${endpoint}/json/list`);
    return await res.json();
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
    console.log(
        "Usage: node scripts/cdp-focus-hold.mjs [--endpoint URL] [--target TEXT] [--hold-ms N]\n\n" +
            "Holds a long CDP session with Emulation.setFocusEmulationEnabled so that\n" +
            "document.visibilityState stays 'visible' and CDP input is delivered.\n" +
            "Run it in the background while running parity-check.mjs / inspect-electron-ui.mjs."
    );
    process.exit(0);
}

const targets = await getTargets(opts.endpoint);
const target =
    targets.find((t) => (t.title || "").includes(opts.target) && t.type === "page") ??
    targets.find((t) => t.type === "page");
if (target == null) {
    console.error(`cdp-focus-hold: no page target matching ${JSON.stringify(opts.target)}`);
    process.exit(1);
}

const client = new CDPClient(target.webSocketDebuggerUrl);
await client.connect();
await client.send("Runtime.enable");
await client.send("Page.enable");
// bringToFront 是目标级副作用（断开也保留）；focus 模拟是会话级（必须长连接）。
await client.send("Page.bringToFront").catch(() => {});
try {
    await client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
} catch (error) {
    console.error(`cdp-focus-hold: setFocusEmulationEnabled unavailable: ${error.message}`);
}
const state = await client.send("Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true });
console.log(JSON.stringify({ holding: true, target: target.title, visibilityState: state?.result?.value, holdMs: opts.holdMs }));

// 心跳：定期核对 visibilityState，掉回 hidden 就重新置位（本机实测会反复掉）。
const heartbeat = setInterval(async () => {
    try {
        await client.send("Page.bringToFront").catch(() => {});
        await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    } catch {
        // 连接已断：让 hold 自然结束
    }
}, 1500);

const shutdown = () => {
    clearInterval(heartbeat);
    client.close();
    process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
setTimeout(shutdown, opts.holdMs);
