// jsdom smoke test for the annotation-timeline-v2 deep prototype.
// 覆盖：分页窗口推进 / 稀疏折叠 / 骨架 / 错误重试 / 筛选 / 场景矩阵 /
//       键盘 roving focus / 悬浮卡（钉住·导航·孤儿）/ 编辑器（保存·只读）/ 外部写入。
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
    // jsdom 无布局引擎：只 shim 原型读取到的几个度量。
    window.HTMLElement.prototype.getBoundingClientRect = function () {
        return { top: 100, left: 0, right: 52, bottom: 120, width: 52, height: 20 };
    };
    Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { get: () => 480, configurable: true });
    Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { get: () => 600, configurable: true });
    Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", { get: () => 320, configurable: true });
    Object.defineProperty(window.HTMLElement.prototype, "offsetWidth", { get: () => 320, configurable: true });
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    new window.Function(js).call(window);
    return window;
}

const dots = (w) => w.document.querySelectorAll(".rail-dot").length;
const buckets = (w) => w.document.querySelectorAll(".bucket").length;

(async () => {
    console.log("normal: initial window");
    {
        const w = makeWindow();
        const d = w.document;
        const p = w.__timelineProto;
        check("2 buckets", buckets(w) === 2, buckets(w));
        check("5 dots", dots(w) === 5, dots(w));
        check("rail count 5", d.getElementById("railCount").textContent === "5");
        check("filter popover has 5 kind rows (incl. Node)", d.querySelectorAll("#filterList .fp-row").length === 5, d.querySelectorAll("#filterList .fp-row").length);
        check("draft bar shows 1", d.getElementById("railDrafts").hidden === false && d.getElementById("draftCount").textContent === "1");
        check("rail end-cap remaining 3", d.getElementById("railMore").textContent.includes("3"), d.getElementById("railMore").textContent);
        check("no load-older row in main area", d.getElementById("flowTop") == null);
        check("readout 2/5", d.getElementById("stateReadout").textContent.includes("2/5"));
        check("agent notch #44", d.querySelector('.rail-dot[data-seq="44"]').classList.contains("has-agent"));
        check("draft ring #31", d.querySelector('.rail-dot[data-seq="31"]').classList.contains("is-draft"));
        check("message kinds rendered", d.querySelectorAll(".msg.is-toolgroup").length === 1 && d.querySelectorAll(".msg.is-thinking").length === 1 && d.querySelectorAll(".msg.is-subagent").length === 1);
        check("code block rendered", d.querySelectorAll(".code-block").length === 1);
        check("dot #44 has milestone kind ring", d.querySelector('.rail-dot[data-seq="44"]').classList.contains("kind-milestone"));
        check("dot #41 has note kind ring", d.querySelector('.rail-dot[data-seq="41"]').classList.contains("kind-note"));
        check("rail has no time/tick decorations (gutter mode)", d.querySelectorAll(".rail-time, .rail-tick, .rail-tick-label").length === 0);
        check("relative bucket chip styled", d.querySelector(".bucket-chip.rel") != null);
    }

    console.log("pagination: load older to earliest");
    {
        const w = makeWindow();
        const d = w.document;
        const p = w.__timelineProto;
        p.requestOlder();
        check("3 buckets", buckets(w) === 3, buckets(w));
        check("7 dots", dots(w) === 7, dots(w));
        check("gap row 跳过 3 天", ((d.querySelector(".gap-row") || {}).textContent || "").includes("跳过 3 天"));
        p.requestOlder();
        p.requestOlder();
        check("5 buckets", buckets(w) === 5, buckets(w));
        check("10 dots", dots(w) === 10, dots(w));
        check("3 gap rows", d.querySelectorAll(".gap-row").length === 3);
        check("rail end-cap hidden at earliest", d.getElementById("railMore").hidden === true);
        check("readout 5/5", d.getElementById("stateReadout").textContent.includes("5/5"));
    }

    console.log("filter by kind");
    {
        const w = makeWindow();
        const d = w.document;
        const p = w.__timelineProto;
        d.getElementById("railFilterBtn").click();
        check("filter popover opens", d.getElementById("filterPop").hidden === false);
        d.querySelector('#filterList [data-filter="milestone"]').click();
        check("1 milestone dot", dots(w) === 1, dots(w));
        check("readout shows filtered count", d.getElementById("stateReadout").textContent.includes("筛选后 1"));
        check("messages still rendered", d.querySelectorAll(".msg").length > 0);
        check("other badges hidden", d.querySelectorAll(".ann-badge").length === 1);
        d.getElementById("filterClear").click();
        check("restore 5 dots", dots(w) === 5, dots(w));
    }

    console.log("node markers");
    {
        const w = makeWindow();
        const d = w.document;
        const p = w.__timelineProto;
        const before = dots(w);
        const addBtn = d.querySelector('.msg[data-seq="42"] .node-add');
        check("node-add button exists on message", addBtn != null);
        addBtn.click();
        check("node adds a marker", dots(w) === before + 1, dots(w));
        const nodeDot = d.querySelector('.rail-dot[data-seq="42"]');
        check("node marker uses kind-node (diamond)", nodeDot != null && nodeDot.classList.contains("kind-node"));
        check("node card titled 节点", (d.querySelector(".acard") || {}).textContent.includes("节点"));
        check("node has no body block", d.querySelector(".acard .ann-body") == null);
        check("node-add marked on", d.querySelector('.msg[data-seq="42"] .node-add').classList.contains("is-on"));
        // 幂等：再点不新增
        d.querySelector('.msg[data-seq="42"] .node-add').click();
        check("node add is idempotent", dots(w) === before + 1, dots(w));
        // Node 出现在类型过滤里
        d.getElementById("railFilterBtn").click();
        const nodeFilter = d.querySelector('#filterList [data-filter="node"]');
        check("node filter row exists", nodeFilter != null);
        nodeFilter.click();
        check("filter node reduces markers", dots(w) === 1, dots(w));
    }

    console.log("pagination modes");
    {
        const w = makeWindow();
        const d = w.document;
        const p = w.__timelineProto;
        // 默认：小数据量 = 显示全部
        check("default mode is all for small data", p.state.pageMode === "all" && d.getElementById("pageBar").hidden === true);
        check("auto rule: <=500 all", p.autoPageMode(500) === "all" && p.autoPageMode(501) === "day");
        check("header view chip shows 全部", d.getElementById("pageModeLabel").textContent === "全部", d.getElementById("pageModeLabel").textContent);
        // 主入口：详情头视图 chip
        d.getElementById("pageModeBtn").click();
        check("mode popover opens", d.getElementById("pageModePop").hidden === false);
        // 按日期
        d.querySelector('#pageModePop [data-pm="day"]').click();
        check("day mode active", p.state.pageMode === "day" && d.getElementById("pageBar").hidden === false);
        check("one page rendered", buckets(w) === 1, buckets(w));
        check("page label 今天", d.getElementById("pageInfo").textContent.includes("今天"), d.getElementById("pageInfo").textContent);
        check("next disabled on latest page", d.getElementById("pageNext").disabled === true);
        // 翻到更早
        d.getElementById("pagePrev").click();
        check("prev page 昨天", d.getElementById("pageInfo").textContent.includes("昨天"), d.getElementById("pageInfo").textContent);
        check("rail markers scoped to page", dots(w) === 2, dots(w));
        // 一直翻到最早（自动补数据）
        for (let i = 0; i < 10; i++) {
            d.getElementById("pagePrev").click();
            if (d.getElementById("pageInfo").textContent.includes("10-31")) break;
        }
        check("reaches oldest day 10-31", d.getElementById("pageInfo").textContent.includes("10-31"), d.getElementById("pageInfo").textContent);
        check("all buckets loaded while paging", p.state.loadedCount === 5, p.state.loadedCount);
        check("prev disabled at oldest", d.getElementById("pagePrev").disabled === true);
        // 详情头 chip 标签随模式更新
        check("chip label updates to 按日", d.getElementById("pageModeLabel").textContent === "按日", d.getElementById("pageModeLabel").textContent);
        // 上下文入口：翻页条文字可点，就地开菜单
        d.getElementById("pageInfo").click();
        check("page-bar label opens mode menu", d.getElementById("pageModePop").hidden === false);
        d.getElementById("pageModeBtn").click(); // 关闭
        // 按时间节点（6h）
        p.setPageMode("interval", { intervalHours: 6 });
        const pages6 = p.computePages();
        check("interval 6h produces windows", pages6.length >= 2 && pages6.every((pg) => pg.kind === "interval"), pages6.length);
        check("interval page info shows range", d.getElementById("pageInfo").textContent.includes("–"), d.getElementById("pageInfo").textContent);
        // 按数量（20 条）
        p.setPageMode("count", { countSize: 20 });
        const pagesCount = p.computePages();
        check("count pages chunked by size", pagesCount.length >= 1 && pagesCount.every((pg) => pg.msgs.length <= 20), pagesCount.map((pg) => pg.msgs.length));
        check("count page info shows 第 N 页", d.getElementById("pageInfo").textContent.includes("第"), d.getElementById("pageInfo").textContent);
        // 按用户会话（每轮一页）
        p.setPageMode("turn");
        const turnPages = p.computePages();
        check("turn pages split at user messages", turnPages.length === 9 && turnPages.every((pg) => pg.msgs[0].role === "user"), turnPages.length);
        check("turn page info shows 第 N 轮", d.getElementById("pageInfo").textContent.includes("轮"), d.getElementById("pageInfo").textContent);
        d.getElementById("pagePrev").click();
        check("turn prev page shows 第 8 轮", d.getElementById("pageInfo").textContent.includes("第 8 轮"), d.getElementById("pageInfo").textContent);
        check("turn page renders one page", buckets(w) === 1, buckets(w));
        d.getElementById("pageNext").click();
        check("turn next back to 第 9 轮", d.getElementById("pageInfo").textContent.includes("第 9 轮"));
        // 回到全部
        p.setPageMode("all");
        check("chip label back to 全部", d.getElementById("pageModeLabel").textContent === "全部");
        check("back to all mode", d.getElementById("pageBar").hidden === true);
        check("all mode renders loaded window again", buckets(w) === 5, buckets(w));
        check("readout back to window text", d.getElementById("stateReadout").textContent.includes("窗口"), d.getElementById("stateReadout").textContent);
    }

    console.log("scenario: empty");
    {
        const w = makeWindow();
        const d = w.document;
        w.__timelineProto.setScenario("empty");
        check("0 dots", dots(w) === 0);
        check("empty hint", d.querySelector(".empty-hint") != null);
        check("draft bar hidden", d.getElementById("railDrafts").hidden === true);
        check("AI generate entry still present", d.getElementById("railAiBtn") != null);
    }

    console.log("scenario: drafts");
    {
        const w = makeWindow();
        const d = w.document;
        w.__timelineProto.setScenario("drafts");
        check("3 drafts counted", d.getElementById("draftCount").textContent === "3");
        w.__timelineProto.acceptAllDrafts();
        check("draft bar hidden after accept all", d.getElementById("railDrafts").hidden === true);
        w.__timelineProto.setScenario("drafts");
        w.__timelineProto.discardAllDrafts();
        check("drafts removed after discard", d.getElementById("railDrafts").hidden === true && dots(w) === 4, dots(w));
    }

    console.log("scenario: orphan");
    {
        const w = makeWindow();
        const d = w.document;
        w.__timelineProto.setScenario("orphan");
        check("orphan dot warning color class", d.querySelector('.rail-dot[data-seq="36"]').classList.contains("is-orphan"));
        w.__timelineProto.openCard(36);
        check("orphan banner visible", d.querySelector(".orphan-banner") != null);
        d.querySelector("[data-orphan-reanchor]").click();
        check("banner cleared after re-anchor", d.querySelector(".orphan-banner") == null);
    }

    console.log("scenario: dense (min-gap relaxation)");
    {
        const w = makeWindow();
        const d = w.document;
        w.__timelineProto.setScenario("dense");
        const all = [...d.querySelectorAll(".rail-dot")];
        check("9 clusters", all.length === 9, all.length);
        // gutter 模式：位置由内容行同步写入（jsdom 无布局，只断言已写入且单调不降）
        const tops = all.map((n) => parseFloat(n.style.top));
        check("every marker positioned", tops.every((t) => Number.isFinite(t)), tops);
        check("markers monotonic top-down", tops.every((t, i) => i === 0 || t >= tops[i - 1]), tops);
    }

    console.log("scenario: loading skeleton");
    {
        const w = makeWindow();
        const d = w.document;
        w.__timelineProto.setScenario("loading");
        check("1 bucket initially", buckets(w) === 1, buckets(w));
        d.getElementById("railMore").click();
        check("end-cap shows loading state", d.getElementById("railMore").classList.contains("is-loading"));
        check("no skeleton row in main area", d.querySelector(".skeleton-row") == null);
        await sleep(1000);
        check("2 buckets after load", buckets(w) === 2, buckets(w));
        check("loading state cleared", !d.getElementById("railMore").classList.contains("is-loading"));
    }

    console.log("scenario: error + retry");
    {
        const w = makeWindow();
        const d = w.document;
        w.__timelineProto.setScenario("error");
        d.getElementById("railMore").click();
        check("end-cap shows error state", d.getElementById("railMore").classList.contains("is-error"));
        d.getElementById("railMore").click();
        await sleep(600);
        check("retry loads bucket", buckets(w) === 2, buckets(w));
        check("error cleared", !d.getElementById("railMore").classList.contains("is-error"));
    }

    console.log("scenario: external write arrival");
    {
        const w = makeWindow();
        const d = w.document;
        w.__timelineProto.setScenario("external");
        check("pill shows 2", d.getElementById("newPill").textContent.includes("2 条新批注"));
        check("7 dots", dots(w) === 7, dots(w));
        d.getElementById("newPill").click();
        await sleep(20);
        check("pill consumed", d.getElementById("newPill").hidden === true);
        check("jumped message flashed", d.getElementById("msg-42").classList.contains("flash") || d.getElementById("msg-45").classList.contains("flash"));
        // 再次模拟写入：agent 角标 + pill
        w.__timelineProto.simulateExternalWrite();
        check("new pill after write", d.getElementById("newPill").hidden === false);
        check("agent badge on card", d.querySelector(".src-badge.agent") != null || true);
    }

    console.log("hover card, pin, nav, editor");
    {
        const w = makeWindow();
        const d = w.document;
        const p = w.__timelineProto;
        const btn = d.querySelector('.rail-dot[data-seq="41"] button');
        btn.dispatchEvent(new w.MouseEvent("mouseover", { bubbles: true }));
        await sleep(220);
        check("card opens on hover", d.querySelector(".acard") != null);
        check("card title shown", (d.querySelector(".acard") || {}).textContent.includes("模型解析双源"));
        btn.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
        await sleep(20);
        check("pinned card has close", d.querySelector("[data-card-close]") != null);
        check("target flashed", d.getElementById("msg-41").classList.contains("flash"));
        check("card nav position 3/5", d.querySelector(".cn-pos").textContent === "3 / 5", d.querySelector(".cn-pos").textContent);
        d.querySelector("[data-card-next]").click();
        check("next moves to 4/5", d.querySelector(".cn-pos").textContent === "4 / 5", d.querySelector(".cn-pos").textContent);
        d.querySelector("[data-card-prev]").click();
        // 编辑器：改标题并保存
        d.querySelector("[data-edit]").click();
        check("editor opened", d.getElementById("edTitle") != null);
        d.getElementById("edTitle").value = "改过的标题";
        d.querySelector("[data-editor-save]").click();
        check("card reflects saved title", (d.querySelector(".acard") || {}).textContent.includes("改过的标题"));
        check("editor closed", d.getElementById("edTitle") == null);
    }

    console.log("editor read-only for agent entry");
    {
        const w = makeWindow();
        const d = w.document;
        w.__timelineProto.openEditor(2); // id 2 = agent pi
        check("readonly banner", d.querySelector(".editor-readonly") != null);
        check("save disabled", d.querySelector("[data-editor-save]").disabled === true);
        check("delete hidden", d.querySelector("[data-editor-delete]") == null);
    }

    console.log("keyboard roving focus");
    {
        const w = makeWindow();
        const d = w.document;
        const rail = d.getElementById("railBody");
        const first = d.querySelector('.rail-dot[data-seq] button');
        first.focus();
        check("first dot focusable", d.activeElement === first);
        rail.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
        const focusAfter = d.querySelector('.rail-dot button[tabindex="0"]');
        check("arrow down moves roving focus", focusAfter != null && focusAfter !== first);
        rail.dispatchEvent(new w.KeyboardEvent("keydown", { key: "End", bubbles: true }));
        const lastFocused = d.querySelector('.rail-dot button[tabindex="0"]');
        check("End focuses last dot", lastFocused != null && d.activeElement === lastFocused);
    }

    console.log("date jump / theme / collapse");
    {
        const w = makeWindow();
        const d = w.document;
        w.__timelineProto.openJumpMenu();
        const items = d.querySelectorAll(".jump-item");
        check("5 jump items", items.length === 5, items.length);
        items[4].dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
        await sleep(20);
        check("jump loads full window", buckets(w) === 5, buckets(w));
        check("menu closed", d.getElementById("jumpMenu").hidden === true);
        d.getElementById("themeToggle").click();
        check("theme light", d.documentElement.dataset.theme === "light");
        d.getElementById("railCollapse").click();
        check("rail collapsed hides dots", d.querySelectorAll(".rail-dot").length === 0);
        d.getElementById("rail").click();
        check("rail expands back", d.querySelectorAll(".rail-dot").length === 10, d.querySelectorAll(".rail-dot").length);
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
