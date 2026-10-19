# 技术设计（父任务）

## 架构分层

```
Go 后端  pkg/aisessions/           会话索引、消息分块、软删除元数据
         pkg/service/aisessionsservice/  RPC 服务层
前端      frontend/app/view/aisessions/  列表 + 详情 + 实时 turn
         frontend/app/view/preview/      文件预览
         frontend/app/commontext/        笔记
         frontend/app/element/           刷新状态图标
```

## 全局契约

### 1. 消息稳定 id（L1 建立，L2 消费）

pi 的每条 JSONL entry 自带 `id` 字段，是天然的稳定标识。`Message` 结构需新增：

```go
EntryID string `json:"entryId,omitempty"`  // pi entry id，跨刷新稳定
ItemKey string `json:"itemKey,omitempty"`  // entryId + ":" + toolCallId 或序号，一条 entry 拆多条时唯一
```

- 增量 delta 必须携带（否则 delta 合并后 id 错位）
- 前端所有"定位/隐藏/书签"操作以 `ItemKey` 为准，禁止用 `Seq`（位置型，一刷新就错位）

### 2. 全量加载协议（L1）

`Detail` 请求新增 `LoadAll bool`。后端行为：

- 首帧返回**最早的**内容（约 512KB），同时返回 `hasMore=true`
- 前端首帧立即渲染，随后按 `DetailDelta` 语义继续向后追加，直到 `hasMore=false`
- **方向约定**：历史会话的"起点"是文件最早的内容，追加是向后（新 → 旧）推进

前端三件事同时做，缺一不可：

1. **虚拟列表**：复用 `@tanstack/react-virtual`（项目已依赖，`treeview.tsx` 已有 `useVirtualizer` 先例）
2. **懒渲染重内容**：超长 assistant 消息默认折叠、thinking 默认收起；`WaveStreamdown` 仅在展开时挂载
3. **渐进式 setState**：每帧一次 setState，不做"攒齐再渲染"

### 3. 标注元数据（L2）

- 标注是 **消息级 + 文字区间级** 数据，session 级 note 保持不动
- 新表 `ai_session_annotations(session_key, item_key, start, end, body, created_at, updated_at)`，schema v3 → v4
- `start/end = -1` 表示整条标注；>= 0 表示该条原文的字符区间
- 复用现有 `SQLiteIndex` 写入路径，**不新增第二套存储**
- 锚点依赖 L1 的 `item_key`；跨 DOM 文本节点用多个 Range 表示一个标注
- 渲染复用 `use-dom-highlight.ts` 的 CSS Custom Highlight 机制（新增独立 key，与搜索高亮互不干扰）
- 实时流式消息不可标注（内容仍在变化）
- **禁止**回写 JSONL；删除类能力全部搁置

### 4. 子代理映射（L3）

不依赖 pi-subagents 改动。两条数据源：

- **主**：父会话 JSONL 中 `toolName=="subagent"` 的 toolCall（含 `agent`、`task`）
- **辅**：`~/.pi/agent/sessions/<cwd>/*.jsonl` 的 `session_info.name`（格式 `"agent: 任务摘要"`）

匹配规则：同 cwd 目录 + name 前缀匹配 agent 名 + createdAt 落在该 toolCall 时间窗口内。并行/同名歧义时标记 `ambiguous`，UI 显示"多个候选，点击选择"而非猜测。

## 性能根因（L1 顺带修复"接口超时"）

前端 `loadDetail(..., refresh=true)` 与 `Detail` 的 `Refresh:true` 会触发
`refreshSummariesInBackground` / 全量 summary 扫描。当前 sessions 目录 200+ 文件、
30 个 cwd 目录，每次刷新全量扫描 → 超时。

修法：
- 默认不传 `refresh=true`；增量走已有 SQLite 缓存 + `DetailDelta`
- `refresh` 仅在用户显式点击刷新时置位
- Note/Tag 写入路径不触发任何 summary 刷新

## 交互约定

- html 打开方式：**双击 = 上次方式**；右键菜单 / 工具栏三个显式入口（源码 / 内置预览 / 系统默认应用）；按扩展名记忆偏好
- L7：第一次点击 → 新建 detail block；再次点击（同 tab 内）→ 并入当前 tab；Ctrl+点击 → 新开 block

## 验证

- 前端：`npm test`（vitest）
- 后端：`go test ./pkg/aisessions/... ./pkg/service/aisessionsservice/...`
- 大规模数据验证：用最大的真实会话（约 20MB）作为回归样本
