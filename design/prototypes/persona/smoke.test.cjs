// jsdom smoke test for the Persona System prototype.
// 覆盖：场景切换 / 右键菜单 / 向导两步 / slug 自动生成 / 文件树预览 /
//       🎭 hover 弹窗（选 agent·人设·注入开关）/ 登场 block / 名册详情·待批准·休眠 / 明暗切换。
// Run: node design/prototypes/persona/smoke.test.cjs
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
    // jsdom 无布局引擎：shim 原型读取到的度量与滚动
    window.HTMLElement.prototype.getBoundingClientRect = function () {
        return { top: 120, left: 1280, right: 1320, bottom: 160, width: 40, height: 40 };
    };
    Object.defineProperty(window.HTMLElement.prototype, "offsetWidth", { get: () => 340, configurable: true });
    Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", { get: () => 460, configurable: true });
    window.HTMLElement.prototype.scrollIntoView = function () {};
    window.eval(js);
    return window;
}

function fire(win, el, type, init = {}) {
    el.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
}

(async () => {
    const win = makeWindow();
    const doc = win.document;
    const $ = (s) => doc.querySelector(s);
    const $$ = (s) => [...doc.querySelectorAll(s)];

    console.log("\n[1] 场景切换");
    check("三个场景容器存在", Boolean($("#scnA") && $("#scnB") && $("#scnC")));
    check("初始只显示 A", !$("#scnA").hidden && $("#scnB").hidden && $("#scnC").hidden);
    fire(win, $('.scn[data-scn="B"]'), "click");
    check("切到 B 后 A 隐藏", $("#scnA").hidden && !$("#scnB").hidden);
    fire(win, $('.scn[data-scn="A"]'), "click");

    console.log("\n[2] 右键 → 菜单 → 向导");
    const row = $(".sess-row");
    fire(win, row, "contextmenu", { clientX: 300, clientY: 300 });
    check("右键后菜单可见", !$("#ctxMenu").hidden);
    check("目标行被高亮", row.classList.contains("sel"));
    check("菜单含「设为新人设」", Boolean($('.ctx-item[data-act="persona"]')));
    fire(win, $('.ctx-item[data-act="persona"]'), "click");
    check("向导打开", !$("#wizardWrap").hidden);
    check("向导停在第 1 步", $("#wizStepNo").textContent === "1" && !$("#wizStep1").hidden);

    console.log("\n[3] slug 自动生成（中文 → 英文目录名）");
    const nameEl = $("#personaName");
    const slugOf = (name) => {
        nameEl.value = name;
        fire(win, nameEl, "input");
        return $("#slugPreview").textContent;
    };
    check("中文名用最长匹配", slugOf("备份管家") === "backup-guard", slugOf("备份管家"));
    check("会话标题截断后可读", slugOf("实时监控图表横向伸缩修复") === "live-monitor-chart-resize-fix");
    check("ASCII 段不被逐字拆开", slugOf("改 Dump 界面逻辑") === "dump-ui-logic");
    check("全未知字符走 fallback 前缀", /^persona-[a-z0-9]+$/.test(slugOf("炁龘")), slugOf("炁龘"));

    console.log("\n[4] emoji picker");
    fire(win, $("#emojiBtn"), "click");
    check("picker 展开", !$("#emojiPop").hidden);
    const emojiPick = $(".emoji-grid button");
    fire(win, emojiPick, "click");
    check("选择后写入按钮且收起", $("#emojiBtn").textContent.trim() === emojiPick.textContent.trim() && $("#emojiPop").hidden);

    console.log("\n[5] 向导第 2 步：文件树预览");
    slugOf("备份管家");
    fire(win, $("#wizNext"), "click");
    check("进入第 2 步", $("#wizStepNo").textContent === "2" && !$("#wizStep2").hidden);
    const tree = $("#treePreview").textContent;
    for (const f of [".index/", "PERSONAS.md", ".persona/", "persona.json", "persona.local.json", "CHARTER.md", "MEMORY/", "facts.md", "lessons.md", "playbook/", "journal.md", "inbox.md", "archive/", "agents/", "AGENTS.md", "CLAUDE.md", "GEMINI.md", "work/"]) {
        check(`树含 ${f}`, tree.includes(f));
    }
    check("树用当前 slug", tree.includes("backup-guard"));
    check("档案区隐藏目录 .persona/", tree.includes(".persona/"));
    check("根级 AGENTS.md 标记为生成物", tree.includes("GENERATED"));
    check("work/ 标注不同步", tree.includes("工作产物（gitignore，跨机不同步）"));
    check("上一步按钮出现", !$("#wizPrev").hidden);
    fire(win, $("#wizNext"), "click");
    check("创建后向导关闭 + toast", $("#wizardWrap").hidden && !$("#toast").hidden);

    console.log("\n[6] 🎭 hover 弹窗");
    fire(win, $('.scn[data-scn="B"]'), "click");
    const widget = $("#personaWidget");
    fire(win, widget, "mouseenter");
    check("hover 300ms 前不弹", $("#personaPop").hidden);
    await sleep(360);
    check("hover 后弹窗可见", !$("#personaPop").hidden);
    check("弹窗含 Agent 网格 4 项", $$("#agentGrid .agent-cell").length === 4);
    check("弹窗含人设列表 + 新建项", $$("#personaList .prow").length === 4);
    check("默认选中一个人设", $$("#personaList .prow.active").length === 1);

    fire(win, $$("#agentGrid .agent-cell")[1], "click");
    check("切换 agent 高亮唯一", $$("#agentGrid .agent-cell.active").length === 1);
    check("汇总行反映 agent", $("#popSummary").textContent.includes("codex"), $("#popSummary").textContent);

    const chk = $("#injectChk");
    chk.checked = true;
    chk.dispatchEvent(new win.Event("change", { bubbles: true }));
    check("注入开关打开后显示路径", !$("#injectPath").hidden);
    check("路径文案正确", $("#injectPath").textContent.trim() === "E:/code/snorkeling");

    console.log("\n[7] 开始登场");
    fire(win, $("#launchBtn"), "click");
    check("登场 block 出现", !$("#launchedBlock").hidden);
    const lb = $("#launchedBlock").textContent;
    check("block 头显示 cwd = 人设据点", lb.includes("D:/Data/personas/backup-guard/"), lb.slice(0, 120));
    check("注入行包含主工作目录", lb.includes("[登场上下文]") && lb.includes("E:/code/snorkeling"));
    check("渐进披露摘要可见", lb.includes("640 tokens") && lb.includes("PERSONAS.md"));
    check("登场后弹窗收起", $("#personaPop").hidden);

    chk.checked = false;
    chk.dispatchEvent(new win.Event("change", { bubbles: true }));
    check("取消注入后 block 更新为纯人设任务", $("#launchedBlock").textContent.includes("未注入主工作目录"));

    console.log("\n[8] 名册 Block");
    fire(win, $('.scn[data-scn="C"]'), "click");
    check("待批准区可见", !$("#pendingBox").hidden);
    check("待批准含配额说明", $("#pendingBox").textContent.includes("2/2"));
    fire(win, $('.rrow[data-id="data-butler"]'), "click");
    check("切换详情标题", $("#rdTitle").textContent === "数据管家");
    check("AI 自建徽标出现", $("#rdMeta").textContent.includes("AI 自建"));
    check("记忆统计 4 格", $$(".mem-cell").length === 4);
    check("注入硬顶文案", $(".mem-note").textContent.includes("2K"));

    fire(win, $("#dormantToggle"), "click");
    check("休眠区展开", !$("#dormantBody").hidden);
    fire(win, $("[data-approve]"), "click");
    check("批准后待批准区消失", $("#pendingBox").hidden);

    console.log("\n[9] 主题");
    const before = doc.documentElement.dataset.theme;
    fire(win, $("#themeBtn"), "click");
    check("明暗切换生效", doc.documentElement.dataset.theme !== before, doc.documentElement.dataset.theme);

    console.log("\n[10] 结构完整性");
    const ids = $$("[id]").map((el) => el.id);
    check("无重复 id", new Set(ids).size === ids.length, ids.filter((x, i) => ids.indexOf(x) !== i));
    check("无 inline script（CSP 友好）", !/onclick=|onchange=/i.test(html));
    check("样式与脚本外链存在", fs.existsSync(path.join(dir, "style.css")) && fs.existsSync(path.join(dir, "script.js")));

    console.log(`\n${failures === 0 ? "SMOKE PASS" : `SMOKE FAIL (${failures})`}`);
    process.exit(failures === 0 ? 0 : 1);
})();
