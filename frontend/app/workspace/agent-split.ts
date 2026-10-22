// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Agent 块「拆分」= 起一个全新会话。
//
// 问题：拆分时新块整份复制源块 meta，而源块 meta 在 agent 首次启动后已被后端写入
// `agent:sessionid`（pkg/blockcontroller/shellcontroller.go persistAgentSessionId）。
// 后端启动进程时按 meta 派生 resume 参数（resolveAgentCmdAndArgs）：
//
//	codex    → resume <id>
//	claude   → --resume <id>
//	opencode → --session <id>
//	pi       → --session-id <id>
//
// 于是新块与源块 resume 同一个会话：两份对话历史互相串、Session Outline 指向同一 session、
// 两边同时写同一份会话文件。
//
// 这里在**共享拆分原语**（store/global.ts createBlockSplitHorizontally / createBlockSplitVertically）
// 处改写「新块」的 meta：剥掉会话身份，保留其余配置（provider / 模型 / vendor / cwd /
// connection / autoresume），让新块以全新会话启动。源块完全不受影响——只改写新块的 meta，
// 不回写源块。
//
// 判据只看**新块自身**是不是 agent 块，与「被拆分的源块」无关：
//   - preview / aisessions 详情块 / 普通终端等拆分 → meta 原样不变，零影响；
//   - agent 块 → 改写成新会话形态。
//
// 本模块是纯函数：不 import store / React，不修改传入的 blockDef / meta / args 数组。

type MetaRecord = Record<string, unknown>;

export const AGENT_AUTORESUME_META_KEY = "agent:autoresume";
export const AGENT_PROVIDER_META_KEY = "agent:provider";
export const AGENT_SESSION_ID_META_KEY = "agent:sessionid";

const CMD_META_KEY = "cmd";
const CMD_ARGS_META_KEY = "cmd:args";

// 后端 stripCodexResumeArgs 用的 codex 选项表（pkg/blockcontroller/shellcontroller.go）。
// 复制一份到前端是为了在剥离 `resume <id>` 子命令时能正确跳过选项的取值，
// 避免把 `--cd /tmp` 的 `/tmp` 误当成 session id。
const CodexOptionValueFlags = new Set([
    "-a",
    "--add-dir",
    "--ask-for-approval",
    "-c",
    "--cd",
    "--config",
    "--disable",
    "--enable",
    "-i",
    "--image",
    "--local-provider",
    "-m",
    "--model",
    "-p",
    "--profile",
    "--profile-v2",
    "--remote",
    "--remote-auth-token-env",
    "-s",
    "--sandbox",
]);

const CodexOptionOnlyFlags = new Set([
    "--all",
    "--dangerously-bypass-approvals-and-sandbox",
    "--dangerously-bypass-hook-trust",
    "-h",
    "--help",
    "--include-non-interactive",
    "--last",
    "--no-alt-screen",
    "--oss",
    "--search",
    "--strict-config",
    "-V",
    "--version",
]);

const CodexResumeOnlyFlags = new Set(["--last", "--all", "--include-non-interactive"]);

const ClaudeSessionValueFlags = new Set(["--resume", "-r", "--session-id"]);
const ClaudeSessionBareFlags = new Set(["--continue", "-c", "--fork-session"]);

const OpenCodeSessionValueFlags = new Set(["--session"]);

const PiSessionValueFlags = new Set(["--session-id", "--session", "--resume", "-r", "--fork"]);

const GenericSessionValueFlags = new Set(["--resume", "-r", "--session", "--session-id"]);

function trimmedString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item): item is string => typeof item === "string");
}

/**
 * cmd 的 basename：去目录分隔符 → 去 `.exe/.cmd/.bat/.ps1` → 小写。
 * 与后端 getAgentProvider（shellcontroller.go）以及前端 agent-session.ts 的
 * commandBaseName 语义一致。
 */
function commandBaseName(command: string): string {
    const normalized = command.replace(/\\/g, "/");
    const slashIdx = normalized.lastIndexOf("/");
    const baseName = slashIdx === -1 ? normalized : normalized.slice(slashIdx + 1);
    return baseName.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, "");
}

/**
 * 新块的 meta 是否属于 agent 块。
 *
 * 三个判据任一命中即算（对齐后端对 agent block 的识别）：
 *   - `agent:autoresume === true`
 *   - `agent:provider` 非空字符串
 *   - `agent:sessionid` 非空字符串
 */
