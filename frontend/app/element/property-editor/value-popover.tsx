// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 属性值编辑浮层（通用外壳）：定位 + 尺寸 + 关闭语义。
//
// 共享层：md 预览属性卡与 AI 会话属性面板共用。
//
// 用 @floating-ui/react 直接实现，而不是 app/element/popover.tsx：
// 后者把 children 强制包成 Button、内部自管 isOpen，且 .popover-content 固定 min-height:150px，
// 与「锚定到值单元格 + 内容自适应」的属性编辑场景不匹配。
//
// 浮层走 FloatingPortal 挂到 body：避免被 Markdown 容器 overflow 裁切。
// 因此它在信息卡（InfoCard）的 DOM 之外 —— 靠 `data-info-card-attached` 标记
// 让 useInfoCardHover 把它当成卡内（见 component-guidelines §10）：否则鼠标移到浮层上
// 会被判成「离开卡片」，300ms 后收卡、锚点消失、编辑器当场消失。

import {
    autoUpdate,
    flip,
    FloatingPortal,
    offset,
    shift,
    size,
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import clsx from "clsx";
import { useEffect } from "react";
import { useInfoCardPin } from "@/app/element/info-card/info-card-hover";
import "./value-popover.scss";

type PropertyValuePopoverProps = {
    open: boolean;
    /** 锚点（属性值单元格）。 */
    anchor: HTMLElement | null;
    onClose: () => void;
    children: React.ReactNode;
    className?: string;
};

const PopoverMaxWidth = 399;

export function PropertyValuePopover({ open, anchor, onClose, children, className }: PropertyValuePopoverProps) {
    const pinHandle = useInfoCardPin();
    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange: (next) => {
            if (!next) onClose();
        },
        placement: "bottom-start",
        middleware: [
            offset(4),
            flip({ padding: 8 }),
            shift({ padding: 8 }),
            size({
                padding: 8,
                apply({ availableWidth, elements }) {
                    const width = Math.max(240, Math.min(PopoverMaxWidth, availableWidth));
                    elements.floating.style.maxWidth = `${width}px`;
                },
            }),
        ],
        whileElementsMounted: autoUpdate,
    });

    useEffect(() => {
        if (anchor != null) refs.setReference(anchor);
    }, [anchor, refs]);

    // 在信息卡（悬浮卡）里打开时 pin 住卡片：浮层在卡片 DOM 之外，
    // 不 pin 的话鼠标移到浮层上会被当成“离开卡片”，300ms 后收卡。
    useEffect(() => {
        if (!open) return;
        pinHandle.pin();
        return () => pinHandle.release();
    }, [open, pinHandle]);

    const dismiss = useDismiss(context, { outsidePress: true, escapeKey: true });
    const { getFloatingProps } = useInteractions([dismiss]);

    if (!open) return null;

    return (
        <FloatingPortal>
            <div
                ref={refs.setFloating}
                style={floatingStyles}
                className={clsx("property-value-popover", className)}
                data-info-card-attached="true"
                {...getFloatingProps()}
            >
                {children}
            </div>
        </FloatingPortal>
    );
}
