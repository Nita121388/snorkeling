// jsdom smoke test for the annotation-card prototype.
// Runs the real script.js against index.html, switches datasets via the
// "Data:" button and asserts the round-10 edge-state behaviors.
// Run: node design/prototypes/aisessions-annotation-card-ux/smoke.test.js
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
    Object.defineProperty(window.HTMLElement.prototype, "offsetWidth", { get: () => 328, configurable: true });
    Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", { get: () => 300, configurable: true });
    // Fake "content taller than the clamp box" so truncation hints are exercised.
    Object.defineProperty(window.HTMLElement.prototype, "scrollHeight", {
        get() {
            return this.classList && this.classList.contains("nb-text") ? 120 : 20;
        },
        configurable: true,
    });
    Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { get: () => 60, configurable: true });
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    new window.Function(js).call(window);
    return window;
}

function snapshot(window) {
    const doc = window.document;
    return {
        dots: doc.querySelectorAll(".rail-dot").length,
        empty: doc.querySelectorAll(".rail-empty").length,
        rows: doc.querySelectorAll(".flow-row").length,
        cards: doc.querySelectorAll(".acard").length,
        dataLabel: doc.getElementById("dataToggle").textContent,
    };
}

async function hoverDot(window, seq) {
    const btn = window.document.querySelector(`.rail-dot[data-seq="${seq}"] button`);
    if (!btn) return null;
    btn.dispatchEvent(new window.MouseEvent("mouseenter"));
    await sleep(120);
    return window.document.querySelector(`.acard[data-seq="${seq}"]`);
}

function clickData(window) {
    window.document.getElementById("dataToggle").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}

(async () => {
    console.log("dataset: Default");
    let w = makeWindow();
    let snap = snapshot(w);
    check("4 rail dots", snap.dots === 4, snap);
    check("no empty state", snap.empty === 0, snap);
    check("4 flow rows", snap.rows === 4, snap);

    let card = await hoverDot(w, 57);
    check("card built on hover", !!card);
    check("default card is not dense", card && !card.classList.contains("is-dense"));
    check("default card has no orphan annotation", card && card.querySelectorAll(".ann.is-orphan").length === 0);
    check(
        "clamped node text gets the fade hint",
        card && !!card.querySelector(".nb-text.is-clamped"),
        card && card.querySelector(".nb-text").className
    );

    // 交互链路：单击固定 → 打开编辑器 → Esc 关闭 → ✕ 收起 → 双击跳转
    const dot57 = w.document.querySelector('.rail-dot[data-seq="57"] button');
    dot57.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await sleep(260);
    card = w.document.querySelector('.acard[data-seq="57"]');
    check("single click pins the card", card && card.classList.contains("pinned"));
    check("dot reports aria-expanded", dot57.getAttribute("aria-expanded") === "true", dot57.getAttribute("aria-expanded"));

    card.querySelector("[data-open]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    check("card action opens the editor", !!w.document.querySelector("#editorLayer .editor"));
    w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    check("Esc closes the editor", w.document.querySelectorAll("#editorLayer .editor").length === 0);

    card.querySelector("[data-close]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await sleep(160);
    check("close button dismisses the card", w.document.querySelectorAll(".acard").length === 0);

    const dot12 = w.document.querySelector('.rail-dot[data-seq="12"] button');
    dot12.dispatchEvent(new w.MouseEvent("dblclick", { bubbles: true }));
    check("dblclick flashes the target row", !!w.document.querySelector("#flow-12.is-jump"));

    console.log("dataset: Edge states");
    clickData(w);
    snap = snapshot(w);
    check("data button label updated", snap.dataLabel === "Data: Edge states", snap.dataLabel);
    check("4 rail dots", snap.dots === 4, snap);
    check("card cleared on dataset switch", snap.cards === 0, snap);
    check("orphan dot present", !!w.document.querySelector(".rail-dot .dot.is-orphan"));

    card = await hoverDot(w, 57);
    check("6 annotations -> dense card", card && card.classList.contains("is-dense"));

    card = await hoverDot(w, 28);
    check("orphan annotation rendered", card && card.querySelectorAll(".ann.is-orphan").length === 1);
    check("orphan chip rendered", card && card.querySelectorAll(".chip.orphan").length === 1);

    card = await hoverDot(w, 12);
    const tags = card ? card.querySelectorAll(".ann-tags .tag").length : 0;
    check("8 tags rendered and wrap", tags === 8, tags);

    console.log("dataset: No notes");
    clickData(w);
    snap = snapshot(w);
    check("no rail dots", snap.dots === 0, snap);
    check("empty rail message shown", snap.empty === 1, snap);
    check("flow rows still render", snap.rows === 3, snap);
    check("playhead removed", !w.document.querySelector(".rail-playhead"));
    check("switching dataset while a card is open closes it", snap.cards === 0, snap);

    console.log("dataset cycles back");
    clickData(w);
    snap = snapshot(w);
    check("cycles back to Default", snap.dataLabel === "Data: Default", snap.dataLabel);
    check("dots restored", snap.dots === 4, snap);

    console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
    process.exit(failures ? 1 : 0);
})();
