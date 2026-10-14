#!/usr/bin/env node

/**
 * parity-check —— 「编辑态 ≡ 预览态」的两态实测比对（parity-harness 交付物 R4）。
 *
 * 为什么需要它：scss 契约测试（overlay-style-contract.test.ts）只能证明「我们没有手工镜像样式」，
 * 证明不了「两态在真实渲染下真的逐项一致」。本脚本在**运行中的应用**里对同一个块抓两次
 * computed style（预览态 / 编辑态）并逐项比对，输出差异表。
 *
 * 复用既有 CDP 通道（`scripts/inspect-electron-ui.mjs` 的 eval / click / key 子命令），
 * 不重复实现 CDP 客户端 —— 单点维护。
 *
 * 用法：
 *   node scripts/parity-check.mjs                          # 自动挑第一个可编辑块
 *   node scripts/parity-check.mjs --line 12                # 指定 data-source-line
 *   node scripts/parity-check.mjs --endpoint http://127.0.0.1:9333 --target "Wave Terminal - T1"
 *   node scripts/parity-check.mjs --json                   # 机器可读输出
 *
 * 退出码：0 = 无差异（或只剩豁免项）；1 = 存在未豁免差异 / 前置条件不满足。
 *
 * 前置：应用以 `--remote-debugging-port` 启动；且**窗口可见**（已知坑：document.hidden 时
 * CDP 输入不投递，脚本会先断言 visibilityState）。
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const UI_SCRIPT = path.join(SCRIPT_DIR, "inspect-electron-ui.mjs");

/** 必须逐项一致的属性（结构性 + 排版）。编辑态改变其中任何一项 = 用户看到「跳了一下」。 */
const PARITY_PROPS = [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "lineHeight",
    "letterSpacing",
    "color",
    "backgroundColor",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "marginTop",
    "marginRight",
    "marginBottom",
    "marginLeft",
    "borderTopWidth",
    "borderLeftWidth",
    "borderLeftStyle",
    "borderLeftColor",
    "borderTopStyle",
    "borderTopColor",
    "borderRadius",
    "boxSizing",
    "display",
    "textAlign",
    "whiteSpace",
    "overflowWrap",
    "wordBreak",
    "textIndent",
    "fontVariantLigatures",
    "tabSize",
];

/**
 * 显式豁免：两态**允许**不同的属性/情形，每条必须写清理由。
 * 这些正是「编辑态可以加的供能性 + 编辑必然引入的差异」。
 *
 * ⚠️ 这张表是 **overlay 路径专用**，因为它豁免的每一条都源于 overlay「另一个 DOM 子树 +
 * 另一条祖先链 + 固定定位盒」这一事实。在位编辑（wysiwyg-inplace）下，编辑面**就是**
 * 渲染面本身：没有 portal、没有 fixed 盒、没有 visibility:hidden。
 * 拿这张表去量在位模式 = 用一把偏松的尺子量最严的要求，会把真差异读成“豁免”。
 * 故 INPLACE_EXEMPTIONS 只留「contenteditable 语义本身必然带来」的那几条。
 */
const EXEMPTIONS = [
    { scope: "prop", name: "caretColor", reason: "caret 颜色属供能性，不影响阅读外观" },
    { scope: "prop", name: "outline", reason: "focus-visible 可供性" },
    { scope: "prop", name: "outlineColor", reason: "focus-visible 可供性" },
    { scope: "prop", name: "outlineStyle", reason: "focus-visible 可供性" },
    { scope: "prop", name: "outlineWidth", reason: "focus-visible 可供性" },
    { scope: "prop", name: "cursor", reason: "编辑态必须显示文本光标" },
    { scope: "prop", name: "userSelect", reason: "编辑态必须可选中" },
    { scope: "prop", name: "overflow", reason: "overlay 自身滚动策略（宿主裁切由 overlay 承担）" },
    { scope: "prop", name: "overflowY", reason: "overlay 自身滚动策略" },
    { scope: "prop", name: "position", reason: "overlay 是 fixed 定位盒，预览块在正常流中" },
    { scope: "prop", name: "zIndex", reason: "overlay 必须浮在预览之上" },
    { scope: "prop", name: "visibility", reason: "预览块被 visibility:hidden 保留布局盒（零布局位移的前提）" },
    { scope: "prop", name: "width", reason: "overlay 宽度由目标矩形驱动（可能与预览的 width:max-content 不同）" },
    { scope: "prop", name: "height", reason: "overlay height:auto 随内容增长" },
    { scope: "prop", name: "minHeight", reason: "overlay 以目标矩形高作下限" },
    { scope: "prop", name: "maxHeight", reason: "overlay 用 min() 边界兜底视口溢出" },
    { scope: "prop", name: "top", reason: "overlay 定位" },
    { scope: "prop", name: "left", reason: "overlay 定位" },
];

