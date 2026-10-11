// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isBlank, makeIconClass } from "@/util/util";
import { autoUpdate, flip, FloatingPortal, offset, shift, useFloating } from "@floating-ui/react";
import { memo, useCallback, useEffect, useRef } from "react";
import type { InlineTabStatusDot } from "./inlinetab-agent-status";

type TabInfo = {
    id: string;
    title: string;
    /** Full path + connection for the row tooltip; falls back to `title`. */
    tooltip?: string;
    icon: string;
    isActive: boolean;
    /** Connection meta, used for the remote badge label. */
    connection?: string;
    /** Non-local connection → show the remote dot badge on the row icon. */
    isRemote?: boolean;
    /** Agent status dot (shared presentation rules with the strip labels). */
    statusDot?: InlineTabStatusDot;
};

type InlineTabDropdownMenuProps = {
    tabs: TabInfo[];
    activeTabId: string;
    /** Ref to the trigger element (the "more" pill or default caret button). */
    anchorRef: React.RefObject<HTMLElement>;
    /** Whether the dropdown menu is open. */
    isOpen: boolean;
    /** Callback to toggle the dropdown open state. */
    onOpenChange: (open: boolean) => void;
    onSelect: (blockId: string) => void;
    /** Optional per-item close (删除) action; rendered as a hover-revealed × on each row. */
    onClose?: (blockId: string) => void;
    /** Optional ack action for the agent status dot; mirrors the strip label behavior. */
    onStatusAck?: (blockId: string) => void;
};

/**
 * Floating dropdown menu listing all tabs in an inline tab group.
 * Rendered via FloatingPortal; anchored to the element referenced by `anchorRef`.
 * The trigger (button/pill that opens it) is rendered by the parent component.
 */
