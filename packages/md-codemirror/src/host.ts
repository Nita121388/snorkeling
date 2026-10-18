// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * MarkdownEditorHost 的默认实现（行为安全的空实现）。
 *
 * 消费方（journal / Snorkeling）在调用 `createMarkdownEditor` 时传入自己的 host，
 * 覆盖链接导航与图片解析；默认实现保证「不传也能跑」，但链接激活不做事、
 * 图片按原 URL 直出（失败显示占位文案）。
 */

import type { MarkdownEditorHost, MarkdownHostEvent } from "./types";

const DEFAULT_HOST: MarkdownEditorHost = {
    resolveImageSrc(src: string): string | null {
        return src;
    },
    openLink(): void {
        // 默认不导航 —— 消费方接入后才会打开链接。
    },
    onEvent(): boolean {
        return false; // 未处理，内核可兜底
    },
};

/**
 * 取默认宿主（每次返回同一实例，避免重复分配对象抖动）。
 */
export function getDefaultHost(): MarkdownEditorHost {
    return DEFAULT_HOST;
}

/** 合并：只覆盖消费方给了的字段。 */
export function mergeHost(host?: MarkdownEditorHost): MarkdownEditorHost {
    if (host == null) {
        return DEFAULT_HOST;
    }
    return { ...DEFAULT_HOST, ...host };
}

/**
 * 供内部 widget 用的实用函数：发语义事件给宿主。
 * 返回是否被宿主处理。
 */
export function emitHostEvent(host: MarkdownEditorHost, event: MarkdownHostEvent): boolean {
    return host.onEvent != null && host.onEvent(event);
}