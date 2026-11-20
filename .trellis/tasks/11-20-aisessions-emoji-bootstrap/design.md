# 技术设计：Agent Block emoji 丢失修复

## 现状（问题结构）

```
              ┌────────────── pick emoji ──────────────┐
              ▼                                       │
 setSessionEmoji(sid, e) ──► localStorage ──┐          │
                            (all windows share)         │
                                            ├─ merge ──► snapshot ──► getAgentIcon
 SessionEmojiRecordPickCommand ──► ai_session_props ──┤   (backend 优先)
                                            │
 backendEmojis ◄── applyBackendSessionSummaries ◄── AI Sessions List (limit 200 + filters)
```

两个断点：

- **B1 本地层被清**：`app.tsx` mount → `migrateLegacySessionEmojis()` → `removeItem(key)` + `localEmojis={}`。
  任何窗口启动都会触发；其它窗口靠 `storage` 事件同步清空 → **运行中丢**。
- **B2 后端层无启动灌入**：唯一生产者是带筛选的列表响应；没打开列表的窗口后端层恒空。

## 设计决策

### D1 新增只读 RPC：全量 emoji props

`SessionEmojiPropsListCommand`（wire name `sessionemojipropslist`，无参数）。

```
SessionEmojiPropsListRequest{}                       // 空结构，保留升级空间
SessionEmojiPropsListResult{ Entries []SessionEmojiPropEntry }
SessionEmojiPropEntry{ SessionKey, ID, Emoji, Source string; UpdatedAt int64 }
```

- 数据层：`SQLiteIndex.EmojiPropsAll(ctx)`，一条 SQL：

  ```sql
  SELECT p.session_key, COALESCE(s.id, ''), p.value_json, p.source, p.updated_at
  FROM ai_session_props p LEFT JOIN ai_sessions s ON s.key = p.session_key
  WHERE p.prop_key = 'emoji'
  ORDER BY p.updated_at DESC LIMIT 2000
  ```

  `LEFT JOIN` 保证 session 行缺失时仍能按 `sessionKey` 提供别名键；`value_json` 非字符串或空串的行跳过；
  `LIMIT 2000` 是明确预算（emoji 行数量级 ~10^2），不携带其它 props。
- 控制层：`agentcontrol.SessionEmojiPropsList(ctx)`（打开 shared index，只读，无写入）。
- 注册面：`wshrpctypes.WshRpcInterface` + `wshserver/session_commands.go` + `wshclient/wshclient.go`
  + `frontend/app/store/wshclientapi.ts` + `frontend/types/gotypes.d.ts`（5 处，与 `sessionemojiget` 同形）。

> 不做：`wsh` CLI 子命令（`wshcmd-session.go`）本轮不加，避免扩散；CLI 需要时复用 RPC 即可。

### D2 store：bootstrap 一次全量替换后端层

```ts
export async function bootstrapSessionEmojis(): Promise<void> {
    // 1. 先把本地层推给后端（if-absent，非破坏，保留历史迁移价值）
    await migrateLegacySessionEmojis();      // 变为「只推不撕」
    // 2. 再把后端全量灌进 backendEmojis（完整集合 → 允许整体替换）
    const result = await RpcApi.SessionEmojiPropsListCommand(TabRpcClient, {});
    setBackendSessionEmojis(mapFromEntries(result?.entries));
}
```

- `mapFromEntries`：同时以 `entry.id` 与 `entry.sessionKey` 作为键（去重、跳过空键），
  兼容 block meta 里存 uuid 或完整 sessionKey 两种形态。
- 失败静默（RPC 不可用时不阻塞首屏），保留现有层，下次窗口启动重试。
- `app.tsx` 的 mount effect 改调 `bootstrapSessionEmojis()`（保留 idle 预热的 emoji catalog 逻辑不变）。

### D3 迁移改为「只推不撕」

`migrateLegacySessionEmojis()`：
- 保留：读本地 → `SessionEmojiMigrateCommand`（后端 if-absent，幂等）。
- 删除：`removeItem(key)`、`localEmojis = {}`、`emit()`。
- 返回语义：`true` = 本地没有待推条目或推送成功；`false` = RPC 失败（下次再试）。
- 理由：localStorage 是所有窗口共享的唯一实时通道；删除它就是「任何一个窗口启动都会清空所有窗口的
  本地层」。后端已优先，本地层留作兜底无副作用。

### D4 `getAgentIcon` 空串回落加固

```ts
const metaSessionId = typeof meta?.["agent:sessionid"] === "string" ? meta["agent:sessionid"] : "";
const optSessionId = typeof opts?.sessionId === "string" && opts.sessionId.trim() !== "" ? opts.sessionId : "";
const sessionId = normalizeSessionEmojiKey(optSessionId !== "" ? optSessionId : metaSessionId);
```

现状 `opts?.sessionId ?? meta[...]` 在调用方传 `""` 时不回落（`""` 非 nullish），meta 兜底失效。

## 数据流（修复后）

```
窗口启动 ─► bootstrapSessionEmojis()
              ├─ migrate（只推）
              └─ SessionEmojiPropsListCommand ─► backendEmojis = 全量
pick emoji ─► local（不删） + RecordEmojiPick（后端）
其它窗口   ─► storage 事件 ─► local 层保持同步（不再被清）
```

## 兼容性 / 回滚

- 纯增量：新 RPC + 新 store 函数；旧窗口/旧后端不匹配时 bootstrap 失败静默，行为回落到现状（不会更差）。
- 回滚：`app.tsx` 换回 `migrateLegacySessionEmojis()` 单调用；RPC 保留无副作用（只读）。
- 不迁移/不删除已有数据；不新增表与持久化介质。

## 风险

- 全量 RPC 响应大小：按 2000 行 × ~120B ≈ 240KB 上限；实测行数 ~10^2。可接受（启动一次）。
- 多窗口同时 bootstrap：只读 + 各自 store，无竞争。
