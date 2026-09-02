# Terminal / Agent TUI — 回到底部浮动按钮

Written against: working tree (`AGENTS.md` 指引的 snorkeling 仓库)

## Evidence chain

- **Surface**: `frontend/app/view/term/term.tsx` — Terminal 视图 (xterm.js)；`frontend/app/view/aisessions/agent.tsx` → `session-detail.tsx` — Agent GUI (已有 Jump to latest)
- **用户意图**: Terminal 和 Agent TUI 都需要「回到底部」浮动按钮；Agent GUI 已有，不需要改
- **xterm 滚动机制**: `.xterm-viewport` (overflow-y: scroll) + `terminal.onScroll` 回调；`terminal.scrollToBottom()` 滚到底
- **Agent TUI 滚动机制**: `session-detail.tsx` 的 `detailScrollRef` (div overflow-y-auto) + `nearBottomRef` + `showJumpPill` 状态

## Design decision

### 统一组件 + 两处接入

创建一个可复用的 `ScrollToBottomButton` React 组件，分别接入 Terminal 和 Agent TUI。

### 视觉设计

```
┌─────────────────────────────────────┐
│  ... 终端内容 / 聊天消息 ...         │
│                                     │
│           ╭─────────╮               │
│           │   ↓     │  ← 浮动按钮   │
│           ╰─────────╯               │
│                                     │
└─────────────────────────────────────┘
```

**按钮规格：**
| 属性 | 值 |
|------|-----|
| 形状 | 圆形 `w-9 h-9` (36px) |
| 图标 | `fa-solid fa-arrow-down` |
| 背景 | `bg-modalbg/90 backdrop-blur-sm` |
| 边框 | `border border-border/50` |
| 阴影 | `shadow-lg` |
| 文字色 | `text-secondary` → hover `text-primary` |
| 位置 | `absolute bottom-4 left-1/2 -translate-x-1/2` |
| 层级 | `z-20` |
| 过渡 | `transition-all duration-200 ease-in-out` |
| 显示 | `opacity-100 scale-100` |
| 隐藏 | `opacity-0 scale-75 pointer-events-none` |

### 显示/隐藏逻辑

| 条件 | 按钮状态 |
|------|---------|
| 在底部 (距底部 < 50px) | 隐藏 |
| 上滚超过 120px | 显示 |
| 流式输出中 + 在底部 | 隐藏 |
| 无内容 | 隐藏 |
| 点击按钮 | 滚到底 + 隐藏 |

### 组件 API

```tsx
// frontend/app/element/scroll-to-bottom-button.tsx
type ScrollToBottomButtonProps = {
  /** 当前是否在底部 */
  isAtBottom: boolean;
  /** 点击回调：滚到底部 */
  onClick: () => void;
  /** 可选：按钮距底部的偏移 (默认 "1rem") */
  bottomOffset?: string;
};
```

实现：纯展示组件，CSS transition 控制显隐，无副作用。

## Changes

### 1. 新建 `frontend/app/element/scroll-to-bottom-button.tsx`

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { memo } from "react";
import { cn } from "@/util/util";

type ScrollToBottomButtonProps = {
    isAtBottom: boolean;
    onClick: () => void;
    bottomOffset?: string;
};

export const ScrollToBottomButton = memo(({ isAtBottom, onClick, bottomOffset = "1rem" }: ScrollToBottomButtonProps) => {
    return (
        <button
            type="button"
            className={cn(
                "absolute left-1/2 z-20 -translate-x-1/2",
                "flex h-9 w-9 items-center justify-center rounded-full",
                "border border-border/50 bg-modalbg/90 shadow-lg backdrop-blur-sm",
                "text-secondary transition-all duration-200 ease-in-out",
                "hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                isAtBottom
                    ? "pointer-events-none scale-75 opacity-0"
                    : "scale-100 opacity-100"
            )}
            style={{ bottom: bottomOffset }}
            onClick={onClick}
            aria-label="Scroll to bottom"
            title="Scroll to bottom"
        >
            <i className="fa-sharp fa-solid fa-arrow-down text-sm" />
        </button>
    );
});

ScrollToBottomButton.displayName = "ScrollToBottomButton";
```

### 2. 修改 `frontend/app/view/term/term.tsx` — Terminal 接入

**新增 state：**
```tsx
const [isTermAtBottom, setIsTermAtBottom] = useState(true);
```

**在 termWrap 初始化 useEffect 中监听 xterm onScroll：**
```tsx
// 在 termWrap.initTerminal() 之后添加
const disposable = termWrap.terminal.onScroll(() => {
    const { viewportY, baseY, length } = termWrap.terminal.buffer.active;
    const viewportRows = termWrap.terminal.rows;
    const atBottom = viewportY + viewportRows >= baseY + length - 1;
    setIsTermAtBottom(atBottom);
});
// 在 cleanup 中 dispose
```

**在 JSX 的 `view-term` div 内部末尾添加：**
```tsx
<ScrollToBottomButton
    isAtBottom={isTermAtBottom}
    onClick={() => {
        model.termRef.current?.terminal.scrollToBottom();
        setIsTermAtBottom(true);
    }}
/>
```

### 3. 修改 `frontend/app/view/aisessions/session-detail.tsx` — Agent TUI 改进

**替换现有 `showJumpPill` + 底部 button 为 `ScrollToBottomButton`：**

将原来的：
```tsx
{showJumpPill && !deltaLoading ? (
    <button ...>Jump to latest</button>
) : null}
```

替换为：
```tsx
<ScrollToBottomButton
    isAtBottom={!showJumpPill || deltaLoading}
    onClick={() => {
        const node = detailScrollRef.current;
        if (node != null) node.scrollTop = node.scrollHeight;
        setShowJumpPill(false);
    }}
/>
```

## Validation

- Terminal：打开终端 → 有输出 → 上滚 → 按钮出现 → 点击回到底 → 按钮消失
- Terminal：流式输出中 + 在底部 → 按钮不出现
- Agent TUI：打开 Agent session → 上滚 → 按钮出现 → 点击回到底
- 两种场景：在底部时按钮不可见 + 无 pointer-events
- 焦点状态：Tab 键可见 focus ring
- 无障碍：aria-label 正确
