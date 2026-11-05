// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 图片预览翻页 —— 纯逻辑层（无 DOM、无 RPC、无状态），全部可单测。
//
// 契约：
//   排序必须与目录预览"所见即所得"：name → TanStack alphanumeric（数字段按数值）；
//   modtime → 修改时间降序。比较器按 TanStack compareAlphanumeric 逐位复刻。
//   默认只翻本层；"下一站" = 目录树先序（目录名序）中下一个含图片的文件夹。

export type ImagePagerSort = "name" | "modtime";

/** 图片扩展名白名单（小写、无点）。 */
export const IMAGE_EXTENSIONS = new Set([
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "avif",
    "bmp",
    "svg",
    "ico",
    "tiff",
    "heic",
]);

/** 遍历时跳过的目录名（不分大小写）与 "." 开头规则。 */
export const SKIP_DIRS = new Set([
    "node_modules",
    ".git",
    ".cache",
    ".svn",
    ".hg",
    "dist",
    "build",
    "out",
    "target",
    ".venv",
    "venv",
    "__pycache__",
    ".idea",
    ".vscode",
    "coverage",
]);

/** 硬上限：防大目录卡死（UI 需提示截断）。 */
export const PAGER_LIMITS = {
    maxImages: 5000,
    maxDepth: 8,
    /** 已列举目录数上限：锚点在图片稀少的根（如 explorer-root="/"）时防止 DFS 无限扫 */
    maxDirs: 500,
    cacheTtlMs: 60_000,
} as const;

export function isImagePath(path: string): boolean {
    const dot = path.lastIndexOf(".");
    if (dot < 0) {
        return false;
    }
    const ext = path.slice(dot + 1).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
}

export function isSkipDir(name: string): boolean {
    if (name == null || name === "") return false;
    if (name.startsWith(".")) return true;
    return SKIP_DIRS.has(name.toLowerCase());
}

// ---------------------------------------------------------------------------
// 排序：与目录预览逐对一致
// ---------------------------------------------------------------------------

const reSplitAlphaNumeric = /([0-9]+)/g;

/**
 * TanStack table-core `compareAlphanumeric` 的逐位复刻。
 * 目录预览 name 列用 `sortingFn: "alphanumeric"`（先 toLowerCase 再比较），
 * 翻页顺序必须逐字符一致，否则"列表里第 2 张"和"下一张"会对不上。
 */
export function compareAlphanumeric(aStr: string, bStr: string): number {
    const a = aStr.split(reSplitAlphaNumeric).filter(Boolean);
    const b = bStr.split(reSplitAlphaNumeric).filter(Boolean);
    while (a.length && b.length) {
        const aa = a.shift();
        const bb = b.shift();
        const an = parseInt(aa, 10);
        const bn = parseInt(bb, 10);
        const combo = [an, bn].sort();
        // 两段都是字符串
        if (isNaN(combo[0])) {
            if (aa > bb) return 1;
            if (bb > aa) return -1;
            continue;
        }
        // 一段是字符串一段是数字：数字在前
        if (isNaN(combo[1])) {
            return isNaN(an) ? -1 : 1;
        }
        // 两段都是数字
        if (an > bn) return 1;
        if (bn > an) return -1;
    }
    return a.length - b.length;
}

export function compareImageNames(a: string, b: string): number {
    return compareAlphanumeric(a.toLowerCase(), b.toLowerCase());
}

/** 目录预览两种默认排序的等价比较器（name: alphanumeric 升序；modtime: 降序）。 */
export function compareBySort(sort: ImagePagerSort): (a: PagerEntry, b: PagerEntry) => number {
    if (sort === "modtime") {
        // modtime 相等时返回 0 保持稳定原序（与目录表格的稳定排序一致，不引入 name 重排）
        return (a, b) => {
            const am = a.modtime ?? 0;
            const bm = b.modtime ?? 0;
            if (am > bm) return -1;
            if (bm > am) return 1;
            return 0;
        };
    }
    return (a, b) => compareImageNames(a.name ?? "", b.name ?? "");
}

