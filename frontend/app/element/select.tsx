// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AppSelect — 项目统一的下拉组件（外观由我们自己画，不依赖平台原生弹层）。
//
// 为什么需要它（2026-11-18，用户反馈「看板分组下拉不好看，主要是 Windows 的不好看，
// 问题就是展开态样式不好看」）：
//   原生 <select> 的 option 列表在 Windows 上由系统 UA chrome 绘制，只认 color-scheme
//   的深浅两档，不认主题令牌 —— 方角、系统字体、整行高亮、与面板底色不一致。
//   `agenthooksettingsmodal.tsx` 曾用 floating-ui 自绘解决过一次（VendorSelect），
//   但那是 modal 内一次性实现：无 listbox 语义、无方向键、无焦点回归、尺寸写死。
//   本组件把那套做法抽成通用件，补齐语义与键盘。
//
// 契约：
//   1. 受控：`value` + `onChange(value)`，不持有值。
//   2. 值通道用**视觉隐藏的原生 <select>**（`data-select-proxy`）承载：
//      `scripts/verify/overview-board|overview-timeline` 与 CDP 都靠
//      `sel.value = x; dispatchEvent(new Event("change"))` 驱动，原生 boot 的
//      `.value` / `.options` 是既有契约，不能换成 div。触发器和弹层只负责看和点。
//   3. 语义：触发器 role=combobox + aria-expanded/aria-controls/aria-activedescendant；
//      弹层 role=listbox；选项 role=option + aria-selected。焦点始终留在触发器上
//      （combobox 模式靠 aria-activedescendant 报活动项，不把 DOM 焦点搬进列表）。
//   4. 外观：全部取主题令牌（docs/design-system.md），选中项除底色外必须有 ✓ 图标。

