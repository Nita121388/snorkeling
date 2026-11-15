// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 「折叠」下拉：把子会话折叠与标签行内折叠收进一个和 SortMenu 同形的控件。
//
// 与排序正交：排序决定顺序，这里决定结构展开/收起，是纯视图偏好（不进筛选链）。
// 触发器 icon-only（28×28）：只显示图标；非默认状态（不再是 smart + tags folded）
// 在右上角点一个小 accent 点，完整状态走 title / aria-label。

import { cn } from "@/util/util";
import { i18n } from "@/i18n/config";
import { useTranslation } from "react-i18next";
import {
    autoUpdate,
    flip,
    FloatingPortal,
    offset,
    shift,
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import { useState } from "react";

export type SubSessionsFold = "folded" | "expanded" | "smart";
export type TagsFold = "folded" | "expanded";

export interface FoldMenuProps {
    subSessionsFold: SubSessionsFold;
    tagsFold: TagsFold;
    onSubSessionsFoldChange: (value: SubSessionsFold) => void;
    onTagsFoldChange: (value: TagsFold) => void;
}

const SubSessionsLabels: { value: SubSessionsFold; labelKey: string; titleKey: string }[] = [
    { value: "folded", labelKey: "aisessions:fold.folded", titleKey: "aisessions:fold.subTitle.folded" },
    { value: "expanded", labelKey: "aisessions:fold.expanded", titleKey: "aisessions:fold.subTitle.expanded" },
    { value: "smart", labelKey: "aisessions:fold.smart", titleKey: "aisessions:fold.subTitle.smart" },
];

const TagsLabels: { value: TagsFold; labelKey: string; titleKey: string }[] = [
    { value: "folded", labelKey: "aisessions:fold.folded", titleKey: "aisessions:fold.tagsTitle.folded" },
    { value: "expanded", labelKey: "aisessions:fold.expanded", titleKey: "aisessions:fold.tagsTitle.expanded" },
];

/** 按钮上的摘要：只显示子会话状态。 */
export function foldSummary(value: SubSessionsFold): string {
    const key =
        value === "folded"
            ? "aisessions:fold.folded"
            : value === "expanded"
              ? "aisessions:fold.expanded"
              : "aisessions:fold.smart";
    return i18n.t(key as never);
}

export function FoldMenu({ subSessionsFold, tagsFold, onSubSessionsFoldChange, onTagsFoldChange }: FoldMenuProps) {
    const { t } = useTranslation("aisessions");
    const [open, setOpen] = useState(false);
    const [reference, setReference] = useState<HTMLButtonElement | null>(null);
    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange: setOpen,
        placement: "bottom-end",
        middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
        whileElementsMounted: autoUpdate,
        elements: { reference },
    });
    const dismiss = useDismiss(context);
    const { getFloatingProps } = useInteractions([dismiss]);

    // 默认组合：子会话 smart + 标签 folded。偏离默认才在按钮上留痕。
    const isDefaultFold = subSessionsFold === "smart" && tagsFold === "folded";
    const foldTitle = i18n.t("aisessions:fold.foldTitle", {
        subSessions: foldSummary(subSessionsFold),
        tags: tagsFold === "expanded" ? t("aisessions:fold.expanded") : t("aisessions:fold.folded"),
    });

    return (
        <>
            <button
                ref={setReference}
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={foldTitle}
                title={foldTitle}
                onClick={() => setOpen((current) => !current)}
                className={cn(
                    "relative flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border/70 transition-colors",
                    open
                        ? "bg-background text-primary shadow-sm ring-1 ring-accent/40"
                        : isDefaultFold
                          ? "bg-surface text-secondary hover:bg-hover hover:text-primary"
                          : "bg-background text-primary ring-1 ring-accent/40 hover:bg-hover"
                )}
            >
                <i className="fa-sharp fa-solid fa-layer-group text-[11px]" />
                {isDefaultFold ? null : (
                    <span
                        aria-hidden="true"
                        className="absolute right-[2px] top-[2px] h-[5px] w-[5px] rounded-full bg-accent"
                    />
                )}
            </button>
            {open ? (
                <FloatingPortal>
                    <div
                        ref={refs.setFloating}
                        style={floatingStyles}
                        {...getFloatingProps()}
                        className="z-50 flex w-56 flex-col overflow-hidden rounded-lg border border-border bg-modalbg"
                    >
                        <div className="border-b border-border/40 px-2.5 py-1.5 text-[12px] text-secondary">
                            {t("aisessions:fold.subSessions")}
                        </div>
                        <div className="p-1.5">
                            <Segmented options={SubSessionsLabels} value={subSessionsFold} onChange={onSubSessionsFoldChange} />
                        </div>
                        <div className="border-b border-t border-border/40 px-2.5 py-1.5 text-[12px] text-secondary">
                            {t("aisessions:fold.tags")}
                        </div>
                        <div className="p-1.5">
                            <Segmented options={TagsLabels} value={tagsFold} onChange={onTagsFoldChange} />
                        </div>
                    </div>
                </FloatingPortal>
            ) : null}
        </>
    );
}

function Segmented<T extends string>({
    options,
    value,
    onChange,
}: {
    options: { value: T; labelKey: string; titleKey: string }[];
    value: T;
    onChange: (value: T) => void;
}) {
    const { t } = useTranslation("aisessions");
    return (
        <div className="flex rounded-md border border-border bg-surface p-0.5">
            {options.map((option) => {
                const active = option.value === value;
                const title = t(option.titleKey as never);
                return (
                    <button
                        key={option.value}
                        type="button"
                        title={title}
                        aria-label={title}
                        aria-pressed={active}
                        onClick={() => onChange(option.value)}
                        className={cn(
                            "flex h-6 flex-1 cursor-pointer items-center justify-center rounded px-1.5 text-[12px] transition-colors duration-250 ease-out",
                            active ? "bg-background text-primary" : "text-secondary hover:text-primary"
                        )}
                    >
                        {t(option.labelKey as never)}
                    </button>
                );
            })}
        </div>
    );
}
