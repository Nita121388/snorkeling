// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 像素层：只做三件事 —— 裁切、墨迹剖面、差异图。
//
// 为什么不做"整图逐像素相等"：编辑态和阅读态的文本由不同 DOM 渲染（contentEditable vs
// 渲染树），抗锯齿会有亚像素差异，整图比对必然误报。真正与 bug 相关的唯一量是
// "每一行文字的起点 x"，所以这里用"墨迹剖面"：逐行取最左非背景像素。

import { PNG } from "pngjs";
import { readFileSync, writeFileSync } from "node:fs";

export function readPng(file) {
    return PNG.sync.read(readFileSync(file));
}

export function writePng(file, png) {
    writeFileSync(file, PNG.sync.write(png));
}

function clampRect(rect, png) {
    const x = Math.max(0, Math.min(Math.round(rect.x), png.width - 1));
    const y = Math.max(0, Math.min(Math.round(rect.y), png.height - 1));
    const width = Math.max(1, Math.min(Math.round(rect.width), png.width - x));
    const height = Math.max(1, Math.min(Math.round(rect.height), png.height - y));
    return { x, y, width, height };
}

export function cropPng(png, rect) {
    const r = clampRect(rect, png);
    const out = new PNG({ width: r.width, height: r.height });
    PNG.bitblt(png, out, r.x, r.y, r.width, r.height, 0, 0);
    return out;
}

/**
 * 把整窗高清截图归一化到 CSS 像素空间。
 *
 * 为什么需要：CDP 的 clip 截图在高分屏/窗口被遮挡时会静默失效，退回整窗 2x 图。
 * 下游所有规则都用 CSS 坐标（getBoundingClientRect），坐标系统一为 CSS 才成立。
 * 整窗图 2680px 对应视口 1340px → factor=0.5。
 *
 * 缩小用**面积平均**（box filter），不用最近邻：最近邻会把 0.3px 级的亚像素
 * 错位放大成整像素翻转（抗锯齿边缘整片抖动，实测 parity 假红 5~12%）；
 * 面积平均让亚像素噪声在降采样时自然抵消，而字形/字重的真实差异保留。
 */
export function scalePng(png, factor) {
    if (!(factor > 0) || Math.abs(factor - 1) < 1e-6) return png;
    const width = Math.max(1, Math.round(png.width * factor));
    const height = Math.max(1, Math.round(png.height * factor));
    const out = new PNG({ width, height });
    if (factor < 1) {
        const stepX = png.width / width;
        const stepY = png.height / height;
        for (let y = 0; y < height; y++) {
            const y0 = y * stepY;
            const y1 = y0 + stepY;
            const iy0 = Math.floor(y0);
            const iy1 = Math.min(png.height, Math.max(iy0 + 1, Math.ceil(y1)));
            for (let x = 0; x < width; x++) {
                const x0 = x * stepX;
                const x1 = x0 + stepX;
                const ix0 = Math.floor(x0);
                const ix1 = Math.min(png.width, Math.max(ix0 + 1, Math.ceil(x1)));
                let r = 0, g = 0, b = 0, a = 0, area = 0;
                for (let sy = iy0; sy < iy1; sy++) {
                    const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
                    for (let sx = ix0; sx < ix1; sx++) {
                        const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
                        const w = wx * wy;
                        const src = (png.width * sy + sx) << 2;
                        r += png.data[src] * w;
                        g += png.data[src + 1] * w;
                        b += png.data[src + 2] * w;
                        a += png.data[src + 3] * w;
                        area += w;
                    }
                }
                const dst = (width * y + x) << 2;
                out.data[dst] = Math.round(r / area);
                out.data[dst + 1] = Math.round(g / area);
                out.data[dst + 2] = Math.round(b / area);
                out.data[dst + 3] = Math.round(a / area);
            }
        }
        return out;
    }
    // 放大保持最近邻（验证台不会走到，仅为类型完备）
    for (let y = 0; y < height; y++) {
        const sy = Math.min(png.height - 1, Math.floor(y / factor));
        for (let x = 0; x < width; x++) {
            const sx = Math.min(png.width - 1, Math.floor(x / factor));
            const src = (png.width * sy + sx) << 2;
            const dst = (width * y + x) << 2;
            out.data[dst] = png.data[src];
            out.data[dst + 1] = png.data[src + 1];
            out.data[dst + 2] = png.data[src + 2];
            out.data[dst + 3] = png.data[src + 3];
        }
    }
    return out;
}

