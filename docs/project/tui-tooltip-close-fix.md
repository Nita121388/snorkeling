# Agent TUI 右侧 Tick ToolTip 无法关闭问题分析

## 问题描述
在 Agent TUI 界面右侧的 Tick（消息刻度轨）上，鼠标点击后展示的 ToolTip 无法正常关闭。

## 问题原因分析

### 1. 组件结构
- `SessionOutlineRail` 是右侧消息刻度轨的核心组件
- 在 TUI 中使用时，没有传递 `onJump` 属性（`<SessionOutlineRail prompts={prompts} activeSeq={activeSeq} />`）
- 当 `onJump` 为 undefined 时，点击 tick 会切换 `pinnedSeq` 状态

### 2. 状态管理逻辑
```typescript
const handleJump = useCallback(
    (seq: number) => {
        if (onJump != null) {
            onJump(seq);
            return;
        }
        setPinnedSeq((current) => (current === seq ? null : seq));
    },
    [onJump]
);
```

### 3. 问题根源
当用户点击 tick 时：
1. 第一次点击：`pinnedSeq` 被设置为 `seq`，显示预览气泡
2. 第二次点击同一个 tick：`pinnedSeq` 被设置为 `null`
3. **但是**：`hoveredIndex` 可能仍然不为 null（因为鼠标仍在 tick 上）
4. 预览气泡的显示逻辑：`if (index == null) { index = hoveredIndex; }`
5. 因此，即使 `pinnedSeq` 为 null，只要 `hoveredIndex` 不为 null，预览气泡仍然显示

### 4. 关闭机制缺陷
- Escape 键：正确清除 `pinnedSeq` 和 `hoveredIndex`
- 鼠标移出 rail 区域：通过 `scheduleClose` 清除 `hoveredIndex`
- **再次点击 tick**：只清除 `pinnedSeq`，但没有清除 `hoveredIndex`

## 修复方案

### 修改文件
`frontend/app/view/session-outline-rail.tsx`

### 修改内容
在 `handleJump` 函数中，当取消固定（`pinnedSeq` 设置为 null）时，同时调用 `hoverIntent.current.leave()` 清除 hover 状态：

```typescript
const handleJump = useCallback(
    (seq: number) => {
        if (onJump != null) {
            onJump(seq);
            return;
        }
        setPinnedSeq((current) => {
            const newPinned = current === seq ? null : seq;
            // 当取消固定时，同时清除 hover 状态，确保 ToolTip 关闭
            if (newPinned === null) {
                hoverIntent.current.leave();
            }
            return newPinned;
        });
    },
    [onJump]
);
```

### 修复原理
1. 当用户再次点击同一个 tick 时，`pinnedSeq` 被设置为 null
2. 同时调用 `hoverIntent.current.leave()`，将 `hoveredIndex` 也设置为 null
3. 预览气泡的显示条件 `if (index == null || !scrollRef.current)` 会满足，从而关闭 ToolTip

## 验证方法
1. 构建开发版本：`npm run build:dev`
2. 在 TUI 界面测试：
   - 点击 tick 显示 ToolTip
   - 再次点击同一个 tick，ToolTip 应该关闭
   - 按 Escape 键，ToolTip 应该关闭
   - 鼠标移出 rail 区域，ToolTip 应该在 500ms 后关闭