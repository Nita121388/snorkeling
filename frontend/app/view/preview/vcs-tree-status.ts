// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 目录树 VCS 变动标记 —— 纯逻辑层（无 DOM、无 RPC），全部可单测。
//
// 契约（D 方案，见 .trellis/tasks/11-04-files-vcs-tree-status/design.md）：
//   文件行：文件名着色（M 橙 / U 绿 / D 红 + 删除线）+ 行尾字母；
//   文件夹行：行尾聚合变更数（干净/非仓库静默，不变色）；
//   一次 RPC 拿全量后同步 O(M) 建两套索引，渲染期 O(1) 查表，滚动/hover 零请求。
//
// 路径形态说明：目录行/文件行的 path 来自 RemoteListEntries，后端做过
// ReplaceHomeDir（home 还原成 "~/"）；而 VCS 数据里的 rootpath/status 是展开后的
// 绝对路径。RemoteVcsRepositoriesRtnData.basepath 正是 rootDir 的展开形态，
// 用它可以建立"绝对路径 → 视图形态"的映射（见 toViewPath）。

/** 回滚开关：置 false 后不发 RPC、不渲染任何标记，回到纯目录视图。 */
export const FILES_VCS_TREE_STATUS_ENABLED = true;

/** 目录切换后发起 RPC 的 debounce（毫秒）。 */
export const VCS_TREE_STATUS_DEBOUNCE_MS = 250;

/** 一次 RPC 的 statuslimit（与后端硬上限 2000 一致）；达到即视为可能截断。 */
export const VCS_TREE_STATUS_LIMIT = 2000;

/** 子目录扫描深度：当前目录 + 两层子目录，覆盖"子目录是独立仓库"的场景。 */
export const VCS_TREE_STATUS_SCAN_DEPTH = 2;

/** 缓存 TTL（毫秒）：key = conn|dir；Refresh / VCS 操作成功后主动失效。 */
export const VCS_TREE_STATUS_CACHE_TTL_MS = 10_000;

/** RPC 超时（毫秒）：VCS 扫描失败不该拖住目录视图。 */
export const VCS_TREE_STATUS_RPC_TIMEOUT_MS = 30_000;

export type VcsTreeMark = "M" | "U" | "D";

/** 聚合计数时跳过的目录名（小写比较）：这些目录内的变更不计数、也不标记。 */
export const VCS_TREE_STATUS_NOISE_DIRS: ReadonlySet<string> = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    "target",
    ".venv",
    "out",
    "coverage",
]);

export interface VcsTreeStatus {
    /** 视图形态的文件绝对路径 → 状态码（行渲染 O(1) 查表） */
    fileMark: Map<string, VcsTreeMark>;
    /** 视图形态的目录绝对路径 → 其下变更文件总数（止于 rootDir） */
    dirCount: Map<string, number>;
    /** 各仓库根（视图形态；rootDir 之外的仓库保留原样） */
    repoRoots: Set<string>;
    /** 任一仓库 status 达到 statuslimit：计数可能不完整 */
    truncated: boolean;
}

/**
 * 归一化路径分隔符与首尾空白：`\` → `/`，去掉尾部分隔符（根除外）。
 * 不做大小写折叠（VCS 路径大小写敏感），也不折叠中间重复斜杠（兼容 UNC）。
 */
export function normalizeVcsPath(path: string | null | undefined): string {
    if (path == null) {
        return "";
    }
    let out = path.replace(/\\/g, "/").trim();
    while (out.length > 1 && out.endsWith("/")) {
        out = out.slice(0, -1);
    }
    return out;
}

/**
 * 状态码规约：
 *   untracked 或 code 为 `??` / `?` → U；
 *   code 含 D → D；
 *   其余（M/A/R/C 等）→ M —— 树上"新增/重命名待提交"与修改一样需要人处理，
 *   D 方案只区分 M/U/D 三态（原型语义）。
 */
export function classifyVcsFileStatus(entry: { code?: string; untracked?: boolean } | null | undefined): VcsTreeMark {
    const code = (entry?.code ?? "").trim().toUpperCase();
    if (entry?.untracked === true || code === "??" || code === "?") {
        return "U";
    }
    if (code.includes("D")) {
        return "D";
    }
    return "M";
}

