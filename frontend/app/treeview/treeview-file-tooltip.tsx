// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { formatFileSize, getLastModifiedTime } from "@/util/fileformat";
import { makeIconClass } from "@/util/util";
import { FloatingPortal, autoUpdate, flip, offset, shift, useFloating } from "@floating-ui/react";
import { useEffect, useState } from "react";

/**
 * Files 目录树节点悬浮信息卡片。
 *
 * 设计要点（Nova 口味）：
 *  - 表面：半透明 modalbg + backdrop-blur + 1px 柔和描边 + 大圆角 + 深阴影，
 *    与项目里其它浮层（preview-new-files / widgets 快速启动）保持同一套视觉语言。
 *  - 排版：标签弱化小字、值清晰、路径等宽换行，1px 低对比分隔线做三层分区。
 *  - 动效：入场 opacity + scale(0.96→1)，出场更快。
 *
 * 关键约束：**本组件不包裹任何 DOM**。
 * TreeView 的行是 @tanstack/react-virtual 渲染的绝对定位元素，多包一层 div 就会破坏行布局，
 * 所以这里只渲染一个浮动层，锚点由调用方（TreeView）以 reference 传入。
 */

/** Tooltip 需要的最小节点信息。TreeNodeData 天然满足，避免 treeview ↔ tooltip 循环依赖。 */
export interface FileMetaNode {
    label?: string;
    path?: string;
    isDirectory: boolean;
    mimeType?: string;
    /** 文件字节数；目录不设置 */
    size?: number;
    /** 最后修改时间（unix 毫秒） */
    modtime?: number;
    notfound?: boolean;
    staterror?: string;
}

export interface FileMetaRow {
    label: string;
    value: string;
}

const MimeTypeLabels: Record<string, string> = {
    "text/markdown": "Markdown",
    "application/json": "JSON",
    "text/x-python": "Python",
    "application/x-python": "Python",
    "text/typescript": "TypeScript",
    "application/typescript": "TypeScript",
    "text/javascript": "JavaScript",
    "application/javascript": "JavaScript",
    "text/html": "HTML",
    "text/css": "CSS",
    "text/csv": "CSV",
    "text/xml": "XML",
    "application/xml": "XML",
    "application/pdf": "PDF",
    "application/zip": "Archive",
    "application/gzip": "Archive",
    "application/x-tar": "Archive",
    "application/yaml": "YAML",
    "text/yaml": "YAML",
    "application/x-yaml": "YAML",
    "application/sql": "SQL",
    "text/x-shellscript": "Shell",
    "text/x-go": "Go",
    "text/x-rust": "Rust",
    "text/x-java": "Java",
    "text/x-c": "C",
    "text/x-c++": "C++",
};

const MimeTypePrefixLabels: Record<string, string> = {
    image: "Image",
    video: "Video",
    audio: "Audio",
    font: "Font",
    text: "Text",
};

/**
 * 把 mimetype 翻译成可读的类型名（用于 Tooltip 右上角的类型徽章）。
 *
 * @param mimeType 节点的 mimetype
 * @param isDirectory 节点是否是目录（目录没有 mimetype，单独处理）
 */
export function describeMimeType(mimeType?: string, isDirectory?: boolean): string {
    if (isDirectory) {
        return "Folder";
    }
    const mime = mimeType?.trim().toLowerCase();
    if (!mime) {
        return "File";
    }
    if (mime === "directory") {
        return "Folder";
    }
    const exact = MimeTypeLabels[mime];
    if (exact != null) {
        return exact;
    }
    const separator = mime.indexOf("/");
    if (separator > 0) {
        const type = mime.slice(0, separator);
        const subtype = mime.slice(separator + 1);
        const prefixLabel = MimeTypePrefixLabels[type];
        if (prefixLabel != null) {
            return prefixLabel;
        }
        if (subtype && subtype !== "x-" && !subtype.startsWith("x-")) {
            return subtype.toUpperCase();
        }
        if (subtype.startsWith("x-")) {
            return subtype
                .slice(2)
                .split(/[-+]/)
                .filter((chunk) => chunk.length > 0)
                .map((chunk) => chunk.toUpperCase())
                .join("-");
        }
    }
    return "File";
}

/**
 * 构造 Tooltip 的元信息行。**缺数据就不产出该行**，避免出现「大小: 」这种空占位。
 *
 * 规则：
 *  - 目录不显示大小（目录字节数在各平台语义不一致）；
 *  - 错误节点（notfound / staterror）不显示任何元信息行，错误说明由组件单独渲染；
 *  - size 为 0 是合法值，显示 `0 B`。
 */
export function buildFileMetaRows(node: FileMetaNode): FileMetaRow[] {
    if (node.notfound || node.staterror) {
        return [];
    }
    const rows: FileMetaRow[] = [];
    if (!node.isDirectory && node.size != null) {
        const size = formatFileSize(node.size);
        if (size !== "") {
            rows.push({ label: "Size", value: size });
        }
    }
    if (node.modtime != null) {
        rows.push({ label: "Modified", value: getLastModifiedTime(node.modtime) });
    }
    return rows;
}