export const InlineTabDropdownMenu = memo(
    ({
        tabs,
        activeTabId,
        anchorRef,
        isOpen,
        onOpenChange,
        onSelect,
        onClose,
        onStatusAck,
    }: InlineTabDropdownMenuProps) => {
        const menuRef = useRef<HTMLDivElement>(null);

        const { refs, floatingStyles } = useFloating({
            open: isOpen,
            onOpenChange,
            placement: "bottom-end",
            middleware: [offset(4), flip(), shift({ padding: 8 })],
            whileElementsMounted: autoUpdate,
            elements: {
                reference: anchorRef.current,
            },
        });

        // Re-sync reference element when anchorRef changes (pill visibility toggles)
        useEffect(() => {
            refs.setReference(anchorRef.current);
        }, [anchorRef, refs, isOpen]);

        // 点击外部关闭菜单
        useEffect(() => {
            if (!isOpen) {
                return;
            }
            const onPointerDown = (e: PointerEvent) => {
                const target = e.target as HTMLElement;
                if (anchorRef.current?.contains(target) || menuRef.current?.contains(target)) {
                    return;
                }
                onOpenChange(false);
            };
            const onKeyDown = (e: KeyboardEvent) => {
                if (e.key === "Escape") {
                    onOpenChange(false);
                }
            };
            window.addEventListener("pointerdown", onPointerDown, true);
            window.addEventListener("keydown", onKeyDown, true);
            return () => {
                window.removeEventListener("pointerdown", onPointerDown, true);
                window.removeEventListener("keydown", onKeyDown, true);
            };
        }, [isOpen, onOpenChange, anchorRef]);

        const handleSelect = useCallback(
            (blockId: string) => {
                onSelect(blockId);
                onOpenChange(false);
            },
            [onSelect, onOpenChange]
        );

        // 删除某一项: 与标签上的 × 走同一条 uxCloseBlock 链路 (含脏数据确认), 删除后关闭菜单
        const handleClose = useCallback(
            (blockId: string) => {
                onClose?.(blockId);
                onOpenChange(false);
            },
            [onClose, onOpenChange]
        );

        // 键盘导航
        const handleKeyDown = useCallback(
            (e: React.KeyboardEvent) => {
                if (!isOpen) {
                    return;
                }

                const menuItems = menuRef.current?.querySelectorAll(".inline-tab-block-dropdown-item");
                if (!menuItems?.length) {
                    return;
                }

                const currentIndex = Array.from(menuItems).findIndex((item) => item === document.activeElement);

                switch (e.key) {
                    case "ArrowDown": {
                        e.preventDefault();
                        const nextIndex = currentIndex < menuItems.length - 1 ? currentIndex + 1 : 0;
                        (menuItems[nextIndex] as HTMLElement).focus();
                        break;
                    }
                    case "ArrowUp": {
                        e.preventDefault();
                        const prevIndex = currentIndex > 0 ? currentIndex - 1 : menuItems.length - 1;
                        (menuItems[prevIndex] as HTMLElement).focus();
                        break;
                    }
                    case "Home": {
                        e.preventDefault();
                        (menuItems[0] as HTMLElement).focus();
                        break;
                    }
                    case "End": {
                        e.preventDefault();
                        (menuItems[menuItems.length - 1] as HTMLElement).focus();
                        break;
                    }
                    // Delete/Backspace: 删除当前聚焦项 (悬浮 × 按钮不在 Tab 顺序内, 用键盘同样可达)
                    case "Delete":
                    case "Backspace": {
                        if (onClose == null || currentIndex < 0) {
                            return;
                        }
                        e.preventDefault();
                        const target = menuItems[currentIndex] as HTMLElement;
                        const blockId = target.getAttribute("data-blockid");
                        if (isBlank(blockId)) {
                            return;
                        }
                        onClose(blockId);
                        onOpenChange(false);
                        break;
                    }
                }
            },
            [isOpen, onClose, onOpenChange]
        );

        if (!isOpen) {
            return null;
        }

        return (
            <FloatingPortal>
                <div
                    ref={(node) => {
                        menuRef.current = node;
                        refs.setFloating(node);
                    }}
                    style={{ ...floatingStyles, zIndex: 1000 }}
                    className="inline-tab-block-dropdown-menu"
                    role="menu"
                    aria-label="All tabs"
                    onKeyDown={handleKeyDown}
                >
                    {tabs.map((tab) => {
                        const statusDot = tab.statusDot;
                        const ackable = statusDot != null && (statusDot.unread || statusDot.doneUnread);
                        return (
                            <div
                                key={tab.id}
                                data-blockid={tab.id}
                                className={`inline-tab-block-dropdown-item ${tab.isActive ? "active" : ""}`}
                                role="menuitem"
                                tabIndex={0}
                                title={tab.tooltip ?? tab.title}
                                aria-label={tab.title}
                                onClick={() => handleSelect(tab.id)}
                            >
                                <span className="dropdown-item-icon">
                                    <i className={makeIconClass(tab.icon, true)} />
                                    {tab.isRemote && (
                                        <span
                                            className="inline-tab-block-dropdown-remote-dot"
                                            title={`Remote: ${tab.connection ?? ""}`}
                                            aria-label="Remote connection"
                                        />
                                    )}
                                </span>
                                <span className="dropdown-item-name">{tab.title}</span>
                                {statusDot != null && (
                                    <span
                                        className={`dropdown-item-status is-${statusDot.state} ${
                                            statusDot.inferred ? "is-inferred" : ""
                                        } ${statusDot.unread ? "is-unread" : "is-acked"} ${
                                            statusDot.doneUnread ? "is-done-unread" : ""
                                        }`}
                                        data-elapsed={statusDot.doneUnread ? statusDot.doneElapsedText : undefined}
                                        title={statusDot.title}
                                        role={ackable ? "button" : undefined}
                                        onClick={
                                            ackable && onStatusAck
                                                ? (e) => {
                                                      // 必须阻止冒泡: 否则会连带触发外层菜单项的「切换到该 tab」
                                                      e.preventDefault();
                                                      e.stopPropagation();
                                                      onStatusAck(tab.id);
                                                  }
                                                : undefined
                                        }
                                    >
                                        {statusDot.state === "done" ? <i className="fa-solid fa-check" /> : null}
                                    </span>
                                )}
                                {onClose != null && (
                                    <button
                                        type="button"
                                        className="dropdown-item-close"
                                        title={`Close ${tab.title}`}
                                        aria-label={`Close ${tab.title}`}
                                        tabIndex={-1}
                                        onClick={(e) => {
                                            // 必须阻止冒泡: 否则会连带触发外层菜单项的「切换到该 tab」
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleClose(tab.id);
                                        }}
                                    >
                                        <i className={makeIconClass("xmark", true)} />
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            </FloatingPortal>
        );
    }
);

InlineTabDropdownMenu.displayName = "InlineTabDropdownMenu";
