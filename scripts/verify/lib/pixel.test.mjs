// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 验证台像素内核的最小单测（node:test 风格，与 scripts/*.test.mjs 一致）。
//
// 锁定的行为是 2026-11-05 夜间踩到的坑：Chromium 在窗口失焦/遮挡时，
// 带 clip 的 `captureScreenshot` 会返回**尺寸完全正确但内容是纯背景**的 PNG。
// 下游 `inkProfile` 因此得到 0 行带 → pixel-zero-shift 假红、pixel-visual-parity 假绿。
// `inkPixelCount` 就是识别"空片"的那个度量，必须有测试兜着。

import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import { inkPixelCount, inkProfile } from "./pixel.mjs";

function solidPng(width, height, rgb) {
    const png = new PNG({ width, height });
    for (let i = 0; i < width * height; i++) {
        png.data[i * 4] = rgb[0];
        png.data[i * 4 + 1] = rgb[1];
        png.data[i * 4 + 2] = rgb[2];
        png.data[i * 4 + 3] = 255;
    }
    return png;
}

function withGlyphRow(png, y, x0, x1, rgb) {
    for (let x = x0; x < x1; x++) {
        const i = (y * png.width + x) * 4;
        png.data[i] = rgb[0];
        png.data[i + 1] = rgb[1];
        png.data[i + 2] = rgb[2];
    }
    return png;
}

test("inkPixelCount is ~0 for a pure-background capture (the blank-clip symptom)", () => {
    const blank = solidPng(120, 20, [17, 17, 17]);
    assert.equal(inkPixelCount(blank), 0);
    assert.equal(inkProfile(blank).bands.length, 0);
});

test("inkPixelCount counts glyph pixels and ignores a faint 1px border only if below tol", () => {
    const dark = [17, 17, 17];
    const text = solidPng(120, 20, dark);
    // 行带少于 3px 会被 inkProfile 当噪点丢掉，这里画 4 行模拟真实字形高度
    for (let y = 8; y < 12; y++) withGlyphRow(text, y, 10, 60, [230, 230, 230]);
    assert.equal(inkPixelCount(text), 200);
    assert.equal(inkProfile(text).bands.length, 1);

    // 一条几乎不可见的边框（亮度差 10 < tol 24）不该算成"有内容"
    const faintBorder = solidPng(120, 20, dark);
    withGlyphRow(faintBorder, 0, 0, 120, [27, 27, 27]);
    assert.equal(inkPixelCount(faintBorder), 0);
});

test("a frame-only capture stays under the blank threshold used by observe.mjs", () => {
    // 空片 + 绿色 accent 边框（实测 60+ 像素）会让"整片 ink"误判，所以 observe 只看文本区。
    // 这里固定该事实：整片 ink 不为 0，但文本区（中部）为 0。
    const dark = [17, 17, 17];
    const framed = solidPng(120, 20, dark);
    withGlyphRow(framed, 0, 0, 120, [80, 200, 90]);
    withGlyphRow(framed, 19, 0, 120, [80, 200, 90]);
    assert.ok(inkPixelCount(framed) >= 200);

    const textArea = { x: 40, y: 4, width: 76, height: 12 };
    const onlyText = solidPng(textArea.width, textArea.height, dark);
    assert.equal(inkPixelCount(onlyText), 0);
});
