// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import dayjs from "dayjs";

/**
 * 文件大小 / 最后修改时间的通用格式化。
 *
 * 放在 `frontend/util/` 而不是某个 view 目录下，有两个原因：
 *  1. 这类纯函数被多个域复用（Files 树、Files 表格、AI 会话列表），放在 view 里会造成
 *     「treeview → preview → aisessions」这种反向依赖；
 *  2. 本模块只依赖 dayjs，不碰 jotai store / RPC，import 它不会把整棵预览域拖进依赖图。
 *
 * 迁移自 `app/view/aisessions/utils.ts`（formatFileSize）与
 * `app/view/preview/preview-directory-utils.tsx`（getLastModifiedTime），行为逐字保留，
 * 原位置改为 re-export，既有调用方零改动。
 */

/**
 * 把字节数格式化成人类可读的大小，如 `0 B` / `999 B` / `1.5 KB` / `5 MB`。
 *
 * 负数、NaN、null/undefined 返回空串（调用方按「无数据」处理，不显示该行）。
 */
export function formatFileSize(bytes: number | null | undefined): string {
    if (bytes == null || Number.isNaN(bytes)) return "";
    if (bytes < 0) return "";
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, unitIndex);
    const display =
        unitIndex === 0 ? Math.round(value).toString() : value.toFixed(value < 10 ? 1 : 0).replace(/\.0$/, "");
    return `${display} ${units[unitIndex]}`;
}

function padDay(day: number): string {
    return String(day).padStart(2, " ");
}

/**
 * 格式化最后修改时间：同年显示 `Sep 15 14:32`，跨年显示 `2025-12-31`。
 *
 * @param unixMillis unix 毫秒时间戳
 */
export function getLastModifiedTime(unixMillis: number): string {
    const file = dayjs(unixMillis);
    const now = dayjs();

    const day = padDay(file.date());
    const time = file.format("HH:mm");

    if (now.isSame(file, "year")) {
        return `${file.format("MMM")} ${day} ${time}`;
    }

    return `${file.format("YYYY-MM-DD")}`;
}
