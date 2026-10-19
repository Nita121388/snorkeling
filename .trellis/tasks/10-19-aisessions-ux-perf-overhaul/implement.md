# 执行计划（父任务）

## 波次编排

### Wave 1（并行，4 条 lane）

| Lane | 子任务目录 | 文件域 | 冲突 |
|---|---|---|---|
| L1 | `../10-19-aisessions-full-load` | `pkg/aisessions/`、`pkg/service/aisessionsservice/`、`view/aisessions/` | 独占 aisessions 详情链路 |
| L3 | `../10-19-aisessions-subagent-fold` | `pkg/aisessions/`（只读扫描，新增文件）、`view/aisessions/session-message.tsx` | 与 L1 在 `view/aisessions/` 有重叠 → **串到 L1 之后** |
| L5 | `../10-19-preview-txt-html-modes` | `view/preview/` | 无冲突 |
| L6 | `../10-19-commontext-paste-image` | `commontext/` | 无冲突 |
| L4 | `../10-19-aisessions-refresh-icon` | `element/refresh-status-icon.tsx` + block header | 无冲突 |

修正：为避免 `view/aisessions/` 双写，Wave 1 实际并行的是 **L1 / L5 / L6 / L4**。

### Wave 2（L1 合并后）

| Lane | 子任务目录 | 依赖原因 |
|---|---|---|
| L2 | `../10-19-aisessions-annotate` | 需要 L1 的 `ItemKey` 稳定 id 与分块管线 |
| L3 | `../10-19-aisessions-subagent-fold` | 需要 L1 的详情渲染容器稳定后再插入折叠卡片 |

### Wave 3

| Lane | 子任务目录 | 依赖原因 |
|---|---|---|
| L7 | `../10-19-aisessions-block-separation` | 改动 block/tab 架构，面最大，放最后避免打断其他 lane |

## 派发规则

- 每个子代理 dispatch prompt 首行必须是 `Active task: .trellis/tasks/<子任务目录>`
- **不传 model**，继承当前模型
- 子代理禁止 `git commit` / `git add` / `git push`
- **并行策略：共享 cwd + 严格文件域，不使用 worktree。**
  原因：`node_modules/` 与 `.tools/` 被 gitignore，managed worktree 里没有这两个目录，子代理无法运行 `npm test`；未提交的 `.trellis/tasks/*` 也不会进 worktree。
  代价：禁止两个 lane 改同一文件；`frontend/app/store/wshclientapi.ts` 与 `pkg/wshrpc/wshclient/wshclient.go` 是 codegen 产物，**只有 L1 可以跑 RPC 生成**。
  冲突兜底：任一 lane 需要触碰他人文件域时，停下来在报告里点名，不许直接改。
- **禁止卡死**：单条 lane 一旦被判定 `needs attention`，父会话立刻检查工作区有无实际改动。若跑了 40+ 轮仍无任何源文件变化，即为空转。
  纠偏手段（按顺序）：查 transcript 末尾最后 3-5 个 tool call → 若卡在自建临时脚本或反复调试同一失败（如 CDP API 不存在），立即 `steer` 硬刹车并改指令为「只读代码推导 + 写报告」。
  已实证：L4（P2 小 lane）曾卡在 `Browser.getWindowForTarget`（Electron 无此 API）+ `window.resizeTo` 无效上，70 工具 / 21 万 token 无产出。
- **工具预算上限**：dispatch 时即声明 tool call 预算（如「最多 15 次后续调用」），到预算强制写报告，禁止无限迭代。
- **UI 布局验证不能只靠活体 DOM**：CDP 实测失败时，允许退化为「读布局代码 + 明确报告未实测」，不得为了跑通 CDP 而无限试错。

## 验证门禁（每个 lane）

1. 单元测试通过（新增行为必须有测试）
2. `npm test` 或对应 Go 包测试通过
3. UI 类改动必须用 `node scripts/inspect-electron-ui.mjs` 实测布局/交互，不允许只凭猜测
4. 不引入新的 RPC 超时路径

## 回滚点

- 每个 lane 独立提交单元，父会话按 lane 顺序合并
- L1 的协议改动（`LoadAll`）保留旧 `Detail` 行为兼容，前端可回退