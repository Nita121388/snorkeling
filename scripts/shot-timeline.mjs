import { chromium } from "playwright-core";
import path from "node:path";

const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage();
for (const sc of ["working-tool", "blocked", "done", "idle"]) {
    const pageErrors = [];
    p.on("pageerror", (e) => pageErrors.push(String(e)));
    const url =
        "file://" +
        path.resolve(".mockup/agent-id-card/index.html").split("\\").join("/") +
        "?scenario=" +
        sc;
    await p.goto(url, { waitUntil: "networkidle" });
    await new Promise((r) => setTimeout(r, 300));
    const segs = await p
        .$$eval("#tl-track .tl-seg", (el) =>
            el.map((e) => ({ cls: e.className.replace("tl-seg tl-seg--", ""), w: e.offsetWidth })),
        )
        .catch(() => null);
    const legend = await p
        .$$eval("#tl-legend .tl-legend-item", (el) => el.map((e) => e.textContent.trim()))
        .catch(() => null);
    const total = await p.$eval("#tl-total", (e) => e.textContent).catch(() => null);
    console.log(`[${sc}] segs=`, JSON.stringify(segs));
    console.log(`  legend=`, JSON.stringify(legend), "total=", total, "errors=", pageErrors.length);
}
await b.close();