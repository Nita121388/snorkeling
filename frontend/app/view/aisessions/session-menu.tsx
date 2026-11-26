// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 头栏 "···" 会话操作菜单：低频操作、会话信息与复制入口。
// 对齐 .mockup/aisessions-chat-redesign 的极简头栏规范。

import { i18n } from "@/i18n/config";
import { cn } from "@/util/util";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { copyText } from "./utils";

function MenuRow({
    icon,
    label,
    onClick,
    disabled,
    disabledReason,
    trailing,
    onMouseEnter,
    danger,
}: {
    icon: string;
    label: string;
    onClick?: () => void;
    disabled?: boolean;
    disabledReason?: string;
    trailing?: React.ReactNode;
    onMouseEnter?: () => void;
    danger?: boolean;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            title={disabled ? disabledReason : undefined}
            onMouseEnter={onMouseEnter}
            onClick={onClick}
            className={cn(
                "flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs",
                disabled
                    ? "cursor-default text-secondary/50"
                    : danger
                      ? "cursor-pointer text-error hover:bg-error/10"
                      : "cursor-pointer text-primary hover:bg-hover"
            )}
        >
            <i
                className={cn(
                    "fa-sharp fa-solid w-3.5 shrink-0 text-center text-[11px]",
                    danger ? "text-error" : "text-secondary",
                    icon
                )}
            />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {trailing}
        </button>
    );
}

