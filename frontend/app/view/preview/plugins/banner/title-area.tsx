// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Title Area 组件 - 在 emoji 下方，属性上方显示笔记标题

import { memo } from "react";

type TitleAreaProps = {
    /** 笔记标题 */
    title: string;
    /** 可选：文档 emoji */
    emoji?: string | null;
};

export const TitleArea = memo(function TitleArea({ title, emoji }: TitleAreaProps) {
    return (
        <div className="snorkeling-title-area">
            <div className="snorkeling-title">
                <div className="snorkeling-title-text">{title}</div>
            </div>
        </div>
    );
});
