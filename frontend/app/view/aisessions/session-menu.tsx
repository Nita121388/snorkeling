// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 头栏 "···" 会话操作菜单：低频操作、会话信息与复制入口。
// 对齐 .mockup/aisessions-chat-redesign 的极简头栏规范。

import { cn } from "@/util/util";
import { useCallback, useEffect, useRef, useState } from "react";
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
    restoreCommand,
    buildMarkdown,
    onRename,
    onEditNote,
    onResume,
    onRefresh,
    onOpenProjectDirectory,
    onOpenSessionFile,
    onDelete,
    restoring = false,
    refreshing = false,
    deleting = false,
}: {
    projectDirectory: string;
    sessionFilePath: string;
    sessionId: string;
    restoreCommand: string;
    buildMarkdown: () => string;
    onRename?: () => void;
    onEditNote: () => void;
    onResume: () => void;
    onRefresh: () => void;
    onOpenProjectDirectory: () => void;
    onOpenSessionFile: () => void;
    onDelete: () => void;
    restoring?: boolean;
    refreshing?: boolean;
    deleting?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [subOpen, setSubOpen] = useState(false);
    const [copiedLabel, setCopiedLabel] = useState("");
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

    const copyAndClose = useCallback((text: string, label: string) => {
        void copyText(text);
        setCopiedLabel(label);
        window.setTimeout(() => {
            setCopiedLabel("");
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
                aria-label="Session actions"
                title="更多操作"
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
                        label="重命名聊天"
                        disabled={!onRename}
                        disabledReason={onRename ? undefined : "即将支持（需后端标题覆盖）"}
                        onClick={
                            onRename
                                ? () => {
                                      closeAndRun(onRename);
                                  }
                                : undefined
                        }
                    />
                    <MenuRow icon="fa-note-sticky" label="编辑 Note 和 Tags" onClick={() => closeAndRun(onEditNote)} />
                    <MenuRow
                        icon={restoring ? "fa-spinner animate-spin" : "fa-square-terminal"}
                        label={restoring ? "正在 Resume..." : "Resume 到终端"}
                        disabled={restoring}
                        disabledReason="正在恢复会话"
                        onClick={() => closeAndRun(onResume)}
                    />
                    <MenuRow
                        icon={refreshing ? "fa-spinner animate-spin" : "fa-rotate"}
                        label={refreshing ? "正在刷新..." : "刷新会话"}
                        disabled={refreshing}
                        disabledReason="正在刷新会话"
                        onClick={() => closeAndRun(onRefresh)}
                    />
                    <MenuRow
                        icon="fa-folder-open"
                        label="打开项目目录"
                        disabled={!projectDirectory}
                        disabledReason="无项目目录"
                        onClick={() => closeAndRun(onOpenProjectDirectory)}
                    />
                    <MenuRow
                        icon="fa-file-arrow-up"
                        label="打开会话文件"
                        disabled={!sessionFilePath}
                        disabledReason="无会话文件"
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
                            label={hasCopied ? copiedLabel : "复制"}
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
                                    label={hasCopied === true && copiedLabel.includes("目录") ? "已复制 ✓" : "工作目录"}
                                    disabled={!projectDirectory}
                                    disabledReason="无工作目录"
                                    onClick={() => copyAndClose(projectDirectory, "已复制工作目录")}
                                />
                                <MenuRow
                                    icon="fa-file-lines"
                                    label="会话文件路径"
                                    disabled={!sessionFilePath}
                                    disabledReason="无会话文件"
                                    onClick={() => copyAndClose(sessionFilePath, "已复制文件路径")}
                                />
                                <MenuRow
                                    icon="fa-fingerprint"
                                    label="会话 ID"
                                    onClick={() => copyAndClose(sessionId, "已复制会话 ID")}
                                />
                                <MenuRow
                                    icon="fa-terminal"
                                    label="Resume 命令"
                                    onClick={() => copyAndClose(restoreCommand, "已复制 Resume 命令")}
                                />
                                <div className="mx-2 my-1 h-px bg-border" />
                                <MenuRow
                                    icon="fa-brackets-curly"
                                    label="Markdown（全文）"
                                    onClick={() => copyAndClose(buildMarkdown(), "已复制 Markdown 全文")}
                                />
                            </div>
                        ) : null}
                    </div>
                    <div className="mx-2 my-1 h-px bg-border" />
                    <MenuRow
                        icon={deleting ? "fa-spinner animate-spin" : "fa-trash"}
                        label={deleting ? "正在删除..." : "删除会话..."}
                        disabled={deleting}
                        disabledReason="正在删除会话"
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
    const lines: string[] = [`# ${sessionTitle}`, "", `> 来源: ${source} · 会话 ID: \`${sessionId}\``, ""];
    for (const message of messages) {
        if (message.role === "user") {
            lines.push("**🧑 你：**", "", message.text.trim(), "");
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
