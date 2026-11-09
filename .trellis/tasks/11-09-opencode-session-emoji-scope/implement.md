# 执行计划

## 前端（R1）

1. [ ] `frontend/app/agent-persona/persona-scope.ts`：加 `"block"` scope + 写目标分支 + 3 参/4 参折叠函数
2. [ ] `frontend/app/agent-persona/picker-host.ts`：`sessionId` 空 + `blockId` 非空 → `initialScope = "block"`
3. [ ] `frontend/app/agent-persona/agent-emoji-picker-host.tsx`：向 picker 传 `blockId` + `blockEmoji`（读 block meta `agent:emoji`）
4. [ ] `frontend/app/view/term/agent-emoji-picker.tsx`：footer 加「仅此标签页」radio；`applyEmoji` 加 block 分支（`RpcApi.SetMetaCommand` + `makeORef("block", blockId)`）；「恢复默认 Logo」per-scope 判定；文案改「未识别到当前会话 ID」
5. [ ] 更新/新增测试：
   - `persona-scope.test.ts`：block 象限（有/无 blockId、session/block/provider 交叉）
   - `agent-emoji-picker-host.test.tsx`：无 sid + 有 blockId → `initialScope === "block"`

## 后端（R2）

6. [ ] `pkg/blockcontroller/shellcontroller.go`：`shouldPersistAgentSessionId` 纯函数 + `PersistAgentSessionIdFromHook`（sync.Map 去重 + meta 非空不覆盖 + 复用 `persistAgentSessionId`）
7. [ ] `pkg/service/blockservice/blockservice.go` `ReportAgentStatus`：Report 成功后调用
8. [ ] `pkg/wshrpc/wshserver/wshserver.go` report 入口：同样调用
9. [ ] Go 单测：`shouldPersistAgentSessionId` 三态（空→写 / 已有相同 / 已有不同）

## 验证

- [x] `npx vitest run frontend/app/agent-persona frontend/app/view/term/agent-emoji-picker` 相关文件全绿（先看现有测试是否分组，可 `npx vitest run persona-scope agent-emoji`）
- [x] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/blockcontroller/ ./pkg/service/blockservice/"`
- [x] 全量相关面回归：`npx vitest run frontend/app/block frontend/app/view/term`
- [x] detect_changes / 交叉检查（trellis-check）

## 回滚点

- 每步独立提交粒度可回滚；后端回写可单独摘除（两处调用）。
