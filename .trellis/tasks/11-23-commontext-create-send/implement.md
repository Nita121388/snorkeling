# Implement：CommonText create 路径改走后端 agentsend

## 0. 红证

`frontend/app/commontext/commontext-send-create-path.test.ts`：
- mock `@/app/store/services`（`ObjectService.CreateBlockInTab` → "blk-new"）、`@/app/store/wshclientapi`
  （`RpcApi.AgentSendCommand` spy）、`@/app/store/global`（atoms/globalStore/createBlock/getApi）、
  `./pending-input`（`registerPendingInput`/`mountPendingInputTab` spy）。
- 用例 1：`executeCommonTextSend({text:"hello", config:{mode:"create"...}, ...})` →
  `AgentSendCommand` 调用 1 次，参数 `{blockid:"blk-new", submit:true, async:true, wait:true, waitms>=120000}`，
  `text64` 解出来 == "hello"；`registerPendingInput` 调用 0 次。
- 用例 2：`AgentSendCommand` reject → `onStatus` 收到 `("err")`，函数仍返回 true（块已建）。
- 用例 3（防回退）：existing 路径仍然调 `AgentSendCommand` 且文本一致。

判定：`npx vitest run frontend/app/commontext/commontext-send-create-path.test.ts` → 红（拒绝/未调用）

## 1. 改 `commontext-send-button.tsx` create 分支

`if (preview.kind === "create")` 内，`blockId` 建好之后：

```ts
// 后端 agentsend：就绪门 + paste + 回车 + confirmSubmit（补回车），与 existing 路径同一入口。
// 必须先建块成功再发起（失败不留空 entry），且不阻塞 UI（async + fireAndForget）。
fireAndForget(async () => {
    try {
        const sendResult = await RpcApi.AgentSendCommand(TabRpcClient, {
            blockid: blockId,
            text64: stringToBase64(cleanText),
            submit: true,
            async: true,
            wait: true,
            waitms: 120000,
            requester: "desktop",
        });
        if (sendResult?.submitconfirmed === false) {
            console.warn("[commontext] 新建 agent 消息已放入输入框但未确认提交", { blockId });
            onStatus?.(i18n.t("commontext:send.submitUnconfirmed"), "err");
        }
    } catch (error) {
        console.warn("[commontext] 新建 agent 发送失败", { blockId, error });
        onStatus?.(i18n.t("commontext:send.sendFailed", { error: (error as Error)?.message ?? "" }), "err");
    }
});
```

- 删除 `registerPendingInput(blockId, cleanText)`。
- 删除 `mountPendingInputTab(targetTabId, blockId)` 调用与 `targetTabId` 维护（仅该调用使用；
  若编译器报未使用则连同 `targetTabId` 变量一起清理，**不动** `activation` / `setActiveTab` 逻辑）。
- `onStatus` 文案：`sentBackground` / `sentPending` 语义改为「已投递（后台）」；新增 key
  `commontext:send.submitUnconfirmed`（中英）。

判定：红证转绿 + `npx vitest run frontend/app/commontext` 全绿 + `npm run build:dev` 过 + tsc 无新增。

## 2. 真机验证

- 实例：`scripts/verify/commontext-send-agent-block`（若结构可直接扩）或新建 `commontext-create-send` area。
- 断言：create 模式发送 `CARD_OK` → 轮询 `waveapp.log`（或 renderer 事件）出现 `[agentsend]` 且
  `submitconfirmed` 非 false；agent 回复文本含 `CARD_OK`。
- 反证断言（可选）：修复前桩——断言不再出现 `snorkeling:pending-input-injected` 事件。

判定：`node scripts/verify/<area>/verify.mjs` → 全绿；台账入账。

## 出界即停

touch：`frontend/app/commontext/commontext-send-button.tsx`、`commontext-send-create-path.test.ts`、
`frontend/i18n/locales/{en,zh}/commontext.json`、`scripts/verify/commontext-create-send/**`、
`scripts/verify/README.md`、`docs/project/verify-ledger.md`、`.trellis/spec/**`、`loop/**`。
改 `term.tsx` / `pending-input.ts` / 后端 = 停，报告。
