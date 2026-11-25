// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 会话消息方块条 —— 列表行与看板卡**共用同一份实现**（11-24 R1 卡列融合）。
//
// 为什么抽出来：列表行（`session-overview.tsx` 的 `MessageSquares`）与看板卡
// （`overview-board.tsx` 的 `BoardCard`）要展示同一种「会话方块」，点击语义也一样
// （打开该条消息）。复制 JSX 意味着两边视觉与交互会各漂各的（历史上 VCS 标记、
// 状态 chip 都吃过这个亏）。
//
// 契约（design §2.1）：
//   · 纯展示 + 一个 `onOpen(seq)` 回调，不自己拿数据、不自己开弹窗；
//   · `overflow > 0` 渲染 `+n`（卡片高度不随消息数跳动）；
//   · `surface="board"` 时给方块补 `data-board-message-square`（真机验证探针锚点）；
//   · 方块必须 `stopPropagation`（否则会触发看板卡的整卡点击 → 开卡片弹窗）；
//   · error / 空 / loading 三态由调用方给文案，本组件只决定结构（与列表 11-22 版
//     逐字符一致：muted 纯文本 vs strip + 可选 spinner）。

import { makeIconClass, cn } from "@/util/util";
import { useTranslation } from "react-i18next";
import * as React from "react";

/** 一条方块的最小数据（不含全文，preview 已裁到 140 字）。 */
export type SessionMessageSquareItem = {
    seq: number;
    role: string;
    /** hover title 用的预览文本（列表侧 ``messagePreview`` 的产物）。 */
    preview: string;
    /** 读屏文案（列表侧 `dialog.messageSeq` 的产物）。 */
    label: string;
};

export type SessionMessageSquaresProps = {
    surface: "row" | "board" | "modal";
    items: readonly SessionMessageSquareItem[];
    /** 已裁掉的条数（渲染 `+n`）。 */
    overflow: number;
    unreadText?: string;
    loading?: boolean;
    emptyText?: string;
    /** 非空时直接渲染错误行（列表侧把 detailState.error 交进来）。 */
    errorText?: string;
    onOpen: (seq: number) => void;
};

/**
 * 会话方块条：`+n` · 方块（user/ai 两种底色）· 未读时长 · loading spinner。
 * 空态一律走 muted 纯文本（不画空 strip），与列表既有视觉零差异。
 */
export function SessionMessageSquares({
    surface,
    items,
    overflow,
    unreadText,
    loading,
    emptyText,
    errorText,
    onOpen,
}: SessionMessageSquaresProps): React.JSX.Element {
    const { t } = useTranslation("session-overview");
    if (errorText != null && errorText !== "") {
        return <div className="session-overview-error">{errorText}</div>;
    }
    if (items.length === 0 && loading !== true) {
        return (
            <div className="session-overview-muted">
                {emptyText != null && emptyText !== "" ? emptyText : t("session-overview:dialog.noPreview")}
            </div>
        );
    }
    return (
        <div className="session-overview-message-strip">
            {overflow > 0 ? <span className="session-overview-more">+{overflow}</span> : null}
            {items.map((item) => (
                <button
                    key={item.seq}
                    type="button"
                    className={cn("session-overview-message-square", item.role === "user" ? "is-user" : "is-ai")}
                    title={item.preview}
                    aria-label={item.label}
                    data-board-message-square={surface === "board" ? "" : undefined}
                    onClick={(event) => {
                        // 方块是"内容"，点它只打开这条消息：绝不冒泡成整卡点击。
                        event.stopPropagation();
                        onOpen(item.seq);
                    }}
                />
            ))}
            {unreadText != null && unreadText !== "" ? (
                <span className="session-overview-unread-time">{unreadText}</span>
            ) : null}
            {loading === true ? (
                <i className={cn(makeIconClass("spinner", false), "session-overview-loading-icon")} />
            ) : null}
        </div>
    );
}