// ---------------------------------------------------------------------------
// 序列构造
// ---------------------------------------------------------------------------

/** 最小目录条目形状（FileListCommand 返回的 FileInfo 字段子集）。 */
export type PagerEntry = {
    path: string;
    name: string;
    isdir?: boolean;
    modtime?: number;
};

/** 本层图片序列：当前目录下所有图片文件，按目录预览同款排序。 */
export function buildLayer(entries: PagerEntry[], sort: ImagePagerSort): string[] {
    return entries
        // 隐藏文件（. 开头）目录预览默认不显示，翻页序列也不该有它（所见即所得）
        .filter((e) => !e.isdir && !e.name.startsWith(".") && isImagePath(e.name))
        .sort(compareBySort(sort))
        .map((e) => e.path);
}

/**
 * 站点先序遍历顺序：子目录名按 alphanumeric 升序，DFS。
 * 返回值：按遍历顺序排列的子目录（跳过噪音目录），供索引进站时用同一顺序。
 */
export function orderedSubdirs(entries: PagerEntry[]): PagerEntry[] {
    return entries
        .filter((e) => e.isdir && !isSkipDir(e.name))
        .sort((a, b) => compareImageNames(a.name ?? "", b.name ?? ""));
}

/** 站点：一个含图片的目录（按目录树先序排好）。 */
export type StationInfo = {
    dir: string;
    /** 该目录的完整图片序列（排序后）。"本层"翻页就用它 —— 必须是每个站点各自的，
     *  否则跨站后当前图不在锚点层里，计数器会退化成 "— / —"（真机验证实测踩到）。 */
    images: string[];
    first: string; // = images[0]
    last: string; // = images[images.length-1]
    count: number;
};

/** 解析翻页状态。currentPath 未命中本层时 position = -1（仍可跨站）。 */
export type PagerResolution = {
    position: number; // 本层下标（-1 = 不在本层）
    next: string | null; // 本层下一张
    prev: string | null; // 本层上一张
    nextStation: StationInfo | null; // 下一个含图文件夹（null = 全树到底）
    prevStation: StationInfo | null;
    currentStation: StationInfo | null;
    atLayerStart: boolean;
    atLayerEnd: boolean;
    layerSize: number;
    /** 实际使用的"本层"序列（Home/End 用它，不能用锚点层——跨站后语义就错了）。 */
    layer: string[];
};

/** 当前图片所在目录（路径的父目录，兼容 / 与 \\）。 */
export function parentDirOf(filePath: string): string {
    const p = (filePath ?? "").replace(/\\/g, "/");
    if (p === "" || p === "/") return "/";
    // 已是目录（带尾分隔符）保留目录本身
    const trimmed = p.replace(/\/+$/, "");
    if (trimmed === "") return "/";
    if (trimmed === "/") return "/";
    const idx = trimmed.lastIndexOf("/");
    if (idx < 0) return trimmed; // 相对路径但无分隔符：把自身当做目录
    if (idx === 0) return "/"; // 根目录下的文件或目录
    return trimmed.slice(0, idx);
}