/**
 * 在位路径的豁免表：**只**豁免 contenteditable / focus 语义本身带来的差异。
 *
 * 关键：不豁免任何几何属性。编辑面就是预览块本身（同一根元素、同一祖先链），
 * 所以 position/zIndex/width/height/top/left/visibility **必须逐项相等** ——
 * 它们一旦不等，就是“编辑面不是渲染面”的直接证据，必须报为阻塞差异。
 */
const INPLACE_EXEMPTIONS = [
    { scope: "prop", name: "caretColor", reason: "caret 颜色属供能性" },
    { scope: "prop", name: "outline", reason: "focus-visible 可供性" },
    { scope: "prop", name: "outlineColor", reason: "focus-visible 可供性" },
    { scope: "prop", name: "outlineStyle", reason: "focus-visible 可供性" },
    { scope: "prop", name: "outlineWidth", reason: "focus-visible 可供性" },
    { scope: "prop", name: "cursor", reason: "编辑态必须显示文本光标" },
    { scope: "prop", name: "userSelect", reason: "编辑态必须可选中" },
];

function usage() {
    return `Usage: node scripts/parity-check.mjs [--endpoint URL] [--target TEXT] [--line N] [--selector CSS] [--json] [--keep-open]

对同一个块抓「预览态 / 编辑态」两份 computed style 并逐项比对。
退出码 0 = 无未豁免差异。

--allow-no-session：点击后无块级编辑会话时降级为“跳过”（默认当错误，以免“点击失效”被静默放过）。`;
}

export function parseArgs(argv) {
    const opts = {
        endpoint: process.env.SNORKELING_CDP_ENDPOINT || "http://127.0.0.1:9222",
        target: process.env.SNORKELING_CDP_TARGET || "Wave Terminal",
        line: null,
        selector: null,
        json: false,
        keepOpen: false,
        // 表格 / hr / 空白块**没有块级编辑会话**（表格用常驻的单元格内联编辑器）。
        // 默认仍当错误（防止“点击失效”被静默放过）；显式传 --allow-no-session 时降级为跳过。
        allowNoSession: false,
    };
    const rest = [...argv];
    while (rest.length > 0) {
        const item = rest.shift();
        if (item === "--help" || item === "-h") {
            opts.help = true;
            continue;
        }
        if (item === "--endpoint") {
            opts.endpoint = rest.shift();
            continue;
        }
        if (item === "--target") {
            opts.target = rest.shift();
            continue;
        }
        if (item === "--line") {
            opts.line = Number.parseInt(rest.shift(), 10);
            continue;
        }
        if (item === "--selector") {
            opts.selector = rest.shift();
            continue;
        }
        if (item === "--json") {
            opts.json = true;
            continue;
        }
        if (item === "--keep-open") {
            opts.keepOpen = true;
            continue;
        }
        if (item === "--allow-no-session") {
            opts.allowNoSession = true;
            continue;
        }
        throw new Error(`unknown argument: ${item}`);
    }
    return opts;
}

function ui(opts, command, ...args) {
    const result = spawnSync(
        process.execPath,
        [UI_SCRIPT, "--endpoint", opts.endpoint, "--target", opts.target, command, ...args],
        { encoding: "utf8", cwd: REPO_ROOT }
    );
    if (result.status !== 0) {
        throw new Error(`inspect-electron-ui ${command} failed: ${(result.stderr || result.stdout || "").trim()}`);
    }
    return (result.stdout || "").trim();
}

function evalJson(opts, expression) {
    const raw = ui(opts, "eval", expression);
    try {
        return JSON.parse(raw);
    } catch {
        // eval 对字符串结果直接原样打印
        return raw;
    }
}

