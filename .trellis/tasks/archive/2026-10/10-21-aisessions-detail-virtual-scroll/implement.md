# 执行计划：详情虚拟滚动 + 子代理归位

## 阶段 A — 虚拟化骨架（P0）

### A1 纯逻辑先行（可单测，无 DOM）

- [ ] 新文件 `frontend/app/view/aisessions/timeline-virtual.ts`
  - [ ] `shouldVirtualize(itemCount: number): boolean`（阈值 60，env/常量可调）
  - [ ] `buildSeqToIndex(items): Map<number, number>`（message item 的 seq → 行号）
  - [ ] `activeSeqFromVirtualItems(virtualIndices, itemSeqs, probeOffset): number | null`
  - [ ] `scrollTargetForSeq(virtualizer, index): number`（估算 offset 兜底）
- [ ] 测试 `timeline-virtual.test.ts`：阈值边界、映射正确性、大纲定位（目标在可见区上方/中间/下方/不可见）

验证：`npx vitest run frontend/app/view/aisessions/timeline-virtual.test.ts --reporter=dot`

### A2 虚拟化渲染分支

- [ ] `session-detail.tsx`：`renderItems.length > 60` 时改用 `TimelineRows`（新组件）承载
  - [ ] `useVirtualizer` 配置（estimateSize 96 / overscan 6 / measureElement）
  - [ ] 绝对定位容器 + `data-index` 供 `measureElement`
  - [ ] 复用现有 `MessageCard` / `ToolCallCard` / `SubagentCard` 渲染逻辑（抽成共享 renderer，两分支共用）
- [ ] `scrollToVisibleMessage` 改走 `seqToIndex` + `virtualizer.scrollToIndex`
- [ ] 自动滚到底改用 `getTotalSize()`
- [ ] `handleDetailScroll` 的 nearBottom 改用 `getTotalSize()`

验证：`npx vitest run frontend/app/view/aisessions --reporter=dot`

### A3 大纲轨适配

- [ ] `useActiveOutlineSeq` 改为接受可见项列表（`virtualizer.getVirtualItems()`），不再 `getElementById`
- [ ] 保持 scroll 事件 + rAF 节流

验证：`npx vitest run frontend/app/view/aisessions --reporter=dot`

**Gate A**：async 子代理跑 `npx tsc --noEmit -p tsconfig.json`，确认本任务文件 0 新增错误。

## 阶段 B — 子代理归位（P1）

### B1 数据关联

- [ ] `session-timeline-sync.ts`：timeline item 类型增加 `subagentMatches` 字段（可选）
- [ ] `session-detail.tsx`：构建后按 `itemKey` 关联 `subagentFold.matches`
- [ ] 测试：`session-timeline-sync.test.ts` 扩展（message item 携带 matches）

### B2 渲染归位

- [ ] `MessageCard` 通过 `children` 渲染父消息尾部的子代理卡片区
- [ ] `session-detail.tsx` 删除"时间线同级 SubagentCard"分支，改为 `MessageCard children`
- [ ] 无匹配时父消息不渲染 children

验证：`npx vitest run frontend/app/view/aisessions --reporter=dot`

**Gate B**：`subagent-card.test.tsx` + `session-detail-block.test.ts` 全绿。

## 阶段 C — 子代理渐进加载（P1）

### C1 串行队列（纯逻辑）

- [ ] 新文件 `subagent-load-queue.ts`：并发 1、可取消（世代号）、FIFO
- [ ] 测试 `subagent-load-queue.test.ts`：同时提交 3 个只 1 个在飞、取消后迟到响应被丢弃、顺序保序

### C2 骨架 + 分帧

- [ ] `subagent-card.tsx`：展开即 `<SessionDetailSkeleton rows={3} />`（去掉"加载中…"纯文字）
- [ ] 首帧渲染 + `HasMore` 时底部"加载更多"动画条，继续拉帧
- [ ] 失败保留已渲染内容 + `Retry`
- [ ] 折叠/卸载取消在途请求

验证：`npx vitest run frontend/app/view/aisessions --reporter=dot`

**Gate C**：async 子代理 `tsc` 复核 + 全量 `vitest run frontend/app/view/aisessions`。

## 实施结果（2026-10-21）

- A / B / C 三个阶段全部完成并通过验证。
- **G2（懒渲染重内容）并入 A 达成**：虚拟化后可视区只挂载约 10 行 MessageCard，
  markdown（`WaveStreamdown`）渲染量与视口相关而非与消息总数相关；thinking 早已有
  `ThinkingDisclosure` 默认折叠。不再单独做"超长消息折叠"，避免与批注/搜索高亮冲突。
- **顺带修复既有 bug**：`AISessionsDetailDeltaRequest` 缺 `includeTools` 字段
  （`agent.tsx` 的 tsc 错误根源），导致 LoadAll 分帧后工具调用丢失；已补字段并重生成类型。

验证结果：
- `vitest run frontend/app/view/aisessions`：**174 passed / 20 files**
- `tsc --noEmit`：`aisessions/` 目录 **0 错误**（原 1 个既有错误一并消除）
- `go test ./pkg/aisessions/ ./pkg/service/aisessionsservice/`：ok

## 阶段 D — 收尾

- [ ] `git status` 确认只提交本任务文件（`widgets.tsx`、`package-lock.json`、`preview-new-files.tsx`、`dev-runtime.*` 是他人改动，不 stage）
- [ ] commit
- [ ] 更新任务 meta（commit / phase）

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 动态测量滚动跳动 | 只测一次；live 更新显式 measure()；≤60 不启用 |
| `scrollToIndex` 未测量定位不准 | 估算先滚 + rAF 修正 |
| 大纲定位偏差 | 纯函数覆盖四类边界 |
| 串行队列饿死主加载 | 队列只承载子代理 |

## 会话纪律（沿用）

1. 慢校验（全量 tsc / 全量 vitest）→ async 子代理，禁止主会话同步跑。
2. Go 工具链走子 PowerShell：`powershell -File` + `cmd /c "go ... > file 2>&1"`。
