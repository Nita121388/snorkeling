# CommonText Send：注入后自动提交 + 目标/Agents 行样式收口

## Goal

1. **修「粘贴了但没发送」**：Send 的两条注入路径都只 `terminal.paste(text)`，没有回车提交 —— agent 收不到。
2. **样式收口**（用户 2026-11-11 反馈）：目标模式行用 Agents 同款 chip 语言；Agents 选择行改纯 logo 单行、不换行。

## Bug 根因

- 新建路径：`frontend/app/view/term/term.tsx` pending-input 注入 = `termWrap.terminal.paste(text)`；
- 聚焦块路径：`frontend/app/commontext/commontext-insert.ts` `sendTextToFocusedTerm` 同样只 paste。
- 两条路径都缺提交动作。用户实测：新建 agent block 后文字粘进输入框但没发出。

## Requirements

1. 注入后自动提交：paste 后延迟 ~150ms 经 `RpcApi.ControllerInputCommand` 发 `"\r"`
   （termsticker.tsx / term-model.ts `sendDataToController` 的同一 PTY 通道），两条路径统一走一个 helper。
2. 目标模式行（聚焦块 / 新建）：与 Agents chip 同款视觉（`bg-accent/12` + 左 2px 强调条 + 图标 + 选中 ✓），
   单行两个 chip；下方一行小字摘要显示实际落点。
3. Agents 行：纯 logo（`getAgentIcon`）单行、`flex-nowrap overflow-x-auto` 不换行；选中的名字显示在
   section 标题右侧；默认项 logo 右上小圆点；每个 logo 保留 `title`/`aria-label`。
4. 真机验证按 2026-11-11 约定跳过（机器卡顿），verify 台选择器同步更新，待机器空闲补跑。

## Acceptance Criteria

- [ ] 新建路径与聚焦块路径注入后都发送 `"\r"`（单测锁 helper：调用 ControllerInputCommand 且入参含 \r）。
- [ ] Agents 行：无换行（jsdom 断言容器 class 含 nowrap/overflow）、logo 按钮 title 完整。
- [ ] 目标模式行保留 `data-commontext-send-mode` 属性（verify 台依赖）。
- [ ] vitest（commontext + splitbutton）全绿；eslint/tsc 涉及文件干净。

## 验证命令

```powershell
npx vitest run frontend/app/commontext/ frontend/app/element/splitbutton.dom.test.tsx
npx eslint frontend/app/commontext/ frontend/app/view/term/commontext-insert-path
```

## 实施结果（2026-11-11）

- [x] `commontext-insert.ts`：新增 `submitTermInput` + `SubmitAfterPasteDelayMs`；`sendTextToFocusedTerm` paste 后延时发 `""`。
- [x] `term.tsx`：pending-input 注入 paste 后同样延时发 `""`（新建块路径）。
- [x] 单测 `commontext-insert.test.ts`：锁「走 ControllerInputCommand + 载荷 = base64("") + 无 blockId 不发」。
- [x] 目标模式行改 Agents chip 语言（`TargetChip`：accent 软底 + 左 2px 条 + 选中 ✓），下方一行落点摘要。
- [x] Agents 行改纯 logo 单行不换行（`overflow-x-auto`，32×32，选中名字只出现在 section 标题右侧，
      默认项右上小圆点，`title`/`aria-label`/`aria-pressed` 齐备）；删掉不再使用的 AgentMiniCard。
- [x] verify 台同步：分区文案（选择目标/新建/选择 Agent…）、agent chip 按 `data-commontext-agent-chip` 定位、
      新增 `data-commontext-send-mode` 行断言。
- 验证：vitest 182 passed（commontext + splitbutton）；eslint/tsc 涉及文件干净（term.tsx 仅 pre-existing
  TermThemeProps 错，与本次无关）。真机验证按用户要求跳过（机器卡顿），待机器空闲补跑。
