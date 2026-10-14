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

/**
 * heading 根的**唯一真源形态**（className + 身份属性）。
 *
 * A3 在位编辑的 EditableBlock 必须命中与预览**完全相同**的根形态（同一套样式），
 * 而 heading 是唯一一个根带额外 data-* 的块（`data-heading-level` / `data-heading-id`），
 * 也是唯一一个有两层结构（`.heading` > `.heading-title`）的块。
 *
 * 因此把形态判定抽到这里，由预览渲染器与 EditableBlock **共同调用**：
 * 今后新增/重命名一个根属性，两边自动跟随，不存在「抄漏一条」的可能。
 * （此前 EditableBlock 手抄了 srcLineAttrs，已在退化节点上与真源分叉，见其文件注释。）
 */
export function headingRootAttrs(props: any, hnum: number, collapsed = false) {
    const headingId = typeof props?.id === "string" ? props.id : "";
    return {
        className: clsx("heading", `is-${hnum}`, { collapsed }),
        "data-heading-level": hnum,
        "data-heading-id": headingId,
    };
}

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
            {...headingRootAttrs(props, hnum, collapsed)}
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