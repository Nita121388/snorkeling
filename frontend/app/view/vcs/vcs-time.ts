// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { i18n } from "@/i18n/config";

const Minute = 60_000;
const Hour = 60 * Minute;
const Day = 24 * Hour;
const Week = 7 * Day;

/**
 * 把 git 返回的时间串压成短相对时间，用于 VCS Remote 提交行的元信息行。
 * 解析失败时原样返回输入，保证不会因为脏数据把整行渲染打空。
 *
 * 文案走 `vcs:relative.*`（切语言即时生效）；`MM-DD` 那条是**日期格式**，
 * 由 `11-02-datetime-format-config` 的格式模式统一管，本模块不改。
 */
export function formatRelativeTime(value: string | undefined | null, now: number = Date.now()): string {
    if (value == null || value.trim() === "") return "";
    const ts = Date.parse(value);
    if (Number.isNaN(ts)) return value;
    const diff = now - ts;
    if (diff < 0) return i18n.t("vcs:relative.justNow");
    if (diff < Minute) return i18n.t("vcs:relative.justNow");
    if (diff < Hour) return i18n.t("vcs:relative.minutes", { count: Math.floor(diff / Minute) });
    if (diff < Day) return i18n.t("vcs:relative.hours", { count: Math.floor(diff / Hour) });
    if (diff < Week) return i18n.t("vcs:relative.days", { count: Math.floor(diff / Day) });
    const d = new Date(ts);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${mm}-${dd}`;
}

/** 绝对时间，用于 title 提示（解析失败时原样返回）。 */
export function formatAbsoluteTime(value: string | undefined | null): string {
    if (value == null || value.trim() === "") return "";
    const ts = Date.parse(value);
    if (Number.isNaN(ts)) return value;
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
