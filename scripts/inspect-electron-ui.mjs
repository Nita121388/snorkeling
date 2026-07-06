#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DefaultEndpoint = "http://127.0.0.1:9222";
const DefaultTarget = "Wave Terminal";
const DefaultScreenshotPath = path.join(process.cwd(), ".cache", "tmp", "inspect-electron-ui.png");

function usage() {
    return [
        "Usage: node scripts/inspect-electron-ui.mjs [--endpoint URL] [--target TEXT] <command> [args]",
        "",
        "Commands:",
        "  state                 Print URL, title, viewport, and interactive snapshot",
        "  elements [--limit N]  Print visible interactive elements with coordinates",
        "  style <query>         Print geometry and computed style for matching elements",
        "  click <x> <y>         Click viewport coordinates using CDP mouse events",
        "  screenshot [path]     Save a PNG screenshot",
        "  eval <js>             Run JavaScript in the renderer and print JSON result",
        "",
        "Defaults:",
        `  endpoint: ${DefaultEndpoint}`,
        `  target:   ${DefaultTarget}`,
    ].join("\n");
}

export function parseArgs(argv) {
    const parsed = {
        endpoint: process.env.SNORKELING_CDP_ENDPOINT || DefaultEndpoint,
        target: process.env.SNORKELING_CDP_TARGET || DefaultTarget,
        command: "",
        args: [],
    };

    const rest = [...argv];
    while (rest.length > 0) {
        const item = rest.shift();
        if (item === "--endpoint") {
            parsed.endpoint = requiredValue(rest, "--endpoint");
            continue;
        }
        if (item === "--target") {
            parsed.target = requiredValue(rest, "--target");
            continue;
        }
        if (item === "--help" || item === "-h") {
            parsed.command = "help";
            parsed.args = [];
            return parsed;
        }
        parsed.command = item;
        parsed.args = rest;
        return parsed;
    }

    parsed.command = "help";
    return parsed;
}

function requiredValue(rest, flag) {
    const value = rest.shift();
    if (!value) {
        throw new Error(`${flag} requires a value`);
    }
    return value;
}

export function selectTarget(targets, preferredText = "") {
    const preferred = preferredText ? new RegExp(escapeRegExp(preferredText.toLowerCase())) : null;
    return [...targets]
        .map((target, index) => ({ target, index, score: scoreTarget(target, preferred) }))
        .filter((item) => Number.isFinite(item.score))
        .sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            return a.index - b.index;
        })[0]?.target;
}

function scoreTarget(target, preferred) {
    if (!target?.webSocketDebuggerUrl) {
        return Number.NEGATIVE_INFINITY;
    }

    const type = String(target.type || "").toLowerCase();
    const url = String(target.url || "").toLowerCase();
    const title = String(target.title || "").toLowerCase();
    const haystack = `${title} ${url}`;
    if (haystack.includes("devtools")) {
        return Number.NEGATIVE_INFINITY;
    }

    let score = 0;
    if (preferred?.test(haystack)) {
        score += 1000;
    }
    if (type === "app") {
        score += 120;
    } else if (type === "webview") {
        score += 100;
    } else if (type === "page") {
        score += 80;
    } else if (type === "iframe") {
        score += 20;
    }
    if (url.startsWith("http://localhost") || url.startsWith("https://localhost")) {
        score += 90;
    }
    if (url.startsWith("http://127.0.0.1") || url.startsWith("https://127.0.0.1")) {
        score += 50;
    }
    if (url.startsWith("file://")) {
        score += 60;
    }
    if (url === "" || url === "about:blank") {
        score -= 160;
    }
    if (title) {
        score += 25;
    }
    return score;
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

class CDPClient {
    constructor(webSocketUrl) {
        this.webSocketUrl = webSocketUrl;
        this.nextId = 1;
        this.pending = new Map();
        this.ws = null;
    }

    connect() {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(this.webSocketUrl);
            const timer = setTimeout(() => {
                reject(new Error("CDP connect timeout"));
                ws.close();
            }, 10000);

            ws.addEventListener("open", () => {
                clearTimeout(timer);
                this.ws = ws;
                resolve();
            });
            ws.addEventListener("message", (event) => this.handleMessage(event.data));
            ws.addEventListener("error", () => {
                clearTimeout(timer);
                reject(new Error("CDP WebSocket error"));
            });
            ws.addEventListener("close", () => {
                for (const pending of this.pending.values()) {
                    pending.reject(new Error("CDP connection closed"));
                }
                this.pending.clear();
            });
        });
    }

    handleMessage(raw) {
        const msg = JSON.parse(raw);
        if (msg.id == null) {
            return;
        }
        const pending = this.pending.get(msg.id);
        if (!pending) {
            return;
        }
        clearTimeout(pending.timer);
        this.pending.delete(msg.id);
        if (msg.error) {
            pending.reject(new Error(`${msg.error.message}: ${msg.error.data || ""}`.trim()));
            return;
        }
        pending.resolve(msg.result);
    }

    send(method, params = {}, timeoutMs = 30000) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error("CDP connection is not open");
        }

        const id = this.nextId++;
        const payload = JSON.stringify({ id, method, params });
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`CDP command ${method} timed out`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            this.ws.send(payload);
        });
    }

    close() {
        this.ws?.close();
    }
}

async function getTargets(endpoint) {
    const root = endpoint.replace(/\/$/, "");
    for (const suffix of ["/json/list", "/json"]) {
        const response = await fetch(`${root}${suffix}`);
        if (!response.ok) {
            continue;
        }
        const data = await response.json();
        if (Array.isArray(data)) {
            return data;
        }
    }
    throw new Error(`No CDP targets at ${endpoint}`);
}

