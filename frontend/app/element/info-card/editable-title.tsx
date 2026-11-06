// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// EditableTitle —— 会话标题的展示 / 内联编辑组件。
//
// 三个消费面共用这一份：放大弹窗的 header、悬浮卡的标题块、详情卡的标题行。
// 差异只在手势（弹窗双击、悬浮卡单击）与宽度，其余（截断、title 属性、
// TitleSourceBadge、Enter/Escape 语义、失败保持编辑态）完全一致。
//
// ESC 必须 stopPropagation（不是可选项）：
//   `frontend/app/app.tsx:349` 在 document 上挂了冒泡期 keydown，
//   全局 Escape 会走 `modalsModel.cancelTopModal()`（keymodel.ts:776）把整个弹窗关掉。
//   改动时不要"顺手清理"这两个调用。

import { TitleSourceBadge } from "@/app/view/aisessions/title-source-badge";
import { RenameTitleInputClass } from "@/app/view/aisessions/title-edit";
import { cn } from "@/util/util";
import * as React from "react";

export type EditableTitleProps = {
    title: string;
    placeholder?: string;
    /** "ai" 时渲染 AI 徽标；其余不渲染。 */
    titleSource?: string | null;
    /** 默认 true。false 时任何手势都不进编辑。 */
    editable?: boolean;
    /** 弹窗用 double，悬浮卡用 single。 */
    enterToEdit?: "double" | "single";
    /** 返回写入后的 summary（null = 没写/失败），据此决定是否退出编辑态。 */
    onCommit: (next: string) => Promise<unknown | null>;
    className?: string;
    /**
     * 展示形态。
     *  - `card`：agent 悬浮卡的标题块（12.5px / 2 行 clamp / 左侧状态色引用线）——
     *    与 0.0.121 的 `.agent-card-title-block` **逐属性一致**，编辑态也沿用同一套排版；
     *  - `inline`：详情头栏 / 弹窗 header 的紧凑单行（11px / 省略号）。
     */
    variant?: "card" | "inline";
};

/**
 * 标题展示 / 内联编辑。
 *
 * 提交语义：
 *   - `Enter` 或 `blur` → onCommit(trim 后的值)；
 *   - 空串 / 与现值相同 → 直接退出，不发请求（避免无意义的 SetTitle）；
 *   - onCommit 返回 null → **保持编辑态** + 行内错误（用户不用重新点开输入框）；
 *   - `Escape` → 放弃修改并退出编辑态（不提交）。
 */
