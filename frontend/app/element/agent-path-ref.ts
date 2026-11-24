// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * agent 输出的“脏路径”修复层与判型。
 *
 * 终端 OSC 8 链接、AI 面板 markdown 链接、以及选区「Search In Files」前的引用识别
 * 都会碰到各种脏写法：`file///x`、`E://x`、`(E://x)`、反引号包裹、`vscode://file/...`、
 * 反斜杠路径、尾随标点。这里只做**文本整形**（repairAgentPathText）和**判型**
 * （parseAgentPathRef），不复制 `term-file-url.ts` 已有的 file:// → 原生路径规则
 * （直接复用它的 `terminalFilePath`），也不重写 `selection-reference-parser.ts`
 * （裸路径 / 相对路径 / 行号交给它）。
 *
 * 本模块保持纯函数：无 Electron / DOM 依赖，可直接单测。
 */

import { terminalFilePath } from "@/app/view/term/term-file-url";
import { parseFileReference } from "./selection-reference-parser";

export type AgentPathKind = "file" | "http" | "other";

export type AgentPathRef = {
    /** `file`=本地文件引用；`http`=http(s)；`other`=白名单外 scheme（拒绝打开）。 */
    kind: AgentPathKind;
    /** kind=file/http 时的规范 URL（file:///…、https://…）。 */
    url?: string;
    /** kind=file 时的本地路径（正斜杠，盘符单斜杠）。 */
    filePath?: string;
    lineNumber?: number;
    columnNumber?: number;
    /** 供 `parseFileReference` / Search-In-Files 兜底时使用的文本。 */
    refText: string;
};

// 成对包裹符：agent 经常把路径写在括号 / 书名号 / 引号里。
const WrapperPairs: [string, string][] = [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
    ["<", ">"],
    ["「", "」"],
    ["『", "』"],
    ["《", "》"],
    ["“", "”"],
    ["‘", "’"],
];
// 单字符包裹符（首尾同字符）。
const SingleCharWrappers = "`'\"";
// 尾随标点：句末标点不属于路径。行号引用以数字结尾，不受影响。
const TrailingPunctuation = /[.,;:!?)\]}>»"'…，。；：！？）】」』》｝]+$/;
// 多字母 scheme（`javascript:` / `data:` / `mailto:` …）。单字母后跟 `:` 是 Windows 盘符，不算 scheme。
const SchemePattern = /^([A-Za-z][A-Za-z0-9+.-]*):/;

function stripWrappers(text: string): string {
    let result = text.trim();
    while (result.length >= 2) {
        const first = result[0];
        const last = result[result.length - 1];
        const pair = WrapperPairs.find(([open, close]) => first === open && last === close);
        if (pair != null) {
            result = result.slice(1, -1).trim();
            continue;
        }
        if (SingleCharWrappers.includes(first) && first === last) {
            result = result.slice(1, -1).trim();
            continue;
        }
        break;
    }
    return result;
}

function stripTrailingPunctuation(text: string): string {
    return text.replace(TrailingPunctuation, "").trim();
}

/**
 * 只做文本整形，不判型：
 *
 * - 剥包裹符（`()` `[]` `{}` `<>` 反引号 引号 中文括号 / 书名号）与尾随标点
 * - `\` → `/`
 * - `vscode://file/…` → 本地路径
 * - `file///…` / `file//…` / `file:/…` → `file:///…`
 * - 盘符后与路径中的重复 `/` 收敛成一个（UNC 前缀 `//server/share` 原样保留）
 *
 * 百分号编码**不在这里解码**：解码交给 URL 解析（`terminalFilePath`）与
 * `parseFileReference`，避免对仍在 URL 形态的文本做二次编码破坏。
 */
export function repairAgentPathText(raw: string): string {
    if (typeof raw !== "string") {
        return "";
    }
    let text = stripWrappers(raw);
    text = stripTrailingPunctuation(text);
    text = stripWrappers(text);
    if (text === "") {
        return "";
    }
    text = text.replace(/\\/g, "/");
    text = text.replace(/^vscode:\/\/file\//i, "");
    text = text.replace(/^file:\/+/i, "file:///");
    text = text.replace(/^file\/{2,}/i, "file:///");
    if (/^file:\/\//i.test(text)) {
        // file:///…：只收敛路径部分的重复斜杠，前缀本身保持三个斜杠。
        text = "file:///" + text.slice("file:///".length).replace(/\/{2,}/g, "/");
    } else if (!/^https?:\/\//i.test(text)) {
        // 无 scheme（本地路径 / UNC）：盘符后的重复斜杠（E://x → E:/x）与路径内部重复斜杠
        // （x//y → x/y）收敛成一个；开头 `//`（UNC）不动。
        text = text.replace(/^([A-Za-z]:)\/+/, "$1/");
        text = text.replace(/([^:/])\/{2,}/g, "$1/");
    }
    return text.trim();
}

/**
 * 判定修复后文本的引用类型。
 *
 * - `file:///…` → kind=file，复用 `terminalFilePath` 的解析语义
 * - `https?://…` → kind=http
 * - 其它显式 scheme → kind=other（调用方必须拒绝）
 * - 无 scheme → 修复文本交 `parseFileReference` 补行号 / 相对路径；解析不出返回 null
 */
export function parseAgentPathRef(raw: string): AgentPathRef | null {
    if (typeof raw !== "string" || raw.trim() === "") {
        return null;
    }
    const repaired = repairAgentPathText(raw);
    if (repaired === "") {
        return null;
    }

    if (/^file:\/\//i.test(repaired)) {
        const filePath = terminalFilePath(repaired);
        if (filePath == null) {
            // URL 解析不出来：不猜路径，交调用方拒绝（终端场景会退 openExternal）。
            return { kind: "other", url: repaired, refText: repaired };
        }
        return { kind: "file", filePath, refText: filePath };
    }

    if (/^https?:\/\//i.test(repaired)) {
        return { kind: "http", url: repaired, refText: repaired };
    }

    const schemeMatch = SchemePattern.exec(repaired);
    if (schemeMatch != null && schemeMatch[1].length > 1) {
        return { kind: "other", url: repaired, refText: repaired };
    }

    const parsed = parseFileReference(repaired);
    if (parsed == null) {
        return null;
    }
    return {
        kind: "file",
        filePath: parsed.filePath,
        lineNumber: parsed.lineNumber,
        columnNumber: parsed.columnNumber,
        refText: repaired,
    };
}
