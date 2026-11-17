# CommonText Send 后台异步发送：不跳转不打扰 + 隐藏挂载注入

## Goal

CommonText Send 改为后台异步：不再跳转目标 Tab、不抢焦点、不打断用户当前操作。新建的 Agent Block
在隐藏挂载（visibility:hidden）的目标 Tab 中等待 TUI 就绪并完成注入，用户全程可继续做自己的事。

## Requirements

1. **不打扰**：Send 执行全程不改变激活 Tab（不调 `setActiveTab`、后端 `activateTargetTab=false`）、
   不移动 DOM 焦点、不写任何 localStorage / 持久化状态。
2. **真后台**：目标 Tab 不激活时，新建 Agent Block 也要在后台等 TUI 就绪并注入文本（复用现有
   pending-input「首输出 + 600ms 静默窗口 + TTL 60s」判定、bracketed paste、延时回车提交链路）。
3. **可回退**：Send popover 提供「后台执行」开关（默认开）；关闭时保留旧的跳转行为（回归兼容）。
4. **生命周期受控**：pending Tab 的隐藏挂载必须在 inject 完成 / expire 回退 / 块被删 / Tab 被关时
   可靠移除；隐藏挂载数量有上限，不无界增长。
5. **状态可见**：发送结果仍经 compose 弹窗 onStatus 反馈（"已在后台发给 X"）；新 agent 照常出现在
   Overview 看板。
6. **启动安全**：本改动不得引入任何「重启起不来」的雷（历史事故模式：持久化残留 + 模块求值期
   读取 → renderer 报废，见 block-jump-signal）。禁止持久化 pendingInputTabIds / pending input registry。

## Acceptance Criteria

### 功能（单测 + 真机）
- [ ] existing-tab 与 new-tab 两条路径后台发送后：`globalStore.get(atoms.workspace).activetabid` 不变；
      DOM `document.activeElement` 不变；localStorage 键集合无新增。
- [ ] 目标 Tab 未激活时，注入照常发生（`snorkeling:pending-input-injected` 事件到达，blockId 落在
      目标 Tab）；无 fallback（回退剪贴板）事件。
- [ ] 用户事后切到目标 Tab：块已就绪、会话已在跑、布局正常、组件复用不重挂载。
- [ ] 「后台执行」关闭时：旧行为回归（跳转目标 Tab）。
- [ ] 单测：pending tab 队列（去重、上限、不参与 PreloadTabCap 切片）、晚注册重触发、
      inject/expire/删块/关 Tab 移出、giveFocus 与 window.term 的非激活 Tab 守卫。

### 异常场景（真机）
- [ ] TTL 到期（TUI 永不就绪）→ 剪贴板回退 + fallback 事件，无卡死、pending Tab 移出挂载。
- [ ] 注入等待中删除目标块 / 关闭目标 Tab → 无崩溃，pending 挂载自动清理。
- [ ] 发送期间用户在当前 Tab 打字/切 Tab/开弹窗 → 焦点不被抢、文字落在当前 term。
- [ ] 连续多次后台发送（含超过挂载上限）→ 互不串扰，超过上限的排队等待，TTL 兜底。
- [ ] 多行/大段文本 → bracketed paste 语义完整（复用现有链路，回归断言）。

### 启动安全（真机）
- [ ] 发送进行中直接杀掉 app → 重启正常（pending 状态全内存，无残留）。
- [ ] 正常后台发送多次 → 退出 → 重启：窗口正常 show、Tab/块全部还原、无黑屏死锁、
      localStorage 键集合与功能使用前一致、启动时不因本功能多挂任何 TabContent。

## Notes

- 历史背景：曾致 renderer 黑屏死锁的根因是 block-jump 信号（localStorage 残留 + atoms 未初始化时
  抛 TypeError），commit `9b30e6721` 已修。本功能不产生任何跳转信号。
- 方案评审（builtin reviewer，2026-11-17）：Go with changes；P1 修改项已并入本 PRD 与 design.md。
