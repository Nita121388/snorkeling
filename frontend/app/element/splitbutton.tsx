// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// SplitButton — 单壳双段按钮（主段动作 + caret 段弹层）。
//
// 契约（docs/design-system.md §8）：
//   - 一个视觉壳：容器统一背景/圆角/高度，主段与 caret 段之间是内部分隔线，
//     不再出现「两个独立按钮硬拼出缝隙」的形态。
//   - 弹层用 @floating-ui/react：FloatingPortal 追加到 body 的是**无定位样式**的容器
//     （不是层叠上下文），floating 层显式 zIndex 1000 → 稳定压过 .modal-wrapper(z-index:500)。
//     历史 bug：自建 <div class="fixed inset-0"> 遮罩（position:fixed + z-index:auto 自成
//     层叠上下文）把内部 z-1000 困死在 .modal-wrapper 之下，弹层开了也看不见。
//   - 外点关闭 / Escape 关闭交给 useDismiss（document pointerdown + reference/floating 包含性判断），
//     不再需要全屏遮罩——遮罩正是层叠陷阱的元凶。
//   - 键盘可达：caret Enter/Space/ArrowDown/ArrowUp 开菜单，Escape 关并把焦点还给 caret。

import { FloatingPortal, offset, useDismiss, useFloating, useInteractions, type Placement } from "@floating-ui/react";
import clsx from "clsx";
import { memo, useId, useRef, type ReactNode } from "react";

import "./splitbutton.scss";

export type SplitButtonProps = {
    /** 主段图标（如 paper-plane） */
    icon?: ReactNode;
    /** 主段文字 */
    label: ReactNode;
    /** 主段点击（受控，不由本组件管理） */
    onPrimaryClick: () => void;
    primaryTitle?: string;
    /** 仅禁主段：caret 仍可打开弹层改配置 */
    primaryDisabled?: boolean;
    caretTitle?: string;
    caretAriaLabel?: string;
    /** 弹层受控开关 */
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** 弹层宽度（px），默认 380 */
    menuWidth?: number;
    menuClassName?: string;
    /** 弹层 role=menu 的 aria-label */
    menuLabel?: string;
    placement?: Placement;
    /** 弹层内容；render 拿 { close } 用于「选中后收起」（JSX children 只能是 ReactNode，函数走 render） */
    children?: ReactNode;
    render?: (api: { close: () => void }) => ReactNode;
    className?: string;
};

const SplitButtonComponent = ({
    icon,
    label,
    onPrimaryClick,
    primaryTitle,
    primaryDisabled,
    caretTitle,
    caretAriaLabel,
    open,
    onOpenChange,
    menuWidth = 380,
    menuClassName,
    menuLabel,
    placement = "bottom-end",
    children,
    render,
    className,
}: SplitButtonProps) => {
    const caretRef = useRef<HTMLButtonElement | null>(null);
    const menuId = `split-button-menu-${useId()}`;

    const { refs, floatingStyles, context } = useFloating({
        placement,
        strategy: "fixed",
        open,
        // reason 由 floating-ui 提供（escape-key / outside-press …）。Escape 关闭时把焦点还给 caret，
        // 否则键盘用户关掉菜单后焦点掉到 body。外点关闭不动焦点（用户已经指向别处）。
        onOpenChange: (nextOpen, _event, reason) => {
            onOpenChange(nextOpen);
            if (!nextOpen && reason === "escape-key") {
                caretRef.current?.focus();
            }
        },
        middleware: [offset(6)],
    });
    const dismiss = useDismiss(context, { escapeKey: true, outsidePress: true });
    const { getFloatingProps } = useInteractions([dismiss]);

    const toggleMenu = () => onOpenChange(!open);

    const handleCaretKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) onOpenChange(true);
        }
    };

    return (
        <div
            ref={refs.setReference}
            className={clsx("wave-split-button", className)}
            data-split-button={open ? "open" : "closed"}
        >
            <button
                type="button"
                className="wave-split-button__main"
                onClick={onPrimaryClick}
                disabled={primaryDisabled}
                title={primaryTitle}
            >
                {icon}
                <span className="wave-split-button__label">{label}</span>
            </button>
            <span className="wave-split-button__divider" aria-hidden="true" />
            <button
                ref={caretRef}
                type="button"
                className="wave-split-button__caret"
                onClick={toggleMenu}
                onKeyDown={handleCaretKeyDown}
                title={caretTitle}
                aria-label={caretAriaLabel ?? caretTitle}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
            >
                <i className="fa-solid fa-chevron-down" />
            </button>
            {open ? (
                <FloatingPortal>
                    <div
                        id={menuId}
                        ref={refs.setFloating}
                        role="menu"
                        aria-label={menuLabel}
                        className={clsx("wave-split-button__menu", menuClassName)}
                        style={{ ...floatingStyles, zIndex: "var(--zindex-popover, 1000)", width: menuWidth }}
                        data-split-button-menu=""
                        {...getFloatingProps()}
                    >
                        {render != null ? render({ close: () => onOpenChange(false) }) : children}
                    </div>
                </FloatingPortal>
            ) : null}
        </div>
    );
};

export const SplitButton = memo(SplitButtonComponent);
SplitButton.displayName = "SplitButton";
