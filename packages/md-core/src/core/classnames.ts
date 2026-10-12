// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * classnames 组合工具（md-core 抽离 P0 · C2）。
 *
 * 实现与 `@/util/util` 的 `cn` 逐字节一致（`twMerge(clsx(inputs))`，同两库、同调用顺序），
 * 之所以在本模块再放一份：`markdown-render/**` 不得静态 import `@/util`（宿主通用工具），
 * 而 `clsx` / `tailwind-merge` 是第三方包，核心层可以直接依赖。
 *
 * Phase B：若 md-core 需要保留 class 合并语义，本文件随包搬走即可（零宿主依赖）。
 */

import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}
