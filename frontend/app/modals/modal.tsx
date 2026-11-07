// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Modal — 全仓唯一的弹窗壳（frontend/app/modals/modal.tsx）。
//
// 契约（docs/design-system.md §8「Modal, Popover, and Menu」）：
//   - Dialog layout is header, scrollable content, and footer.
//   - Footer actions do not move when content overflows.
//   - Do not place cards inside modal cards; use unframed sections.
//
// 形状：
//   .modal (flex column, max-height)
//     ├─ .modal-header      仅当 title/subtitle/headerExtra 任一存在时渲染；✕ 在流内
//     ├─ .content-wrapper   flex:1 min-h-0；滚动发生在这里
//     └─ .modal-footer      仅当 footer 或 onOk/onCancel 存在时渲染；shrink-0
//
// 兼容：不传 title/subtitle/headerExtra 的老弹窗保持原形状（含 ✕ 的绝对定位老位置），
// 以免一次性改动 20+ 个弹窗的版式。新弹窗必须走结构化 header。
//
// Modal 已并入本文件并删除（它的 .Content/.Footer 全仓 0 使用）。
// element/modal.tsx 是独立死代码，已删除。

import { Button } from "@/app/element/button";
import { cn } from "@/util/util";
import { forwardRef, useId } from "react";
import ReactDOM from "react-dom";

import "./modal.scss";

interface ModalProps {
    children?: React.ReactNode;
    okLabel?: string;
    cancelLabel?: string;
    className?: string;
    style?: React.CSSProperties;
    /** 点 backdrop 关闭。优先级高于 closeOnBackdrop。 */
    onClickBackdrop?: () => void;
    /** 点 backdrop 关闭（onClickBackdrop 未提供时回落调 onClose）。默认 false。 */
    closeOnBackdrop?: boolean;
    onOk?: () => void;
    onCancel?: () => void;
    /** 关闭回调。有值才渲染 ✕ —— 不会再出现「✕ 渲染出来但点了没反应」。 */
    onClose?: () => void;
    okDisabled?: boolean;
    cancelDisabled?: boolean;

    // ── 结构化 header / footer ──
    /** header 标题（同时作为 aria-labelledby 目标）。有值即启用结构化 header。 */
    title?: React.ReactNode;
    /** header 副标题。 */
    subtitle?: React.ReactNode;
    /** header 右侧、✕ 左侧的插槽（状态点 / 模型名 / 徽标）。 */
    headerExtra?: React.ReactNode;
    /** 自定义 footer 内容（替代 ok/cancel 按钮组）。 */
    footer?: React.ReactNode;

    /** 内容区内边距。默认 true（--modal-padding）；false → .modal--flush 由调用方自己管。 */
    padding?: boolean;
    /** 内容区滚动。默认 true。自带滚动容器或固定高度的调用方传 false。 */
    scrollBody?: boolean;
}

const Modal = forwardRef<HTMLDivElement, ModalProps>(
    (
        {
            children,
            className,
            style,
            cancelLabel,
            okLabel,
            onCancel,
            onOk,
            onClose,
            onClickBackdrop,
            closeOnBackdrop = false,
            okDisabled,
            cancelDisabled,
            title,
            subtitle,
            headerExtra,
            footer,
            padding = true,
            scrollBody = true,
        }: ModalProps,
        ref
    ) => {
        const reactId = useId();
        const titleId = `modal-title-${reactId}`;
        const hasStructuredHeader = title != null || subtitle != null || headerExtra != null;

        const backdropClick =
            onClickBackdrop ?? (closeOnBackdrop && onClose != null ? onClose : undefined);
        const renderBackdrop = (onClick?: () => void) => (
            <div className="modal-backdrop" onClick={onClick}></div>
        );

        const renderFooter = () => footer != null || onOk != null || onCancel != null;

        const closeButton = (extraClassName: string) => (
            <button
                type="button"
                className={cn("modal-close", extraClassName)}
                onClick={onClose}
                title="Close (ESC)"
                aria-label="Close"
            >
                <i className="fa-sharp fa-solid fa-xmark" />
            </button>
        );

        const renderModal = () => (
            <div className="modal-wrapper">
                {renderBackdrop(backdropClick)}
                <div
                    ref={ref}
                    className={cn(
                        "modal",
                        !padding && "modal--flush",
                        !scrollBody && "modal--no-scroll",
                        className
                    )}
                    style={style}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={title != null ? titleId : undefined}
                    // 阻断冒泡回 block：Modal 通过 createPortal 挂到 #main，但在 React 组件树里
                    // 仍是 block 的后代。若不拦截，点击弹窗内任意处会冒泡到 block frame 的
                    // onClick → setBlockClickedTrue → setFocusTarget()，把焦点抢回 block 的
                    // dummy-focus 输入框，导致弹窗内 textarea 无法聚焦/输入。
                    onClick={(e) => e.stopPropagation()}
                >
                    {hasStructuredHeader ? (
                        <div className="modal-header">
                            <div className="modal-header__text">
                                {title != null ? (
                                    <div className="modal-header__title" id={titleId}>
                                        {title}
                                    </div>
                                ) : null}
                                {subtitle != null ? (
                                    <div className="modal-header__subtitle">{subtitle}</div>
                                ) : null}
                            </div>
                            {headerExtra != null ? (
                                <div className="modal-header__extra">{headerExtra}</div>
                            ) : null}
                            {onClose != null ? closeButton("modal-close--inline") : null}
                        </div>
                    ) : onClose != null ? (
                        // 老形状：✕ 绝对定位在右上角。仅为 20+ 个既有弹窗保留原版式，
                        // 新弹窗请用 title/subtitle 走结构化 header。
                        <Button className="grey ghost modal-close-btn" onClick={onClose} title="Close (ESC)">
                            <i className="fa-sharp fa-solid fa-xmark"></i>
                        </Button>
                    ) : null}
                    <div className="content-wrapper">
                        <div className="modal-content">{children}</div>
                    </div>
                    {renderFooter() ? (
                        <footer className="modal-footer">
                            {footer}
                            {onCancel != null && (
                                <Button className="grey ghost" onClick={onCancel} disabled={cancelDisabled}>
                                    {cancelLabel ?? "Cancel"}
                                </Button>
                            )}
                            {onOk != null && (
                                <Button onClick={onOk} disabled={okDisabled}>
                                    {okLabel ?? "Ok"}
                                </Button>
                            )}
                        </footer>
                    ) : null}
                </div>
            </div>
        );

        return ReactDOM.createPortal(renderModal(), document.getElementById("main"));
    }
);

Modal.displayName = "Modal";

export { Modal };

export type { ModalProps };
