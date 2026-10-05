// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";
import clsx from "clsx";
import { CopyButton } from "@/app/element/copybutton";
import { IconButton } from "@/app/element/iconbutton";
import { sourceLineAttrs } from "./shared";

export type CodeBlockProps = {
    children: React.ReactNode;
    onClickExecute?: (cmd: string) => void;
    sourceLine?: number;
    sourceLineEnd?: number;
    /** Detected fence language (from the <code> child's className); null when unset. */
    language?: string | null;
    /** When provided the language badge becomes an editable affordance (方案 04 §2). */
    onApplyLanguage?: (lang: string | null) => void;
};

// 命令类语言：执行按钮常驻（不随 hover 隐藏）。本项目是终端工具，md 里的命令块一键执行
// 是核心场景，比 Wolai 把动作藏进块菜单更顺手。
export const ShellLikeLangs = new Set([
    "bash",
    "sh",
    "zsh",
    "fish",
    "shell",
    "shell-session",
    "console",
    "powershell",
    "ps1",
    "cmd",
    "bat",
]);

export function isShellLike(language?: string | null): boolean {
    return language != null && ShellLikeLangs.has(language.toLowerCase());
}

// 长代码块折叠阈值（行）。折叠只做 CSS 裁剪，DOM 文本不变 → inline-edit 行坐标安全。
export const CodeBlockCollapseLineThreshold = 30;

export const CodeBlock = ({
    children,
    onClickExecute,
    sourceLine,
    sourceLineEnd,
    language,
    onApplyLanguage,
}: CodeBlockProps) => {
    const [editingLang, setEditingLang] = useState(false);
    const [langDraft, setLangDraft] = useState("");
    const [expanded, setExpanded] = useState(false);
    const getTextContent = (children: any): string => {
        if (typeof children === "string") {
            return children;
        } else if (Array.isArray(children)) {
            return children.map(getTextContent).join("");
        } else if (children.props && children.props.children) {
            return getTextContent(children.props.children);
        }
        return "";
    };

    // 代码原文：复制、执行、行数统计共用一份（顶栏与折叠 UI 都不进这份文本）
    const codeText = getTextContent(children).replace(/\n$/, "");
    const lineCount = codeText === "" ? 0 : codeText.split("\n").length;
    const collapsible = lineCount > CodeBlockCollapseLineThreshold;
    const collapsed = collapsible && !expanded;

    const handleCopy = async (e: React.MouseEvent) => {
        await navigator.clipboard.writeText(codeText);
    };

    const handleExecute = (e: React.MouseEvent) => {
        if (onClickExecute) {
            onClickExecute(codeText);
            return;
        }
    };

    return (
        <pre
            className={clsx("codeblock", collapsed && "is-collapsed")}
            {...sourceLineAttrs(sourceLine, sourceLineEnd)}
            // 折叠态下双击进 inline-edit 前先展开，避免“看着被截断却在编辑全文”
            onDoubleClick={() => {
                if (collapsed) setExpanded(true);
            }}
        >
            {children}
            <div className="codeblock-header">
                {/* Language badge (方案 04 §2): click → inline input → Enter applies via a
                    one-line fence rewrite (setCodeBlockLanguage), Esc/blur cancels. */}
                {editingLang ? (
                    <input
                        className="codeblock-lang-input"
                        autoFocus
                        value={langDraft}
                        placeholder="language"
                        onChange={(e) => setLangDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                onApplyLanguage?.(langDraft.trim() || null);
                                setEditingLang(false);
                            } else if (e.key === "Escape") {
                                e.preventDefault();
                                setEditingLang(false);
                            }
                        }}
                        onBlur={() => setEditingLang(false)}
                        onClick={(e) => e.stopPropagation()}
                    />
                ) : onApplyLanguage != null ? (
                    <button
                        type="button"
                        className="codeblock-lang-badge"
                        title="Set language"
                        onClick={(e) => {
                            e.stopPropagation();
                            setLangDraft(language ?? "");
                            setEditingLang(true);
                        }}
                    >
                        {language ?? "text"}
                    </button>
                ) : (
                    language != null && <span className="codeblock-lang-badge is-static">{language}</span>
                )}
                <div className="codeblock-ops">
                    <CopyButton onClick={handleCopy} title="Copy" />
                    {onClickExecute && (
                        <IconButton
                            decl={{
                                elemtype: "iconbutton",
                                icon: "regular@square-terminal",
                                click: handleExecute,
                                className: isShellLike(language) ? "is-persistent" : undefined,
                            }}
                        />
                    )}
                </div>
            </div>
            {collapsible && (
                <button
                    type="button"
                    className="codeblock-expand"
                    onClick={(e) => {
                        e.stopPropagation();
                        setExpanded((v) => !v);
                    }}
                >
                    {expanded ? "收起" : `展开全部（共 ${lineCount} 行）`}
                </button>
            )}
        </pre>
    );
};