/** 是否文件系统根（posix `/`、Windows 盘符根 `C:`/`C:\`、UNC `\\server\share`）。 */
export function isRootPath(path: string): boolean {
    const s = (path ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
    if (s === "" || s === "/") return true;
    if (/^[A-Za-z]:$/.test(s)) return true;
    // UNC：\\server\share 视为根（再往上只剩 \\server 服务器名，无意义）
    if (/^\/\/[^/]+\/[^/]+$/.test(s)) return true;
    return false;
}

/** 末段可读名（根目录回退到自身）。 */
export function shortDirName(dir: string): string {
    const s = (dir ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
    if (s === "" || s === "/") return "/";
    const idx = s.lastIndexOf("/");
    return idx >= 0 ? s.slice(idx + 1) || "/" : s;
}

export type PagerAnchorInput = {
    /** block meta `preview:explorer-root`：从目录预览进入时的根（最高优先）。 */
    explorerRoot?: unknown;
    /** block meta `preview:image-pager-anchor`：上次落盘的粘性锚点。 */
    stickyAnchor?: unknown;
    filePath: string;
    isRoot?: (p: string) => boolean;
};

/**
 * 锚点解析（翻页范围的事实来源）。
 *
 * 1. `explorer-root` → 用它
 * 2. 粘性锚点且当前图仍在其子树内 → 用它（跨站后目录树不塌缩）
 * 3. 否则**提升一级**：图片目录的父目录 —— 让同级兄弟文件夹进入站点序列。
 *    站点 = 锚点子树，锚点若停在图片目录上，兄弟目录结构性不可达（不是索引没建好）。
 *    走到文件系统根时不再提升，避免整盘扫描。
 */
export function resolvePagerAnchor({ explorerRoot, stickyAnchor, filePath, isRoot = isRootPath }: PagerAnchorInput): string {
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+\//g, "/");
    const trim = (p: string) => p.replace(/[\\/]+$/, "") || p;

    if (typeof explorerRoot === "string" && explorerRoot.trim() !== "") {
        return trim(explorerRoot);
    }

    const dir = parentDirOf(filePath);

    if (typeof stickyAnchor === "string" && stickyAnchor.trim() !== "") {
        const sticky = trim(stickyAnchor);
        const np = norm(filePath);
        const ns = norm(sticky);
        if (np === ns || np.startsWith(ns.replace(/\/$/, "") + "/")) {
            return sticky;
        }
    }

    const up = parentDirOf(dir);
    if (up === dir || isRoot(up)) return dir;
    return up;
}

/** 气泡文案上下文：只取 resolvePager 结果里的判定位，不依赖索引状态类型（防循环 import）。 */
export type PagerHintTexts = {
    prev: string;
    next: string;
    refresh: string;
    counter: string;
};

/**
 * 悬停气泡文案（纯函数，单测锁文案）。
 * 四要素：动作 + 快捷键 + 目标/范围 + 当前状态 —— 置灰态必须解释"为什么点不动"。
 */
export function buildPagerHintTexts(res: PagerResolution, filePath: string, anchor: string): PagerHintTexts {
    const pos = res.position;
    const size = res.layerSize;
    const atStart = res.prev == null && res.prevStation == null;
    const atEnd = res.next == null && res.nextStation == null;

    const prev = res.prev != null
        ? `上一张（←） · ${pos}/${size}`
        : res.prevStation != null
          ? `上一站：${displayStationDir(res.prevStation.dir, anchor)}（${res.prevStation.count} 张） · Shift+←`
          : atStart
            ? `本层已是第一张；锚点 ${anchor} 下没有更早的含图片文件夹`
            : `上一张（←）`;

    const next = res.next != null
        ? `下一张（→） · ${pos + 2}/${size}`
        : res.nextStation != null
          ? `进入下一站：${displayStationDir(res.nextStation.dir, anchor)}（${res.nextStation.count} 张） · 按 → 或 Shift+→`
          : atEnd
            ? `本层已是最后一张；锚点 ${anchor} 下没有更多含图片文件夹`
            : `下一张（→）`;

    const positionText = pos >= 0 ? `第 ${pos + 1}/${size} 张` : "索引中…";

    return {
        prev,
        next,
        refresh: "重建索引（Shift+R） · 缓存 60s",
        counter: `${positionText} · ${filePath} · 锚点：${shortDirName(anchor)}`,
    };
}

export function resolvePager(
    anchorLayer: string[],
    stations: StationInfo[],
    currentPath: string,
    normalize: (p: string) => string = (p) => p
): PagerResolution {
    const norm = normalize(currentPath);
    const normDir = normalize(parentDirOf(currentPath));
    const si = stations.findIndex((s) => normalize(s.dir) === normDir);
    // “本层”= 当前图片所在目录的图片序列。站点还没建到（索引进行中）时退回锚点层。
    const layer = si >= 0 ? stations[si].images : anchorLayer;
    const position = layer.findIndex((p) => normalize(p) === norm);
    const next = position >= 0 && position + 1 < layer.length ? layer[position + 1] : null;
    const prev = position > 0 ? layer[position - 1] : null;
    return {
        position,
        next,
        prev,
        nextStation: si >= 0 && si + 1 < stations.length ? stations[si + 1] : null,
        prevStation: si > 0 ? stations[si - 1] : null,
        currentStation: si >= 0 ? stations[si] : null,
        atLayerStart: position <= 0,
        // position=-1（当前图不在任何已建站点）也按"到层尾"处理，让用户从下一站续读
        atLayerEnd: position < 0 || position >= layer.length - 1,
        layerSize: layer.length,
        layer,
    };
}

/** 显示用：相对锚点的目录名（短）。Windows 路径先归一为 /。 */
export function displayStationDir(stationPath: string, anchor: string): string {
    const norm = (s: string) => (s ?? "").replace(/\\/g, "/").replace(/\/+\//g, "/");
    const sp = norm(stationPath);
    const ap = norm(anchor);
    if (sp === ap) return ".";
    if (sp.startsWith(ap + "/")) {
        return sp.slice(ap.length + 1);
    }
    const lastSlash = sp.lastIndexOf("/");
    return lastSlash >= 0 ? sp.slice(lastSlash + 1) : sp;
}

/**
 * 站点排序：确定性 DFS 先序（父目录先于子目录，同级按自然序）。
 *
 * 为什么不能用"发现顺序"：索引是并发 3 列目录，完成顺序不确定 →
 * 「下一站」会跳到随机文件夹（真机验证实测踩到：本层末尾的下一站直接跳到了
 * sub/deep 而不是 sub）。路径逐段自然序比较恰好等于先序遍历：
 *   /a  <  /a/1.png 所在层  <  /a/sub  <  /a/sub/deep  <  /a/zz
 */
export function compareStationPaths(a: string, b: string): number {
    const as = a.split(/[\\/]+/).filter(Boolean);
    const bs = b.split(/[\\/]+/).filter(Boolean);
    const n = Math.min(as.length, bs.length);
    for (let i = 0; i < n; i++) {
        const c = compareImageNames(as[i], bs[i]);
        if (c !== 0) return c;
    }
    return as.length - bs.length;
}

/** 插入并按 DFS 先序保持有序（增量发布时的稳定顺序）。 */
export function insertStationSorted(stations: StationInfo[], station: StationInfo): StationInfo[] {
    const next = stations.slice();
    let lo = 0;
    let hi = next.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (compareStationPaths(next[mid].dir, station.dir) <= 0) lo = mid + 1;
        else hi = mid;
    }
    next.splice(lo, 0, station);
    return next;
}

// ---------------------------------------------------------------------------
// 跨站浮出提示（模块级 store）
//
// 为什么不能放组件 state：翻页会触发 block meta 更新 → 预览视图重挂 → 组件
// state 丢失，toast 一闪都没来得及显示（真机验证实测：toast 恒为 null）。
// 模块级 store + useSyncExternalStore 让重挂后仍能读到当前提示。
// ---------------------------------------------------------------------------

const TOAST_MS = 1500;
let toastText: string | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const toastListeners = new Set<() => void>();

function notifyToast() {
    for (const cb of toastListeners) {
        try {
            cb();
        } catch {
            // 单个订阅者抛错不影响其它
        }
    }
}

export function showPagerToast(text: string): void {
    toastText = text;
    if (toastTimer != null) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toastText = null;
        toastTimer = null;
        notifyToast();
    }, TOAST_MS);
    notifyToast();
}

export function getPagerToast(): string | null {
    return toastText;
}

export function subscribePagerToast(cb: () => void): () => void {
    toastListeners.add(cb);
    return () => {
        toastListeners.delete(cb);
    };
}
