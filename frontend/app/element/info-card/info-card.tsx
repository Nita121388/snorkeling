// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// InfoCard — 通用悬浮信息卡展示壳。
//
// 设计目标：
//  - 不绑定任何业务域（Block / 文件 / 远程机器…），只提供「卡片 + 行级原语」。
//  - 具体内容由调用方组装：想展示什么，就按原语拼什么。
//  - 原语名称与旧 .agent-hover-card-* 一一对应，视觉规范原样平移，见 info-card.scss。
//
// 用法示例（业务侧卡片）：
//   <InfoCard>
//     <InfoCardSection>
//       <InfoCardHead><InfoCardIcon icon="fa-solid fa-microchip" /><InfoCardTitle>…</InfoCardTitle></InfoCardHead>
//       <InfoCardStatus icon="fa-spinner">working</InfoCardStatus>
//       <InfoCardText>…</InfoCardText>
//     </InfoCardSection>
//   </InfoCard>

import { cn } from "@/util/util";
import * as React from "react";
import "./info-card.scss";

type InfoCardChildrenProps = {
    className?: string;
    children?: React.ReactNode;
};

type InfoCardProps = InfoCardChildrenProps & {
    /** 透传给卡片根节点，用于注入 CSS 变量（如 --info-card-accent）等。 */
    style?: React.CSSProperties;
};

/** 卡片外框。 */
export function InfoCard({ className, children, style }: InfoCardProps) {
    return (
        <div className={cn("info-card", className)} style={style}>
            {children}
        </div>
    );
}

/** 卡片内的一个分区（多个分区用相同结构上下堆叠）。 */
export function InfoCardSection({ className, children }: InfoCardChildrenProps) {
    return <div className={cn("info-card-section", className)}>{children}</div>;
}

/** 分区标题行：图标 + 标题 +（可选）右侧补充信息。 */
export function InfoCardHead({ className, children }: InfoCardChildrenProps) {
    return <div className={cn("info-card-head", className)}>{children}</div>;
}

/** 标题行内的图标。icon 传完整 font-awesome class（如 "fa-solid fa-microchip"）。 */
export function InfoCardIcon({ className, icon }: { className?: string; icon: string }) {
    return <i className={cn("info-card-icon", icon, className)} />;
}

/** 标题行内的主标题（次要文字色，超长省略）。 */
export function InfoCardTitle({ className, children }: InfoCardChildrenProps) {
    return <span className={cn("info-card-title", className)}>{children}</span>;
}

/** 标题行右侧的补充信息（模型名 / 状态等，右对齐）。 */
export function InfoCardMeta({ className, children }: InfoCardChildrenProps) {
    return <span className={cn("info-card-meta", className)}>{children}</span>;
}

/** 状态行：图标 + 文字。icon 只传图标名（如 "circle-exclamation"），FA 前缀由组件补全。 */
export function InfoCardStatus({ className, icon, children }: { className?: string; icon: string; children?: React.ReactNode }) {
    return (
        <div className={cn("info-card-status", className)}>
            <i className={cn("info-card-status-icon", "fa-sharp", "fa-solid", icon)} />
            <span>{children}</span>
        </div>
    );
}

/** 可点击的内容预览（如 note 首行 / 文件路径）。 */
export function InfoCardPreview({ className, children, ...rest }: InfoCardChildrenProps & React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button type="button" className={cn("info-card-preview", className)} {...rest}>
            {children}
        </button>
    );
}

/** 正文文本（最多 3 行，超出省略）。 */
export function InfoCardText({ className, children }: InfoCardChildrenProps) {
    return <span className={cn("info-card-text", className)}>{children}</span>;
}

/** 空态占位（斜体次要文字）。 */
export function InfoCardEmpty({ className, children }: InfoCardChildrenProps) {
    return <span className={cn("info-card-empty", className)}>{children}</span>;
}

/** 行内编辑输入框。 */
export const InfoCardInput = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { className?: string }>(
    function InfoCardInput({ className, ...rest }, ref) {
        return <textarea ref={ref} className={cn("info-card-input", className)} {...rest} />;
    }
);

/** 错误提示。 */
export function InfoCardError({ className, children }: InfoCardChildrenProps) {
    return <div className={cn("info-card-error", className)}>{children}</div>;
}
