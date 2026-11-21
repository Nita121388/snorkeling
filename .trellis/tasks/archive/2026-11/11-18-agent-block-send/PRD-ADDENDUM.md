
## 判据修正（2026-11-19 复测）
- `waitedms ≈ quietms` 只是**提示**，不是铁证：先建块→等 3s→单独 send 时 waitedms 同样=400，
  但 TUI 已有 76KB 输出且指令确认到达。
- 真正的判据是**发送瞬间的输出字节数**（0 字节 = 未就绪）。修复必须把「发送瞬间 size」打进日志/返回体。

---

## 追加需求 R10：CommonText existing 发送路径收口到 agentsend（2026-11-20 用户反馈「还是存在发送失败」）

### 诊断结论（读前端链得到，攒了 5 个失败入口）

前端链 = xterm `paste` + 「首输出 + quiet 静默」轮询 + 固定延时回车，纯启发式：

1. **固定 150ms paste→回车竞态**（`commontext-insert.ts` `SubmitAfterPasteDelayMs=150`）：TUI 忙/首次渲染慢时 bracketed paste 没吃完，`\r` 被当成粘贴内容吞掉 → 文字停在输入框、agent 收不到。
2. **静默判定被 spinner 打穿**（`term.tsx:605` + `pending-input.ts` `DefaultPendingInputQuietMs=600`）：agent TUI 启动期持续重绘，`lastUpdated` 每帧在涨 → 永不静默。
3. **TTL 兜底是写剪贴板**（`term.tsx:630`）：60s 后 expire → 文本进剪贴板，只有一条 console.warn，界面看起来就是「没发出去」。
4. **隐藏挂载上限 2**（`PendingInputTabMountCap`）：连续后台发第 3 个目标 → 该 Tab 不挂载 → 无 TermWrap → 永不 inject。
5. **未就绪直报失败**（`sendTextToFocusedTerm` 返回 null → `commontext:send.notReady`），`submitTermInput` 失败也只 console.warn。

### 要求

- **R10.1** `executeCommonTextSend` 的 existing 路径（`commontext-send-button.tsx:238`）改为后端 `AgentSendCommand`（本地块）：就绪等待/一次 bracketed paste/回车/明确错误码全由后端承担，前端不再自造等待。
- **R10.2** 远端块（`AgentBlockInfo.connection` 非空非 local）或后端返回 `E_UNSUPPORTED` → 回退现有前端 paste 链，不得双双写入（禁止「后端失败再 paste」用于已 injected 的场景：会出现文本重复）。
- **R10.3** 失败必须可见：走 `onStatus(i18n.t("commontext:send.sendFailed", { error }))`，不允许只 console.warn。
- **R10.4** create 路径（`registerPendingInput` + 隐藏挂载 + `reinitWave` 并 Tab）本包**不动**：它同时是 `scripts/verify/commontext-send-agent-block` 断言对象（rule 8「pending input 在 TUI 就绪后自动注入」），收口需要连 verify area 一起改，另开包。

### 判据（机器可判定）

- [ ] `npx vitest run frontend/app/commontext` → 0 fail（existing 路径单测：本地块 → 调 `AgentSendCommand` 且不调 `terminal.paste`；远端块 → 只走 paste；RPC 报错 → 触发 sendFailed 状态）
- [ ] `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "commontext-send-button"` → `0`
- [ ] 真机：`node scripts/verify/commontext-send-agent-block/verify.mjs --attach` → create 路径行为不变（pending input 仍注入）
- [ ] 真机：聚焦一个本地 agent 块 → CommonText 发送 → `wsh block read <id> --tail 20` 能看到发出的文本（不经过前端 xterm），且 agentsend 返回 `injected=true submitted=true`

### 现状台账依据

`docs/project/verify-ledger.md`：`commontext-send-agent-block` 2026-11-18 11:48 出现 ❌ 28/30（11:59 复跑 30/30）；`commontext-send-background` 2026-11-19 03:12 fatal 未跑。复测先跑这两个 area 定位属于上面哪一条。

### R10 实现记录（2026-11-20 21:35）

- 落地：`frontend/app/commontext/commontext-send-button.tsx` `executeCommonTextSend` existing 分支。
  本地块（connection 空/local）→ `RpcApi.AgentSendCommand({blockid, text64, submit:true})`，
  发送前先 `onStatus(send.sending, info)`，成功 `sent`；远端块与 `E_UNSUPPORTED`/`E_NOT_FOUND`（确定没写入）
  回退原前端 paste 链；其余错误（E_AGENT_NOT_READY 等）**不回退**（防双路重复文本），走 `sendFailed` 可见报错并返回 false。
- 新增单测 `frontend/app/commontext/commontext-send-existing.test.ts`（5 用例全绿）：
  1. 本地块 → AgentSendCommand 带 blockid/text64(#tag 剥离)/submit=true，且**不调** terminal.paste；
  2. 远端块 → 不调后端，只走 paste 链；
  3. E_AGENT_NOT_READY → sendFailed 可见 + false + 不回退（防双发）；
  4. E_UNSUPPORTED → 回退 paste 链；
  5. 先发 sending(info) 再落终态。
- 回归：`npx vitest run frontend/app/commontext` → 14 files / 191 tests 全绿（compose-modal dom 含 Send 按钮渲染）；
  tsc `commontext-send` 0 错；eslint exit 0。
- i18n：`commontext:send.sending`（en "Sending…" / zh "发送中…"）。
- 判据状态：
  - [x] vitest commontext → 0 fail（191/191）
  - [x] tsc `grep -c "commontext-send-button"` → 0
  - [ ] 真机 verify：`commontext-send-agent-block` / `commontext-send-background`（与 11-20 v2 的真机收尾一起跑，
        当前有并行包 hotzones 在同仓改 session-overview，暂不起实例）
  - [ ] 真机 wsh block read 复核注入（同上一起）
