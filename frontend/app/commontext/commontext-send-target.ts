// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// CommonText Send 目标解析：纯逻辑，不依赖 React / DOM。
// 判定三类信息：
//   1. 一个块是否为「Agent Block」（term 块 + agent:* meta）；
//   2. 本次 Send 是「直接注入聚焦块」还是「新建 agent block」；
//   3. Folder 候选从哪些块的 cwd 收集。
// 与原型 design/prototypes/commontext/commontext-send-agent-block/ 的解析规则一致。

export type AgentBlockInfo = {
    blockId: string;
    provider: string;
    model: string | null;
    cwd: string | null;
    connection: string | null;
    /** 会话标题 / 块标题兜底用的展示名（可选） */
    title: string | null;
};

type AgentBlockLike = {
    oid?: string;
    meta?: Record<string, unknown> | null;
};

function readString(meta: Record<string, unknown>, key: string): string {
    const value = meta?.[key];
    return typeof value === "string" ? value.trim() : "";
}

/**
 * 与 session-overview 的 isAgentMeta 同语义，但只认 term 块：
 * `view=agent` 是 GUI 聊天块，不在本功能范围（无 TUI 可注入）。
 */
export function extractAgentBlockInfo(
    block: AgentBlockLike | null | undefined,
    blockId?: string
): AgentBlockInfo | null {
    if (block == null) return null;
    const meta = block.meta ?? {};
    if (meta.view !== "term") return null;
    const provider = readString(meta, "agent:provider");
    const sessionId = readString(meta, "agent:sessionid");
    const autoresume = meta["agent:autoresume"] === true;
    if (provider === "" && sessionId === "" && !autoresume) return null;
    const model = readString(meta, "agent:requestedmodel");
    const cwd = readString(meta, "cmd:cwd");
    const connection = readString(meta, "connection");
    const title =
        readString(meta, "frame:title") ||
        readString(meta, "display:name") ||
        (typeof meta.file === "string" ? meta.file : "");
    return {
        blockId: blockId ?? block.oid ?? "",
        provider: (provider || readCommandProvider(meta)).toLowerCase(),
        model: model === "" ? null : model,
        cwd: cwd === "" ? null : cwd,
        connection: connection === "" ? null : connection,
        title: title === "" ? null : title,
    };
}

function readCommandProvider(meta: Record<string, unknown>): string {
    const cmd = typeof meta.cmd === "string" ? meta.cmd : "";
    if (cmd.trim() === "") return "agent";
    const normalized = cmd.trim().replace(/\\/g, "/");
    const parts = normalized.split("/");
    return (parts[parts.length - 1] ?? "").replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase();
}

/**
 * profile 名 → provider 名。agent-launch.ts 用 cmd basename 作为 provider，
 * 这里对常见别名做一次归一（anthropic≈claude 需要上游 resolveAgentProvider 的 settings 才能精确判定，
 * 调用方应优先传 providerFromProfile；无 settings 时退化为小写比较）。
 */
export function normalizeProviderKey(value: string | null | undefined): string {
    return (value ?? "").trim().toLowerCase();
}

export type SendTabSelection =
    | { kind: "current" }
    | { kind: "existing"; tabId: string; tabName?: string }
    | { kind: "new"; tabName?: string };

export type SendTargetSelection = {
    /** 选中的 agent profile 名（如 claude/codex/pi） */
    agentProfile: string;
    /** 与 agentProfile 等价的 provider 名；缺省时按 profile 小写比较 */
    provider?: string | null;
    tab: SendTabSelection;
    /** 目标 cwd；空字符串表示「跟随聚焦块」 */
    folder: string | null;
    /**
     * 强制新建：true 时即使三项与聚焦块全等也不落 existing。
     * 面板里的「新建 Agent Block」显式选项靠这个——否则选了与聚焦块同款 agent 时
     * 无法从「聚焦块」切到「新建」（2026-11-11 用户反馈）。
     */
    forceCreate?: boolean;
};

export type ResolvedSendTarget =
    | { kind: "existing"; label: string; block: AgentBlockInfo }
    | { kind: "create"; label: string; tab: SendTabSelection; cwd: string };

/** `~` 展开成给定 home；其余原样（统一正斜杠、去尾斜杠）。 */
export function normalizeCwd(cwd: string | null | undefined, homeDir?: string | null): string {
    const value = (cwd ?? "").trim();
    if (value === "") return "";
    if (value === "~") {
        return homeDir != null && homeDir !== "" ? stripTrailingSlash(homeDir) : value;
    }
    if (value.startsWith("~/") || value.startsWith("~\\")) {
        const rest = value.slice(2);
        return homeDir != null && homeDir !== "" ? joinPath(homeDir, rest) : stripTrailingSlash(value);
    }
    return stripTrailingSlash(value.replace(/\\/g, "/"));
}