export function SessionMoreMenu({
    projectDirectory,
    sessionFilePath,
    sessionId,
    sessionKey,
    restoreCommand,
    canResume = true,
    buildMarkdown,
    onRename,
    onEditNote,
    onResume,
    onRefresh,
    onOpenProjectDirectory,
    onOpenSessionFile,
    onDelete,
    onGenerate,
    restoring = false,
    refreshing = false,
    deleting = false,
}: {
    projectDirectory: string;
    sessionFilePath: string;
    sessionId: string;
    sessionKey?: string;
    restoreCommand: string;
    /**
     * R8：该来源能否恢复。false 时不渲染 Resume 与「复制恢复命令」两项——
     * 声明式 provider（antigravity）没有恢复命令，置灰仍可能被误点。
     */
    canResume?: boolean;
    buildMarkdown: () => string;
    onRename?: () => void;
    onEditNote: () => void;
    onResume: () => void;
    onRefresh: () => void;
    onOpenProjectDirectory: () => void;
    onOpenSessionFile: () => void;
    onDelete: () => void;
    /** 一键 AI 生成；不传则不渲染这两个菜单项。 */
    onGenerate?: (kind: "title" | "metadata" | "both") => void;
    restoring?: boolean;
    refreshing?: boolean;
    deleting?: boolean;
}) {
    const { t } = useTranslation("aisessions");
    const [open, setOpen] = useState(false);
    const [subOpen, setSubOpen] = useState(false);
    const [copiedLabel, setCopiedLabel] = useState("");
    // 二级菜单「已复制」提示按 kind 记，不能从 label 文案反推（label 会随语言翻译）。
    const [copiedKind, setCopiedKind] = useState("");
    const rootRef = useRef<HTMLDivElement | null>(null);
    // 二级菜单 hover 关闭防抖计时器：跨越行与弹窗间隙时避免误关。
    const subCloseTimer = useRef<number | null>(null);

    useEffect(() => {
        if (!open) return;
        const handlePointer = (e: MouseEvent) => {
            if (rootRef.current != null && !rootRef.current.contains(e.target as Node)) {
                if (subCloseTimer.current != null) {
                    window.clearTimeout(subCloseTimer.current);
                    subCloseTimer.current = null;
                }
                setOpen(false);
                setSubOpen(false);
            }
        };
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setOpen(false);
                setSubOpen(false);
            }
        };
        document.addEventListener("mousedown", handlePointer);
        document.addEventListener("keydown", handleKey);
        return () => {
            document.removeEventListener("mousedown", handlePointer);
            document.removeEventListener("keydown", handleKey);
            if (subCloseTimer.current != null) window.clearTimeout(subCloseTimer.current);
        };
    }, [open]);

    const copyAndClose = useCallback((text: string, label: string, kind: string) => {
        void copyText(text);
        setCopiedLabel(label);
        setCopiedKind(kind);
        window.setTimeout(() => {
            setCopiedLabel("");
            setCopiedKind("");
            setOpen(false);
            setSubOpen(false);
        }, 700);
    }, []);

    const hasCopied = copiedLabel !== "";
    const closeAndRun = useCallback((action: () => void) => {
        setOpen(false);
        setSubOpen(false);
        action();
    }, []);

    // 二级菜单延迟关闭：跨越行与弹窗之间的间隙时给光标 140ms 进入弹窗，避免误关。
    const cancelSubClose = useCallback(() => {
        if (subCloseTimer.current != null) {
            window.clearTimeout(subCloseTimer.current);
            subCloseTimer.current = null;
        }
    }, []);
    const scheduleSubClose = useCallback(() => {
        if (subCloseTimer.current != null) window.clearTimeout(subCloseTimer.current);
        subCloseTimer.current = window.setTimeout(() => {
            subCloseTimer.current = null;
            setSubOpen(false);
        }, 140);
    }, []);

    return (
        <div ref={rootRef} className="relative shrink-0">
            <button
                type="button"
                aria-label={t("aisessions:menu.actions")}
                title={t("aisessions:menu.more")}
                onClick={() => setOpen((current) => !current)}
                className={cn(
                    "flex h-6 w-6 cursor-pointer items-center justify-center rounded text-secondary transition-colors hover:bg-hover hover:text-primary",
                    open && "bg-hover text-primary"
                )}
            >
                <i className={cn("fa-sharp fa-solid text-xs", hasCopied ? "fa-check text-accent" : "fa-ellipsis")} />
            </button>
            {open ? (
                <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-border bg-modalbg p-1 shadow-2xl">
                    <MenuRow
                        icon="fa-pen"
                        label={t("aisessions:menu.rename")}
                        disabled={!onRename}
                        disabledReason={onRename ? undefined : t("aisessions:menu.renameSoon")}
                        onClick={
                            onRename
                                ? () => {
                                      closeAndRun(onRename);
                                  }
                                : undefined
                        }
                    />
                    <MenuRow
                        icon="fa-note-sticky"
                        label={t("aisessions:menu.editNote")}
                        onClick={() => closeAndRun(onEditNote)}
                    />
                    {onGenerate != null ? (
                        <>
                            <MenuRow
                                icon="fa-wand-magic-sparkles"
                                label={t("aisessions:menu.genTitle")}
                                disabled={!sessionKey}
                                disabledReason={sessionKey ? undefined : t("aisessions:menu.keyUnavailable")}
                                onClick={() => closeAndRun(() => onGenerate("title"))}
                            />
                            <MenuRow
                                icon="fa-wand-magic-sparkles"
                                label={t("aisessions:menu.genNote")}
                                disabled={!sessionKey}
                                disabledReason={sessionKey ? undefined : t("aisessions:menu.keyUnavailable")}
                                onClick={() => closeAndRun(() => onGenerate("metadata"))}
                            />
                        </>
                    ) : null}
                    {canResume ? (
                        <MenuRow
                            icon={restoring ? "fa-spinner animate-spin" : "fa-square-terminal"}
                            label={restoring ? t("aisessions:menu.resuming") : t("aisessions:menu.resume")}
                            disabled={restoring}
                            disabledReason={t("aisessions:menu.restoring")}
                            onClick={() => closeAndRun(onResume)}
                        />
                    ) : null}
                    <MenuRow
                        icon={refreshing ? "fa-spinner animate-spin" : "fa-rotate"}
                        label={refreshing ? t("aisessions:menu.refreshing") : t("aisessions:menu.refresh")}
                        disabled={refreshing}
                        disabledReason={t("aisessions:menu.refreshingSession")}
                        onClick={() => closeAndRun(onRefresh)}
                    />
                    <MenuRow
                        icon="fa-folder-open"
                        label={t("aisessions:menu.openProject")}
                        disabled={!projectDirectory}
                        disabledReason={t("aisessions:menu.noProject")}
                        onClick={() => closeAndRun(onOpenProjectDirectory)}
                    />
                    <MenuRow
                        icon="fa-file-arrow-up"
                        label={t("aisessions:menu.openFile")}
                        disabled={!sessionFilePath}
                        disabledReason={t("aisessions:menu.noFile")}
                        onClick={() => closeAndRun(onOpenSessionFile)}
                    />
                    <div className="mx-2 my-1 h-px bg-border" />
                    <div
                        className="relative"
                        onMouseEnter={() => {
                            cancelSubClose();
                            setSubOpen(true);
                        }}
                        onMouseLeave={scheduleSubClose}
                    >
                        <MenuRow
                            icon="fa-copy"
                            label={hasCopied ? copiedLabel : t("aisessions:menu.copy")}
                            onClick={() => setSubOpen((current) => !current)}
                            trailing={
                                <i
                                    className={cn(
                                        "fa-sharp fa-solid fa-chevron-right text-[9px] text-secondary transition-transform",
                                        subOpen && "-rotate-90"
                                    )}
                                />
                            }
                        />
                        {subOpen ? (
                            <div
                                className="absolute right-0 top-full z-10 mt-1 w-56 rounded-lg border border-border bg-modalbg p-1 shadow-2xl"
                                onMouseEnter={cancelSubClose}
                            >
                                <MenuRow
                                    icon="fa-folder"
                                    label={
                                        hasCopied === true && copiedKind === "directory"
                                            ? t("aisessions:menu.copied")
                                            : t("aisessions:menu.workingDir")
                                    }
                                    disabled={!projectDirectory}
                                    disabledReason={t("aisessions:menu.noWorkingDir")}
                                    onClick={() =>
                                        copyAndClose(projectDirectory, t("aisessions:menu.copiedDir"), "directory")
                                    }
                                />
                                <MenuRow
                                    icon="fa-file-lines"
                                    label={t("aisessions:menu.filePath")}
                                    disabled={!sessionFilePath}
                                    disabledReason={t("aisessions:menu.noFile")}
                                    onClick={() =>
                                        copyAndClose(sessionFilePath, t("aisessions:menu.copiedFilePath"), "filepath")
                                    }
                                />
                                <MenuRow
                                    icon="fa-fingerprint"
                                    label={t("aisessions:menu.sessionId")}
                                    onClick={() => copyAndClose(sessionId, t("aisessions:menu.copiedId"), "id")}
                                />
                                {canResume ? (
                                    <MenuRow
                                        icon="fa-terminal"
                                        label={t("aisessions:menu.resumeCommand")}
                                        onClick={() =>
                                            copyAndClose(restoreCommand, t("aisessions:menu.copiedResume"), "resume")
                                        }
                                    />
                                ) : null}
                                <div className="mx-2 my-1 h-px bg-border" />
                                <MenuRow
                                    icon="fa-brackets-curly"
                                    label={t("aisessions:menu.markdown")}
                                    onClick={() =>
                                        copyAndClose(buildMarkdown(), t("aisessions:menu.copiedMd"), "markdown")
                                    }
                                />
                            </div>
                        ) : null}
                    </div>
                    <div className="mx-2 my-1 h-px bg-border" />
                    <MenuRow
                        icon={deleting ? "fa-spinner animate-spin" : "fa-trash"}
                        label={deleting ? t("aisessions:menu.deleting") : t("aisessions:menu.delete")}
                        disabled={deleting}
                        disabledReason={t("aisessions:menu.deletingSession")}
                        danger
                        onClick={() => closeAndRun(onDelete)}
                    />
                </div>
            ) : null}
        </div>
    );
}

/** 把当前会话消息导出为 Markdown 文本（用户/AI 消息 + 工具调用 details 块）。 */
export function buildSessionMarkdown(
    sessionTitle: string,
    source: string,
    sessionId: string,
    messages: Message[],
    toolCalls?: ToolCall[]
): string {
    const lines: string[] = [`# ${sessionTitle}`, "", `> Source: ${source} · Session ID: \`${sessionId}\``, ""];
    for (const message of messages) {
        if (message.role === "user") {
            lines.push("**🧑 You:**", "", message.text.trim(), "");
        } else {
            lines.push(`**🤖 ${message.role ?? "assistant"}：**`, "", message.text.trim(), "");
        }
    }
    for (const toolCall of toolCalls ?? []) {
        const summaryText = [toolCall.name, toolCall.summary, toolCall.output].filter(Boolean).join("\n").trim();
        lines.push(
            `<details><summary><code>${toolCall.name ?? "tool"}</code></summary>`,
            "",
            "```",
            summaryText,
            "```",
            "",
            "</details>",
            ""
        );
    }
    return lines.join("\n");
}
