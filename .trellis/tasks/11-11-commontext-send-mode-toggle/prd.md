# CommonText Send：聚焦块 / 新建 显式二选一

## Goal

Send 目标选择面板把「发送到聚焦块」的 ✓ 从纯推导改成**显式二选一**（聚焦块 / 新建），
修掉「选了与聚焦块同款 agent 时没有任何入口切到新建」的 UX 死角。

## 背景

现状：面板第一段的 ✓ 完全由「Agents + Type + Folder 三项是否与聚焦块全等」推导。
用户点了与聚焦块同家的 agent（如聚焦块是 Codex、又选了 Codex）→ 三项仍全等 → ✓ 依旧打在聚焦块上，
想「新建一个同款 Codex 块」没有任何办法（只能去改 Type/Folder 才能脱离聚焦）。
用户反馈："我选择了其他的时聚焦还是打上对勾了，怎么切换呀"。

## Requirements

1. `CommontextSendConfig` 增加 `mode: "focused" | "create"`，默认 `"focused"`（跟随现状）。
2. 面板第一段改成两个显式互斥选项行（复用现有行样式）：
   - 「聚焦的 Agent Block」（mini card）— 点击 = 三项跟随聚焦块（`mode:"focused"` + profile/tab/folder 置空跟随）；
   - 「新建 Agent Block」— 点击 = `mode:"create"`（保留当前 Agents/Type/Folder 选择，允许「同款新建」）；
   - ✓ 跟随**实际落点**（`preview.kind`）：existing → 聚焦行；create → 新建行。两行有且仅有一个 ✓。
   - 无聚焦 agent block 时保持现有禁用提示；新建行照常可选。
3. `resolveSendTarget`（纯逻辑）支持 `forceCreate`：true 时永远 create（三项全等也不落 existing）。
4. 点 Agents/Type/Folder 控件不改 mode（用户已显式选择过目标模式后，改配置不应把目标模式拉回推导）。

## 非目标

- 不改发送执行链路（executeCommonTextSend / pending-input）。
- 不改 SplitButton 控件。

## Acceptance Criteria

- [ ] 单测：`forceCreate=true` 且三项与聚焦块全等 → `create`；`forceCreate` 缺省 → 原 `existing` 判定不变。
- [ ] 单测/类型：`CommontextSendConfig.mode` 默认 `"focused"`。
- [ ] 面板两行互斥 ✓：选中「新建」后聚焦行 ✓ 消失；切回「聚焦的 Agent Block」→ ✓ 回到聚焦行。
- [ ] 既有 `resolveSendTarget` 8 条判定表单测保持绿；vitest 全绿 + eslint/tsc 涉及文件干净。
- [ ] 真机 verify 按 2026-11-11 约定暂不跑（机器卡顿），后续机器空闲时与
      `commontext-send-agent-block` 一起补跑。

## 验证命令

```powershell
npx vitest run frontend/app/commontext/
npx eslint frontend/app/commontext/commontext-send-button.tsx frontend/app/commontext/commontext-send-target.ts
```
