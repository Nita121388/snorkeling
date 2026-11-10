# Implement — AISessions 恢复时 session not found 优雅降级

## 白名单（touch）

- `frontend/app/view/aisessions/utils.ts`
- `frontend/app/view/aisessions/utils.test.ts`
- `frontend/app/view/aisessions/agent.tsx`
- `frontend/app/view/aisessions/aisessions.tsx`
- `frontend/app/view/aisessions/agent-restore-bound.test.ts`（新增）
- `.trellis/tasks/11-10-aisessions-restore-notfound-graceful/**`
- `.trellis/config.yaml`（hook 路径可移植化，已改）

## 步骤

- [x] 1. `utils.ts` 增加并导出：
  ```ts
  export function isSessionNotFoundError(error: unknown, sessionId?: string): boolean
  ```
  实现：`getErrorMessage(error).trim().toLowerCase()`；必须包含 `session not found:`；若给了 sessionId（trim 后非空）则必须包含 `session not found: <id 小写>`。
- [x] 2. `utils.test.ts` 补 ≥5 条用例（含 id 匹配/不匹配/无 id 参数/非 not-found 错误/空值）。
- [x] 3. `agent.tsx`：
  - 加 `private async clearBoundSessionMeta(): Promise<void>`：`RpcApi.SetMetaCommand(TabRpcClient, { oref: `block:${this.blockId}`, meta: { "aisessions:sessionid": null, "agent:sessionid": null } })`，`.catch(() => undefined)`。
  - 加 `async restoreBoundSession(): Promise<void>`：读 `getBoundSessionId()`；空则 return；`await this.loadDetailById(id)`；成功 return；失败时若 `isSessionNotFoundError(globalStore.get(this.errorAtom), id)` → 清 meta + `errorAtom=""`、`detailAtom=null`、`selectedKeyAtom=NewSessionKey` 启动 New Chat（复用 `startNewSession()`）；否则保持错误展示。
  - mount effect 改为 `void model.restoreBoundSession()`。
- [x] 4. `aisessions.tsx`：恢复 fallback 链处（约 617-630 行）把 `loadDetailById` 失败分支改为：
  ```ts
  } else if (boundSessionId !== "") {
      if (await this.loadDetailById(boundSessionId, refresh)) return;
      if (isSessionNotFoundError(globalStore.get(this.errorAtom), boundSessionId)) {
          await this.clearBoundSessionMeta();
          globalStore.set(this.errorAtom, "");
      }
  }
  ```
  随后逻辑接回原有 `shouldAutoStartNewChat / 首个会话` 分支；加对应 `clearBoundSessionMeta`（同 agent.tsx 实现，若 `this.blockId` 存在；否则用当前 block meta 路径既有写法）。**先确认 `aisessions.tsx` 的 `this.blockId` 字段名**。
- [x] 5. 新增 `agent-restore-bound.test.ts`：构造 AgentViewModel（jotai globalStore 重置、mock `service.Detail` 抛两种错误、mock `RpcApi.SetMetaCommand`），断言 AC2 两条。
- [x] 6. 验证：
  - `npx vitest run frontend/app/view/aisessions/` 全绿
  - `npx tsc --noEmit`
  - `npx eslint frontend/app/view/aisessions/utils.ts frontend/app/view/aisessions/agent.tsx frontend/app/view/aisessions/aisessions.tsx`
- [x] 7. 真机（可选，若 app 可跑）：改 block meta 塞一个不存在的 session id → 重启 → 不再出现错误横幅，块进入 New Chat。

## 风险 / 回滚

- 误判「瞬时失败」为 not-found 会误清有效绑定：已通过严格匹配 `session not found: <确切 id>` 降低；非该文本的失败不清绑。
- 回滚：单点 revert 上面 4 个源码文件的改动即可，无 schema/契约变更。
