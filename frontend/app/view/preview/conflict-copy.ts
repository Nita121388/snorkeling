// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 「复制给 agent」的 VCS/冲突域构建器（Copy for Agent 共享契约的消费者）。
 *
 * 三个出口，全部走 buildAgentPayload 三段式（Context → Task → Output contract）：
 *   1. buildConflictCopyText      —— 文件保存冲突（base→mine / base→theirs 双 diff）；
 *   2. buildVcsOperationFailurePayload —— VCS push/commit 等操作失败（stderr 截断 200 行）；
 *   3. buildMergeConflictsPayload —— git 合并冲突（<<<<<<< / >>>>>>> 片段，±3 行上下文）。
 */
import { buildAgentPayload, FIX_COMMAND_ONLY, MERGED_CONTENT_ONLY } from "@/app/element/agent-payload";
import { createTwoFilesPatch } from "diff";

export const VCS_STDERR_MAX_LINES = 200;

/** git porcelain 的 unmerged 状态码（XY 两列任一为 U/A/D 的组合都是冲突）。 */
export function isUnmergedCode(code: string): boolean {
    return /^(UU|AA|DD|AU|UA|DU|UD)/.test((code ?? "").trim());
}

/**
 * 文件保存冲突 → 一段自包含的 agent 文本。
 *
 * 历史上的第四套格式（无输出契约小节）已收口：内部改走 buildAgentPayload，
 * 双 diff 结构保持不变（既有 file-conflict-modal 调用点签名不变）。
 */
export function buildConflictCopyText(
    filePath: string,
    baseContent: string,
    mineContent: string,
    theirsContent: string
): string {
    const patchOpts = { context: 3 };
    const minePatch = createTwoFilesPatch(
        `${filePath} (base)`,
        "your draft",
        baseContent,
        mineContent,
        "",
        "",
        patchOpts
    );
    const theirsPatch = createTwoFilesPatch(
        `${filePath} (base)`,
        "current disk",
        baseContent,
        theirsContent,
        "",
        "",
        patchOpts
    );
    const context = [
        `File conflict: ${filePath}`,
        "This file was modified externally while you were editing it (possibly by an AI Agent). Your unsaved changes conflict with the current disk content.",
        "",
        "== Your unsaved changes (base → your draft) ==",
        "",
        minePatch,
        "",
        "== External changes (base → current disk) ==",
        "",
        theirsPatch,
    ].join("\n");
    return buildAgentPayload({
        context,
        task: "Analyze both sides and merge them into one complete file.",
        outputContract: MERGED_CONTENT_ONLY,
    });
}

export type VcsOperationFailureInput = {
    /** 失败的操作：pull / push / fetch / update / commit。 */
    action: string;
    /** 仓库根路径（agent 需要在哪里跑命令）。 */
    repoPath: string;
    /** 失败摘要（RPC 返回的 error/output 首行）。 */
    message: string;
    /** 原始 stderr/stdout 全文（优先保留，超过 200 行时截断并标注）。 */
    details?: string;
};

/** VCS 操作失败 → 诊断 payload（结论 + 最小修复命令，不写分析长文）。 */
export function buildVcsOperationFailurePayload(input: VcsOperationFailureInput): string {
    const allLines = (input.details ?? "").split("\n");
    const truncated = allLines.length > VCS_STDERR_MAX_LINES;
    const lines = truncated ? allLines.slice(-VCS_STDERR_MAX_LINES) : allLines;
    const context = [
        `- action: ${input.action || "(unknown)"}`,
        `- repo: ${input.repoPath || "(unknown)"}`,
        `- error: ${input.message || "(no message)"}`,
        `- stderr (${lines.length} of ${allLines.length} lines${truncated ? ", truncated to the last " + VCS_STDERR_MAX_LINES : ""}):`,
    ];
    if (truncated) {
        context.push(`  … (truncated, full output: ${allLines.length} lines)`);
    }
    for (const line of lines) {
        context.push(`  ${line}`);
    }
    return buildAgentPayload({
        context: context.join("\n"),
        task: "Diagnose why the git operation failed and name the smallest fix.",
        outputContract: FIX_COMMAND_ONLY,
    });
}

/** 单文件冲突片段的行预算（PRD 上限 60 行，超出截断标注）。 */
export const MERGE_SEGMENT_MAX_LINES = 60;
/** 冲突块两侧各带几行上下文（与双 diff 的 context: 3 对齐）。 */
export const MERGE_SEGMENT_CONTEXT = 3;

/**
 * 从文件内容里截取合并冲突片段：`<<<<<<<` 到 `>>>>>>>` 整块，两侧各 ±context 行；
 * 多个块之间用 `…` 分隔。没有冲突标记（读失败/已解决）返回空串。
 */
export function extractConflictSegments(content: string, contextLines: number = MERGE_SEGMENT_CONTEXT): string {
    const lines = (content ?? "").split("\n");
    const segments: string[] = [];
    let i = 0;
    while (i < lines.length) {
        if (lines[i].startsWith("<<<<<<<")) {
            let j = i;
            while (j < lines.length && !lines[j].startsWith(">>>>>>>")) {
                j++;
            }
            if (j >= lines.length) {
                // 无结束标记（内容被截断）：整段收进来，宁多勿缺。
                j = lines.length - 1;
            }
            const from = Math.max(0, i - contextLines);
            const to = Math.min(lines.length - 1, j + contextLines);
            segments.push(lines.slice(from, to + 1).join("\n"));
            i = j + 1;
        } else {
            i++;
        }
    }
    return segments.join("\n…\n");
}

export type MergeConflictFile = {
    path: string;
    /** 文件全文（含冲突标记）；构建器只截冲突片段。 */
    content: string;
};

/** git 合并冲突（一或多个文件）→ 合并 payload（多文件 `=== path ===` 分段，便于回填）。 */
export function buildMergeConflictsPayload(files: MergeConflictFile[]): string {
    const sections: string[] = [];
    let totalConflicts = 0;
    for (const file of files) {
        let segment = extractConflictSegments(file.content);
        if (segment === "") {
            continue;
        }
        totalConflicts++;
        const allLines = segment.split("\n");
        if (allLines.length > MERGE_SEGMENT_MAX_LINES) {
            segment =
                allLines.slice(0, MERGE_SEGMENT_MAX_LINES).join("\n") +
                `\n… (truncated, this file has ${allLines.length} conflict context lines)`;
        }
        sections.push(`=== ${file.path} ===\n${segment}`);
    }
    if (totalConflicts === 0) {
        // 调用方只在检测到 unmerged 状态码时出现；读不到标记时也不能产出一段「没有证据」的空任务。
        throw new Error("buildMergeConflictsPayload: no conflict markers found in any file");
    }
    return buildAgentPayload({
        context: [
            `${totalConflicts} file(s) with unresolved merge conflicts. Each section below is one file, containing every conflict block with 3 lines of surrounding context.`,
            "",
            ...sections,
        ].join("\n"),
        task: "Resolve these merge conflicts and output only the resolved file contents.",
        outputContract: MERGED_CONTENT_ONLY,
    });
}