function getErrorText(node: FileMetaNode): string | null {
    if (node.notfound) {
        return "Not found";
    }
    if (node.staterror) {
        return node.staterror;
    }
    return null;
}

export interface FileMetaTooltipProps {
    /** 锚点元素（被悬浮的树行 DOM 节点） */
    reference: HTMLElement | null;
    /** 被悬浮节点的信息 */
    node: FileMetaNode | null;
    /** Font Awesome 图标名（如 `file-lines`） */
    icon?: string;
    /** 图标颜色 */
    iconColor?: string;
    /** 是否展开 */
    open: boolean;
}

/**
 * 悬浮信息卡片。
 *
 * 位置：`right`（树面板一般靠左/居中，右侧留白多），贴到屏幕边缘时 floating-ui 会自动 flip。
 * 动效用独立的 `scale` 属性而非 `transform`，避免覆盖 floating-ui 用来定位的 translate。
 */
export function FileMetaTooltip({ reference, node, icon, iconColor, open }: FileMetaTooltipProps) {
    const { refs, floatingStyles, context } = useFloating({
        open,
        placement: "right",
        // crossAxis: true —— shift 默认只约束交叉轴（垂直方向），主轴（水平）溢出由 flip 兜底；
        // 但当两侧都放不下时 flip 会维持原位，tooltip 就会溢出视口。开启 crossAxis 后
        // 主轴也会被拉回视口内（树面板贴屏幕边缘时的真实场景）。
        middleware: [offset(10), flip(), shift({ padding: 12, crossAxis: true })],
        whileElementsMounted: autoUpdate,
    });

    useEffect(() => {
        refs.setReference(reference);
    }, [reference, refs]);

    // 卡片带着终态（opacity 1 / scale 1）挂载时，浏览器没有「变化前样式」，入场动画不会触发。
    // 先以隐藏态渲染，下一帧再翻到可见态，transition 才能真的跑起来。
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        if (!open) {
            setVisible(false);
            return;
        }
        const frame = window.requestAnimationFrame(() => setVisible(true));
        return () => window.cancelAnimationFrame(frame);
    }, [open]);

    if (reference == null || node == null) {
        return null;
    }

    const rows = buildFileMetaRows(node);
    const errorText = getErrorText(node);
    const typeLabel = describeMimeType(node.mimeType, node.isDirectory);
    const path = node.path;
    const scaleOrigin = context.placement?.startsWith("left") ? "right center" : "left center";

    return (
        <FloatingPortal>
            <div
                ref={refs.setFloating}
                role="tooltip"
                aria-hidden={!visible}
                style={{
                    ...floatingStyles,
                    opacity: visible ? 1 : 0,
                    scale: visible ? "1" : "0.96",
                    transformOrigin: scaleOrigin,
                    // 出场比入场快，读完信息后不至于赖着不走
                    transition: visible ? "opacity 120ms ease, scale 120ms ease" : "opacity 90ms ease, scale 90ms ease",
                }}
                className="pointer-events-none z-50 w-max max-w-[300px] select-none rounded-xl border border-border/70 bg-modalbg/95 px-3 py-2.5 shadow-2xl backdrop-blur-xl"
            >
                <div className="flex items-center gap-2">
                    <i
                        className={makeIconClass(icon, true)}
                        style={{
                            color: node.notfound || node.staterror ? "var(--color-error)" : (iconColor ?? "inherit"),
                        }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                        {node.label ?? node.path}
                    </span>
                    <span className="shrink-0 rounded-md border border-border/60 bg-surface px-1.5 py-0.5 text-[10px] leading-none text-secondary">
                        {typeLabel}
                    </span>
                </div>

                {errorText != null ? (
                    <>
                        <div className="my-2 h-px bg-border/60" />
                        <div className="text-[11px] leading-4 text-error">{errorText}</div>
                    </>
                ) : (
                    rows.length > 0 && (
                        <>
                            <div className="my-2 h-px bg-border/60" />
                            <div className="flex flex-col gap-1">
                                {rows.map((row) => (
                                    <div key={row.label} className="flex items-baseline justify-between gap-4">
                                        <span className="text-[10px] uppercase tracking-wider text-secondary/70">
                                            {row.label}
                                        </span>
                                        <span className="text-[12px] text-foreground">{row.value}</span>
                                    </div>
                                ))}
                            </div>
                        </>
                    )
                )}

                {path != null && path !== "" && (
                    <>
                        <div className="my-2 h-px bg-border/60" />
                        <div className="break-all font-mono text-[11px] leading-4 text-secondary/80">{path}</div>
                    </>
                )}
            </div>
        </FloatingPortal>
    );
}
