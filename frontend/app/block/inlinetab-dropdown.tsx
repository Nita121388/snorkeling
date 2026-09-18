// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { makeIconClass } from "@/util/util";
import { autoUpdate, flip, FloatingPortal, offset, shift, useFloating } from "@floating-ui/react";
import { memo, useCallback, useEffect, useRef } from "react";

type TabInfo = {
    id: string;
    title: string;
    icon: string;
    isActive: boolean;
    statusDot?: {
        state: string;
        unread?: boolean;
        doneUnread?: boolean;
    };
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
};

/**
 * Floating dropdown menu listing all tabs in an inline tab group.
 * Rendered via FloatingPortal; anchored to the element referenced by `anchorRef`.
 * The trigger (button/pill that opens it) is rendered by the parent component.
 */
export const InlineTabDropdownMenu = memo(
    ({ tabs, activeTabId, anchorRef, isOpen, onOpenChange, onSelect }: InlineTabDropdownMenuProps) => {
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
                }
            },
            [isOpen]
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
                    {tabs.map((tab) => (
                        <div
                            key={tab.id}
                            className={`inline-tab-block-dropdown-item ${tab.isActive ? "active" : ""}`}
                            role="menuitem"
                            tabIndex={0}
                            title={tab.title}
                            aria-label={tab.title}
                            onClick={() => handleSelect(tab.id)}
                        >
                            <span className="dropdown-item-icon">
                                <i className={makeIconClass(tab.icon, true)} />
                            </span>
                            <span className="dropdown-item-name">{tab.title}</span>
                            {tab.statusDot && (
                                <span
                                    className={`dropdown-item-status ${
                                        tab.statusDot.state === "working"
                                            ? "is-working"
                                            : tab.statusDot.state === "done"
                                              ? "is-done"
                                              : ""
                                    }`}
                                />
                            )}
                        </div>
                    ))}
                </div>
            </FloatingPortal>
        );
    }
);

InlineTabDropdownMenu.displayName = "InlineTabDropdownMenu";
