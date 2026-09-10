> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/view/aisessions/session-detail.tsx, frontend/app/view/aisessions/chat-composer.tsx
> 最后同步：2026-09-10
> 方案来源：[[Snorkeling-方案/agent-gui-message-queue-redesign|agent-GUI 消息队列重构方案]]

---

# Message Queue Redesign — 消息队列交互原型

## 解决的问题

当前 AI Sessions 对话界面（`chat-composer.tsx`）的消息排队机制有三层缺陷：

1. **UI 几乎不可见** — 仅一行 `11px text-accent`：`"N messages queued — waiting for the current turn"`，被 composer 卡片的 GitStatusBar 和工具行稀释，用户几乎注意不到。
2. **数据模型无队列语义** — `queuedMessagesRef = useRef<ChatRequestBody[]>([])` 是纯 push/shift 的 ref 数组，无消息 ID、无优先级、无单条操作能力、abort 后静默丢弃。
3. **调度粗糙** — `turn_end` 时直接 `shift()`，无 drain 延迟（竞态风险）、无速率/并发控制。

## 方案要点

参照 Paseo `GitProcessScheduler` 的双优先级队列 + drain 调度模式，将队列从"一行文字"升级为**可交互的 MessageQueuePill**：

### Phase 1：MessageQueuePill（本原型覆盖）

| 组件 | 职责 |
|---|---|
| **折叠态 pill** | 显示 `N queued · M high`，点击展开列表，`⌘⇧Q` 快捷键 |
| **展开态列表** | 滚动列表，每行：序号 + priority icon + 文本截断预览 + 取消 × + 置顶 ⚡ |
| **拖拽排序** | HTML5 drag/drop，用户可调整 normal 消息的执行顺序 |
| **Priority toggle** | ⚡ 按钮切换 high ↔ normal；high 自动插到队列前端 |
| **Abort toast** | Abort 后保留排队消息，底部 toast 显示 "N messages retained" + Restore / Dismiss |

### Phase 2：数据层（不在原型内）

- `MessageQueueStore` 替代 ref 数组（id + priority + status + retryCount）
- `MessageQueueScheduler`：turn_end 后延迟 300ms drain 下一条，防竞态

### Phase 3：持久化（可选）

- localStorage 跨刷新保留排队

## 消息队列数据结构

```
QueuedMessage {
  id: string           // 唯一 ID
  body: ChatRequestBody
  enqueuedAt: number
  priority: "high" | "normal"
  retryCount: number
  status: "queued" | "sending" | "done" | "cancelled"
}
```

| 方法 | 语义 |
|---|---|
| `enqueue(body, priority?)` | 入队（normal 默认；retry = high） |
| `dequeueNext()` | drain 调用：high 优先 → shift normal |
| `cancel(messageId)` | 仅 queued 态可取消 |
| `promote(messageId)` | 切换 high ↔ normal |
| `reorder(messageId, targetIdx)` | 拖拽置顶 |

## 镜像源对账

| 镜像源 | 存在？ | 说明 |
|---|---|---|
| `frontend/app/view/aisessions/session-detail.tsx` | ✓ | `queuedMessagesRef` + `handleChatQueue` + `flushQueuedRef` |
| `frontend/app/view/aisessions/chat-composer.tsx` | ✓ | `queuedCount` prop + 当前 `11px text` 渲染 |

## 原型说明

打开 `index.html` 即可交互。底部 Demo 栏提供：

| 按钮 | 操作 |
|---|---|
| **+ Normal msg** | 入队一条 normal 优先级消息 |
| **+ High priority** | 入队一条 high 优先级消息（⚡ 插队） |
| **▶ Flush next** | 模拟 drain 下一条（2-4s 后完成） |
| **■ Abort + toast** | Abort 当前 turn + 弹出 undo toast |
| **↩ Undo restore** | 从 toast 恢复保留的排队消息 |
| **Batch ×5** | 批量入队 5 条（混合优先级） |
| **Old vs New** | 对比面板：当前实现 vs 新方案 |

点击 composer 输入框输入文字，Enter 或点 Send 也可入队/发送。深色 / 浅色 / 单色三主题可切换。

## 与 Composer 的布局关系

```
┌─────────────────────────────────┐
│  GitStatusBar (ctx%, model)     │  ← 第一行（不变）
│  ▾ 2 queued · high:1           │  ← 第二行（队列 pill，queue.length > 0 时显示）
│  ┌─────────────────────────┐   │
│  │ textarea                │   │
│  └─────────────────────────┘   │
│  [📎] [model▾] [brain▾] [↑]    │  ← 工具行
└─────────────────────────────────┘
```

pill 粘在 GitStatusBar 与 textarea 之间，作为"第二行状态"，不与 GitStatusBar 争位。

## 验收标准

- [ ] 排队消息有可见列表（非纯数字）
- [ ] 每条可独立取消（× 按钮）
- [ ] 可拖拽调整顺序
- [ ] ⚡ 可切换 high/normal 优先级
- [ ] abort 后排队消息不丢失（保留 + undo toast）
- [ ] 折叠态 / 展开态切换流畅（spring 动画对齐 v2 设计语言）
- [ ] 三主题一致性

## 实施路径

| 阶段 | 内容 | 改动文件 |
|---|---|---|
| **P1** | MessageQueueStore（ref 数组 → reactive store，集成 drain 调度） | 新增 `message-queue-store.ts`；改 `session-detail.tsx` |
| **P2** | MessageQueuePill UI（替换当前文本，支持折叠/展开/取消） | 新增 `message-queue-pill.tsx`；改 `chat-composer.tsx` |
| **P3** | 拖拽排序 + 置顶 + abort 恢复 | 改 `message-queue-pill.tsx` + `session-detail.tsx` |
| **P4** | 队列持久化（localStorage，可选） | 新增持久化逻辑 |