/** 路径拼接：rel 允许以 `/` 或 `./` 开头；base 为空时直接返回 rel。 */
function joinVcsPath(base: string, rel: string): string {
    let cleanedRel = rel;
    while (cleanedRel.startsWith("./")) {
        cleanedRel = cleanedRel.slice(2);
    }
    while (cleanedRel.startsWith("/")) {
        cleanedRel = cleanedRel.slice(1);
    }
    if (cleanedRel === "") {
        return base;
    }
    if (base === "") {
        return cleanedRel;
    }
    if (base.endsWith("/")) {
        return base + cleanedRel;
    }
    return base + "/" + cleanedRel;
}

/** 取父目录；`/`、`C:` 等根返回空串表示到头。 */
function vcsParentDir(path: string): string {
    const idx = path.lastIndexOf("/");
    if (idx < 0) {
        return "";
    }
    if (idx === 0) {
        return "/";
    }
    return path.slice(0, idx);
}

/** path 是否位于 dir 之内（含 dir 自身）。 */
export function isUnderVcsDir(path: string, dir: string): boolean {
    if (dir === "" || path === "") {
        return false;
    }
    if (path === dir) {
        return true;
    }
    return path.startsWith(dir.endsWith("/") ? dir : dir + "/");
}

/** 组件序列（去掉空段；根路径返回 []）。 */
function vcsPathComponents(path: string): string[] {
    return path.split("/").filter((c) => c !== "");
}

/** comps 是否以 tail 结尾（组件级比较）。 */
function vcsComponentsEndWith(comps: string[], tail: string[]): boolean {
    if (tail.length === 0 || tail.length > comps.length) {
        return false;
    }
    const offset = comps.length - tail.length;
    for (let i = 0; i < tail.length; i++) {
        if (comps[offset + i] !== tail[i]) {
            return false;
        }
    }
    return true;
}

/**
 * 推测 baseDir 的「已解析」拼写（符号链接展开后的真实路径）。
 *
 * 背景：VCS 后端报的 rootpath 是 realpath（macOS 上 /tmp/... 会被解析成
 * /private/tmp/...，git 对 workdir 一律用 getcwd 的解析结果），而 RPC 的
 * basepath 保留输入拼写（只 Clean/ExpandHome，不 EvalSymlinks）。同一目录两种
 * 拼写对不上时，isUnderVcsDir(absPath, baseDir) 永远失败，索引全空。
 *
 * 推测依据：同一目录的两种拼写共享尾部组件序列，只可能在前缀部分不同。
 *   情形 B（baseDir 在仓库内）：rootpath 以 baseDir 的前缀（输入拼写）结尾，
 *     推测 RB = rootpath + baseDir 去掉前缀后的剩余尾部；
 *   情形 A（仓库根在 baseDir 之内，含相等）：在 rootpath 的祖先里找与 baseDir
 *     共享尾部的最近祖先。
 * 推测不出（尾部对不上）则返回 null，索引退回原始 baseDir 拼写——干净静默。
 */
function resolveResolvedBaseDir(baseDir: string, repoRootAbs: string): string | null {
    // 只对 POSIX 绝对路径做拼写对齐（Windows 盘符路径没有这种前缀解析问题）
    if (!baseDir.startsWith("/") || !repoRootAbs.startsWith("/")) {
        return null;
    }
    const baseComps = vcsPathComponents(baseDir);
    const rootComps = vcsPathComponents(repoRootAbs);
    if (baseComps.length === 0 || rootComps.length === 0) {
        return null;
    }
    // 情形 B：baseDir 在仓库根之内（或相等）
    if (rootComps.length <= baseComps.length) {
        for (let m = 1; m <= rootComps.length; m++) {
            if (vcsComponentsEndWith(rootComps, baseComps.slice(0, m))) {
                return "/" + [...rootComps, ...baseComps.slice(m)].join("/");
            }
        }
        return null;
    }
    // 情形 A：仓库根在 baseDir 之内——从最深祖先往上找共享尾部。
    for (let len = rootComps.length; len >= 1; len--) {
        const ancestor = rootComps.slice(0, len);
        for (let k = 0; k < baseComps.length; k++) {
            if (vcsComponentsEndWith(ancestor, baseComps.slice(k))) {
                return "/" + ancestor.join("/");
            }
        }
    }
    return null;
}

