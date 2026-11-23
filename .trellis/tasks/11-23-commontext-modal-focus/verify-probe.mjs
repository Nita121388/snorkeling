// 真机探针（本任务判据，CDP 真实指针/键盘）：
// 启动实例：SNORKELING_DEV_TASK=electron:start node scripts/dev-isolated.mjs --profile ct-focus --vite-port 51822 --cdp-port 9262
// 跑：node .trellis/tasks/11-23-commontext-modal-focus/verify-probe.mjs
//
// ct-diag6: 修复后真机断言（任务 11-23-commontext-modal-focus）
//   A. 弹窗开着时 tab 栏不再被 .modal-wrapper 吞（elementFromPoint 命中 tab 栏控件）
//   B. 弹窗外壳 pointer-events 修正后，tab 栏真的可点（新建 Tab → tab 数 +1）
//   C. 点弹窗死区（tab 栏条带）后详情 textarea 自动回焦（AC3）
//   D. 切回原 Tab 后弹窗仍在、详情仍可编辑（用户绕行路径与修复共存）
import { connectToTarget, listPageTargets } from "../../../scripts/verify/lib/cdp.mjs";
import { pickLiveRenderer, sleep } from "../../../scripts/verify/lib/probes.mjs";

const endpoint = "http://127.0.0.1:9262";
const MODAL = ".commontext-compose-modal";
const TA = `${MODAL} textarea:not([data-commontext-composer])`;

async function connectLive(timeoutMs = 240000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const pages = await listPageTargets(endpoint).catch(() => []);
        if (pages.length > 0) {
            const picked = await pickLiveRenderer(pages, connectToTarget, endpoint).catch(() => null);
            if (picked?.client != null) return picked.client;
        }
        await sleep(2000);
    }
    throw new Error("等不到可用渲染器");
}

const c = await connectLive();
await c.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await c.evaluate(`
window.__desc = function (el) {
    if (el == null) return "null";
    if (el === document.body) return "BODY";
    const inModal = el.closest && el.closest(".commontext-compose-modal") != null;
    const blk = el.closest && el.closest("[data-blockid]");
    return el.tagName + (inModal ? "[M]" : "") + (blk ? "[B]" : "") + " class=" + String(el.getAttribute("class") || "").slice(0, 44);
};
true;`);

const results = [];
function record(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${detail}`);
}

// 前置：打开弹窗 + 建一条 + 选中 + 聚焦详情 textarea
await c.evaluate(`(() => {
    if (!document.querySelector("${MODAL}")) {
        window.dispatchEvent(new CustomEvent("snorkeling:common-text:open-search", { detail: {} }));
    }
    return true;
})()`);
await sleep(500);
const rowCount = await c.evaluate(`document.querySelectorAll("${MODAL} [data-commontext-title]").length`);
if (rowCount === 0) {
    await c.evaluate(`(() => {
        const el = document.querySelector("[data-commontext-composer]");
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        setter.call(el, "Focus probe item\\nprobe body");
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
    })()`);
    await sleep(250);
    const addBtn = await c.evaluate(`(() => {
        const i = document.querySelector("${MODAL} button .fa-plus");
        const b = i?.closest("button");
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    if (addBtn) await c.click(addBtn.x, addBtn.y);
    await sleep(800);
}
const row = await c.evaluate(`(() => {
    const el = document.querySelector("${MODAL} [data-commontext-title]");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`);
if (!row) throw new Error("没有列表行，无法继续");
await c.click(row.x, row.y);
await sleep(400);

const taBox = await c.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(TA)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`);
if (!taBox) throw new Error("没有详情 textarea");
await c.click(taBox.x, taBox.y);
await sleep(200);
const focused = await c.evaluate(`window.__desc(document.activeElement)`);
record("详情 textarea 可聚焦", focused.includes("TEXTAREA[M]"), focused);

// A. tab 栏不再被 modal-wrapper 吞
const tabBarProbe = await c.evaluate(`(() => {
    const btn = document.querySelector('[title="新建 Tab"]') || document.querySelector('[aria-label="更多 Tab"]');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
    return { hit: window.__desc(hit), isButton: btn.contains(hit) || hit === btn };
})()`);
record("tab 栏命中不再被 .modal-wrapper 吞", tabBarProbe != null && tabBarProbe.isButton, JSON.stringify(tabBarProbe));

// C. 点弹窗内非可聚焦死区（详情 footer 的元信息行）后自动回焦
// 注意不能拿 tab 栏条带当死区：S2 之后那里是真按钮，点它本来就该把焦点给按钮。
const deadZone = await c.evaluate(`(() => {
    const el = document.querySelector("[data-commontext-detail-meta]");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = Math.round(r.x + 6), y = Math.round(r.y + r.height / 2);
    return { x, y, hit: window.__desc(document.elementFromPoint(x, y)) };
})()`);
record("死区命中测试（非可聚焦元素）", deadZone != null && !deadZone.hit.startsWith("BUTTON"), JSON.stringify(deadZone));
if (deadZone) await c.click(deadZone.x, deadZone.y);
await sleep(350);
const afterDead = await c.evaluate(`window.__desc(document.activeElement)`);
record("点死区后详情 textarea 自动回焦 (AC3)", afterDead.includes("TEXTAREA[M]"), afterDead);

// B. tab 栏真的可点：新建 Tab → tab 数 +1
const before = await c.evaluate(`document.querySelectorAll(".tab").length`);
const newTabBtn = await c.evaluate(`(() => {
    const b = document.querySelector('[title="新建 Tab"]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`);
if (newTabBtn) {
    await c.click(newTabBtn.x, newTabBtn.y);
    await sleep(1500);
}
const after = await c.evaluate(`document.querySelectorAll(".tab").length`);
record("弹窗开着时 tab 栏可点（新建 Tab 生效）", newTabBtn != null && after === before + 1, `tabs ${before} -> ${after}`);

// D. 切回第一个 Tab，弹窗仍在、详情仍可编辑
const backTab = await c.evaluate(`(() => {
    const tabs = [...document.querySelectorAll(".tab")];
    const first = tabs.find((t) => !t.className.includes("active")) ?? tabs[0];
    if (!first) return null;
    const r = first.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`);
if (backTab) {
    await c.click(backTab.x, backTab.y);
    await sleep(1500);
}
const survive = await c.evaluate(`(() => {
    const modal = document.querySelector("${MODAL}");
    const ta = document.querySelector(${JSON.stringify(TA)});
    return { modal: modal != null, ta: ta != null, active: window.__desc(document.activeElement) };
})()`);
if (survive.ta) {
    await c.click(taBox.x, taBox.y);
    await sleep(200);
}
const finalState = await c.evaluate(`window.__desc(document.activeElement)`);
record("切 Tab 往返后弹窗仍在且详情可编辑", survive.modal && survive.ta && finalState.includes("TEXTAREA[M]"), JSON.stringify({ survive, finalState }));

const failed = results.filter((r) => !r.ok);
console.log(`\n==== ${results.length - failed.length}/${results.length} PASS ====`);
c.close();
process.exitCode = failed.length === 0 ? 0 : 1;
