# 执行计划：AI 会话与 Agent TUI 文本选中及上下文复制

父任务不直接写实现代码。本文件定义子任务顺序、验证命令与集成验收门。

## 顺序

```
子任务 1  10-24-aisessions-copy-context-builder   ← 地基，必须先做
   │
   ├──► 子任务 2  10-24-agent-tui-selection-copy-context   （依赖 1 的 fencedBlock / 格式）
   │
   └──► 子任务 3  10-24-aisessions-quote-to-composer       （依赖 1 的 formatSessionContext）
```

子任务 2 与 3 之间无依赖，可并行；两者都必须在子任务 1 归档后启动。

## 子任务 1：地基

**范围**：`copy-context.ts` 纯函数 + DOM 契约 + `getCopyContextTextFromDom` 分支 + Session Detail 接线 + hover 按钮。

**实施顺序**

1. 写 `copy-context.ts` 的类型与 `formatSessionContext` / `fencedBlock`
2. 写 `copy-context.test.ts`，先让 11 组用例红→绿（纯函数，可脱离 UI 验证）
3. `selection-copy-overlay.tsx` 增新契约分支，跑既有单测确认旧分支未回归
4. `session-message.tsx` 挂 DOM 属性 + 第二个复制按钮，更新 memo 比较
5. `session-detail.tsx` 传 meta、维护 `copySelectionRangeRef`
6. 手工验证 ≤60 行与 >60 行两种会话

**验证命令**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; npx vitest run frontend/app/view/aisessions/copy-context.test.ts"
```

若前端测试入口不是 vitest，按仓库既有脚本（`npm run test` / `node scripts/run-task.mjs <task>`）走，命令以实际可用者为准并记录到本文件。

**通过门**

- `copy-context.test.ts` 全绿
- `selection-copy-overlay` 相关既有单测全绿
- tsc 无新增错误
- 手工：Session Detail 选区出 Copy Context；preview markdown 的 Copy Context 行为不变

## 子任务 2：终端

**顺序**

1. 先跑 V1 验证矩阵（普通 shell / claude fullscreen / claude modal / pi / codex）
2. 记录结论到子任务 `prd.md` 的「V1 验证记录」
3. V1 全通过 → 只加 `formatTermContext` 接线 + 菜单项 + 提示文案 + `shouldForceTermSelection` 单测
4. V1 有失败 → 追加选择模式开关
5. 端到端：real terminal block 里 Shift+拖选 → 💡 → Copy Context → 粘贴核对

**通过门**

- `term-selection-gesture.test.ts` 全绿（新函数用例）
- 既有 `Copy Logical Line` / `Copy Selection as One Line` 行为不变
- `selected-lines` 绝对行号与 `cat -n` 输出核对一致

## 子任务 3：回流

**顺序**

1. `chat-composer-events.ts` + 单测（多 key 隔离优先写）
2. `chat-composer-insert.ts` + 单测（5 条规则）
3. composer 订阅与聚焦
4. 方案 A：`clipboard-float-actions.tsx` 解析 `data-aisession-key` 并追加菜单项
5. 若 A 不可行 → 退方案 B，并把原因写进子任务 `prd.md`「实施记录」
6. 一致性断言：同一选区 `Copy Context` 与 `Quote to Input` 产出一致

**通过门**

- 两个新单测文件全绿
- 会话外选区（preview / Wave AI 面板）不出现 `Quote to Input`
- 插入后光标在末尾

## 集成验收（父任务）

三个子任务归档后执行：

- [ ] 同一会话、同一选区，`Copy Context`（💡）与 hover「Copy as context」与 `Quote to Input` 三者文本逐字节一致
- [ ] 终端侧 Copy Context 的 `<context>` 块结构与会话侧一致（字段不同但骨架一致）
- [ ] preview / markdown / 代码预览的 Copy Context 输出与改动前完全一致
- [ ] `Search In Files`、`Common Text`、`Copy` 三个既有菜单项行为无变化
- [ ] 全量前端测试通过
- [ ] `detect_changes()` 变更范围与预期符号一致（按项目 GitNexus 规则）

## 回滚点

| 位置 | 回滚方式 |
|---|---|
| 子任务 1 完成后 | 单文件回滚 `copy-context.ts` + 撤销 `session-message.tsx` 的 DOM 属性即可恢复原状 |
| 子任务 2 | 移除 `terminalCopyMenuItems` 追加项 |
| 子任务 3 | 移除 composer 订阅 + 菜单项，事件总线文件可留（无消费者无害） |

## 备注

- 前端没有后端改动，不需要 tsgen 同步。
- 新增文件都在 `frontend/app/view/aisessions/` 与 `frontend/app/view/term/`，不新增目录。
- 所有新逻辑优先写成纯函数并单测，UI 层只做接线——这是本项目既有任务的通行做法（`timeline-virtual.ts`、`term-selection-gesture.ts`、`chat-slash.ts`）。
