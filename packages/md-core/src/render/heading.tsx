// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import { domProps, srcLineAttrs } from "./shared";

export type HeadingProps = {
    props: React.HTMLAttributes<HTMLHeadingElement>;
    hnum: number;
    collapsed: boolean;
    onToggle: (headingId: string) => void;
};

export const CollapsibleHeading = ({ props, hnum, collapsed, onToggle }: HeadingProps) => {
    const headingId = typeof props.id === "string" ? props.id : "";
    return (
        <div
            // step3：heading 不走默认可编辑块路径（专有 <div class="heading"> 包装），必须显式
            // 转发 remarkBlockIds 打的块身份（hast `dataBlockId` → `data-block-id`），否则标题
            // 在 DOM 上没有 data-block-id，提交前就无法按身份重定位。展开放在最前：显式属性
            // （id/className/…）必须覆盖 props 的同名值，行为与改动前一致。
            {...domProps(props)}
            id={props.id}
            className={clsx("heading", `is-${hnum}`, { collapsed })}
            data-heading-level={hnum}
            data-heading-id={headingId}
            {...srcLineAttrs(props)}
        >
            <button
                type="button"
                className="heading-collapse-button"
                title={collapsed ? "Expand section" : "Collapse section"}
                aria-label={collapsed ? "Expand section" : "Collapse section"}
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (headingId) {
                        onToggle(headingId);
                    }
                }}
            >
                <i className={clsx("fa-sharp fa-solid", collapsed ? "fa-chevron-right" : "fa-chevron-down")} />
            </button>
            <span className="heading-title">{props.children}</span>
        </div>
    );
};