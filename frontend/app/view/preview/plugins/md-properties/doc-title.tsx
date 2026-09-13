// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 文档兜底标题组件：当笔记正文没有 H1 时，用文件名在属性卡上方补一个干净的标题，
// 避免无标题笔记在预览里"只有地址栏一串半截文件名"的观感。

import { memo } from "react";

type DocTitleProps = {
    /** 显示的标题文本 */
    title: string;
};

export const DocTitle = memo(function DocTitle({ title }: DocTitleProps) {
    return (
        <div className="md-props-doc-title">
            <div className="md-props-doc-title-text">{title}</div>
        </div>
    );
});
