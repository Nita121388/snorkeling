# AI 会话列表与详情分离为独立 Block

## Goal

把当前「列表 + 详情同视图」拆开：点击会话打开一个详情 block；在当前 tab 内再次点击则并入该 tab 成为 tab 页；`Ctrl+点击` 则新开一个 block。

## 现状

- `frontend/app/view/aisessions/aisessions.tsx` 同时承载列表与详情
- `view/aisessions/agent.tsx` 是"只有详情"的 Agent block 视图（已有雏形）
- 详情加载由 `agent.tsx` 的 `AgentViewModel` 负责，通过 `aisessions:sessionid` meta 绑定会话

## Requirements

### 打开行为

- 在列表点击会话 → 打开/复用一个会话详情 block
- 同一 tab 内再次点击另一个会话 → 该 tab 内以 tab 页形式承载多个详情
- `Ctrl+点击` → 强制新开一个独立 block（不并入当前 tab）
- 打开详情后，原列表视图保持可用（可继续点别的会话）

### 路由与状态

- block meta 用现有 `aisessions:sessionid` 绑定会话，不发明新键
- tab 内多个详情 block 的切换、关闭遵循现有 block/tab 语义
- 刷新/重启后按 meta 恢复对应会话

### 一致性

- 列表的星标、note、tag 更新要能反映到已打开的详情（复用现有 `AISessionNoteUpdated` 事件总线）
- 详情里的删除/恢复操作要同步列表

## Acceptance Criteria

- [ ] 点击列表项能打开会话详情 block
- [ ] 当前 tab 内再次点击，详情以 tab 页形式叠加而非替换列表
- [ ] `Ctrl+点击` 新开独立 block
- [ ] 列表与详情可同时可见/操作
- [ ] 重启后 block 能恢复对应会话
- [ ] 列表与详情间的星标 / note / tag / 删除保持同步
- [ ] 现有 `view/aisessions` 的使用点不回归