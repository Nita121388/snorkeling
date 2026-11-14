// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { Input } from "@/app/element/input";
import React, { memo, useState } from "react";
import { useTranslation } from "react-i18next";

export enum EntryManagerType {
    NewFile = "New File",
    NewDirectory = "New Folder",
    EditName = "Rename",
    MoveTo = "Move to...",
}

/** 入口类型 → 标题 i18n key（枚举值本身是英文，展示层按 key 取本地化标题） */
const EntryTypeTitleKey = {
    [EntryManagerType.NewFile]: "preview:entryManager.newFile",
    [EntryManagerType.NewDirectory]: "preview:entryManager.newFolder",
    [EntryManagerType.EditName]: "preview:entryManager.rename",
    [EntryManagerType.MoveTo]: "preview:entryManager.moveTo",
} as const;

export type EntryManagerOverlayProps = {
    forwardRef?: React.Ref<HTMLDivElement>;
    entryManagerType: EntryManagerType;
    startingValue?: string;
    hint?: string;
    onSave: (newValue: string) => void;
    onCancel?: () => void;
    style?: React.CSSProperties;
    getReferenceProps?: () => any;
};

export const EntryManagerOverlay = memo(
    ({
        entryManagerType,
        startingValue,
        hint,
        onSave,
        onCancel,
        forwardRef,
        style,
        getReferenceProps,
    }: EntryManagerOverlayProps) => {
        const { t } = useTranslation("preview");
        const [value, setValue] = useState(startingValue);
        return (
            <div className="entry-manager-overlay" ref={forwardRef} style={style} {...(getReferenceProps?.() ?? {})}>
                <div className="entry-manager-type">{t(EntryTypeTitleKey[entryManagerType])}</div>
                {hint != null && hint !== "" && <div className="mb-1 text-[11px] leading-4 text-muted">{hint}</div>}
                <div className="entry-manager-input">
                    <Input
                        value={value}
                        onChange={setValue}
                        autoFocus={true}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                e.stopPropagation();
                                onSave(value);
                            }
                        }}
                    />
                </div>
                <div className="entry-manager-buttons">
                    <Button className="py-[4px]" onClick={() => onSave(value)}>
                        {t("preview:entryManager.save")}
                    </Button>
                    <Button className="py-[4px] red outlined" onClick={onCancel}>
                        {t("preview:entryManager.cancel")}
                    </Button>
                </div>
            </div>
        );
    }
);

EntryManagerOverlay.displayName = "EntryManagerOverlay";