export function isAgentBlockMeta(meta?: MetaType | Record<string, unknown>): boolean {
    if (meta == null) {
        return false;
    }
    const record = meta as MetaRecord;
    if (record[AGENT_AUTORESUME_META_KEY] === true) {
        return true;
    }
    if (trimmedString(record[AGENT_PROVIDER_META_KEY]) !== "") {
        return true;
    }
    if (trimmedString(record[AGENT_SESSION_ID_META_KEY]) !== "") {
        return true;
    }
    return false;
}

/**
 * 解析 block 的 agent provider。
 *
 * 优先级：`agent:provider`（trim + 小写）→ `cmd` 的 basename。
 * 与后端 getAgentProvider 语义一致。
 */
export function resolveAgentProvider(meta?: MetaType | Record<string, unknown>): string {
    const record = (meta ?? {}) as MetaRecord;
    const provider = trimmedString(record[AGENT_PROVIDER_META_KEY]).toLowerCase();
    if (provider !== "") {
        return provider;
    }
    const cmd = trimmedString(record[CMD_META_KEY]);
    if (cmd === "") {
        return "";
    }
    return commandBaseName(cmd);
}

/** 跳过 codex 的一个选项（连同其取值），返回下一个待检查的下标。对齐后端 skipCodexOptionArgs。 */
function skipCodexOptionArgs(args: string[], idx: number): number {
    if (idx < 0 || idx >= args.length) {
        return idx;
    }
    const arg = args[idx];
    if (arg === "") {
        return idx;
    }
    if (arg === "--") {
        return idx + 1;
    }
    const eqIdx = arg.indexOf("=");
    const flag = eqIdx === -1 ? arg : arg.slice(0, eqIdx);
    if (CodexOptionValueFlags.has(flag)) {
        if (eqIdx !== -1) {
            return idx + 1;
        }
        if (idx + 1 < args.length) {
            return idx + 2;
        }
        return idx + 1;
    }
    if (CodexOptionOnlyFlags.has(flag)) {
        return idx + 1;
    }
    if (arg.startsWith("-")) {
        return idx + 1;
    }
    return idx;
}

/** 找到 codex 的 `resume` 子命令下标。对齐后端 findCodexResumeArgIndex。 */
function findCodexResumeArgIndex(args: string[]): number {
    let idx = 0;
    while (idx < args.length) {
        if (args[idx] === "resume") {
            return idx;
        }
        const nextIdx = skipCodexOptionArgs(args, idx);
        if (nextIdx === idx) {
            return -1;
        }
        idx = nextIdx;
    }
    return -1;
}

/** 找到 `resume` 子命令后面的 session id（第一个非选项位置参数）。对齐后端 findCodexResumeSessionArgIndex。 */
function findCodexResumeSessionArgIndex(args: string[], resumeIdx: number): number {
    let idx = resumeIdx + 1;
    while (idx < args.length) {
        const nextIdx = skipCodexOptionArgs(args, idx);
        if (nextIdx !== idx) {
            idx = nextIdx;
            continue;
        }
        const arg = args[idx] ?? "";
        if (arg.trim() === "" || arg.startsWith("-")) {
            return -1;
        }
        return idx;
    }
    return -1;
}

/** 剥掉 `resume <id>` 子命令及其 id，并去掉 `--last` / `--all` / `--include-non-interactive`。 */
function stripCodexResumeArgs(args: string[]): string[] {
    const resumeIdx = findCodexResumeArgIndex(args);
    const sessionIdx = resumeIdx === -1 ? -1 : findCodexResumeSessionArgIndex(args, resumeIdx);
    const out: string[] = [];
    args.forEach((arg, idx) => {
        if (idx === resumeIdx || idx === sessionIdx) {
            return;
        }
        if (CodexResumeOnlyFlags.has(arg)) {
            return;
        }
        out.push(arg);
    });
    return out;
}

/** 剥掉带取值的选项（`--flag value` 与 `--flag=value` 两种形态）。 */
function stripValueFlags(args: string[], flags: Set<string>): string[] {
    const out: string[] = [];
    for (let idx = 0; idx < args.length; idx++) {
        const arg = args[idx];
        if (flags.has(arg)) {
            idx++; // 连同取值一起跳过
            continue;
        }
        const eqIdx = arg.indexOf("=");
        if (eqIdx > 0 && flags.has(arg.slice(0, eqIdx))) {
            continue;
        }
        out.push(arg);
    }
    return out;
}

