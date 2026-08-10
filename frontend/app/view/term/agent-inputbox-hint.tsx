// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 阶段 2：Agent TUI 输入态提示条（只读，无键盘接管）。
//
// 订阅 termWrap.agentInputBoxHintAtom（阶段 1 检测写入），在 composer /
// 权限提问输入态时于 TermStickers 同层悬浮一个小条。不做键盘接管，
// 仅验证"识别 → UI 出现/消失"闭环；误报时用户可点 × 关闭（lastLine
// 变化进入新的输入态后恢复显示）。

import { useAtomValueSafe } from "@/util/util";
import * as React from "react";
import type { InputBoxHint } from "./agent-inputbox-detect";
import type { TermWrap } from "./termwrap";

interface AgentInputBoxHintProps {
    /** 当前 term 的 TermWrap 实例；null 时不渲染。 */
    termWrap: TermWrap | null;
}

export const AgentInputBoxHint = React.memo(function AgentInputBoxHint({ termWrap }: AgentInputBoxHintProps) {
    const hint = useAtomValueSafe<InputBoxHint | null>(termWrap?.agentInputBoxHintAtom);
    const [dismissedLine, setDismissedLine] = React.useState<string | null>(null);

    if (termWrap == null || hint == null || hint.kind === "none") {
        return null;
    }
    // 误报时用户可关；lastLine 变化（进入新的输入态）时恢复显示。
    if (dismissedLine != null && dismissedLine === hint.lastLine) {
        return null;
    }

    const label = hint.kind === "composer" ? "✏️ 输入区已识别" : "⚠️ 权限提问";
    const dismiss = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        setDismissedLine(hint.lastLine);
    };

    return (
        <div className="absolute bottom-2 right-2 z-50 flex select-none items-center gap-2 rounded-md bg-zinc-800/90 px-2 py-1 text-xs text-secondary shadow-xl pointer-events-auto">
            <span>{label}</span>
            <button
                type="button"
                className="text-secondary/70 transition-colors hover:text-secondary"
                onClick={dismiss}
                aria-label="关闭提示"
            >
                ×
            </button>
        </div>
    );
});