function pixelAt(png, x, y) {
    const idx = (png.width * y + x) << 2;
    return {
        r: png.data[idx],
        g: png.data[idx + 1],
        b: png.data[idx + 2],
        a: png.data[idx + 3],
    };
}

function luminance(p) {
    return 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
}

/** 背景色 = 顶行出现最多的颜色（列表行的背景就是面板底色，顶行一定是纯背景）。 */
export function detectBackground(png) {
    const counts = new Map();
    for (let x = 0; x < png.width; x++) {
        const p = pixelAt(png, x, 0);
        const key = `${p.r},${p.g},${p.b}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let best = null;
    let bestCount = -1;
    for (const [key, count] of counts) {
        if (count > bestCount) {
            best = key;
            bestCount = count;
        }
    }
    const [r, g, b] = best.split(",").map(Number);
    return { r, g, b };
}

/**
 * 墨迹剖面：把图切成"文本行带"，每带给出最左墨迹 x。
 * 探针 = 与背景色亮度差 > tol 的像素。
 */
export function inkProfile(png, { tol = 24, chromeColumnRatio = 0.8 } = {}) {
    const bg = detectBackground(png);
    const bgLum = luminance(bg);
    const isInkAt = (x, y) => Math.abs(luminance(pixelAt(png, x, y)) - bgLum) > tol;

    // 先找出"镀层列"：整列几乎全是墨迹的竖条（例如 inline-edit-active 的 accent 竖线）。
    // 它们会把所有文本行连成一条、并且劫持"最左墨迹 x"，必须剔除。
    const colInk = new Array(png.width).fill(0);
    for (let y = 0; y < png.height; y++) {
        for (let x = 0; x < png.width; x++) {
            if (isInkAt(x, y)) colInk[x]++;
        }
    }
    const chromeCol = colInk.map((n) => n / png.height >= chromeColumnRatio);

    const rowHasInk = new Array(png.height).fill(false);
    const rowInkLeft = new Array(png.height).fill(-1);

    for (let y = 0; y < png.height; y++) {
        for (let x = 0; x < png.width; x++) {
            if (chromeCol[x]) continue;
            if (isInkAt(x, y)) {
                rowHasInk[y] = true;
                if (rowInkLeft[y] < 0) rowInkLeft[y] = x;
            }
        }
    }

    const bands = [];
    let start = -1;
    for (let y = 0; y <= png.height; y++) {
        const has = y < png.height ? rowHasInk[y] : false;
        if (has && start < 0) start = y;
        if (!has && start >= 0) {
            const y0 = start;
            const y1 = y - 1;
            start = -1;
            // 太薄的带（1~2px）当噪点丢掉
            if (y1 - y0 + 1 < 3) continue;
            let inkLeft = Number.POSITIVE_INFINITY;
            for (let yy = y0; yy <= y1; yy++) {
                if (rowInkLeft[yy] >= 0 && rowInkLeft[yy] < inkLeft) inkLeft = rowInkLeft[yy];
            }
            const prev = bands[bands.length - 1];
            if (prev != null && y0 - prev.y1 <= 2) {
                // 同一行文本被字形间隙切开 → 合并（否则"行带数量"会随抗锯齿抖动）
                prev.y1 = y1;
                if (Number.isFinite(inkLeft) && (prev.inkLeft < 0 || inkLeft < prev.inkLeft)) prev.inkLeft = inkLeft;
            } else {
                bands.push({ y0, y1, inkLeft: Number.isFinite(inkLeft) ? inkLeft : -1 });
            }
        }
    }
    return { bg, bands, inkBandCount: bands.length, chromeColumns: chromeCol.filter(Boolean).length };
}

/**
 * 逐行带比较"最左墨迹 x"。这是 pixel-zero-shift 规则的实现。
 * 返回 { pass, detail, rows:[{index, before, during, delta}] }
 */
export function compareInkProfiles(beforePng, duringPng, { maxShiftPx = 1.5, tol = 24 } = {}) {
    const a = inkProfile(beforePng, { tol });
    const b = inkProfile(duringPng, { tol });
    const n = Math.min(a.bands.length, b.bands.length);
    const rows = [];
    let maxDelta = 0;
    let worst = null;
    for (let i = 0; i < n; i++) {
        const delta = Math.abs(b.bands[i].inkLeft - a.bands[i].inkLeft);
        rows.push({ index: i, before: a.bands[i].inkLeft, during: b.bands[i].inkLeft, delta });
        if (delta > maxDelta) {
            maxDelta = delta;
            worst = rows[rows.length - 1];
        }
    }
    // 行带数量差只作证据，不参与判定：裁剪有专门的 no-clip 规则用 scrollHeight/子元素越界判，
    // 用像素行数判会误伤（裁切边缘、抗锯齿都会影响行带切分）。
    const missingLines = a.bands.length - b.bands.length;
    const pass = n > 0 && maxDelta <= maxShiftPx;
    return {
        pass,
        detail:
            `文本行带 before=${a.bands.length} during=${b.bands.length}` +
            `，逐行起点最大位移 ${maxDelta.toFixed(2)}px` +
            (worst != null ? `（第 ${worst.index + 1} 行: ${worst.before}→${worst.during}）` : "") +
            (missingLines > 0 ? `，编辑态行带少 ${missingLines}（仅提示，裁剪由 no-clip 判）` : ""),
        evidence: { maxDelta, maxShiftPx, missingLines, rows, beforeBands: a.bands.length, duringBands: b.bands.length, bg: a.bg },
    };
}

/** 差异图：差异像素标红，其余压暗，便于人复核到底哪里变了。 */
export function diffPng(beforePng, duringPng, { tol = 24 } = {}) {
    const width = Math.min(beforePng.width, duringPng.width);
    const height = Math.min(beforePng.height, duringPng.height);
    const out = new PNG({ width, height });
    let diffCount = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const pa = pixelAt(beforePng, x, y);
            const pb = pixelAt(duringPng, x, y);
            const differs =
                Math.abs(luminance(pa) - luminance(pb)) > tol ||
                Math.abs(pa.r - pb.r) > tol ||
                Math.abs(pa.g - pb.g) > tol ||
                Math.abs(pa.b - pb.b) > tol;
            const idx = (width * y + x) << 2;
            if (differs) {
                diffCount++;
                out.data[idx] = 255;
                out.data[idx + 1] = 40;
                out.data[idx + 2] = 40;
            } else {
                const dark = Math.round(luminance(pa) * 0.25);
                out.data[idx] = dark;
                out.data[idx + 1] = dark;
                out.data[idx + 2] = dark;
            }
            out.data[idx + 3] = 255;
        }
    }
    return { png: out, diffCount, total: width * height };
}

/**
 * 整体视觉一致性：两张同尺寸图里"明显不同"的像素占比。
 * 用于 pixel-visual-parity —— 只比文字起点 x 会漏掉字体/内联样式/行高等差异（真实踩到：
 * 编辑器里 code 丢了等宽字体、strong 字重不同，起点却一样）。
 *
 * 会剔除"镀层列"（整列几乎全是墨迹的竖线，例如 accent 竖条），否则它会被算成大面积差异。
 */
export function diffRatio(a, b, { tol = 24, chromeColumnRatio = 0.8 } = {}) {
    const width = Math.min(a.width, b.width);
    const height = Math.min(a.height, b.height);
    if (width === 0 || height === 0) return { ratio: 0, diffPixels: 0, total: 0, chromeColumns: 0 };

    const inkOf = (png, x, y) => Math.abs(luminance(pixelAt(png, x, y)) - luminance(detectBackground(png))) > tol;
    const colInkA = new Array(width).fill(0);
    const colInkB = new Array(width).fill(0);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (inkOf(a, x, y)) colInkA[x]++;
            if (inkOf(b, x, y)) colInkB[x]++;
        }
    }
    const isChrome = (x) => colInkA[x] / height >= chromeColumnRatio || colInkB[x] / height >= chromeColumnRatio;

    let diffPixels = 0;
    let total = 0;
    let chromeColumns = 0;
    for (let x = 0; x < width; x++) {
        if (isChrome(x)) {
            chromeColumns++;
            continue;
        }
        for (let y = 0; y < height; y++) {
            total++;
            const pa = pixelAt(a, x, y);
            const pb = pixelAt(b, x, y);
            const differs =
                Math.abs(pa.r - pb.r) > tol ||
                Math.abs(pa.g - pb.g) > tol ||
                Math.abs(pa.b - pb.b) > tol;
            if (differs) diffPixels++;
        }
    }
    return {
        ratio: total === 0 ? 0 : diffPixels / total,
        diffPixels,
        total,
        chromeColumns,
    };
}

/**
 * 结构化墨迹统计：用于"编辑态看起来是不是同一段文字"的判定。
 *
 * 为什么不用逐像素比例：亚像素级的 paint 取整会让抗锯齿边缘整片抖动
 * （实测多行文本 5~12% 的差异像素，但字形、位置、颜色全部一致；单行 case 只有 0.01%）。
 * 逐像素比例无法把这种"不可见差异"和真实样式回归分开。
 *
 * 实测分离度（--legacy-css 已知坏样本 vs 正常态，见 2026-11-04 标定）：
 *   墨迹质量比 during/before：正常 1.00~1.11 ｜ 坏样本 0.51 / 0.74 / 1.33
 *   平均墨迹亮度差：          正常 ≤4.2%      ｜ 坏样本 ≤13%
 * 所以判定用「质量比 + 行带边缘 + 行数」，像素比例只作证据留档。
 */
export function inkBandStats(png, { tol = 32 } = {}) {
    const bg = detectBackground(png);
    const isInk = (i) =>
        Math.abs(png.data[i] - bg.r) + Math.abs(png.data[i + 1] - bg.g) + Math.abs(png.data[i + 2] - bg.b) > tol;
    const rows = [];
    let mass = 0;
    let lumSum = 0;
    let minX = Infinity;
    let maxX = -1;
    for (let y = 0; y < png.height; y++) {
        let n = 0;
        let left = -1;
        let right = -1;
        for (let x = 0; x < png.width; x++) {
            const i = (png.width * y + x) << 2;
            if (!isInk(i)) continue;
            n++;
            lumSum += 0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2];
            if (left < 0) left = x;
            right = x;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
        }
        mass += n;
        rows.push({ y, n, left, right });
    }
    // 文本行数：连续有墨迹的行视为一个行带
    let lines = 0;
    let inBand = false;
    const bands = [];
    let cur = null;
    for (const r of rows) {
        if (r.n > 0) {
            if (!inBand) {
                lines++;
                inBand = true;
                cur = { y0: r.y, y1: r.y, left: r.left, right: r.right, mass: 0 };
                bands.push(cur);
            }
            cur.y1 = r.y;
            cur.left = Math.min(cur.left, r.left);
            cur.right = Math.max(cur.right, r.right);
            cur.mass += r.n;
        } else {
            inBand = false;
        }
    }
    return {
        width: png.width,
        height: png.height,
        bg,
        mass,
        lines,
        bands,
        minX: Number.isFinite(minX) ? minX : 0,
        maxX: maxX >= 0 ? maxX : 0,
        meanInkLum: mass > 0 ? lumSum / mass : 0,
    };
}

/** 两图的结构化一致性判定（供 pixel-visual-parity 规则使用）。 */
export function compareInkStructure(beforePng, duringPng, opts = {}) {
    const massRatioTol = opts.massRatioTol ?? 0.18;
    const lumRatioTol = opts.lumRatioTol ?? 0.08;
    const a = inkBandStats(beforePng, opts);
    const b = inkBandStats(duringPng, opts);
    const massRatio = a.mass === 0 && b.mass === 0 ? 1 : b.mass / Math.max(1, a.mass);
    const lumRatio = Math.abs(a.meanInkLum - b.meanInkLum) / Math.max(1, Math.max(a.meanInkLum, b.meanInkLum));
    const linesEqual = a.lines === b.lines;
    const massOk = Math.abs(massRatio - 1) <= massRatioTol;
    const lumOk = lumRatio <= lumRatioTol;
    const edgesOk = Math.abs(a.minX - b.minX) <= 2 && Math.abs(a.maxX - b.maxX) <= 2;
    return {
        pass: linesEqual && massOk && lumOk && edgesOk,
        linesEqual,
        massOk,
        lumOk,
        edgesOk,
        massRatio,
        lumRatio,
        linesBefore: a.lines,
        linesDuring: b.lines,
        before: { mass: a.mass, meanInkLum: a.meanInkLum, minX: a.minX, maxX: a.maxX },
        during: { mass: b.mass, meanInkLum: b.meanInkLum, minX: b.minX, maxX: b.maxX },
    };
}