/** 渲染进程内执行的测量函数：对指定元素（含其“承载文本”的内层元素）抓 computed style。 */
const MEASURE_FN = `(() => {
    const PROPS = ${JSON.stringify(PARITY_PROPS)};
    const pick = (el) => {
        const cs = getComputedStyle(el);
        const out = {};
        for (const p of PROPS) out[p] = String(cs[p]);
        return out;
    };
    // 与 markdown-inline-edit.tsx 的 resolveTextElement 同语义：pre → code；其它取首个非空文本节点父元素
    const resolveTextElement = (el) => {
        if (el.tagName === "PRE") return el.querySelector("code") ?? el;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode()) != null) {
            if ((node.nodeValue ?? "").trim() !== "") return node.parentElement ?? el;
        }
        return el;
    };
    window.__parityMeasure = (selector) => {
        const el = document.querySelector(selector);
        if (el == null) return { error: "not found: " + selector };
        const textEl = resolveTextElement(el);
        const rect = el.getBoundingClientRect();
        return {
            selector,
            tag: el.tagName.toLowerCase(),
            cls: String(el.className || "").slice(0, 160),
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
            block: pick(el),
            text: pick(textEl),
            textSelector: textEl.tagName.toLowerCase() + "." + String(textEl.className || "").split(" ").filter(Boolean).join("."),
        };
    };
    window.__parityFindTarget = (line) => {
        const root = document.querySelector(".markdown-render-root") ?? document;
        if (line != null && Number.isFinite(line)) {
            const el = root.querySelector('[data-source-line="' + line + '"]');
            return el ? describe(el) : null;
        }
        // 默认挑第一个 WYSIWYG 可编辑的块（p/h/list/quote），且可见
        const cands = Array.from(root.querySelectorAll("p[data-source-line], h1[data-source-line], h2[data-source-line], h3[data-source-line], ul[data-source-line], ol[data-source-line], blockquote[data-source-line], calloutalert[data-source-line]"));
        for (const el of cands) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return describe(el);
        }
        return null;
        function describe(el) {
            // 先把块滚进视口：块可能在折叠区之下（实测 line 32 的 y=948 超出视口，
            // elementFromPoint 返回 null → 点击落空、编辑器根本不打开，容易被误判为 parity 失败）
            el.scrollIntoView({ block: "center", inline: "nearest" });
            const r = el.getBoundingClientRect();
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const x = Math.round(Math.min(Math.max(r.x + r.width / 2, 8), vw - 8));
            const y = Math.round(Math.min(Math.max(r.y + Math.min(r.height / 2, 12), 8), vh - 8));
            const inViewport = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
            return { line: el.getAttribute("data-source-line"), tag: el.tagName.toLowerCase(), cls: String(el.className || ""), x, y, inViewport };
        }
    };
    window.__parityEditProbe = (selector) => {
        // overlay 路径：独立的 portal 盒
        const ov = document.querySelector(".inline-edit-overlay");
        if (ov != null) {
            return {
                mode: "overlay",
                present: true,
                kind: ov.getAttribute("data-block-kind"),
                hasEditor: ov.querySelector("[contenteditable=true], textarea") != null,
            };
        }
        // 在位路径：**没有**新盒子 —— 块自身变成 contenteditable。
        // 判据：目标块自身（或其自己的编辑体，如 heading 的 .heading-title）是 [contenteditable]。
        const el = document.querySelector(selector);
        if (el == null) return { mode: "none", present: false };
        const self = el.getAttribute("contenteditable") === "true";
        // 排除**常驻内联编辑器**（不是 A3 会话的一部分）：
        //  - 表格单元格（tablecell feature 给每个 td/th 挂常驻 contenteditable）
        //  - 代码块内部（ContentEditableCodeEditor）
        // 不排除的话，点表格单元格会被误判为“进入 inplace 编辑”，
        // 于是拿“预览表格 vs 单元格编辑器”去对拍 —— 可能读出假差异，也可能掩盖真差异。
        const inner = Array.from(el.querySelectorAll("[contenteditable=true]")).find(
            (node) => node.closest("td, th, pre.codeblock, .table-wrapper") == null
        );
        if (!self && inner == null) return { mode: "none", present: false };
        return {
            mode: "inplace",
            present: true,
            kind: el.tagName.toLowerCase(),
            hasEditor: true,
            editableIsRoot: self,
        };
    };
    window.__parityOverlayProbe = () => window.__parityEditProbe(window.__parityLastSelector);
    return "ready";
})()`;

const CLICK_AND_MEASURE = (opts, selector) =>
    `(() => {
        window.__parityLastSelector = ${JSON.stringify(selector)};
        const ov = document.querySelector(".inline-edit-overlay");
        if (ov) ov.__paritySelector = ${JSON.stringify(selector)};
        return window.__parityMeasure(${JSON.stringify(selector)});
    })()`;

function diff(a, b, exemptionTable = EXEMPTIONS) {
    const exempt = new Set(exemptionTable.filter((e) => e.scope === "prop").map((e) => e.name));
    const rows = [];
    for (const bucket of ["block", "text"]) {
        const left = a?.[bucket] ?? {};
        const right = b?.[bucket] ?? {};
        for (const prop of PARITY_PROPS) {
            const lv = left[prop];
            const rv = right[prop];
            if (lv === rv) continue;
            rows.push({ bucket, prop, preview: lv, edit: rv, exempt: exempt.has(prop) });
        }
    }
    return rows;
}

