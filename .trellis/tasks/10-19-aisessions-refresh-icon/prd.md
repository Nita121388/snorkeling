# 刷新控件简化为纯图标并修复与关闭按钮重叠

## Goal

AI 会话头部右上角的刷新控件与关闭按钮重叠，且绿色的 `Auto` 文字徽标没有信息价值。收敛为**一个纯刷新图标**，并修掉重叠。

## 现状

- `frontend/app/element/refresh-status-icon.tsx`：`status === "autoEnabled"` 时在图标后渲染一个 `Auto` 文字徽标，宽度未计入头部布局
- 该控件作为 block header widget 渲染，与关闭按钮在视觉上重叠
- `view/aisessions/aisessions.tsx` 的 `endIconButtons` 用 `RefreshStatusIcon` + `deriveRefreshStatus`

## Requirements

### 控件简化

- 移除 `Auto` 文字徽标（不再渲染该 `<span>`）
- 刷新控件收敛为单个图标按钮，语义为「刷新会话列表」
- `autoEnabled` 状态不再用徽标表达，最多用图标的颜色/旋转动效区分（保持克制，不加新元素）
- tooltip 保留有用信息：上次同步时间 / 自动刷新倒计时 / 失败可重试

### 布局修复

- 刷新图标与关闭按钮之间必须有明确间距，不得重叠
- 窄宽度下按钮组不得互相覆盖或溢出到关闭按钮区域
- 未启用自动刷新的场景（远程连接时 `autoRefreshEnabled=false`）仍显示正常

### 交互

- 点击刷新立即触发刷新并可观察到状态变化（syncing → idle/error）
- 失败状态可点击重试

## Acceptance Criteria

- [ ] 头部不再出现 `Auto` 文字徽标
- [ ] 用 `node scripts/inspect-electron-ui.mjs` 实测：刷新图标与关闭按钮的 `getBoundingClientRect()` 不重叠
- [ ] 窄窗口下两者仍不重叠
- [ ] 点击刷新有可观察的状态变化
- [ ] 失败状态下 tooltip 提示可重试，点击有效
- [ ] 现有 `RefreshStatusIcon` 的其它使用点不受破坏