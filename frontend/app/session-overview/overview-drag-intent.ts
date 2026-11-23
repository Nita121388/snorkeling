// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview 看板卡跨 Tab 拖拽的纯逻辑（design/11-23 nita 拍板：拖到目标 Tab 组 = 移动块）。
//
// 为什么单独成模块：拖拽契约有三处易错点（payload 编解码、落点判定、拖起阈值与内部控件排除），
// 全是纯输入→输出，放在渲染层里只能靠点击手感验证。这里锁成纯函数，渲染层只做 DOM 事件接线；
// 真正的移动调用走既有 `waveEnv.services.object.MoveBlockToTab`，本模块不碰 RPC。
//
// 复盘：这份文件的判据由 `overview-board-drag.test.ts` 覆盖（纯函数 + DOM 两段）。

/** 拖起判定阈值：位移小于它一律视为点击（防止「想开弹窗结果误拖动」）。 */
export const DragStartThresholdPx = 6;

/** dataTransfer 里承载的拖拽载荷（同一 Tab 内拖拽同样走这条）。 */
export type DragPayload = {
    blockId: string;
    /** 拖起时卡片所在的 Tab（用于「拖回原列 = 无操作」判定）。 */
    fromTabId: string;
};

export type DropResolution =
    | { kind: "move"; blockId: string; fromTabId: string; toTabId: string }
    | { kind: "none"; reason: "no-payload" | "no-target" | "same-tab" };

const PayloadSeparator = "\u0000";

/** 编码成单一字符串，避免 dataTransfer 多类型在不同平台上的兼容差异。 */
export function encodeDragPayload(payload: DragPayload): string {
    return `${payload.blockId}${PayloadSeparator}${payload.fromTabId}`;
}

/** 解析 dataTransfer 字符串；坏数据一律返回 null（不抛错、不半解析）。 */
export function decodeDragPayload(raw: string | null | undefined): DragPayload | null {
    if (typeof raw !== "string" || raw === "") return null;
    const index = raw.indexOf(PayloadSeparator);
    if (index <= 0) return null;
    const blockId = raw.slice(0, index);
    const fromTabId = raw.slice(index + PayloadSeparator.length);
    if (blockId === "" || fromTabId === "") return null;
    return { blockId, fromTabId };
}

/**
 * 落点判定：目标 Tab 存在且与原 Tab 不同才算 move；其余一律 none 且不产生任何副作用
 * （PRD：拖到当前 Tab / 空白处必须 0 次变更）。
 */
export function resolveDropIntent(
    payload: DragPayload | null | undefined,
    targetTabId: string | null | undefined
): DropResolution {
    if (payload == null || payload.blockId === "" || payload.fromTabId === "") {
        return { kind: "none", reason: "no-payload" };
    }
    const toTabId = (targetTabId ?? "").trim();
    if (toTabId === "") return { kind: "none", reason: "no-target" };
    if (toTabId === payload.fromTabId) return { kind: "none", reason: "same-tab" };
    return { kind: "move", blockId: payload.blockId, fromTabId: payload.fromTabId, toTabId };
}

/**
 * 位移是否已经越过拖起阈值（用勾股距离，斜拖同样按真实距离算）。
 * 非有限数按「没动」处理，避免 NaN 让卡片永远判成拖拽中。
 */
export function isDragDisplacementBeyondThreshold(
    dx: number,
    dy: number,
    threshold: number = DragStartThresholdPx
): boolean {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
    return Math.hypot(dx, dy) >= threshold;
}

/** 拖起源的最小判定描述（纯数据，便于单测；不要在纯函数里读真 DOM）。 */
export type DragOriginDescriptor = {
    tagName: string;
    isContentEditable?: boolean;
    /** 卡片内部的显式交互热区（与 11-20 卡片点击热区同一口径）。 */
    dataCardInteractive?: boolean;
};

const BlockedOriginTags = new Set(["BUTTON", "A", "INPUT", "TEXTAREA", "SELECT"]);

/**
 * 内部控件上不启动拖拽：按钮/链接/输入/可编辑区/`[data-card-interactive]`。
 * 与卡片点击热区白名单同源，避免「拖得动却点不开」或「点得开却一拖就飞」。
 */
export function isDragBlockedOrigin(origin: DragOriginDescriptor | null | undefined): boolean {
    if (origin == null) return false;
    if (origin.isContentEditable === true || origin.dataCardInteractive === true) return true;
    return BlockedOriginTags.has(String(origin.tagName ?? "").toUpperCase());
}
