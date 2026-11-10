// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { formatAbsoluteTime, formatRelativeTime } from "@/app/view/vcs/vcs-time";
import { openLink } from "@/store/global";
import { fireAndForget } from "@/util/util";
import React from "react";
import { VcsIconButton } from "./vcs-icon-button";

/**
 * 共享提交行：VCS Changes 页 Remote 区（Incoming/Outgoing）与 vcshistory 块共用。
 * 两行式：主行 subject，副行 短hash · author · 相对时间（绝对时间进 title）。
 * 可选左侧 2px 语义轨（railColor）与展开指示（expandable/expanded/onToggle）。
 */
export function CommitRow({
    commit,
    railColor,
    expandable = false,
    expanded = false,
    onToggle,
    remoteOpenUrl,
}: {
    commit: VcsCommitInfo;
    /** 左侧 2px 语义轨的背景色类（如 bg-success / bg-accent）；不传则不渲染轨 */
    railColor?: string;
    expandable?: boolean;
    expanded?: boolean;
    onToggle?: () => void;
    /** 该提交在远程的网页地址；非空时主行 hover 浮现 ↗ 点击跳转 */
    remoteOpenUrl?: string;
}) {
    const shortHash = (hash: string) => (hash?.length > 10 ? hash.slice(0, 10) : hash);
    const subject = commit.subject || "(no subject)";
    const relativeTime = formatRelativeTime(commit.date);
    const clickable = expandable && onToggle != null;
    const subjectLine = expandable ? (
        <div className="flex min-w-0 items-center gap-1.5 text-xs">
            <span className="w-[12px] shrink-0 text-[11px] text-muted">{expanded ? "▾" : "▸"}</span>
            <span className="truncate">{subject}</span>
        </div>
    ) : (
        <div className="truncate text-xs">{subject}</div>
    );
    return (
        <div
            className={`group flex w-full items-stretch gap-2 border-b border-border px-2 py-[7px] last:border-b-0 hover:bg-hover${
                clickable ? " cursor-pointer" : ""
            }`}
            title={subject}
            onClick={clickable ? onToggle : undefined}
        >
            {railColor != null ? (
                <span className={`w-[2px] shrink-0 self-stretch rounded-full opacity-55 ${railColor}`} />
            ) : null}
            <div className="min-w-0 flex-1 py-[1px]">
                {subjectLine}
                <div className="mt-[3px] flex min-w-0 items-center gap-1.5 text-[10.5px] text-muted">
                    <span className="font-mono">{shortHash(commit.hash ?? "")}</span>
                    {commit.author ? (
                        <>
                            <span className="opacity-50">·</span>
                            <span className="max-w-[160px] truncate">{commit.author}</span>
                        </>
                    ) : null}
                    <span className="opacity-50">·</span>
                    <span title={formatAbsoluteTime(commit.date)}>{relativeTime || "—"}</span>
                </div>
            </div>
            {remoteOpenUrl != null && remoteOpenUrl !== "" && (
                <span className="flex shrink-0 self-center">
                    <VcsIconButton
                        icon="arrow-up-right-from-square"
                        title="Open commit on remote"
                        size="sm"
                        reveal="hover"
                        onClick={(e) => {
                            e.stopPropagation();
                            fireAndForget(async () => {
                                await openLink(remoteOpenUrl);
                            });
                        }}
                    />
                </span>
            )}
        </div>
    );
}

/**
 * 共享提交分组：标题 11px semibold + 计数 chip + 右侧发丝线 + 圆角容器。
 * count 为 0 时整组不渲染（沿用 Remote 区现状）。
 */
export function CommitGroup({ title, count, children }: { title: string; count: number; children?: React.ReactNode }) {
    if (count === 0) return null;
    return (
        <div className="mt-3">
            <div className="mb-1 flex items-center gap-1.5 px-0.5">
                <span className="text-[11px] font-semibold text-secondary">{title}</span>
                <span className="rounded bg-surface-soft px-1 font-mono text-[10px] leading-[15px] text-muted">
                    {count}
                </span>
                <span className="ml-1 h-px flex-1 bg-border" />
            </div>
            <div className="overflow-hidden rounded-[7px]">{children}</div>
        </div>
    );
}
