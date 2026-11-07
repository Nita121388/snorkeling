// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 「指针离开 header 后去了哪里」的判据。
//
// 为什么单独一个文件：它要摸 Node/Element（DOM），而 header-hover-latch.ts
// 是纯函数、跑在 node 环境里做穷举单测。混在一起会让纯函数测试被迫拖进 jsdom。
//
// 为什么需要它（实测结论，别改成「靠菜单自己先 FREEZE」）：
// 溢出菜单走 blockEnv.showContextMenu，portal 到 body、与 header 互为兄弟节点。
// Playwright + Edge 实测事件顺序：
//
//   hdr:pointerenter
//   hdr:pointerleave related=DIV      ← 先到
//   menu:pointerenter related=hdr     ← 后到
//
// 也就是说 header 的 pointerleave 先触发，宽限定时器已经启动，指望菜单的
// pointerenter 来 FREEZE 已经晚了一步（graceMs=0 时更是直接丢状态）。
// 所以必须在 onPointerLeave 里先查 relatedTarget 是否落在附属层内。

/**
 * 指针是否正移进某个「附属层」（溢出菜单 / 浮层工具条）。
 *
 * @param related  PointerEvent.relatedTarget
 * @param attachedEls 附属层的根元素（未挂载时可为 null）
 */
export function isLeavingToAttachedLayer(
    related: EventTarget | null,
    attachedEls: (Element | null | undefined)[]
): boolean {
    if (!(related instanceof Node)) {
        return false;
    }
    for (const el of attachedEls) {
        if (el != null && el.contains(related)) {
            return true;
        }
    }
    return false;
}
