// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Emoji Badge 组件 - 从 banner 底部突出显示文档 emoji

import { memo, useCallback } from "react";

type EmojiBadgeProps = {
    /** Emoji 字符 */
    emoji: string;
    /** 点击回调 */
    onClick?: () => void;
};

export const EmojiBadge = memo(function EmojiBadge({ emoji, onClick }: EmojiBadgeProps) {
    const handleClick = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation(); // 阻止事件冒泡到 banner
            onClick?.();
        },
        [onClick]
    );

    return (
        <button
            type="button"
            className="snorkeling-emoji-badge"
            title="Change document emoji"
            aria-label="Document emoji"
            onClick={handleClick}
        >
            <span className="snorkeling-emoji-char">{emoji}</span>
        </button>
    );
});
