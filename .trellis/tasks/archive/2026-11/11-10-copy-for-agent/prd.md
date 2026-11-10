# Copy for Agent：一键把上下文交给 agent（冲突/诊断/失败输出）

> 子任务：cfa-core（P0）→ cfa-commontext-conflict / cfa-sync-diagnostics / cfa-terminal-output / cfa-vcs-conflict（P1）→ cfa-settings-json-error（P2）
> 起因：用户原话「一键复制交给 agent，避免让用户给 agent 解释半天」。

## Background（仓库已有三份独立实现，缺的是统一与入口）

同一个「复制给 agent」诉求，目前散落三处、三套格式：

| 已有实现 | 位置 | 格式 |
|---|---|---|
| `syncconflict.RenderAll()` | `pkg/syncconflict/render.go` | 两侧全文 + 仅冲突字段 + Task 陈述 + **输出契约**（"Reply with the merged content only — no explanation, no code fences"），CLI `wsh commontext-sync conflicts --copy` 出口 |
| `buildConflictCopyText()` | `frontend/app/view/preview/conflict-copy.ts` | base→mine / base→theirs 双 diff + 一句 Task（无输出契约） |
| 手写 `errTexts.join("\n")` | `frontend/app/block/connstatusoverlay.tsx:335` | 裸错误行堆叠，无 Task、无契约 |

共享件 `element/copybutton.tsx`（2s 勾反馈、失败不假报成功）已存在，但没有被统一包装成
「Copy for agent」语义。`syncsettings.tsx` 面板至今写着让用户自己去命令行跑
`wsh commontext-sync conflicts --copy`（L944 一带），UI 断点明确。

## Goal

任何「用户需要向 agent 解释半天」的状态，旁边都有一个 `Copy for agent` 按钮：点一下，
剪贴板里是一段自包含、带任务陈述与输出契约的文本，粘给任何 agent（Claude / Codex /
OpenCode / 外部 MCP）都不需要补充一个字；能自动回填的（冲突合并）提供回程。

## 统一契约（所有子任务共同遵守，由 cfa-core 固化为代码）

payload 三段式（与 `syncconflict.RenderMarkdown` 既有行为对齐）：

1. **Context**：结构化事实（id / 时间 / 传输 / 两侧内容或错误码 / 环境版本），机器可读优先，键值行。
2. **Task**：一句祈使句（"Merge both versions…" / "Diagnose why…"）。
3. **Output contract**：明确输出物形态——「只回 X，不要解释、不要整段代码围栏」。缺这段是
   「用户不用解释半天」的成败关键：agent 默认会写一篇分析。

硬规则：

- **只进剪贴板**，不绑定任何单一 provider（跨 agent 唯一通道是剪贴板）。
- 按钮**紧贴被解释的对象**（冲突行右、错误行右），不做全局「导出诊断」。
- 复制成功反馈复用 `CopyButton`（2s 勾），失败静默保持原图标，不假报成功。
- 文案统一 `Copy for agent`，title 带 payload 概要（如 `Copy all 3 conflicts for an AI to merge`）。

## 子任务地图与依赖

| 子任务 | 优先级 | 依赖 | 交付物 |
|---|---|---|---|
| cfa-core | P0 | — | `<CopyForAgent>` + `buildAgentPayload()` 三段式构建器 + 单测 |
| cfa-commontext-conflict | P1 | core | 面板冲突行 Copy 按钮（RPC `SyncConflictsCopy`）+ 冲突抽屉逐条粘回 `resolve` |
| cfa-sync-diagnostics | P1 | core | Sync 失败行（lastError + 最近 N 条 journal 事件）/ Server 不可达（probe checks）/ 协议不兼容（双端版本） |
| cfa-terminal-output | P1 | core | 终端块非零退出一键复制末 N 行输出 + 退出码 + cwd |
| cfa-vcs-conflict | P1 | core | git 合并冲突 + push 被拒；迁移既有 `buildConflictCopyText` 到共享契约 |
| cfa-settings-json-error | P2 | core | Raw JSON 校验失败：键 + 位置 + 片段 |

实施顺序：core → commontext-conflict（第一消费者，验证契约）→ 其余按 P1/P2 自由并行。

**不在本树内**：Agent 卡片「卡住会话尾部复制」——语义与
`10-24-aisessions-agent-copy-context` 已有线重合，在该任务里作为第四个消费面接入，不新开子任务。

## 跨子任务验收（父任务收口判据）——已收口（2026-11-10）

- [x] 1. `grep -rn "Reply with\|output the merged\|只回" frontend/app/element/` → 三个契约常量只此 `agent-payload.ts` 一处定义，无散抄。
- [x] 2. 全仓 `navigator.clipboard.writeText` 调用点中，「拼 prompt 文本」的全部经 `buildAgentPayload`（copy-for-agent.tsx / file-conflict-modal.tsx→buildConflictCopyText 已迁移）；其余均为复制内容本体/标识符（href、code block、选区、id、revision、url 等），不属 Copy-for-agent 语义面。
- [x] 3. 每个消费面的 e2e 都断言了 `### Task` + `### Output contract` 两段：sync-conflict-copy 14/14、sync-diagnostics-copy 20/20、term-failure-copy 11/11、vcs-conflict-copy 17/17、waveconfig-json-error 11/11。
- [x] 4. 6 个子任务各自跑真机验证台并写台账（共 5 个新 area），全部 archive。

附带产出：真机验证台挖出并修复 4 个真 bug——syncmanager reload 抹掉 run 错误（lastRunError 拆分）、SyncNow 失败面板不刷新、term 失败 command 拼接丢可执行文件名、fileread 不接受 conn:local 路由。

## Out of Scope

- 自动把文本发给某个 agent（ACS 走 `11-01-agent-control-surface` 另议）。
- 图片/截图复制（仅文本）。
- agent 自动执行 `checks[].fix`（agent 自己跑命令即可，不替它跑）。
