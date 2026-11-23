# PRD：会话面 2026-11-23 未闭环问题（父）

> 父任务只持有问题清单、证据锚点、优先级顺序与两处待拍板决策；实现全在子包。
> 本文件就是防遗忘台账：每条症状的原始证据（file:line / 日志 / DB 查询）都在各自子包 prd。

## 问题清单与优先级（nita 已确认按此顺序，2026-11-23）

| 序 | 子包 | 问题 | 为什么这个位置 | 规模 | 状态（2026-11-23 午后） |
| 1 | `11-23-commontext-create-send` | CommonText「新建 agent 并发送」文本发了没出去（静默丢消息） | 唯一"成功假象"型 bug：UI 说已发、对方收不到、无报错；改动极小 | S | ✅ 已修入库 `79cf281db`，人工验证过 |
| 1b | `11-23-agentsend-submit-budget` | 提交确认 45s 次数上限绕过时间预算 + 派发回执谎报成功 | 修序 1 时真机挖出的更深根因 | S | ✅ 已修入库 `6e73a4be7` |
| 2+3 | `11-23-overview-refresh-1123` | ①恢复的会话在 Overview 没卡 ②Tab 新增 agent 看不到 ③悬浮卡不刷新（疑同根） | 三症状共享一个"块集合变化未订阅"假设；一次复现台/人工5步定性 | S | ⏳ **等 nita 的 5 步人工复现结果**（`manual-verification.md`） |
| 4 | `11-23-board-card-actions` | 看板卡缺「恢复 agent」+ composer | 纯增量功能，复用已交付 RPC | M | ⏸ **暂缓（2026-11-23 nita：先去掉）**：恢复热区判定冗余（卡=块投影，恢复无对象，孤卡恢复归 #5 重新设计）；✈ 发消息保留在 `b5f08dc7c` |
| 5 | `11-23-session-card-unify` | 列表卡与看板卡融合成单组件 | 纯重构，收益是维护性；依赖序 4 | M-L | 🎨 原型成稿（`6dd2720c6`），**待确认"会话方块"口径 A/B/C**（`notes-20261123.md`） |
| 6 | `11-23-manual-paste-submit-guard` | 手工粘贴+回车被吞的提示 | 可选；上游 TUI 行为，只能加提示 | S | ⬜ 未动工，最低优先级 |

## 已核实的证据快照（2026-11-23 上午，防复查重复劳动）

- 运行实例 = **0.0.136**（`D:\Apps\Snorkeling-win32-x64-0.14.6-beta.0.snorkeling.0.0.136`，08:08 起；
  之前误判 0.0.133 是读了旧轮转日志 `logs/waveapp.69.log`）。
- CommonText 发送两条路：existing → `AgentSendCommand(async:true)`（有提交确认）；
  **create → `registerPendingInput` + `term.tsx` 前端 paste + `setTimeout(submitTermInput, SubmitAfterPasteDelayMs)`（无确认、无补发）**——
  `frontend/app/commontext/commontext-send-button.tsx:323`、`frontend/app/view/term/term.tsx:612-630`。
- 旁证：当日 `Data/waveapp.log` `[agentsend]`/`[agentdispatch]` 0 条（create 路径不走后端）。
- 本会话 block：`64c909ed`（term/pi，sessionid 79963437-f874-…），在 ws `07361d21` tab `sessions`（e30485e2），
  该 ws 的 Overview 块 `d0036db6` 在 tab `OverView`（ea409e02）——数据层面"应该显示"。
- 真正的「恢复」目前只在 AISessions 列表行（`aisessions.tsx:1638 restoreSession` → `RestoreContext`+`createBlock`）。

## 待拍板决策（blocking 序 4/5）

| # | 决策 | 推荐 |
|---|---|---|
| D1 | 看板卡「恢复 agent」语义 | 无活块 → `agent resume`（恢复到新块）；有块 → composer 发唤醒消息。两者都要 |
| D2 | 融合后看板卡的 composer 展开方式 | **浮动面板盖在卡上**（不撑列宽，列不抖）；不用原地长高 |

## 跨子包验收

- 序 1 落地后：CommonText create/existing 两路径走同一后端入口，`[agentsend]` 日志两路径都出现。
- 序 3 落地后：新增 agent 块 → Overview 列表/看板、Tab 悬浮卡三面在 2s 内出现（复用同一次复现台断言）。
- 序 5 落地后：同 fixture 在 `variant=row|card` 下渲染的 counts/chips/actions 数逐一相等 + 像素回归不退化。