function joinPath(base: string, rest: string): string {
    const trimmedBase = base.replace(/[\\/]+$/, "");
    return stripTrailingSlash(`${trimmedBase}/${rest}`);
}

function stripTrailingSlash(value: string): string {
    return value.length > 1 ? value.replace(/[\\/]+$/, "") : value;
}

export function cwdEqual(a: string | null | undefined, b: string | null | undefined, homeDir?: string | null): boolean {
    const left = stripTrailingSlash(normalizeCwd(a, homeDir));
    const right = stripTrailingSlash(normalizeCwd(b, homeDir));
    return left !== "" && left === right;
}

function tabLabel(tab: SendTabSelection): string {
    if (tab.kind === "current") return "当前 Tab";
    if (tab.kind === "new") return "新 Tab";
    return tab.tabName != null && tab.tabName !== "" ? tab.tabName : "Tab";
}

/**
 * 解析本次 Send 的落点：
 *   existing 当且仅当 !forceCreate
 *     && 聚焦块是 agent block
 *     && provider 匹配所选 profile
 *     && tab 为当前 Tab
 *     && folder 与聚焦块 cwd 相同（folder 为空 = 跟随聚焦块）
 *   其余一律 create。
 */
export function resolveSendTarget(
    selection: SendTargetSelection,
    focusedAgent: AgentBlockInfo | null,
    opts?: { homeDir?: string | null; profileLabel?: string | null }
): ResolvedSendTarget {
    const label = opts?.profileLabel ?? selection.agentProfile;
    const profileProvider = normalizeProviderKey(selection.provider ?? selection.agentProfile);
    const folder = selection.folder ?? "";
    if (
        selection.forceCreate !== true &&
        focusedAgent != null &&
        normalizeProviderKey(focusedAgent.provider) === profileProvider &&
        selection.tab.kind === "current" &&
        (folder === "" ? true : cwdEqual(folder, focusedAgent.cwd, opts?.homeDir))
    ) {
        return { kind: "existing", label: `聚焦 ${label}`, block: focusedAgent };
    }
    const cwd = folder === "" ? (focusedAgent?.cwd ?? "") : folder;
    return {
        kind: "create",
        label: `新建 ${label} · ${tabLabel(selection.tab)}${cwd === "" ? "" : ` · ${cwd}`}`,
        tab: selection.tab,
        cwd,
    };
}

export type FolderCandidate = {
    path: string;
    /** 展示用次级说明：聚焦块 / 项目 / 主目录 / 当前工作区 */
    note: string;
};

type FolderCandidateBlock = {
    blockId: string;
    info: AgentBlockInfo;
};

/**
 * Folder 候选：聚焦块 cwd 优先，其次本 Tab 内其他 agent/term 块的 cwd，最后 workspace cwd / home。
 * 去重按 normalizeCwd 后的值；空值忽略。
 */
export function collectFolderCandidates(input: {
    focusedAgent: AgentBlockInfo | null;
    blocks?: FolderCandidateBlock[] | null;
    workspaceCwd?: string | null;
    homeDir?: string | null;
}): FolderCandidate[] {
    const seen = new Set<string>();
    const out: FolderCandidate[] = [];
    const push = (path: string | null | undefined, note: string) => {
        const normalized = normalizeCwd(path, input.homeDir);
        if (normalized === "") return;
        if (seen.has(normalized)) return;
        seen.add(normalized);
        out.push({ path: normalized, note });
    };
    if (input.focusedAgent != null) {
        push(input.focusedAgent.cwd, "聚焦块目录");
    }
    for (const block of input.blocks ?? []) {
        push(block.info.cwd, "项目");
    }
    push(input.workspaceCwd, "当前工作区");
    if (input.homeDir != null) {
        push(input.homeDir, "主目录");
    }
    return out;
}

/** 默认 Folder：聚焦块 cwd → 当前工作区 cwd → 空。 */
export function defaultSendFolder(focusedAgent: AgentBlockInfo | null, workspaceCwd?: string | null): string {
    if (focusedAgent?.cwd != null && focusedAgent.cwd !== "") return focusedAgent.cwd;
    return (workspaceCwd ?? "").trim();
}
