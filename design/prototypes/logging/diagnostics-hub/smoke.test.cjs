// jsdom smoke test for the diagnostics-hub fusion prototype.
// 覆盖：三视图渲染 / 审计筛选与统计 / 融合动作一（审计→日志 blockid 预设）/
//       融合动作二（日志→审计回跳）/ 导出诊断包 / 场景矩阵（off / failstorm / empty）。
// Run: node design/prototypes/logging/diagnostics-hub/smoke.test.cjs
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const js = fs.readFileSync(path.join(dir, "script.js"), "utf8");

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
    window.HTMLElement.prototype.getBoundingClientRect = function () {
        return { top: 100, left: 0, right: 52, bottom: 120, width: 52, height: 20 };
    };
    new window.Function(js).call(window);
    return window;
}

function $(w, sel) {
    return w.document.querySelector(sel);
}
function $$(w, sel) {
    return Array.from(w.document.querySelectorAll(sel));
}
function click(el) {
    el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent("click", { bubbles: true }));
}
function change(el) {
    el.dispatchEvent(new el.ownerDocument.defaultView.Event("change", { bubbles: true }));
}

async function main() {
    console.log("diagnostics-hub smoke");
    const w = makeWindow();
    const { S } = w.__diag;

    // 1. 三视图 tab + 计数
    const tabs = $$(w, "[data-view-tab]");
    check("三视图 tab", tabs.length === 3);
    check("默认 audit 视图", S.view === "audit");
    check("审计行渲染", $$(w, ".row-audit").length === w.__diag.audits().length);

    // 2. 筛选 failed + 统计条点击
    const failedMetric = $(w, '[data-act="pickFailed"]');
    click(failedMetric);
    check("统计条点 failed 生效", S.audit.state === "failed");
    const failedRows = $$(w, ".row-audit .pill-failed").length;
    check("failed 行数与数据一致", failedRows === w.__diag.audits().filter((a) => a.state === "failed").length && failedRows > 0);

    // 3. 抽屉 + 融合动作一：审计 → 日志（blockid 预设 + 横幅）
    S.audit.state = "";
    w.__diag.goView("audit");
    const firstAuditRow = $(w, ".row-audit");
    click(firstAuditRow);
    const drawer = $(w, "#drawer");
    check("抽屉打开", drawer != null && !drawer.hidden);
    check("抽屉含关联日志区", $(w, ".section-title") != null);
    const viewLogsBtn = $(w, '[data-act="viewLogsFor"]:not([disabled])');
    check("存在可用的「查看相关日志」按钮", viewLogsBtn != null);
    click(viewLogsBtn);
    check("融合一：切到 log 视图", S.view === "log");
    check("融合一：query 带 block: 前缀", S.log.query.startsWith("block:"));
    check("融合一：横幅提示来路", !w.document.getElementById("banner").hidden);
    const logRowsAfter = $$(w, ".row-log");
    check("融合一：日志行按 blockid 过滤后 > 0", logRowsAfter.length > 0 && logRowsAfter.length < w.__diag.events().length);

    // 4. 融合动作二：日志 → 审计回跳
    const backBtn = $(w, '[data-act="openAudit"]');
    if (backBtn == null) {
        // 从日志行打开抽屉再找
        click($(w, ".row-log"));
    }
    const backBtn2 = $(w, '[data-act="openAudit"]');
    check("日志抽屉提供「回到审计条目」", backBtn2 != null);
    click(backBtn2);
    check("融合二：切回 audit 视图", S.view === "audit");
    check("融合二：抽屉直接打开目标条目", !w.document.getElementById("drawer").hidden && S.drawer != null && S.drawer.kind === "audit");

    // 5. 联合时间线
    w.__diag.goView("timeline");
    const tlRows = $$(w, ".row-tl");
    check("时间线行 = 审计 + 日志", tlRows.length === w.__diag.audits().length + w.__diag.events().length);
    check("时间线含两种徽标", $(w, ".tl-badge.audit") != null && $(w, ".tl-badge.log") != null);

    // 6. 导出诊断包
    w.__diag.goView("audit");
    const failedRow = $$(w, ".row-audit").find((r) => r.querySelector(".pill-failed"));
    click(failedRow);
    const exportBtn = $(w, '[data-act="export"]:not([disabled])');
    check("失败条目可导出诊断包", exportBtn != null);
    click(exportBtn);
    const exportBody = w.document.getElementById("exportBody").textContent;
    check("诊断包含审计 JSON", exportBody.includes('"state": "failed"'));
    check("诊断包含关联日志 jsonl", exportBody.includes("```jsonl") && exportBody.includes("send-fail"));
    check("诊断声明无隐私正文", exportBody.includes("无正文与凭据"));

    // 7. 场景矩阵：off
    const scenarioSel = w.document.getElementById("scenario");
    scenarioSel.value = "off";
    change(scenarioSel);
    w.__diag.goView("log");
    check("off 场景：日志关闭说明", w.document.getElementById("list").textContent.includes("log:level"));
    check("off 场景：审计不受影响", w.__diag.audits().length === 9);
    check("off 场景：统计条显示 off", w.document.getElementById("stats").textContent.includes("off"));

    // 8. 场景矩阵：failstorm
    scenarioSel.value = "failstorm";
    change(scenarioSel);
    w.__diag.goView("log");
    check("failstorm：限流 sysrow", w.document.getElementById("list").textContent.includes("log-dropped"));
    check("failstorm：预算 sysrow", w.document.getElementById("list").textContent.includes("200MB"));
    check("failstorm：统计条含丢弃数", w.document.getElementById("stats").textContent.includes("限流丢弃 82"));

    // 9. 场景矩阵：empty
    scenarioSel.value = "empty";
    change(scenarioSel);
    check("empty：审计空态", w.document.getElementById("list").textContent.includes("没有审计条目") || S.view !== "audit");
    w.__diag.goView("audit");
    check("empty：审计空态文案", w.document.getElementById("list").textContent.includes("没有审计条目"));

    // 10. 主题切换
    click(w.document.getElementById("themeToggle"));
    check("主题切到 light", w.document.documentElement.dataset.theme === "light");

    console.log(failures === 0 ? "PASS" : `FAIL (${failures})`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
