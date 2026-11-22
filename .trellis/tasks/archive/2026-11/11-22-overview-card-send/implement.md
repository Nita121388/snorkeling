# Implement：Overview 卡片展开 + composer 发送

> 红证先行。顺序即实现顺序；每步有判定命令。

## 0. 红证

`frontend/app/session-overview/overview-card-send.test.ts`（纯函数级，无 React）：
- `outcomeFromSend` 六分支：`submitted` / `unconfirmed`（ok 但 submitconfirmed=false）/
  `replied` / `timeout`（warnings 含 reply-timeout，**不是 failed**）/ `failed`
  （error "E_AGENT_NOT_READY: ..." → code=E_AGENT_NOT_READY）/ error 无码 → code=null。
- `buildCardSendRequest`：空文本 → `{ok:false, error:"empty"}`；waitReply=false 不带 waitreply；
  waitReply=true 不带 async；waitms 300001 → 夹 300000；chars 50 → 夹 200；text 走 text64。
- 互斥保护：waitReply=true 时 `req.async !== true`（防止 E_USAGE 从 UI 触发）。
判定：`npx vitest run frontend/app/session-overview/overview-card-send.test.ts` → 红，登记 `loop/red/`。

## 1. 纯函数 `overview-card-send.ts`

按 design §3 实现。判定：同上 → 绿。

## 2. `BlockRow` 展开体

按 design §4：
- 面板级 `expandedBlockId`（互斥）挂在 `SessionOverviewPanel`，
  通过 props/context 下传 `BlockRow`；`draftByBlock`/`sendByBlock` 同级。
- 展开体三段：属性行 / 最近回复（复用行内摘要 + 已有 `onOpenMessage` 跳全文）/
  composer（textarea + 勾选 + 发送）。
- 发送：`RpcApi.AgentSendCommand(TabRpcClient, req, {timeout: 320000})`
  （`waitreply` 等待窗口必须放大 RPC timeout，见 `.trellis/spec/.../agent-roundtrip-contract.md` §3）。
- 行主体 onClick 展开；既有热区（跳转/备注/关闭/`[↪]`）全部 stopPropagation。
- 键盘：Enter 发送 / Shift+Enter 换行 / Esc 收起。
判定：`npx vitest run frontend/app/session-overview` 全绿（258+ 新增）。

## 3. 样式 + i18n

- scss：`.session-overview-card-expand` / 行程徽章色（replied=绿 / timeout=黄 / failed=红）。
- i18n key 见 design §5，`node scripts/i18n/check-parity.mjs` → `键 parity diff: 0`。
判定：`npm run build:dev` 过。

## 4. 真机验证台（扩展 `overview-ux` area，加第 11-13 条）

11. 点 agent 行 → 展开体出现，`document.activeElement` 在 textarea。
12. 发送 `reply with exactly: CARD_OK`（勾等回复）→ 徽章到「收到回复」，卡片内文本含 `CARD_OK`。
13. 取消勾选等回复 → 发送后 ≤2s 徽章到「已提交」，其他行仍可点击展开。
判定：`node scripts/verify/overview-ux/verify.mjs` → 13/13。

## 5. spec 回写

- `.trellis/spec/snorkeling-docs/frontend/overview-tab-grouping-contract.md` 追加或新文件
  `overview-card-send-contract.md`：RPC timeout 必须放大（320s）、映射顺序、E_AGENT_NOT_READY
  的「改为不等待」语义、热区 stopPropagation 纪律。

## 出界即停

touch：`frontend/app/session-overview/overview-card-send.{ts,test.ts}`、`session-overview.tsx`、
`session-overview.scss`、`frontend/i18n/locales/{en,zh}/session-overview.json`、
`scripts/verify/overview-ux/**`、`scripts/verify/README.md`、`docs/project/verify-ledger.md`、
`.trellis/spec/**`、`loop/**`。
改 `overview-board*`（本轮看板卡不接）/ 后端 = 停，报告。