async function withClient(opts, fn) {
    const targets = await getTargets(opts.endpoint);
    const target = selectTarget(targets, opts.target);
    if (!target) {
        throw new Error(`No inspectable CDP target matched ${JSON.stringify(opts.target)}`);
    }
    const client = new CDPClient(target.webSocketDebuggerUrl);
    await client.connect();
    try {
        await client.send("Runtime.enable");
        await client.send("Page.enable");
        return await fn(client, target);
    } finally {
        client.close();
    }
}

async function evaluate(client, expression) {
    const result = await client.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
    });
    if (result.exceptionDetails) {
        const desc = result.exceptionDetails.exception?.description || "unknown evaluate error";
        throw new Error(desc);
    }
    return result.result?.value;
}

function interactiveElementsJs(limit) {
    return `(() => {
        const vw = window.innerWidth;
        const nodes = Array.from(document.querySelectorAll('button,[role=button],a,input,textarea,select,[title],[aria-label]'));
        return nodes.map((el, index) => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return {
                index,
                tag: el.tagName.toLowerCase(),
                text: (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120),
                aria: el.getAttribute('aria-label'),
                title: el.getAttribute('title'),
                role: el.getAttribute('role'),
                cls: String(el.className || '').slice(0, 180),
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                w: Math.round(rect.width),
                h: Math.round(rect.height),
                right: Math.round(vw - rect.right),
                visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
            };
        }).filter((item) => item.visible).sort((a, b) => (b.x - a.x) || (a.y - b.y)).slice(0, ${limit});
    })()`;
}

function styleQueryJs(query) {
    return `(() => {
        const query = ${JSON.stringify(query.toLowerCase())};
        function matches(el) {
            const haystack = [
                el.tagName,
                el.id,
                String(el.className || ''),
                el.getAttribute('aria-label') || '',
                el.getAttribute('title') || '',
                el.innerText || el.textContent || '',
            ].join(' ').toLowerCase();
            return haystack.includes(query);
        }
        return Array.from(document.querySelectorAll('*')).filter(matches).slice(0, 30).map((el) => {
            const rect = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return {
                tag: el.tagName.toLowerCase(),
                text: (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 160),
                cls: String(el.className || '').slice(0, 220),
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                w: Math.round(rect.width),
                h: Math.round(rect.height),
                clientH: el.clientHeight,
                scrollH: el.scrollHeight,
                display: cs.display,
                position: cs.position,
                flex: cs.flex,
                flexDirection: cs.flexDirection,
                minHeight: cs.minHeight,
                height: cs.height,
                maxHeight: cs.maxHeight,
                overflow: cs.overflow,
                overflowY: cs.overflowY,
                background: cs.backgroundColor,
                border: cs.border,
                borderRadius: cs.borderRadius,
                padding: cs.padding,
                margin: cs.margin,
                zIndex: cs.zIndex,
            };
        });
    })()`;
}

async function commandState(client, target) {
    const meta = await evaluate(client, "({ url: location.href, title: document.title, viewport: `${innerWidth}x${innerHeight}` })");
    const elements = await evaluate(client, interactiveElementsJs(40));
    console.log(`target: ${target.title || target.url}`);
    console.log(`url: ${meta.url}`);
    console.log(`title: ${meta.title}`);
    console.log(`viewport: ${meta.viewport}`);
    console.log("");
    printElements(elements);
}

async function commandElements(client, args) {
    const limit = readLimit(args, 80);
    const elements = await evaluate(client, interactiveElementsJs(limit));
    printElements(elements);
}

function readLimit(args, fallback) {
    const idx = args.indexOf("--limit");
    if (idx === -1) {
        return fallback;
    }
    const raw = args[idx + 1];
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error("--limit requires a positive number");
    }
    return value;
}

function printElements(elements) {
    for (const el of elements) {
        const name = el.text || el.aria || el.title || el.cls || el.tag;
        console.log(
            `[@${el.index}] ${el.tag} "${name}" x=${el.x} y=${el.y} w=${el.w} h=${el.h} right=${el.right}`
        );
    }
}

async function commandStyle(client, args) {
    const query = args.join(" ").trim();
    if (!query) {
        throw new Error("style requires a query");
    }
    const data = await evaluate(client, styleQueryJs(query));
    console.log(JSON.stringify(data, null, 2));
}

async function commandClick(client, args) {
    const x = Number(args[0]);
    const y = Number(args[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error("click requires numeric x and y coordinates");
    }
    await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    console.log(`clicked ${x},${y}`);
}

async function commandScreenshot(client, args) {
    const outputPath = args[0] || DefaultScreenshotPath;
    const result = await client.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
    });
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, Buffer.from(result.data, "base64"));
    console.log(outputPath);
}

async function commandEval(client, args) {
    const js = args.join(" ");
    if (!js) {
        throw new Error("eval requires JavaScript");
    }
    const value = await evaluate(client, js);
    console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.command === "help") {
        console.log(usage());
        return;
    }

    await withClient(opts, async (client, target) => {
        if (opts.command === "state") {
            await commandState(client, target);
        } else if (opts.command === "elements") {
            await commandElements(client, opts.args);
        } else if (opts.command === "style") {
            await commandStyle(client, opts.args);
        } else if (opts.command === "click") {
            await commandClick(client, opts.args);
        } else if (opts.command === "screenshot") {
            await commandScreenshot(client, opts.args);
        } else if (opts.command === "eval") {
            await commandEval(client, opts.args);
        } else {
            throw new Error(`Unknown command: ${opts.command}\n\n${usage()}`);
        }
    });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
