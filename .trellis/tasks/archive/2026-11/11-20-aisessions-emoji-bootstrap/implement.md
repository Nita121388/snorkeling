# 执行计划：Agent Block emoji 丢失修复

## R1 后端：全量 emoji props RPC

1. [ ] `pkg/aisessions/sqlite_index.go`：`EmojiPropRow` 类型 + `EmojiPropsAll(ctx)`（LEFT JOIN ai_sessions，
       `prop_key='emoji'`，跳过非字符串/空串，`ORDER BY updated_at DESC LIMIT 2000`）
2. [ ] `pkg/aisessions/emoji_props_all_test.go`：3 行数据（有 emoji / 无 emoji / 无 ai_sessions 行）→
       只返回 1 条、字段齐全、`ID` 为空时 `SessionKey` 仍存在；上限行为不测（常量断言即可）
3. [ ] `pkg/agentcontrol/emoji.go`：`SessionEmojiPropsList(ctx)`（打开 shared index，只读，映射 wshrpc 类型）
4. [ ] `pkg/wshrpc/wshrpctypes.go`：`SessionEmojiPropsListRequest/Result/Entry` + interface 方法
5. [ ] `pkg/wshrpc/wshserver/session_commands.go`：`SessionEmojiPropsListCommand`
6. [ ] `pkg/wshrpc/wshclient/wshclient.go`：`SessionEmojiPropsListCommand`（wire name `sessionemojipropslist`）
7. [ ] `frontend/app/store/wshclientapi.ts`：对应方法
8. [ ] `frontend/types/gotypes.d.ts`：`SessionEmojiPropsListRequest/Result/Entry`

## R2 前端 store：bootstrap + 只推不撕

9. [ ] `frontend/app/agent-persona/session-persona-store.ts`
       - `migrateLegacySessionEmojis()`：删掉 `removeItem` / `localEmojis={}` / `emit()`，保留推送；更新注释
       - 新增 `emojiMapFromEntries(entries)`（纯函数，可测）+ `bootstrapSessionEmojis()`
10. [ ] `frontend/app/app.tsx`：mount effect 改调 `bootstrapSessionEmojis()`（保留 catalog 预热）
11. [ ] `frontend/app/agent-persona/session-persona-store.test.ts`
       - 迁移成功后 **key 仍在** 且快照不丢（替换旧断言）
       - `emojiMapFromEntries`：id + sessionKey 双键、空键跳过、重复不覆盖
       - `bootstrapSessionEmojis`：mock 两个 RPC → 快照 = 后端全量 ∪ 本地

## R3 空串回落加固

12. [ ] `frontend/app/view/term/agent-logo.tsx`：`getAgentIcon` 空串回落 meta（D4）
13. [ ] `frontend/app/view/term/agent-logo.test.ts`：`{sessionId: ""}` + meta `agent:sessionid` → 命中 emoji

## 验收命令（顺序执行，全部有数字/绿红）

```bash
# 本地工具链（Windows，子进程 dot-source）
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/aisessions/... -run Emoji"
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/agentcontrol/... ./pkg/wshrpc/... -run Emoji"
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go build ./..."
npx vitest run frontend/app/agent-persona frontend/app/view/term/agent-logo.test.ts
npx tsc --noEmit -p .   # 或 npm run ts-check，按仓库脚本
```

## 真机证据（A4）

- 首选机器判定：`node scripts/inspect-electron-ui.mjs`（需 app 以 `--remote-debugging-port=9222` 启动）
  读 `.block-frame-default-header-iconview` 的 `innerHTML`：修复后 agent block 应含 emoji 文本节点
  而非品牌 `<svg>`。
- 若本机性能/重启成本高：以 R2/R3 的 vitest 用例 + R1 的 Go 测试作为判据，并在 ledger/implement 记录
  「真机 skip + 理由」。**不接受「我看了一下没问题」**。

## 回滚点

- 回滚点 1（R1 完成）：RPC 只读、无调用方 → revert 无痕。
- 回滚点 2（R2 完成）：`app.tsx` 单点改动，换回旧调用即回滚；store 迁移改动需与 `app.tsx` 一起回滚。

## 交付纪律

- 白名单：`pkg/aisessions/sqlite_index.go`、`pkg/aisessions/emoji_props_all_test.go`、`pkg/agentcontrol/emoji.go`、
  `pkg/wshrpc/wshrpctypes.go`、`pkg/wshrpc/wshserver/session_commands.go`、`pkg/wshrpc/wshclient/wshclient.go`、
  `frontend/app/store/wshclientapi.ts`、`frontend/types/gotypes.d.ts`、`frontend/app/agent-persona/**`、
  `frontend/app/app.tsx`、`frontend/app/view/term/agent-logo.tsx`、`frontend/app/view/term/agent-logo.test.ts`、
  `.trellis/tasks/11-20-aisessions-emoji-bootstrap/**`
- 不提交（主 agent 统一收尾）；子 agent 不写台账。

## 执行记录（2026-11-20）

- R1/R2/R3 全部落地；改动文件与白名单一致（`git status` 核对）。
- 判据结果：
  - `go test ./pkg/aisessions/... -run Emoji` → ok（含新增 `TestSQLiteIndexEmojiPropsAll`：3 行数据只出 1 条、
    其它 prop 不混入、孤儿 session 仍按 sessionKey 返回、ID 为空）。
  - `go test ./pkg/agentcontrol/... -run Emoji` → ok。
  - `go build ./pkg/aisessions ./pkg/agentcontrol ./pkg/wshrpc/wshclient ./pkg/wshrpc/wshserver` → 干净。
  - `vitest run frontend/app/agent-persona frontend/app/view/term/agent-logo.test.ts` → **6 files / 56 tests passed**。
  - `tsc --noEmit -p tsconfig.json` → 81 条错误**全部为改动前既有基线**（preview/emain/agent-status-notify），
    本次触碰的 5 个文件 0 错误（`grep` 命中 0）。
- A4 真机：**skipped**（用户本机 app 正在使用中，且现网是 0.0.132 安装版不含本修复；起 dev 实例需重启/构建，
  用户此前对同类改动已明确豁免真机）。替代证据 = 上述 vitest + Go 判据。若日后验真机：
  `node scripts/inspect-electron-ui.mjs` 读 `.block-frame-default-header-iconview`，
  修复后 agent Block 图标是 emoji 文本节点而非品牌 `<svg>`。
- loop 台账未记：本机无 loop 引擎（引擎在 `E:/primary/projects/loop`），沿用 `N-1119-emoji-p0` 的先例，
  门凭据待引擎侧代录。
