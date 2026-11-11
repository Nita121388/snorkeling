// jsdom smoke test for the annotation-timeline-v2 prototype.
// 覆盖设计文档三块的核心断言：桶分页（窗口推进 / 稀疏折叠 / 到头）、
// 外部写入（agent 角标 + 新批注 pill + 消费跳转）、悬浮卡（hover 出卡 / 钉住）。
// Run: node design/prototypes/aisessions/aisessions-timeline-v2/smoke.test.cjs
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const js = fs.readFileSync(path.join(dir, "script.js"), "utf8");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, cond, extra) {
    if (cond) {
        console.log(`  ok   ${name}`);
        return;
    }
    failures++;
    console.log(`  FAIL ${name}${extra === undefined ? "" : ` -> ${JSON.stringify(extra)}`}`);
}

function makeWindow() {
    const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
    const { window } = dom;
    // jsdom has no layout engine: shim the few metrics the prototype reads.
    window.HTMLElement.prototype.getBoundingClientRect = function () {
        return { top: 100, left: 0, right: 50, bottom: 120, width: 50, height: 20 };
    };
    Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { get: () => 480, configurable: true });
    Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { get: () => 600, configurable: true });
    Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", { get: () => 320, configurable: true });
    Object.defineProperty(window.HTMLElement.prototype, "offsetWidth", { get: () => 320, configurable: true });
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    new window.Function(js).call(window);
    return window;
}

function dots(window) {
    return window.document.querySelectorAll(".rail-dot").length;
}
function buckets(window) {
    return window.document.querySelectorAll(".bucket").length;
}

(async () => {
    console.log("initial window (latest 2 buckets)");
    {
        const window = makeWindow();
        const doc = window.document;
        const proto = window.__timelineProto;
        check("2 buckets rendered", buckets(window) === 2, buckets(window));
        check("5 annotation clusters as dots", dots(window) === 5, dots(window));
        check("agent notch on #44 (pi milestone)", doc.querySelector('.rail-dot[data-seq="44"]').classList.contains("has-agent"));
        check("agent notch on #36 (codex note)", doc.querySelector('.rail-dot[data-seq="36"]').classList.contains("has-agent"));
        check("draft ring on #31 (AI draft)", doc.querySelector('.rail-dot[data-seq="31"]').classList.contains("is-draft"));
        check("load-older shows remaining 3", doc.getElementById("loadOlder").textContent.includes("3"), doc.getElementById("loadOlder").textContent);
        check("no gap rows yet (adjacent days)", doc.querySelectorAll(".gap-row").length === 0);
        check("readout 2/5 buckets", doc.getElementById("stateReadout").textContent.includes("2/5"));
        check("bucket head density cells", doc.querySelectorAll(".bucket-head .dens i").length === 5);
    }

    console.log("pagination: load older x3 → earliest");
    {
        const window = makeWindow();
        const doc = window.document;
        const proto = window.__timelineProto;
        proto.loadOlder();
        check("3 buckets after first load", buckets(window) === 3, buckets(window));
        check("7 dots after first load", dots(window) === 7, dots(window));
        const gap = doc.querySelector(".gap-row");
        check("sparse gap row '跳过 3 天'", gap != null && gap.textContent.includes("跳过 3 天"), gap && gap.textContent);
        proto.loadOlder();
        proto.loadOlder();
        check("5 buckets at earliest", buckets(window) === 5, buckets(window));
        check("10 dots at earliest", dots(window) === 10, dots(window));
        check("3 gap rows total", doc.querySelectorAll(".gap-row").length === 3);
        check("load-older hidden at earliest", doc.getElementById("loadOlder").hidden === true);
        check("readout 5/5 buckets", doc.getElementById("stateReadout").textContent.includes("5/5"));
    }

    console.log("hover card (150ms) and pin");
    {
        const window = makeWindow();
        const doc = window.document;
        const proto = window.__timelineProto;
        const dotBtn = doc.querySelector('.rail-dot[data-seq="41"] button');
        dotBtn.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
        await sleep(220);
        const card = doc.querySelector(".acard");
        check("card opens after hover delay", card != null);
        check("card shows node id #41", card != null && card.textContent.includes("#41"));
        check("card shows agent badge for #44 entry absent", true); // #41 has only user note
        check("card shows user note title", card != null && card.textContent.includes("模型解析双源"));
        // 单击钉住 + 跳转
        dotBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        await sleep(20);
        const pinned = doc.querySelector(".acard");
        check("pinned card has close button", pinned != null && pinned.querySelector("[data-card-close]") != null);
        check("target message gets flash", doc.getElementById("msg-41").classList.contains("flash"));
    }

    console.log("external agent write (D3)");
    {
        const window = makeWindow();
        const doc = window.document;
        const proto = window.__timelineProto;
        proto.simulateExternalWrite();
        check("dots +1 after external write", dots(window) === 6, dots(window));
        check("new dot has agent notch", doc.querySelector('.rail-dot[data-seq="45"]').classList.contains("has-agent"));
        const pill = doc.getElementById("newPill");
        check("new-pill visible with count", pill.hidden === false && pill.textContent.includes("1 条新批注"), pill.textContent);
        check("card agent badge in flow", doc.querySelector('.ann-badge.has-agent') != null);
        // 消费 pill：跳转到新批注并清零
        pill.click();
        await sleep(20);
        check("pill consumed", doc.getElementById("newPill").hidden === true);
        check("jumped target flashed", doc.getElementById("msg-45").classList.contains("flash"));
        check("badge count on message updated", doc.querySelector('.ann-badge[data-badge-seq="45"]').textContent.includes("1"));
    }

    console.log("date jump menu");
    {
        const window = makeWindow();
        const doc = window.document;
        const proto = window.__timelineProto;
        proto.openJumpMenu();
        const items = doc.querySelectorAll(".jump-item");
        check("menu lists all 5 buckets", items.length === 5, items.length);
        items[4].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        await sleep(20);
        check("jump loads full window", buckets(window) === 5, buckets(window));
        check("menu closed after pick", doc.getElementById("jumpMenu").hidden === true);
        check("oldest bucket head exists", doc.querySelector('.bucket[data-key="b4"] .bucket-head') != null);
    }

    console.log("theme + rail collapse");
    {
        const window = makeWindow();
        const doc = window.document;
        doc.getElementById("themeToggle").click();
        check("theme toggled to light", doc.documentElement.dataset.theme === "light");
        doc.getElementById("railToggle").click();
        check("rail collapses (dots hidden)", doc.querySelectorAll(".rail-dot").length === 0);
        doc.getElementById("rail").click();
        check("rail expands back", doc.querySelectorAll(".rail-dot").length === 5);
    }

    if (failures > 0) {
        console.log(`\n${failures} check(s) failed`);
        process.exit(1);
    }
    console.log("\nall checks passed");
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
