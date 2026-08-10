// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 阶段 3：Agent TUI 大输入框镜像（键盘接管 + PTY 注入）。
//
// 识别到 composer 输入态时，悬浮一个 textarea 作为"大输入框"：
//  - 字符键/方向键/Home/End 默认留在 textarea（多行编辑需要；偏离调研笔记
//    "编辑键放行给 xterm"——codex composer 输入内容在 GUI 侧时 TUI 行编辑无意义，
//    方向键必须留在 GUI 才能编辑已输入文本）；
//  - Enter 发送 `text + "\n"` 到 PTY（termWrap.sendDataHandler）；Shift+Enter 换行；
//  - Esc/Ctrl+C 等控制键转发到 PTY（agent 需要它们取消/中断，TUI 侧无行编辑）；
//  - IME：onCompositionStart/End 期间不发字节；
//  - 防双写：GUI textarea 聚焦时焦点不在 xterm，xterm 不产生 onData；失焦即关闭。
//
// 发送后 agent 重绘 → hint 变化/消失 → 输入框自动收起或继续（codex Working 时
// composer 仍在底部，可连续输入）。

import { useAtomValueSafe } from "@/util/util";
import * as React from "react";
import type { InputBoxHint } from "./agent-inputbox-detect";
import type { TermWrap } from "./termwrap";

interface AgentComposerOverlayProps {
    /** 当前 term 的 TermWrap 实例；null 时不渲染。 */
    termWrap: TermWrap | null;
}

export const AgentComposerOverlay = React.memo(function AgentComposerOverlay({ termWrap }: AgentComposerOverlayProps) {
    const hint = useAtomValueSafe<InputBoxHint | null>(termWrap?.agentInputBoxHintAtom);
    const [dismissedLine, setDismissedLine] = React.useState<string | null>(null);
    const [text, setText] = React.useState("");
    const [isComposing, setIsComposing] = React.useState(false);
    const taRef = React.useRef<HTMLTextAreaElement>(null);

    const isComposer = termWrap != null && hint != null && hint.kind === "composer";
    const open = isComposer && dismissedLine !== hint.lastLine;

    // 打开时自动聚焦（键盘接管从这一刻开始；误判时点 × 或点击外部退出）。
    React.useEffect(() => {
        if (open) {
            taRef.current?.focus();
        }
    }, [open]);

    if (!open) {
        return null;
    }

    const send = () => {
        if (text.trim() === "") {
            return; // 空内容不发送（agent 空输入无操作）
        }
        // 分两步发送（实测 codex 0.147）：
        //  1. 先发字符（含 \n 换行，Wave 的 Shift+Enter 就发 \n，codex 当换行）；
        //  2. 延迟 150ms 再单独发 \r（Enter）。
        // 原因：同一 tick 内连续两次 ControllerInputCommand 会被 codex/wavesrv
        // 合并为一批数据，\r 被当粘贴内容不触发提交；必须有间隔才等于真实 Enter。
        const submit = () => termWrap.sendDataHandler("\r");
        termWrap.sendDataHandler(text);
        window.setTimeout(submit, 150);
        setText("");
        // 发送后 agent 会重绘（可能进入 Working / 更新 composer），hint 变化时
        // dismissedLine 自动失效，输入框保持可继续输入。
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (isComposing) {
            return; // IME 组合中：Enter/Esc 等交给输入法，不发送
        }
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
            return;
        }
        // 控制键转发到 PTY（agent 行编辑在 TUI 侧，Esc 取消 / Ctrl+C 中断）。
        if (event.key === "Escape") {
            event.preventDefault();
            termWrap.sendDataHandler("\u001b");
            setText("");
            return;
        }
        if (event.key === "c" && event.ctrlKey) {
            event.preventDefault();
            termWrap.sendDataHandler("\u0003");
            return;
        }
        // 其余键（字符/方向键/Home/End/Shift+Enter）走 textarea 默认行为。
    };

    const rows = Math.min(5, Math.max(1, text.split("\n").length));

    return (
        <div className="pointer-events-auto absolute bottom-4 left-1/2 z-50 w-[min(70%,560px)] -translate-x-1/2">
            <div className="flex items-start gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--form-element-bg-color)] p-2 shadow-2xl">
                <span className="mt-1 shrink-0 select-none text-sm text-[var(--form-element-text-color)]">
                    {hint.prompt}
                </span>
                <textarea
                    ref={taRef}
                    className="min-h-6 w-full resize-none bg-transparent font-mono text-sm leading-6 text-[var(--form-element-text-color)] outline-none placeholder:text-secondary/50"
                    value={text}
                    rows={rows}
                    placeholder="输入消息，Enter 发送，Shift+Enter 换行…"
                    onChange={(event) => setText(event.target.value)}
                    onKeyDown={handleKeyDown}
                    onCompositionStart={() => setIsComposing(true)}
                    onCompositionEnd={() => setIsComposing(false)}
                    onBlur={() => setDismissedLine(hint.lastLine)}
                />
                <button
                    type="button"
                    className="mt-0.5 shrink-0 text-secondary/70 transition-colors hover:text-secondary"
                    onClick={() => setDismissedLine(hint.lastLine)}
                    aria-label="关闭大输入框"
                >
                    ×
                </button>
            </div>
        </div>
    );
});