/** 相对路径里只要出现噪音目录段，就整条跳过（node_modules 下的 untracked 尤其多）。 */
function isNoiseVcsRelPath(relPath: string): boolean {
    for (const segment of relPath.split("/")) {
        if (segment === "") {
            continue;
        }
        if (VCS_TREE_STATUS_NOISE_DIRS.has(segment.toLowerCase())) {
            return true;
        }
    }
    return false;
}

export interface BuildVcsTreeStatusOptions {
    /** 当前目录视图的根（行 path 的形态，可能是 `~/...`） */
    rootDir: string;
    /** rootDir 的展开形态（RPC 返回的 basepath）；缺省时按 rootDir 原样处理 */
    baseDir?: string;
    /** 与 RPC 的 statuslimit 一致；达到即标记 truncated */
    statusLimit?: number;
}

/**
 * 一次 RPC 结果 → 两套索引（同趟 O(M)）：
 *   fileMark：文件路径 → M/U/D
 *   dirCount：目录路径 → 其下变更文件数（祖先聚合，止于 rootDir）
 * 视图之外（不在 baseDir 之下）的变更不参与，行只会是 rootDir 的直接子项。
 */
export function buildVcsTreeStatus(
    repositories: VcsRepositoryInfo[] | null | undefined,
    opts: BuildVcsTreeStatusOptions
): VcsTreeStatus {
    const rootDir = normalizeVcsPath(opts.rootDir ?? "");
    const baseDir = normalizeVcsPath(opts.baseDir ?? "") || rootDir;
    const statusLimit = opts.statusLimit ?? 0;

    const fileMark = new Map<string, VcsTreeMark>();
    const dirCount = new Map<string, number>();
    const repoRoots = new Set<string>();
    let truncated = false;

    /** 绝对路径 → 视图形态：优先原始拼写 baseDir，推测不出已解析拼写或对不上时用它。 */
    const toViewPath = (absPath: string, bases: string[]): string => {
        for (const base of bases) {
            if (base === "") {
                continue;
            }
            if (absPath === base) {
                return rootDir;
            }
            if (isUnderVcsDir(absPath, base)) {
                return joinVcsPath(rootDir, absPath.slice(base.length));
            }
        }
        // 视图之外：保留原样（repoRoots 会用到；变更行不会出现）
        return absPath;
    };

    for (const repo of repositories ?? []) {
        if (repo == null) {
            continue;
        }
        const repoRootAbs = normalizeVcsPath(repo.rootpath ?? "");
        if (repoRootAbs === "") {
            continue;
        }
        // baseDir 与 rootpath 可能是同一目录的两种拼写（符号链接解析差异，
        // 典型如 macOS /tmp ↔ /private/tmp）：用 rootpath 推测 baseDir 的已解析形态，
        // 两种拼写都作为映射基准，对不上的那套自然落空。
        const resolvedBaseDir = resolveResolvedBaseDir(baseDir, repoRootAbs);
        const bases = resolvedBaseDir != null && resolvedBaseDir !== baseDir ? [baseDir, resolvedBaseDir] : [baseDir];
        repoRoots.add(toViewPath(repoRootAbs, bases));
        const statuses = repo.status ?? [];
        if (statusLimit > 0 && statuses.length >= statusLimit) {
            truncated = true;
        }
        for (const entry of statuses) {
            if (entry == null) {
                continue;
            }
            const relPath = normalizeVcsPath(entry.path ?? "");
            if (relPath === "" || relPath === ".") {
                continue;
            }
            if (isNoiseVcsRelPath(relPath)) {
                continue;
            }
            const absPath = joinVcsPath(repoRootAbs, relPath);
            const viewPath = toViewPath(absPath, bases);
            if (!isUnderVcsDir(viewPath, rootDir)) {
                continue;
            }
            fileMark.set(viewPath, classifyVcsFileStatus(entry));
            // 目录祖先聚合：从文件父目录一路累加，止于 rootDir（含 rootDir 自身）。
            // D 状态文件已从磁盘消失，行不会渲染，但仍要计入目录数量。
            let dir = vcsParentDir(viewPath);
            while (dir !== "") {
                dirCount.set(dir, (dirCount.get(dir) ?? 0) + 1);
                if (dir === rootDir || dir === "/") {
                    break;
                }
                const parent = vcsParentDir(dir);
                if (parent === dir) {
                    break;
                }
                dir = parent;
            }
        }
    }

    return { fileMark, dirCount, repoRoots, truncated };
}

