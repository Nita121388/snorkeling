// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useWaveEnv } from "@/app/waveenv/waveenv";
import { getLayoutModelForTabById } from "@/layout/index";
import { makeORef } from "@/store/wos";
import { fireAndForget, makeIconClass } from "@/util/util";
import { autoUpdate, flip, FloatingPortal, offset, shift, useFloating } from "@floating-ui/react";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BlockEnv } from "./blockenv";
import { blockViewToIcon, blockViewToName } from "./blockutil";

type TabInfo = {
    id: string;
    title: string;
    path: string;
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
    nodeId: string;
    tabId: string;
    onSelect: (blockId: string) => void;
};

export const InlineTabDropdownMenu = memo(({ tabs, activeTabId, nodeId, tabId, onSelect }: InlineTabDropdownMenuProps) => {
    const waveEnv = useWaveEnv<BlockEnv>();
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const { refs, floatingStyles } = useFloating({
        open: menuOpen,
        onOpenChange: setMenuOpen,
        placement: "bottom-end",
        middleware: [offset(4), flip(), shift({ padding: 8 })],
        whileElementsMounted: autoUpdate,
        elements: {
            reference: buttonRef.current,
        },
    });

    // 点击外部关闭菜单
    useEffect(() => {
        if (!menuOpen) {
            return;
        }
        const onPointerDown = (e: PointerEvent) => {
            const target = e.target as HTMLElement;
            if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) {
                return;
            }
            setMenuOpen(false);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setMenuOpen(false);
            }
        };
        window.addEventListener("pointerdown", onPointerDown, true);
        window.addEventListener("keydown", onKeyDown, true);
        return () => {
            window.removeEventListener("pointerdown", onPointerDown, true);
            window.removeEventListener("keydown", onKeyDown, true);
        };
    }, [menuOpen]);

    const handleSelect = useCallback(
        (blockId: string) => {
            onSelect(blockId);
            setMenuOpen(false);
        },
        [onSelect]
    );

    // 键盘导航
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (!menuOpen) {
                return;
            }

            const menuItems = menuRef.current?.querySelectorAll(".inline-tab-block-dropdown-item");
            if (!menuItems?.length) {
                return;
            }

            const currentIndex = Array.from(menuItems).findIndex((item) => item === document.activeElement);

            switch (e.key) {
                case "ArrowDown":
                    e.preventDefault();
                    const nextIndex = currentIndex < menuItems.length - 1 ? currentIndex + 1 : 0;
                    (menuItems[nextIndex] as HTMLElement).focus();
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    const prevIndex = currentIndex > 0 ? currentIndex - 1 : menuItems.length - 1;
                    (menuItems[prevIndex] as HTMLElement).focus();
                    break;
                case "Home":
                    e.preventDefault();
                    (menuItems[0] as HTMLElement).focus();
                    break;
                case "End":
                    e.preventDefault();
                    (menuItems[menuItems.length - 1] as HTMLElement).focus();
                    break;
            }
        },
        [menuOpen]
    );

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                className="inline-tab-block-dropdown-btn"
                title="Show all tabs"
                aria-label="Show all tabs"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen((open) => !open);
                }}
            >
                <i className={makeIconClass("caret-down", true)} />
            </button>
            {menuOpen && (
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
                                onClick={() => handleSelect(tab.id)}
                            >
                                <span className="dropdown-item-icon">
                                    <i className={makeIconClass(tab.icon, true)} />
                                </span>
                                <span className="dropdown-item-title">{tab.title}</span>
                                {tab.path && (
                                    <span className="dropdown-item-path" title={tab.path}>
                                        {tab.path}
                                    </span>
                                )}
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
            )}
        </>
    );
});

InlineTabDropdownMenu.displayName = "InlineTabDropdownMenu";