// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 导出设置弹窗：导出 HTML / PDF 前让用户选择导出选项（如是否显示属性 frontmatter）。
// 确认（导出）或取消（backdrop / 取消按钮）后由调用方执行真正的导出流程。
// 上次的选择用 localStorage 记住，下次打开弹窗默认沿用。

import { Toggle } from "@/element/toggle";
import { useMemo, useState } from "react";
import { Modal } from "@/app/modals/modal";
import { defaultExportOptions, type ExportFormat, type ExportOptions } from "./export-provider";
import "./export-options-modal.scss";

const ExportOptionsStorageKey = "snorkeling:markdown-export-options";

/** 读取上次保存的导出选项；缺失或损坏时回落到默认值。 */
export function loadStoredExportOptions(): ExportOptions {
    try {
        const raw = window.localStorage.getItem(ExportOptionsStorageKey);
        if (raw == null) {
            return { ...defaultExportOptions };
        }
        const parsed = JSON.parse(raw) as Partial<ExportOptions>;
        return { ...defaultExportOptions, ...parsed };
    } catch {
        return { ...defaultExportOptions };
    }
}

/** 持久化导出选项，供下次打开弹窗时沿用。 */
function saveExportOptions(options: ExportOptions): void {
    try {
        window.localStorage.setItem(ExportOptionsStorageKey, JSON.stringify(options));
    } catch {
        // localStorage 不可用时静默忽略（只影响记忆，不影响导出本身）。
    }
}

type ExportOptionsModalProps = {
    format: ExportFormat;
    onSubmit: (options: ExportOptions) => void;
    onCancel: () => void;
};

const formatLabel: Record<ExportFormat, string> = {
    html: "HTML",
    pdf: "PDF",
};

const optionItems: Array<{ key: keyof ExportOptions; label: string; title: string }> = [
    {
        key: "includeFrontmatter",
        label: "显示属性（frontmatter）",
        title: "导出时是否保留文档开头的属性（YAML frontmatter）",
    },
    {
        key: "includeToc",
        label: "显示目录",
        title: "在导出文档顶部插入目录",
    },
    {
        key: "darkTheme",
        label: "深色主题",
        title: "导出的 HTML / PDF 使用深色配色",
    },
];

export function ExportOptionsModal({ format, onSubmit, onCancel }: ExportOptionsModalProps) {
    const [options, setOptions] = useState<ExportOptions>(() => loadStoredExportOptions());
    const toggleOption = (key: keyof ExportOptions) => (value: boolean) => {
        setOptions((prev) => ({ ...prev, [key]: value }));
    };
    const toggleList = useMemo(() => optionItems, []);
    const handleSubmit = () => {
        saveExportOptions(options);
        onSubmit(options);
    };

    return (
        <Modal
            className="export-options-modal"
            okLabel="导出"
            cancelLabel="取消"
            onOk={handleSubmit}
            onCancel={onCancel}
            onClickBackdrop={onCancel}
            onClose={onCancel}
        >
            <div className="export-options-title">导出为 {formatLabel[format]}</div>
            <div className="export-options-list">
                {toggleList.map((item) => (
                    <Toggle
                        key={item.key}
                        id={`export-option-${item.key}`}
                        checked={options[item.key]}
                        onChange={toggleOption(item.key)}
                        label={item.label}
                    />
                ))}
            </div>
        </Modal>
    );
}