interface VcsTreeStatusCacheEntry {
    status: VcsTreeStatus;
    at: number;
    /** 记录构建时的 refreshVersion；Refresh 后版本号变化 → 缓存视为失效 */
    refreshVersion?: number;
}

const vcsTreeStatusCache = new Map<string, VcsTreeStatusCacheEntry>();

export function makeVcsTreeStatusCacheKey(conn: string | null | undefined, dir: string | null | undefined): string {
    return `${(conn ?? "").trim()}|${normalizeVcsPath(dir ?? "")}`;
}

export function getCachedVcsTreeStatus(
    conn: string | null | undefined,
    dir: string | null | undefined,
    opts?: { now?: number; refreshVersion?: number }
): VcsTreeStatus | null {
    const key = makeVcsTreeStatusCacheKey(conn, dir);
    const entry = vcsTreeStatusCache.get(key);
    if (entry == null) {
        return null;
    }
    const now = opts?.now ?? Date.now();
    if (now - entry.at > VCS_TREE_STATUS_CACHE_TTL_MS) {
        vcsTreeStatusCache.delete(key);
        return null;
    }
    if (opts?.refreshVersion != null && entry.refreshVersion != null && entry.refreshVersion !== opts.refreshVersion) {
        vcsTreeStatusCache.delete(key);
        return null;
    }
    return entry.status;
}

export function setCachedVcsTreeStatus(
    conn: string | null | undefined,
    dir: string | null | undefined,
    status: VcsTreeStatus,
    opts?: { now?: number; refreshVersion?: number }
): void {
    const at = opts?.now ?? Date.now();
    vcsTreeStatusCache.set(makeVcsTreeStatusCacheKey(conn, dir), {
        status,
        at,
        refreshVersion: opts?.refreshVersion,
    });
    pruneVcsTreeStatusCache(at);
}

/**
 * 缓存剪枝：过期条目只在"再次读到同一 key"时才被删，浏览过的目录若不回访会永久驻留
 * （每条约 statuslimit 条路径）。写入时顺手清过期 + 限制条目数即可。
 */
const VCS_TREE_STATUS_CACHE_MAX_ENTRIES = 32;
function pruneVcsTreeStatusCache(now: number): void {
    for (const [key, entry] of vcsTreeStatusCache) {
        if (now - entry.at > VCS_TREE_STATUS_CACHE_TTL_MS) {
            vcsTreeStatusCache.delete(key);
        }
    }
    if (vcsTreeStatusCache.size <= VCS_TREE_STATUS_CACHE_MAX_ENTRIES) {
        return;
    }
    const victims = [...vcsTreeStatusCache.entries()]
        .sort((a, b) => a[1].at - b[1].at)
        .slice(0, vcsTreeStatusCache.size - VCS_TREE_STATUS_CACHE_MAX_ENTRIES);
    for (const [key] of victims) {
        vcsTreeStatusCache.delete(key);
    }
}

/**
 * 失效缓存：给定 dir 时只清该条；给定 conn 时清该连接全部；都不给则全清。
 * Refresh 与 VCS 操作（提交/同步）成功后调用。
 */
export function clearVcsTreeStatusCache(conn?: string | null, dir?: string | null): void {
    if (dir != null) {
        vcsTreeStatusCache.delete(makeVcsTreeStatusCacheKey(conn, dir));
        return;
    }
    if (conn == null) {
        vcsTreeStatusCache.clear();
        return;
    }
    const prefix = `${conn.trim()}|`;
    for (const key of [...vcsTreeStatusCache.keys()]) {
        if (key.startsWith(prefix)) {
            vcsTreeStatusCache.delete(key);
        }
    }
}
