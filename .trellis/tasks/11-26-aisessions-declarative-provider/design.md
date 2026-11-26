# 技术设计：AISessions 声明式 provider

## 1. 边界与契约

- 声明式 provider 是 `Provider` 接口（`types.go:231`：Source/List/LoadMessages）的又一个实现，与 4 个编译期 provider 同链路：`DefaultProviders()` → Manager 扫描 → SQLite 索引 → 前端。
- 只读：以 `?mode=ro` 打开外部 db，绝不写 agent 数据（沿用项目铁律：provider session files are never modified）。
- 不实现可选能力接口（ToolCallProvider / MessageDeltaProvider / ModelStateProvider / SummaryFileProvider）：Capabilities 缺省，前端走现有降级路径。
- 遵守 aisessions-scan-contract：全部扫描经 Manager single-flight，不新增扫描入口；List() 单次查询 LIMIT 保护（默认 2000，可配）。

## 2. 配置模型（wconfig）

`settings.json` 新节 `"agent:sessionproviders"`：

```jsonc
"agent:sessionproviders": {
  "antigravity": {                      // key = source id
    "label": "Antigravity",
    "type": "sqlite",                   // 本期唯一类型
    "db": "~/.gemini/antigravity-cli/conversation_summaries.db",
    "table": "conversation_summaries",
    "disabled": false,
    "columns": {                        // 字段 -> 列名；缺失列允许，代码按需取
      "id": "conversation_id",
      "title": "title",
      "updated": "last_modified_time",
      "created": "last_user_input_time",
      "project": "workspace_uris",     // file:// URI 串（JSON 数组或单值，实现时兼容两种）
      "parentid": "parent_conversation_id"
    }
  }
}
```

- `AgentSessionProviderConfigType` 加进 `SettingsType`（`agent:sessionproviders,omitempty`）+ metaconsts `ConfigKey_AgentSessionProviders`。`~` 展开、`db`/`table` 必填校验。
- **合并语义**（对齐 agentcatalog builtin+config）：内置默认条目表（代码内，仅 `antigravity` 一项）∪ 用户配置；同 key 用户覆盖；`disabled: true` 剔除。合并逻辑独立成纯函数 `mergeSessionProviderConfigs() map[string]AgentSessionProviderConfigType`，可单测。

## 3. SQLite 声明 provider（pkg/aisessions/provider_declarative_sqlite.go）

- `DeclarativeSQLiteProvider{ source, label, cfg }`：
  - `Source()` 返回配置 key。
  - `List(ctx)`：`SELECT <mapped columns> FROM <table> [WHERE parent filter 无] ORDER BY <updated> DESC LIMIT n`。只 SELECT 声明过的列。
  - 时间解析：实测格式 `2026-11-26 03:21:47.2006764+00:00`，layout `2006-01-02 15:04:05.999999999-07:00`；解析失败回退 0 并计入错误日志（不 fail 整个 List）。
  - project：`workspace_uris` 为 file:// URI（可能 JSON 数组）→ 取第一个解码成路径 → `SessionSummary.ProjectPath`。解码失败留空（前端已有空项目回退）。
  - `FilePath`：`conversations/<id>.db`（同目录推导）存在则用之，否则用 summary db 路径。StableKey 语义不变（source:id:filePath）。
  - `LoadMessages(ctx, path)`：返回 `[]Message{}, nil`——protobuf 正文本期明确不支持。详情页降级 = 打开后仅有头信息与占位，验收只要求不崩。
  - 打开方式 `sql.Open("sqlite", "file:"+path+"?mode=ro")`；驱动与项目现用一致（pkg 内已有 opencode sqlite provider 同款做法，直接对齐 `provider_opencode.go` 的只读连接与错误处理）。
- WAL 注意：目标 db 带 `-wal`（实测在用），只读打开在 WAL 模式下需要能读未 checkpoint 数据——`mode=ro` 可以读 WAL，但若 db 所在目录不可写且 wal 需要恢复会失败；错误路径上返回 error 而非 panic（scan 层把单 provider 错误聚合进 ScanSummaries 的 errs）。

## 4. 注册收口（paths.go）

`DefaultProviders()` 末尾追加：

```
for name, cfg := range mergeSessionProviderConfigs(settings) {
    if cfg.Disabled || cfg.Type != "sqlite" || db 不存在 { continue }
    providers = append(providers, NewDeclarativeSQLiteProvider(name, cfg))
}
```

- 与现有 os.Stat 门一致：db 不存在直接不注册（跨机干净）。
- 配置读取：`DefaultProviders` 现无 settings 参数，改为内部 `wconfig.ReadFullConfig()`（对齐 agentcatalog.List 的做法）。

## 5. 前端来源面收口

现状：`CHAT_SOURCES`（sources.tsx）硬编码 4 项；filter-panel.tsx:336 直接 map 它；`getChatSource` 对未知 source 回退 `{id, label:id}`。

- 后端暴露来源清单：aisessionsservice 新增 `GetSourceList` RPC，返回 `[{source, label, available}]`（available=db 注册门通过与否）。provider 侧加可选接口 `LabeledProvider interface{ Label() string }`，4 个编译期 provider 不实现则用现有硬编码 label 兜底。
- 前端 `sources.tsx`：`CHAT_SOURCES` 保留作兜底/图标映射；新增从 RPC 合并来源的 hook（列表 = CHAT_SOURCES ∪ RPC 来源，同 id 以 RPC label 为准）。filter-panel 与 session-detail 徽标改用合并结果。
- dotClass / icon：未知来源用中性色点；icon 走 `getAgentIcon` 现有回退（首字母/emoji 偏好链已有 fallback）。不为 antigravity 手写专属样式——那是硬编码回潮。

## 6. 兼容与回滚

- 纯增量：不动 4 个既有 provider；配置节缺省 = 内置 antigravity 条目生效（或 db 不存在时无声跳过）。
- 回滚开关：settings `"agent:sessionproviders": {"antigravity": {"disabled": true}}` 单条禁用；整体回滚 = revert commit，无数据迁移（SQLite 索引按 source 前缀可整体丢弃重扫）。
- schema 漂移风险：Antigravity 是快速迭代期产品，`conversation_summaries` 表结构可能变——列映射在配置里，用户可改；代码按「列缺失允许」设计，缺列只影响对应字段，不炸扫描。

## 7. 权衡记录

- 固定列映射 vs 任意 SQL：选前者。表达力换安全与可测；真需要任意 SQL 时再评估（外进程 provider 更合适）。
- FilePath 指向 per-conv db vs summary db：选 per-conv db（存在时）。它是详情会尝试读的路径，语义上「会话文件」应该是它；summary db 是「索引」而非会话本体。
- `GetSourceList` RPC vs 前端从结果集 union：选 RPC。筛选选项要含「当前页 0 结果」的来源，只有后端注册面是全集。