/** 剥掉不带取值的选项。 */
function stripBareFlags(args: string[], flags: Set<string>): string[] {
    return args.filter((arg) => !flags.has(arg));
}

/** 找到 `resume <id>` 子命令后面的 session id（通用形态）。 */
function findResumeSessionArgIndex(args: string[], resumeIdx: number): number {
    for (let idx = resumeIdx + 1; idx < args.length; idx++) {
        const arg = args[idx];
        if (arg === "--") {
            return -1;
        }
        if (arg.startsWith("-")) {
            if (!arg.includes("=")) {
                idx++; // 跳过选项的取值
            }
            continue;
        }
        return idx;
    }
    return -1;
}

/** 剥掉 `resume <id>` 子命令及其 id。 */
function stripResumeSubcommand(args: string[]): string[] {
    const resumeIdx = args.findIndex((arg) => arg === "resume");
    if (resumeIdx === -1) {
        return [...args];
    }
    const sessionIdx = findResumeSessionArgIndex(args, resumeIdx);
    const out: string[] = [];
    args.forEach((arg, idx) => {
        if (idx === resumeIdx || idx === sessionIdx) {
            return;
        }
        out.push(arg);
    });
    return out;
}

/**
 * 剥掉会指向「旧会话」的参数。
 *
 * 各 provider 的剥离规则与后端既有函数语义对齐
 * （stripCodexResumeArgs / stripClaudeSessionArgs / ensurePiSessionIdArg）：
 *   - codex：`resume <id>` 子命令 + `--last` / `--all` / `--include-non-interactive`
 *   - claude：`--resume` / `-r` / `--session-id`（连同取值）、`--continue` / `-c` / `--fork-session`
 *   - opencode：`--session`（连同取值）
 *   - pi：`--session-id` / `--session` / `--resume` / `-r` / `--fork`（连同取值）
 *   - 未知：保守通用 —— `--resume` / `-r` / `--session` / `--session-id`（含 `=` 内联形态）
 *     及其取值，外加 `resume <id>` 子命令
 *
 * 始终返回**新数组**，不修改传入的 args。
 */
export function stripAgentResumeArgs(provider: string, args: string[]): string[] {
    const source = Array.isArray(args) ? args : [];
    switch (trimmedString(provider).toLowerCase()) {
        case "codex":
            return stripCodexResumeArgs(source);
        case "claude":
            return stripBareFlags(stripValueFlags(source, ClaudeSessionValueFlags), ClaudeSessionBareFlags);
        case "opencode":
            return stripValueFlags(source, OpenCodeSessionValueFlags);
        case "pi":
            return stripValueFlags(source, PiSessionValueFlags);
        default:
            return stripResumeSubcommand(stripValueFlags(source, GenericSessionValueFlags));
    }
}

/**
 * 为「拆分」生成新块的 blockDef。
 *
 * - 非 agent 块（普通终端 / preview / aisessions 详情块等）→ meta 逐字段等价，零行为变化。
 * - agent 块 → 删除 `agent:sessionid`、剥离 `cmd:args` 里的 resume 类参数；
 *   保留 `agent:autoresume` / `agent:provider` 以及 cmd / cmd:env / cmd:cwd / connection /
 *   vendor / model 等其余全部 meta。新块仍由后端为它新铸/新捕获一个 session id，
 *   今后重启它 resume 的是**它自己的**会话。
 *
 * 不原地修改传入的 blockDef / meta / args。
 */
export function buildSplitBlockDef(blockDef: BlockDef): BlockDef {
    const meta = blockDef?.meta as MetaRecord | undefined;
    if (meta == null) {
        return { ...blockDef };
    }
    if (!isAgentBlockMeta(meta)) {
        return { ...blockDef, meta: { ...meta } as MetaType };
    }
    const nextMeta: MetaRecord = { ...meta };
    delete nextMeta[AGENT_SESSION_ID_META_KEY];
    const provider = resolveAgentProvider(meta);
    const args = nextMeta[CMD_ARGS_META_KEY];
    if (Array.isArray(args)) {
        const stripped = stripAgentResumeArgs(provider, stringList(args));
        if (stripped.length > 0) {
            nextMeta[CMD_ARGS_META_KEY] = stripped;
        } else {
            delete nextMeta[CMD_ARGS_META_KEY];
        }
    }
    return { ...blockDef, meta: nextMeta as MetaType };
}
