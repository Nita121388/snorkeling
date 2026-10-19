# 全量加载会话详情，且不卡顿

## Goal

用户在「学习回看一个 AI 处理过程」时，能**一次性**看到某个会话的**全部**内容，中间不需要一页一页点加载，且 UI 全程不冻结、不出现"加载不出来"。

## 现状

- 后端单帧上限 `messageDeltaMaxBytes = 512KB`（`pkg/aisessions/util.go`）
- 前端仅在滚动到底部时才逐帧续拉（`loadDetailDelta("bottom")`）
- 消息列表一次性全量渲染，无虚拟化
- 用户最大的历史会话约 20MB → 需要约 40 次翻页

## Requirements

### 全量加载入口

- 会话详情提供「Load all」操作（按钮或菜单项），一次触发后自动把整个会话内容取回
- 取回过程**不允许**要求用户继续交互（不再有"点一次加载一页"）
- 首帧内容必须在触发后 1 秒内可见（首帧取**最早的**内容）

### 渐进式与不卡顿

- 后续内容在后台分帧追加，每帧一次渲染更新
- 追加过程中 UI 必须保持可滚动、可交互
- 任一帧失败不影响已渲染内容，顶部提供重试入口
- 全量到手后必须提供"跳到最早/最新"的能力

### 虚拟列表

- 消息时间线接入 `@tanstack/react-virtual`（项目已依赖，参考 `frontend/app/treeview/treeview.tsx` 的 `useVirtualizer` 用法）
- 几千条消息滚动不得出现明显掉帧
- 搜索结果跳转必须能定位到被虚拟化的位置

### 懒渲染重内容

- 超长 assistant 消息默认折叠，展开时才挂载 `WaveStreamdown`
- thinking 块默认收起
- 不得为懒渲染牺牲"能看到全部"的目标

### 稳定 id

- `Message` 新增 `entryId`（pi entry id）与 `itemKey`（一条 entry 拆多条时唯一）
- 增量 delta 必须携带这两个字段
- 前端定位/滚动/key 一律用 `itemKey`，禁用 `Seq`

### 顺带修复接口超时

- 默认不传 `refresh=true`；增量走 SQLite 缓存 + `DetailDelta`
- `refresh` 仅在用户显式点击刷新时置位
- Note / Tag 写入路径不得触发任何 summary 全量刷新

## Acceptance Criteria

- [ ] 打开约 20MB 的历史会话，点一次「Load all」即可取回全部内容，无第二次交互
- [ ] 首屏内容在 1 秒内可见；后续内容后台补齐
- [ ] 补齐过程中可正常滚动、点击、搜索
- [ ] 全量渲染后滚动流畅，无 UI 冻结
- [ ] 某一帧失败时，已加载内容仍可用且有重试入口
- [ ] 详情加载与 Note/Tag 编辑不再因全量 summary 刷新而超时
- [ ] 新增 `itemKey` 且有测试覆盖 delta 合并后 key 不错位