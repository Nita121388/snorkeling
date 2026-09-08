// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 属性值编辑浮层（通用外壳）：定位 + 尺寸 + 关闭语义。
//
// 用 @floating-ui/react 直接实现，而不是 app/element/popover.tsx：
// 后者把 children 强制包成 Button、内部自管 isOpen，且 .popover-content 固定 min-height:150px，
// 与「锚定到值单元格 + 内容自适应」的属性编辑场景不匹配。
//
// 浮层走 FloatingPortal 挂到 body：避免被 Markdown 容器 overflow 裁切。

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
import "./property-value-popover.scss";

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

    const dismiss = useDismiss(context, { outsidePress: true, escapeKey: true });
    const { getFloatingProps } = useInteractions([dismiss]);

    if (!open) return null;

    return (
        <FloatingPortal>
            <div
                ref={refs.setFloating}
                style={floatingStyles}
                className={clsx("property-value-popover", className)}
                {...getFloatingProps()}
            >
                {children}
            </div>
        </FloatingPortal>
    );
}
