// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 编辑目标定位 + 手势意图判定（纯 DOM，零 React、零宿主）。
 *
 * 这两个函数处理的是编辑引擎最靠外的两个问题：
 *   1. **点哪一个元素进编辑**（锚点可能已不在 DOM 里 —— 块被重渲染/替换过，此时按行号回退）
 *   2. **这次点击该不该进编辑**（用户正在拖选文本时不能劫持手势）
 *
 * 之所以要在 test 里单独锁住「用户正在选区」这条：它是**手势层**的判据，而
 * `markdown.tsx` 里还有一条基于选区**长度**的启发式。两者覆盖面不同 ——
 * 长度启发式只能抓住「已经长出来」的选区，抓不住"刚按下、选区还是空的"那一瞬，
 * 而那一瞬点击会被当成"进入编辑"，表现为「拖选一开头就被打断」。
 */

/** 会话里定位所需的**最小**视图：刻意不含 React 类型与回调（窄接口）。 */
export type EditableHostTarget = {
    blockKind: string;
    startLine: number;
    targetEl: HTMLElement;
};

/**
 * 回退选择器：锚点元素已经不在 DOM 里时，按行号在渲染根里重新定位。
 *
 * 刻意**与块类型无关** —— 任何渲染器产出的块都带 `data-source-line`，
 * 所以列表/表格/代码这些后加的块类型都走同一条路径，不需要 per-kind 映射表
 * （per-kind 映射表正是那种"加了新块型忘了登记"的漂移源）。
 */
export function fallbackSelector(startLine: number): string {
    return `.markdown-render-root [data-source-line="${startLine}"]`;
}

/**
 * 解析「这次编辑应该锚在哪个元素上」。
 *
 * 优先用会话里锚定的元素 —— 但**必须校验它仍然属于当前 viewport 且已连接**：
 * 编辑会话可能跨越一次重渲染，旧锚点会变成 detached 节点；此时在 detached 节点上
 * 进 contenteditable，用户看不到任何东西，而提交又按行号切片 —— 结果就是"编辑了个空气"。
 * 校验失败时按行号回退。
 */
export function resolveInlineEditTarget(
    viewport: HTMLElement,
    session: EditableHostTarget
): HTMLElement | null {
    if (session.targetEl.isConnected && viewport.contains(session.targetEl)) {
        return session.targetEl;
    }
    return viewport.querySelector<HTMLElement>(fallbackSelector(session.startLine));
}

/**
 * 手势意图：当前是否处于**活跃选区**（用户正在选文本）？
 *
 * `Range` 型选区意味着用户正在拖选（或刚选完），此时点击**不得**打开编辑器。
 * `sel` 只要求最小 Selection-like 形状，这样 jsdom/node 测试可以传普通对象、
 * 也能直接吃 `window.getSelection()` 的结果。
 */
export function isSelectingRange(sel: { type?: string; rangeCount: number } | null): boolean {
    return sel != null && sel.rangeCount > 0 && sel.type === "Range";
}