import {
    autoUpdate,
    flip,
    FloatingPortal,
    offset,
    shift,
    size as sizeMiddleware,
    useDismiss,
    useFloating,
    useId,
    useInteractions,
    useRole,
    useTypeahead,
    type Placement,
} from "@floating-ui/react";
import clsx from "clsx";
import { memo, useCallback, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import "./select.scss";

export type AppSelectOption = {
    value: string;
    label: string;
    disabled?: boolean;
};

export type AppSelectSize = "xs" | "sm" | "md";

export type AppSelectProps = {
    options: AppSelectOption[];
    value: string;
    onChange: (value: string) => void;
    /** 20 / 26 / 32px 三档，默认 sm */
    size?: AppSelectSize;
    /** bare：无边框/底色/内边距，交给宿主外壳（如 `.session-overview-group-picker`）负责视觉 */
    variant?: "default" | "bare";
    disabled?: boolean;
    /** 触发器 tooltip */
    title?: string;
    /** 触发器无障碍名（同时作为隐藏原生 select 的名字） */
    ariaLabel?: string;
    className?: string;
    placement?: Placement;
    /** 调用方的 data-* 会透传到隐藏原生 select（值通道），与迁移前行为一致 */
} & { [dataAttr: `data-${string}`]: string | undefined };

const AppSelectComponent = ({
    options,
    value,
    onChange,
    size = "sm",
    variant = "default",
    disabled = false,
    title,
    ariaLabel,
    className,
    placement = "bottom-start",
    ...dataProps
}: AppSelectProps) => {
    const idPrefix = useId();
    const menuId = `app-select-menu-${idPrefix}`;
    const optionId = (index: number) => `${menuId}-opt-${index}`;

    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    // useTypeahead 要的是字符串数组（选项文本），不是 DOM 元素数组 —— 传错会在 keydown 时抛
    // `text.toLocaleLowerCase is not a function`，并把同一次事件里 useListNavigation 的导航一并带崩。
    const typeaheadListRef = useRef<Array<string | null>>(options.map((option) => option.label));
    const triggerRef = useRef<HTMLButtonElement | null>(null);

    // 选项变时保持 typeahead 文本同步（幂等赋值）。
    typeaheadListRef.current = options.map((option) => option.label);

    const selectedIndex = options.findIndex((option) => option.value === value);
    const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

    // 打开时把活动项定在当前选中项上（``focusItemOnOpen: false`` 时 floating-ui 不会替我们设）。
    // 这是选单语义：弹层一开就能看到「我现在选的是哪个」，再按方向键从这里继续走。
    const syncActiveIndexOnOpen = useCallback(
        (nextOpen: boolean) => {
            setActiveIndex(nextOpen ? (selectedIndex >= 0 ? selectedIndex : 0) : null);
        },
        [selectedIndex]
    );

    const { refs, floatingStyles, context } = useFloating<HTMLButtonElement>({
        open,
        onOpenChange: (nextOpen, _event, reason) => {
            setOpen(nextOpen);
            syncActiveIndexOnOpen(nextOpen);
            if (!nextOpen) {
                // Escape 关闭时焦点必须回到触发器；外点关闭不动焦点（用户已经指向别处）。
                if (reason === "escape-key") triggerRef.current?.focus();
            }
        },
        placement,
        // fixed：规避 transform 祖先（看板横向 snap 容器）导致的 absolute 错位。
        strategy: "fixed",
        whileElementsMounted: autoUpdate,
        middleware: [
            offset(2),
            flip({ padding: 8 }),
            shift({ padding: 8 }),
            sizeMiddleware({
                apply({ rects, elements }) {
                    // 弹层至少不窄于触发器，避免短标签时面板比触发器还小。
                    elements.floating.style.minWidth = `${Math.round(rects.reference.width)}px`;
                },
            }),
        ],
    });

    const dismiss = useDismiss(context);
    const role = useRole(context, { role: "listbox" });
    // 方向键导航自己掌握，不用 useListNavigation：那个钩子是按「可输入型 combobox」设计的
    // （它内部用 indexRef 维护索引，开合与 focus 事件会反复重置，和「焦点留在触发器、
    // 靠 aria-activedescendant 报活动项」的模型冲突 —— 实测表现为箭头键推不动活动项）。
    // 这里只需要选单语义：上下移动、首末、键入匹配。
    const typeahead = useTypeahead(context, {
        listRef: typeaheadListRef,
        activeIndex,
        selectedIndex: selectedIndex >= 0 ? selectedIndex : null,
        onMatch: (index) => setActiveIndex(index),
    });

    const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([dismiss, role, typeahead]);

    const commit = useCallback(
        (index: number) => {
            const option = options[index];
            if (option == null || option.disabled) return;
            onChange(option.value);
            setOpen(false);
            setActiveIndex(null);
            triggerRef.current?.focus();
        },
        [onChange, options]
    );

    /** 从 from 开始朝 step 方向找下一个可用项（含回绕）。找不到返回 null。 */
    const nextEnabledIndex = useCallback(
        (from: number, step: 1 | -1): number | null => {
            const count = options.length;
            if (count === 0) return null;
            let index = from;
            for (let attempt = 0; attempt < count; attempt++) {
                index = (index + step + count) % count;
                if (!options[index]?.disabled) return index;
            }
            return null;
        },
        [options]
    );

    const closeMenu = useCallback(() => {
        setOpen(false);
        setActiveIndex(null);
    }, []);

    const openWithSelected = useCallback(() => {
        setOpen(true);
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : nextEnabledIndex(-1, 1));
    }, [selectedIndex, nextEnabledIndex]);

    // 关闭：开合走原生 click（button 的 Enter/Space 会合成 click）；
    // 打开：方向键/首末/Enter/Space/Esc/Tab 全部自己处理，顺序确定，不依赖内部状态机。
    const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        const key = event.key;
        if (key === "ArrowDown" || key === "ArrowUp") {
            event.preventDefault();
            const step: 1 | -1 = key === "ArrowDown" ? 1 : -1;
            if (!open) {
                if (step === 1) openWithSelected();
                else {
                    setOpen(true);
                    setActiveIndex(selectedIndex >= 0 ? selectedIndex : nextEnabledIndex(0, -1));
                }
                return;
            }
            const base = activeIndex ?? (step === 1 ? -1 : 0);
            setActiveIndex(nextEnabledIndex(base, step));
            return;
        }
        if (!open) return;
        if (key === "Home" || key === "End") {
            event.preventDefault();
            setActiveIndex(key === "Home" ? nextEnabledIndex(-1, 1) : nextEnabledIndex(0, -1));
            return;
        }
        if (key === "Enter" || key === " ") {
            // 必须 preventDefault：否则 button 的 Enter/Space 会再合成一次 click，把刚提交的选单重新打开。
            event.preventDefault();
            if (activeIndex != null) commit(activeIndex);
            return;
        }
        if (key === "Tab") {
            setOpen(false);
        }
    };

    return (
        <span
            className={clsx(
                "app-select",
                `app-select--${size}`,
                variant === "bare" && "app-select--bare",
                open && "is-open",
                disabled && "is-disabled",
                className
            )}
            data-select-root=""
            data-select-size={size}
        >
            {/*
              值通道：视觉隐藏的原生 select。aria-hidden + tabIndex=-1 使它不进焦点环与读屏树，
              但保留 .value / .options / change 事件 —— 验证台与 CDP 的既有驱动方式。
              调用方传入的 data-* （如 data-overview-group）挂在它身上，与迁移前一致。
            */}
            <select
                className="app-select__proxy"
                data-select-proxy=""
                tabIndex={-1}
                aria-hidden="true"
                aria-label={ariaLabel}
                value={value}
                disabled={disabled}
                onChange={(event) => onChange(event.target.value)}
                {...dataProps}
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value} disabled={option.disabled}>
                        {option.label}
                    </option>
                ))}
            </select>
            <button
                ref={(node) => {
                    triggerRef.current = node;
                    refs.setReference(node);
                }}
                type="button"
                className="app-select__trigger"
                data-select-trigger=""
                data-select-value={value}
                disabled={disabled}
                title={title}
                aria-label={ariaLabel}
                {...getReferenceProps({
                    // 这两个必须**传进** getReferenceProps 而不是另外铺在它后面：
                    // getReferenceProps 自己返回 onClick（useListNavigation/useTypeahead 的焦点与
                    // 活动项逻辑），后铺会被它覆盖 —— 实测表现为「点触发器毫无反应、aria-expanded
                    // 永远是 false」。传进去由 floating-ui 组合调用。
                    onClick: () => (open ? closeMenu() : openWithSelected()),
                    onKeyDown: handleTriggerKeyDown,
                })}
                // floating-ui 只把 aria-activedescendant 挂在「可输入型 combobox」（input/textarea）
                // 的参考元素上（isTypeableCombobox）；button 型 combobox 不在其列，而它默认挂在
                // listbox 上对读屏无意义。按 WAI-ARIA combobox 模式自己挂到触发器上。
                aria-activedescendant={open && activeIndex != null ? optionId(activeIndex) : undefined}
            >
                <span className="app-select__label" data-select-label="">
                    {selected?.label ?? ""}
                </span>
                <i className="fa-solid fa-chevron-down app-select__caret" data-select-caret="" aria-hidden="true" />
            </button>
            {open ? (
                <FloatingPortal>
                    <div
                        ref={refs.setFloating}
                        id={menuId}
                        className="app-select__menu"
                        data-select-menu=""
                        style={floatingStyles}
                        {...getFloatingProps()}
                    >
                        {options.length === 0 ? (
                            <div className="app-select__empty" data-select-empty="">
                                <i className="fa-solid fa-circle-info" aria-hidden="true" />
                            </div>
                        ) : (
                            options.map((option, index) => {
                                const isSelected = index === selectedIndex;
                                const isActive = index === activeIndex;
                                return (
                                    <div
                                        key={option.value}
                                        id={optionId(index)}
                                        className={clsx(
                                            "app-select__option",
                                            isSelected && "is-selected",
                                            isActive && "is-active"
                                        )}
                                        data-select-option=""
                                        data-value={option.value}
                                        aria-disabled={option.disabled || undefined}
                                        {...getItemProps({
                                            onClick: () => commit(index),
                                        })}
                                        // getItemProps 里的 aria-selected 跟的是 activeIndex（键盘活动项），
                                        // 语义不对；选项的选中态必须跟 value。后铺覆盖。
                                        role="option"
                                        aria-selected={isSelected}
                                    >
                                        <span className="app-select__option-label">{option.label}</span>
                                        {isSelected ? (
                                            <i
                                                className="fa-solid fa-check app-select__option-check"
                                                aria-hidden="true"
                                            />
                                        ) : null}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </FloatingPortal>
            ) : null}
        </span>
    );
};

export const AppSelect = memo(AppSelectComponent);
AppSelect.displayName = "AppSelect";
