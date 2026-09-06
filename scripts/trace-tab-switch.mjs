#!/usr/bin/env node
// Continuously record a Chrome performance trace for all tab renderer processes
// so you can dump it AFTER you notice a problem (no need to reproduce on demand).
//
// Usage:
//   1. Start the dev app with a CDP port:  npm run dev:cdp
//   2. Start this script in another terminal:  npm run trace:tab
//   3. Use the app normally. When you notice tab-switch lag, press Enter here.
//      The buffered trace (everything up to that moment) is written to a JSON
//      file and recording continues automatically, so you can dump again later.
//
// The output file can be loaded into Chrome DevTools (Performance panel ->
// Load profile) or handed to an agent for analysis.
//
// Env:
//   CDP_ENDPOINT  defaults to http://127.0.0.1:9222

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import WebSocket from "ws";

const endpoint = process.env.CDP_ENDPOINT ?? "http://127.0.0.1:9222";
const outDir = path.join(process.cwd(), ".cache", "tmp");

const categories = [
    "devtools.timeline",
    "v8.execute",
    "disabled-by-default-devtools.timeline.stack",
    "disabled-by-default-devtools.timeline.frame",
];

function httpGetJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on("error", reject);
    });
}

class CdpClient {
    constructor(wsUrl, label) {
        this.label = label;
        this.nextId = 1;
        this.pending = new Map();
        this.traceEvents = [];
        this.completeResolvers = [];
        this.ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
        this.ws.on("message", (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw.toString());
            } catch {
                return;
            }
            if (msg.id != null && this.pending.has(msg.id)) {
                const { resolve, reject } = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                if (msg.error) {
                    reject(new Error(`${msg.error.message} ${msg.error.data ?? ""}`));
                } else {
                    resolve(msg.result);
                }
                return;
            }
            if (msg.method === "Tracing.dataCollected" && Array.isArray(msg.params?.value)) {
                this.traceEvents.push(...msg.params.value);
            } else if (msg.method === "Tracing.tracingComplete") {
                const resolvers = this.completeResolvers.splice(0);
                for (const resolve of resolvers) {
                    resolve();
                }
            }
        });
        this.ready = new Promise((resolve, reject) => {
            this.ws.on("open", resolve);
            this.ws.on("error", reject);
        });
    }

    send(method, params = {}) {
        const id = this.nextId++;
        return this.ready.then(
            () =>
                new Promise((resolve, reject) => {
                    this.pending.set(id, { resolve, reject });
                    this.ws.send(JSON.stringify({ id, method, params }));
                })
        );
    }

    async startTracing() {
        this.traceEvents = [];
        await this.send("Tracing.start", {
            traceConfig: {
                recordMode: "recordContinuously",
                includedCategories: categories,
            },
        });
    }

    async dumpAndRestart() {
        await this.send("Tracing.end");
        await new Promise((resolve) => {
            this.completeResolvers.push(resolve);
            setTimeout(resolve, 5000); // safety timeout
        });
        const events = this.traceEvents;
        await this.startTracing();
        return events;
    }

    close() {
        try {
            this.ws.close();
        } catch {
            // ignore
        }
    }
}

async function main() {
    let targets;
    try {
        targets = await httpGetJson(`${endpoint}/json/list`);
    } catch (e) {
        console.error(`[trace-tab-switch] cannot reach CDP at ${endpoint}: ${e.message}`);
        console.error(`[trace-tab-switch] start the dev app first: npm run dev:cdp`);
        process.exit(1);
    }

    const pageTargets = targets.filter((t) => t.type === "page" && !t.url.startsWith("devtools://"));
    if (pageTargets.length === 0) {
        console.error("[trace-tab-switch] no page targets found via /json/list");
        process.exit(1);
    }

    const clients = [];
    for (const target of pageTargets) {
        try {
            const client = new CdpClient(target.webSocketDebuggerUrl, target.title || target.url);
            await client.ready;
            await client.startTracing();
            clients.push(client);
            console.log(`[trace-tab-switch] tracing: ${target.title || target.url}`);
        } catch (e) {
            console.warn(`[trace-tab-switch] failed to attach to "${target.title}": ${e.message}`);
        }
    }
    if (clients.length === 0) {
        console.error("[trace-tab-switch] could not attach to any target");
        process.exit(1);
    }

    fs.mkdirSync(outDir, { recursive: true });

    async function dumpOnce() {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const outFile = path.join(outDir, `tab-switch-trace-${stamp}.json`);
        const allEvents = [];
        const targetInfos = [];
        for (const client of clients) {
            try {
                const events = await client.dumpAndRestart();
                allEvents.push(...events);
                targetInfos.push(client.label);
            } catch (e) {
                console.warn(`[trace-tab-switch] dump failed for "${client.label}": ${e.message}`);
            }
        }
        const payload = {
            traceEvents: allEvents,
            metadata: { targets: targetInfos, dumpedAt: new Date().toISOString() },
        };
        fs.writeFileSync(outFile, JSON.stringify(payload));
        console.log(
            `[trace-tab-switch] saved ${allEvents.length} events -> ${outFile} (recording continues, press Enter to dump again)`
        );
        return outFile;
    }

    console.log(`[trace-tab-switch] continuous tracing on ${clients.length} target(s).`);
    console.log(`[trace-tab-switch] Press Enter AFTER you notice lag to dump the buffered trace. Ctrl+C to exit.`);

    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    rl.on("line", () => {
        dumpOnce().catch((e) => console.error("[trace-tab-switch] dump error:", e));
    });

    process.on("SIGINT", async () => {
        console.log("\n[trace-tab-switch] exiting, dumping final trace...");
        await dumpOnce().catch(() => {});
        for (const client of clients) {
            client.close();
        }
        process.exit(0);
    });
}

main();
