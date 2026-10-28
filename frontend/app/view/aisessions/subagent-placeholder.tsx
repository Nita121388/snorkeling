// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 子代理未匹配到子会话（或缺失子会话文件）时的占位卡。
 *
 * 折叠态一行：agent + task + 状态点 + 一个「未载入子会话」提示。
 * 不可展开，但至少让用户知道"这里派发了一个子代理"，而不是静默退化成普通工具行。
 */
export function SubagentPlaceholderCard({
    match,
}: {
    match: SubagentMatch;
}) {
    const agentName = (match.call.agent ?? "").trim() || "subagent";
    const taskText = (match.call.task ?? "").replace(/\s+/g, " ").trim();
    return (
        <div className="my-1 min-w-0 overflow-hidden rounded-lg border border-border/60 border-l-2 border-dashed bg-surface-soft">
            <div className="flex w-full items-center gap-2 px-2 py-1 text-left opacity-90">
                <i className="fa-sharp fa-solid fa-robot shrink-0 text-[9px] text-secondary" />
                <span className="shrink-0 text-[11px] font-semibold text-secondary">{agentName}</span>
                {taskText !== "" ? (
                    <span className="min-w-0 flex-1 truncate text-[11px] text-secondary">{taskText}</span>
                ) : (
                    <span className="flex-1" />
                )}
                <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-secondary"
                    title="Subagent dispatched; child session not loaded"
                />
            </div>
            <div className="px-2 pb-1.5 text-[10px] text-secondary">Subagent dispatched · child session not loaded</div>
        </div>
    );
}
