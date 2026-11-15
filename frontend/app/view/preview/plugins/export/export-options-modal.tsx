// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 导出设置弹窗：选择导出格式（HTML/PDF）、设置文件名、配置导出选项。
// 确认（导出）或取消（backdrop / 取消按钮）后由调用方执行真正的导出流程。
// 上次的选择用 localStorage 记住，下次打开弹窗默认沿用。

import { Toggle } from "@/element/toggle";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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

/** 持久化导出选项（不含 fileName），供下次打开弹窗时沿用。 */
function saveExportOptions(options: ExportOptions): void {
    try {
        const { fileName: _fileName, ...persistable } = options;
        void _fileName;
        window.localStorage.setItem(ExportOptionsStorageKey, JSON.stringify(persistable));
    } catch {
        // localStorage 不可用时静默忽略。
    }
}

type ExportOptionsModalProps = {
    /** 默认格式，由调用方指定；弹窗内可切换。 */
    defaultFormat?: ExportFormat;
    /** 默认文件名（不含扩展名），由调用方根据当前文件计算。 */
    defaultFileName: string;
    onSubmit: (format: ExportFormat, options: ExportOptions) => void;
    onCancel: () => void;
};

const formatOptions: Array<{ value: ExportFormat; label: string; ext: string }> = [
    { value: "html", label: "HTML", ext: ".html" },
    { value: "pdf", label: "PDF", ext: ".pdf" },
];

type OptionKey = keyof ExportOptions;

/** 选项 → i18n key（label/title 延迟到渲染期取词，避免 import 期锁死 locale）。
 *  不加 `Array<...>` 注解：注解会把 labelKey 拓宽成 string，i18next 的严格 key 类型会拒收。 */
const optionItemKeys = [
    {
        key: "includeFrontmatter",
        labelKey: "preview:exportOptions.showFrontmatter",
        titleKey: "preview:exportOptions.showFrontmatterTitle",
    },
    {
        key: "includeToc",
        labelKey: "preview:exportOptions.showToc",
        titleKey: "preview:exportOptions.showTocTitle",
    },
    {
        key: "darkTheme",
        labelKey: "preview:exportOptions.darkTheme",
        titleKey: "preview:exportOptions.darkThemeTitle",
    },
] as const;

export function ExportOptionsModal({
    defaultFormat = "html",
    defaultFileName,
    onSubmit,
    onCancel,
}: ExportOptionsModalProps) {
    const { t } = useTranslation("preview");
    const [format, setFormat] = useState<ExportFormat>(defaultFormat);
    const [options, setOptions] = useState<ExportOptions>(() => ({
        ...loadStoredExportOptions(),
        fileName: defaultFileName,
    }));
    const toggleOption = (key: keyof ExportOptions) => (value: boolean) => {
        setOptions((prev) => ({ ...prev, [key]: value }));
    };
    const toggleList = useMemo(
        () =>
            optionItemKeys.map((item) => ({
                key: item.key as OptionKey,
                label: t(item.labelKey),
                title: t(item.titleKey),
            })),
        [t]
    );
    const handleSubmit = () => {
        saveExportOptions(options);
        onSubmit(format, { ...options, fileName: options.fileName || defaultFileName });
    };

    const selectedExt = formatOptions.find((f) => f.value === format)?.ext ?? ".html";
    const displayName = options.fileName || defaultFileName;

    return (
        <Modal
            className="export-options-modal"
            okLabel={t("preview:exportOptions.okLabel")}
            cancelLabel={t("preview:exportOptions.cancelLabel")}
            onOk={handleSubmit}
            onCancel={onCancel}
            onClickBackdrop={onCancel}
            onClose={onCancel}
        >
            <div className="export-options-title">{t("preview:exportOptions.title")}</div>

            {/* 格式选择 */}
            <div className="export-options-format-row">
                {formatOptions.map((f) => (
                    <button
                        key={f.value}
                        className={`export-format-btn${format === f.value ? " active" : ""}`}
                        onClick={() => setFormat(f.value)}
                        type="button"
                    >
                        {f.label}
                    </button>
                ))}
            </div>

            {/* 文件名输入 */}
            <div className="export-options-filename-row">
                <label className="export-options-filename-label" htmlFor="export-file-name">
                    {t("preview:exportOptions.fileNameLabel")}
                </label>
                <div className="export-options-filename-input-wrapper">
                    <input
                        id="export-file-name"
                        className="export-options-filename-input"
                        type="text"
                        value={options.fileName}
                        onChange={(e) => setOptions((prev) => ({ ...prev, fileName: e.target.value }))}
                        placeholder={defaultFileName}
                        spellCheck={false}
                    />
                    <span className="export-options-filename-ext">{selectedExt}</span>
                </div>
            </div>

            {/* 预览 */}
            <div className="export-options-preview">
                {t("preview:exportOptions.willExportAs")} <strong>{displayName}{selectedExt}</strong>
            </div>

            {/* 导出选项 */}
            <div className="export-options-list">
                {toggleList.map((item) => (
                    <Toggle
                        key={item.key}
                        id={`export-option-${item.key}`}
                        checked={options[item.key] as boolean}
                        onChange={toggleOption(item.key)}
                        label={item.label}
                    />
                ))}
            </div>
        </Modal>
    );
}

ExportOptionsModal.displayName = "ExportOptionsModal";
