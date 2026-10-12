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

function usage() {
    return `Usage: node scripts/parity-check.mjs [--endpoint URL] [--target TEXT] [--line N] [--selector CSS] [--json] [--keep-open]

对同一个块抓「预览态 / 编辑态」两份 computed style 并逐项比对。
退出码 0 = 无未豁免差异。`;
}

export function parseArgs(argv) {
    const opts = {
        endpoint: process.env.SNORKELING_CDP_ENDPOINT || "http://127.0.0.1:9222",
        target: process.env.SNORKELING_CDP_TARGET || "Wave Terminal",
        line: null,
        selector: null,
        json: false,
        keepOpen: false,
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
            const r = el.getBoundingClientRect();
            return { line: el.getAttribute("data-source-line"), tag: el.tagName.toLowerCase(), cls: String(el.className || ""), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(r.height / 2, 12)) };
        }
    };
    window.__parityOverlayProbe = () => {
        const ov = document.querySelector(".inline-edit-overlay");
        if (ov == null) return { present: false };
        return {
            present: true,
            kind: ov.getAttribute("data-block-kind"),
            targetVisible: (() => {
                const sel = ov.__paritySelector;
                const t = sel ? document.querySelector(sel) : null;
                return t ? getComputedStyle(t).visibility : null;
            })(),
            hasEditor: ov.querySelector("[contenteditable=true], textarea") != null,
        };
    };
    return "ready";
})()`;

const CLICK_AND_MEASURE = (opts, selector) =>
    `(() => {
        const ov = document.querySelector(".inline-edit-overlay");
        if (ov) ov.__paritySelector = ${JSON.stringify(selector)};
        return window.__parityMeasure(${JSON.stringify(selector)});
    })()`;

function diff(a, b) {
    const exempt = new Set(EXEMPTIONS.filter((e) => e.scope === "prop").map((e) => e.name));
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

    const preview = evalJson(opts, CLICK_AND_MEASURE(opts, selector));
    ui(opts, "click", String(target.x), String(target.y));
    await new Promise((r) => setTimeout(r, 600));
    const probe = evalJson(opts, "window.__parityOverlayProbe()");
    if (!probe?.present) {
        throw new Error("点击后未出现 .inline-edit-overlay —— 未进入编辑态（窗口可见性/坐标是否失效？）");
    }
    const edit = evalJson(opts, CLICK_AND_MEASURE(opts, selector));

    const rows = diff(preview, edit);
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
        console.log(`目标块: line=${target.line} <${target.tag} class="${target.cls}">`);
        console.log(`编辑态: overlay kind=${probe.kind} editor=${probe.hasEditor}`);
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