function formatRows(rows) {
    const lines = [];
    for (const r of rows) {
        const mark = r.exempt ? "豁免" : "❌ 差异";
        lines.push(`  [${mark}] ${r.bucket}.${r.prop}: 预览=${r.preview} → 编辑=${r.edit}`);
    }
    return lines.join("\n");
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        console.log(usage());
        return;
    }

    // 先置前 + 开 focus 模拟（已知坑：窗口未置前时 visibilityState=hidden，
    // CDP 输入不投递 → 点击/按键全部落空 → 会被误判为“未进入编辑态”）。
    // 不这一步就会抛下面的 visibility 断言；做成自动的就不依赖人工把窗口摆在前台。
    try {
        ui(opts, "focus");
    } catch {
        // 老版本没有 focus 命令时忽略，交给下面的断言报清楚的错
    }
    await new Promise((r) => setTimeout(r, 300));

    const visibility = evalJson(opts, "document.visibilityState");
    if (visibility !== "visible") {
        throw new Error(
            `渲染进程当前 visibilityState=${visibility}：CDP 输入不会投递（已知坑）。请把窗口置前或用 Emulation.setFocusEmulationEnabled + 长连接。`
        );
    }

    evalJson(opts, MEASURE_FN);

    const target = evalJson(opts, `window.__parityFindTarget(${opts.line ?? "null"})`);
    if (target == null) {
        throw new Error("找不到可编辑块（--line 指定 data-source-line，或确认笔记已在预览中打开）");
    }
    const selector = opts.selector ?? `[data-source-line="${target.line}"]`;

    // 把指针移到中性角落再测「预览态」：否则上一次点击残留的 :hover 会给块加高亮底色
    // （实测：预览 <li> 出现 --accent-color 4% 混合背景 → 被误报为 parity 差异）
    ui(opts, "move", "4", "4");
    await new Promise((r) => setTimeout(r, 150));
    const preview = evalJson(opts, CLICK_AND_MEASURE(opts, selector));
    ui(opts, "click", String(target.x), String(target.y));
    await new Promise((r) => setTimeout(r, 600));
    const probe = evalJson(opts, `window.__parityEditProbe(${JSON.stringify(selector)})`);
    if (!probe?.present) {
        if (opts.allowNoSession) {
            console.log(`目标块: line=${target.line} <${target.tag} class="${target.cls}">`);
            console.log(
                "⏭️  该块没有块级编辑会话（表格用常驻单元格内联编辑器 / hr、空白块不可块级编辑）—— 跳过"
            );
            return;
        }
        throw new Error(
            "点击后未进入编辑态（既没有 .inline-edit-overlay，也没有 contenteditable 块）—— 窗口可见性/坐标是否失效？或 wysiwyg-inplace flag 未开且点击未命中可编辑块"
        );
    }
    ui(opts, "move", "4", "4"); // 编辑态同样移开指针，让两态在同一 hover 条件下比较
    await new Promise((r) => setTimeout(r, 150));
    const edit = evalJson(opts, CLICK_AND_MEASURE(opts, selector));

    // 在位路径用**更严**的豁免表：几何属性一律不得豁免（它们不等就是“编辑面≠渲染面”的铁证）。
    const table = probe.mode === "inplace" ? INPLACE_EXEMPTIONS : EXEMPTIONS;
    const rows = diff(preview, edit, table);
    const blocking = rows.filter((r) => !r.exempt);

    if (opts.json) {
        console.log(
            JSON.stringify(
                { target, selector, probe, rows, blocking: blocking.length, preview, edit },
                null,
                2
            )
        );
    } else {
        console.log(`目标块: line=${target.line} <${target.tag} class="${target.cls}"> inViewport=${target.inViewport}`);
        console.log(
            `编辑态: mode=${probe.mode} kind=${probe.kind} editor=${probe.hasEditor}` +
                (probe.mode === "inplace" ? ` editableIsRoot=${probe.editableIsRoot}` : "")
        );
        if (rows.length === 0) {
            console.log("✅ 两态 computed style 逐项一致（无任何差异，含豁免项）");
        } else {
            console.log(formatRows(rows));
            console.log(
                blocking.length === 0
                    ? `✅ 仅剩 ${rows.length} 项已豁免差异（caret/hover/定位类）`
                    : `❌ ${blocking.length} 项未豁免差异（编辑态改变了用户能看到的结构性样式）`
            );
        }
    }

    if (!opts.keepOpen) {
        ui(opts, "key", "escape");
    }
    process.exitCode = blocking.length === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("parity-check.mjs")) {
    main().catch((error) => {
        console.error(`parity-check: ${error.message}`);
        process.exitCode = 1;
    });
}