export function EditableTitle({
    title,
    placeholder,
    titleSource,
    editable = true,
    enterToEdit = "double",
    onCommit,
    className,
    variant = "inline",
}: EditableTitleProps): React.ReactElement {
    const [editing, setEditing] = React.useState(false);
    const [draft, setDraft] = React.useState(title);
    const [error, setError] = React.useState("");
    const [pending, setPending] = React.useState(false);
    const inputRef = React.useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
    // 提交中重复触发（Enter 后紧跟 blur）只允许跑一次。
    const pendingRef = React.useRef(false);
    // Escape 之后浏览器仍会触发一次 blur；用这个标记让 blur 走"放弃"分支。
    const canceledRef = React.useRef(false);

    React.useEffect(() => {
        if (!editing) {
            setDraft(title);
        }
    }, [editing, title]);

    React.useEffect(() => {
        if (editing) {
            const element = inputRef.current;
            element?.focus();
            element?.select();
        }
    }, [editing]);

    const beginEdit = React.useCallback(() => {
        if (!editable) return;
        setDraft(title);
        setError("");
        canceledRef.current = false;
        setEditing(true);
    }, [editable, title]);

    const exitEditing = React.useCallback(() => {
        setEditing(false);
        canceledRef.current = false;
        setError("");
    }, []);

    const commit = React.useCallback(async () => {
        if (pendingRef.current) return;
        const next = draft.trim();
        if (canceledRef.current) {
            exitEditing();
            return;
        }
        if (next === "" || next === title.trim()) {
            exitEditing();
            return;
        }
        pendingRef.current = true;
        setPending(true);
        setError("");
        try {
            const result = await onCommit(next);
            if (result == null) {
                // 后端没写进去：留在编辑态，草稿不丢。
                setError("保存失败，请重试");
                return;
            }
            setEditing(false);
            setError("");
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            pendingRef.current = false;
            setPending(false);
        }
    }, [draft, exitEditing, onCommit, title]);

    const handleKeyDown = React.useCallback(
        (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            if (event.key === "Enter") {
                // textarea 里 Shift+Enter 允许换行（用户可能真要两行标题）；单独 Enter 提交。
                if (event.shiftKey && event.currentTarget instanceof HTMLTextAreaElement) {
                    return;
                }
                event.preventDefault();
                void commit();
                return;
            }
            if (event.key === "Escape") {
                // 只退出编辑，不关闭外层弹窗：必须拦在这里，否则 document 级的
                // 全局 Escape（cancelTopModal）会把整个对话框关掉、草稿直接丢。
                event.preventDefault();
                event.stopPropagation();
                canceledRef.current = true;
                exitEditing();
            }
        },
        [commit, exitEditing]
    );

    // single 同时绑 click 与 dblclick：真实浏览器里双击前必先发两次 click，
    // 这里显式绑上只是为了让"双击进入编辑"在单测/合成事件里也能成立（幂等）。
    const gestureProps =
        enterToEdit === "single"
            ? { onClick: beginEdit, onDoubleClick: beginEdit }
            : { onDoubleClick: beginEdit };

    const isCard = variant === "card";

    if (editing) {
        // 编辑态**不换排版**：同一个 .agent-card-title-block 盒子 + 左侧引用线，
        // 只把文字换成同名尺寸的 textarea（或 input）。
        //
        // 为什么不用 <input>：卡片标题是 2 行 clamp 的长文本，input 是单行控件，
        // 一进编辑就会丢换行、字号跳变、宽度溢出（实测把 340px 卡撞破）。
        // 为什么去掉边框/背景：Notion 的页面标题点进去是「文字直接变成可编辑」，
        // 不是凭空长出一个表单控件；常驻蓝色描边在卡片上像另一个交互。
        const editorClass = isCard ? "agent-card-title-editor" : RenameTitleInputClass;
        const shared = {
            value: draft,
            placeholder: placeholder ?? title,
            "aria-label": "Session title",
            spellCheck: false,
            disabled: pending,
            className: editorClass,
            onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                setDraft(event.target.value),
            onKeyDown: handleKeyDown,
            // 外部点击提交：mousedown 里别处会抢焦点，所以用 blur 兜住。
            onBlur: () => void commit(),
        };
        return (
            <span
                className={cn(
                    "editable-title is-editing",
                    isCard && "agent-card-title-wrap",
                    isCard && "agent-card-title-block",
                    className
                )}
            >
                {isCard ? (
                    <textarea ref={inputRef as React.RefObject<HTMLTextAreaElement>} rows={2} {...shared} />
                ) : (
                    <input ref={inputRef as React.RefObject<HTMLInputElement>} {...shared} />
                )}
                {error !== "" ? <span className="editable-title-error">{error}</span> : null}
            </span>
        );
    }

    // 展示态。card 变体直接复用 0.0.121 的 .agent-card-title-block（尺寸/clamp/引用线），
    // 不另写一份样式，避免“卡片标题又变了”这类回归。
    return (
        <span
            className={cn(
                "editable-title",
                isCard ? "agent-card-title-wrap" : "flex-1 min-w-0",
                className
            )}
        >
            <span
                className={cn(
                    isCard ? "agent-card-title-block" : "info-card-title",
                    editable && "is-editable",
                    editable && "cursor-text"
                )}
                title={title}
                {...(editable ? gestureProps : {})}
                role={editable ? "textbox" : undefined}
                aria-label={editable ? `Session title: ${title}` : undefined}
            >
                {isCard ? (
                    <>
                        <TitleSourceBadge titleSource={titleSource} className="mr-1 align-baseline" />
                        {title}
                    </>
                ) : (
                    title
                )}
            </span>
            {isCard ? null : <TitleSourceBadge titleSource={titleSource} className="ml-1 align-baseline" />}
        </span>
    );
}

EditableTitle.displayName = "EditableTitle";
