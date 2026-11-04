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
