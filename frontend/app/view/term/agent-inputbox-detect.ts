// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Agent TUI 输入态识别（阶段 1，纯函数，无 UI / 无键盘接管）。
//
// 目标：判断"一个 agent 终端 block 当前是否正在显示 TUI 输入框"（composer /
// 权限提问 / 选择列表），为后续"悬浮 GUI 输入框镜像"提供输入态 hint。
//
// 设计约束（见 方案/竞品与生态调研/Agent TUI 输入框自动渲染为 GUI 可行性调研.md §2.5）：
//  - 必须是 agent block（meta agent:provider），非 agent block 一律不判；
//  - 只用 xterm 前端已有的数据（buffer 文本 / cursor / alt-buffer 状态），
//    不碰 PTY、不解析 ANSI 字节流；
//  - 识别规则宁可漏判（kind: none）不可误判（把 shell/less/vim 当输入框）。

export type AgentInputBoxKind = "none" | "composer" | "permission";

export type InputBoxHint =
    | { kind: "none" }
    | {
          kind: "composer";
          prompt: string;
          cursorX: number;
          cursorY: number;
          lastLine: string;
      }
    | { kind: "permission"; prompt: string; lastLine: string };

export type AgentInputBoxDetectionInput = {
    /** 是否为 agent block（isAgentTerminalMeta(meta)）。false 时直接返回 none。 */
    isAgentBlock: boolean;
    /** xterm buffer 类型："normal" | "alternate"。TUI 全屏程序用 alternate。 */
    bufferType: string;
    /** active buffer 最后 3 行（物理行，已 translateToString）。 */
    lastLines: string[];
    /** 光标列（0 基）。 */
    cursorX: number;
    /** 光标行（相对屏幕顶部，0 基）。 */
    cursorY: number;
    /** 最近执行的命令（shellblocking 用的 lastCommand），已知全屏程序时抑制。 */
    lastCommand: string | null;
};

// 已知会切 alt-buffer 的"全屏但非 agent 输入框"程序。命中时抑制 composer 判定。
// ponytail: 白名单维护成本随内置命令数增长；先覆盖最常见项，升级路径是复用
// shellblocking.ts 的 ALWAYS_BLOCK 列表（把 getBlockingCommand 结果传进来）。
const ALT_BUFFER_NON_INPUT_CMDS = new Set([
    "vim",
    "nvim",
    "emacs",
    "nano",
    "less",
    "more",
    "man",
    "htop",
    "top",
    "btop",
    "fzf",
    "ranger",
    "mc",
    "nnn",
    "k9s",
    "nmtui",
    "alsamixer",
    "tig",
    "gdb",
    "lldb",
    "mutt",
    "neomutt",
    "weechat",
    "irssi",
    "dialog",
    "whiptail",
    "psql",
    "mysql",
    "sqlite3",
    "mongo",
    "redis-cli",
    "tmux",
    "screen",
    "lazygit",
]);

// Agent composer 提示符特征：**行首** `?`/`❯`/`›`/`>`（实测 codex 0.147.0 为
// `› 提示文本` 或 `› `，提示符在行首）。`?` 行首被 permission 规则优先拦截。
// ponytail: 各 agent 提示符随版本漂移；命中即新增，漏判优于误判。
const COMPOSER_PROMPT_RE = /^\s*([?❯>›])\s/;

// 权限提问特征：行首 `?` 或含 "allow" / "proceed" / "permission" / "继续" 的提问行。
const PERMISSION_QUESTION_RE = /^\s*\?\s+/i;
const PERMISSION_KEYWORD_RE = /\b(allow|proceed|permission|approve|deny|y\/n|yes\/no)\b/i;

// shell 提示符（抑制：普通 shell 的 `$` / `#` / `%` 结尾行）。
const SHELL_PROMPT_RE = /[\$#%>]\s*$/;

function isLineBlank(line: string): boolean {
    return line.trim() === "";
}

function getLastCommandWord(lastCommand: string | null): string | null {
    if (!lastCommand) {
        return null;
    }
    const words = lastCommand.trim().split(/\s+/);
    if (words.length === 0) {
        return null;
    }
    return words[0].split("/").pop()!.toLowerCase();
}

export function detectAgentInputBox(input: AgentInputBoxDetectionInput): InputBoxHint {
    if (!input.isAgentBlock) {
        return { kind: "none" };
    }
    if (input.lastLines.length === 0) {
        return { kind: "none" };
    }

    const lastLine = input.lastLines[input.lastLines.length - 1] ?? "";
    // 注意：cursorY 是 xterm 屏幕坐标（相对 viewport 顶），不是 lastLines 数组索引——
    // 实测 codex 光标可停在状态行/其他区域而 composer 在末行附近。且 codex 布局中
    // 状态栏（如 `gpt-5.6-sol xhigh`）常在 composer 行之后，所以 **末行不一定是 composer**。
    // 正确做法：从后往前扫描 lastLines 找第一个命中 composer/permission 的行。
    const lastCmdWord = getLastCommandWord(input.lastCommand);

    // 权限提问：行首 `?`（Claude/Gemini 提问），或含权限关键词的行。从后往前扫描。
    for (let i = input.lastLines.length - 1; i >= 0; i--) {
        const line = input.lastLines[i] ?? "";
        if (PERMISSION_QUESTION_RE.test(line) || PERMISSION_KEYWORD_RE.test(line)) {
            return { kind: "permission", prompt: line.trim(), lastLine };
        }
    }

    // 抑制规则 1：已知全屏非输入程序。
    if (lastCmdWord && ALT_BUFFER_NON_INPUT_CMDS.has(lastCmdWord)) {
        return { kind: "none" };
    }

    // 抑制规则 2：普通 shell 提示符（`$`/`#`/`%` 结尾）。看末行。
    if (SHELL_PROMPT_RE.test(lastLine)) {
        return { kind: "none" };
    }

    // composer：从后往前扫描 lastLines 找命中提示符特征的行（行首 `?`/`›`/`❯`/`>`）。
    // 实测 codex 0.147.0 把全屏 TUI 画在 normal buffer（不切 alt-buffer），
    // composer 在 viewport 末区域，所以不依赖 alt-buffer——alt-buffer 仅作加分。
    const inAltBuffer = input.bufferType === "alternate";
    for (let i = input.lastLines.length - 1; i >= 0; i--) {
        const line = input.lastLines[i] ?? "";
        const promptMatch = COMPOSER_PROMPT_RE.exec(line);
        if (promptMatch) {
            return {
                kind: "composer",
                prompt: promptMatch[1] ?? "",
                cursorX: input.cursorX,
                cursorY: input.cursorY,
                lastLine: line,
            };
        }
    }

    // 兜底：alt-buffer 且末行非空、倒数第二行空——大概率是 TUI 输入区（Codex composer 边界）。
    // ponytail: 启发式，误判风险存在；层 2 提示条 + 手动关闭兜底。
    if (inAltBuffer && !isLineBlank(lastLine)) {
        const blankAbove = input.lastLines.length >= 2 && isLineBlank(input.lastLines[input.lastLines.length - 2]);
        if (blankAbove) {
            return {
                kind: "composer",
                prompt: "",
                cursorX: input.cursorX,
                cursorY: input.cursorY,
                lastLine,
            };
        }
    }

    return { kind: "none" };
}
