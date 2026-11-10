// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isBlank } from "@/util/util";

/**
 * VCS 远程跳转 URL 工具。
 *
 * 后端（pkg/wshrpc/wshremote/vcs.go loadGitRemoteUrls / loadSvnRemoteUrls）已把
 * `remoteurl`（原始 git@.../svn:// 形式）与 `browseurl`（归一化后的 https 网页地址）
 * 随仓库信息下发；本模块只做前端拼接，不发 RPC。
 */

/**
 * 仓库在浏览器打开的地址：优先 browseurl（https 网页），回退 remoteurl（原始形式，
 * 浏览器可能打不开但至少可见）。两者皆空返回 ""。
 */
export function getRepoOpenUrl(repo: VcsRepositoryInfo): string {
    if (repo == null) return "";
    const browseUrl = repo.browseurl ?? "";
    const remoteUrl = repo.remoteurl ?? "";
    const openUrl = !isBlank(browseUrl) ? browseUrl : remoteUrl;
    return openUrl.trim();
}

/**
 * 单个提交在远程的网页地址：`<browseurl>/commit/<hash>`。
 * 仅对有意义的前提成立——browseUrl 必须是归一化后的 https 仓库根（后端保证去 `.git` 后缀）。
 * 任一入参为空返回 ""（调用方据此隐藏入口）。
 */
export function buildCommitRemoteUrl(browseUrl: string, hash: string): string {
    if (isBlank(browseUrl) || isBlank(hash)) return "";
    const trimmedBrowse = browseUrl.trim().replace(/\/+$/, "");
    if (isBlank(trimmedBrowse)) return "";
    return `${trimmedBrowse}/commit/${hash.trim()}`;
}
