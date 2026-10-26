# cc-switch → Wave AI 隔离导入方案研究

> Research for task `10-17-wave-ai-default-provider` (Simplify Wave AI defaults and provider naming).
> 范围:cc-switch 供应商导入 Wave AI 的隔离边界 — DTO、RPC/service 边界、安全风险。
> 不修改任何代码,纯研究记录。调查时间:2026-10-17。

## 1. 现状盘点(代码事实)

### 1.1 snorkeling `pkg/ccswitch`(现有集成模式)

- `reader.go`:`Vendor` struct + `List<Vendor>Vendors(ctx)` 从 SQLite DB 读取供应商。
  - DB 路径:`~/.cc-switch/cc-switch.db`(`DefaultDBRelPath`);表 `providers`,列含 `id, app_type, name, settings_config(JSON), website_url, category, created_at, sort_index, notes, icon, icon_color, meta, is_current, in_failover_queue`;PK `(id, app_type)`。
  - `Vendor{ID, Name, Env map[string]string, Model, IsCurrent, ProviderType, Category, *ConfigDir}` — `Env` 由 `settings_config` 提取;`ConfigDir`(Claude/Codex/OpenCode/Pi)是落地到磁盘的隔离配置目录。
- `AppType` 常量:`claude` / `codex` / `opencode` / `pi`。**尚无 waveai。**
- `materialize_opencode.go` / `materialize_pi.go`:按 vendor 隔离目录注入配置,实现启动隔离。
- `diagnostics.go`:`VendorIsolationStatus` 检查。
- 服务侧消费方:
  - `pkg/service/aisessionsservice/aisessionsservice.go`:`ccswitch.ResolveClaudeVendorSessionPath` / `ListClaudeVendors`。
  - `pkg/service/blockservice/blockservice.go`:`GetVendorIsolationStatus(appType, vendorID)`。
  - `pkg/aisessions/paths.go`、`provider_claude.go`:vendors 目录解析。
- RPC 层:`pkg/wshrpc/wshrpctypes.go:172-178` 只读命令 `CcSwitchList{Claude,Codex,OpenCode,Pi}VendorsCommand`,在 `pkg/wshrpc/wshserver/` 实现、`pkg/wshclient/` 有对应 client wrapper。

### 1.2 snorkeling `secretstore`(`pkg/secretstore/secretstore.go`)

- 存储:config 目录 `secrets.enc`,整体加密后写盘;加密/解密经 emain RPC(`ElectronEncryptCommand`/`ElectronDecryptCommand`),Linux 有独立 storage backend。
- 接口:`GetSecret(name)`, `GetSecretsNames()`, `SetSecret`/`SetSecrets`;线程安全 + 写去抖动。
- 命名约束:secret name 匹配 `^[A-Za-z][A-Za-z0-9_]*$`(无连字符、无点)。
- 消费方:`pkg/service/aitestservice/aitestservice.go` 与 `fetchmodels.go` 用 `secretstore.GetSecret(request.SecretName)` 解析 `SecretName` → token(未保存表单测试时用)。

### 1.3 Wave AI 配置结构(snorkeling)

- 存储:`<configDir>/waveai.json`,`map[string]AIModeConfigType`(key 即 mode key),默认 setting `waveai:defaultmode`。
- `pkg/wconfig/settingsconfig.go:405` `AIModeConfigType` 字段(Go + gotypes.d.ts 双向同步):
  - `display:name`(必填)、`display:order`、`display:icon`、`display:description`
  - `ai:provider`(enum: wave/google/groq/openrouter/nanogpt/openai/azure/azure-legacy/custom)、
  - `ai:apitype`(google-gemini / openai-responses / openai-chat)、`ai:model`、`ai:thinkinglevel`、`ai:verbosity`
  - `ai:endpoint`、`ai:proxyurl`、`ai:azureapiversion`、`ai:azureresourcename`、`ai:azuredeployment`
  - `ai:apitoken`(明文,危险)与 `ai:apitokensecretname`(推荐,引用 secretstore)
  - `ai:capabilities`[]、`ai:switchcompat`[]、`waveai:cloud`、`waveai:premium`
- 内置模式 key:`waveai@quick`/`waveai@balanced`/`waveai@deep`(默认 `waveai@balanced`);新任务要求空配置时只创建 `custom@default`("My AI")。
- 前端:`frontend/app/view/waveconfig/waveai-modes.ts` — CRUD 直接 `FileWriteCommand` 写 `waveai.json`;`setDefaultWaveAIMode` 走 `SetConfigCommand({waveai:defaultmode})`;后端 watcher 重新广播 `waveai:modeconfig`(`pkg/wps/wpstypes.go:35 Event_AIModeConfig`)刷新 atom。
- RPC:`GetWaveAIModeConfigCommand`(wshrpctypes.go:84 / wshserver)只读拉取 mode config。

### 1.4 snorkeling service 注册机制

- `pkg/service/service.go` `ServiceMap map[string]any`:现有 `aisessions` / `aitest` / `block` / `object` / `client` / `commontext` / `window` / `workspace` / `userinput`。
- 调度:反射 `CallService(ctx, WebCallType{Service, Method, …})` + `<Method>_Meta()` 生成 tsgen 契约;`ValidateServiceMap()` 兜底校验。
- `aitestservice` 的 `AITestConnectionRequest` 是"镜像 AIModeConfigType 的平铺 struct"(apiType/endpoint/model/provider/apiToken/secretName),不进配置、只测连通性 — **这是现成的"DTO 镜像"先例**。

### 1.5 cc-switch 最新 schema(~/Primary/projects/cc-switch)

- TS:`src/types.ts` `Provider { id, name, settingsConfig: Record<string, any>, websiteUrl?, category?(ProviderCategory), createdAt?, sortIndex?, notes?, isPartner?, meta?(ProviderMeta), icon?, iconColor?, inFailoverQueue? }`,`AppConfig { providers: Record<string, Provider>, current }`。
  - `ProviderMeta` 仅存于 `~/.cc-switch/config.json`(含 providerType 等,不进 live 配置)。
  - `settingsConfig` 语义按 app_type 不同:Claude 是 settings.json 内容;Codex 是 `{auth, config}`;OpenCode/OpenClaw 是 `{baseUrl, apiKey, api, models[]}`(openai-compatible 形态,`OpenClawProviderConfig`);Hermes 是 `{default, provider, base_url, context_length, max_tokens}`。
- 模型侧:`src/config/*ProviderPresets.ts`(claude/codex/universal/gemini/mcode/pi/hermes/jiekou/grok)提供官方模型目录;用户 provider 的模型列表在 `settingsConfig.models` 或 preset 中,SQLite 表 `provider_endpoints(id, provider_id, app_type, url)` 存 endpoint 候选。
- Rust 端 `src-tauri/src/app_config.rs` `AppType` enum:**Claude / ClaudeDesktop / Codex / Gemini / GrokBuild / OpenCode / OpenClaw / Hermes / Pi / Mcode** — **没有 waveai**。`src-tauri/src/provider.rs:240` 注释明确:"listed explicitly (not `_`) so a new AppType fails to compile here" — 加 app_type 是编译期强制改点。
- 数据库表 `providers` 含 `app_type` 维度,PK `(id, app_type)`;`is_current` 标记当前激活供应商。

## 2. 隔离导入方案设计建议

### 2.1 核心思路:只读拉取 + 后端落库,不反向写 cc-switch

cc-switch 最危险的不是读,是写。snorkeling 侧严格遵守**只读**:
- 新增 `app_type = "waveai"` 时,cc-switch 侧需在 `AppType` enum 增加变体(编译期强制),并在 preset/model 目录补充 waveai 端点模板;**snorkeling 不反向写** cc-switch DB。
- 导入方向单向:`cc-switch provider(settings_config)` → 归一化为 `AIModeConfigType` → 写入 `waveai.json` + token 进 `secretstore`。

### 2.2 建议 DTO

沿用现有 `Vendor` 扩展(而不是新建平行包):

```go
const CcSwitchProviderAppTypeWaveAI = "waveai" // 建议值

// 扩展 ccswitch.Vendor(保持原有字段不动),或新增窄 DTO:
type WaveAIVendor struct {
    ID           string            `json:"id"`            // cc-switch provider.id
    Name         string            `json:"name"`          // provider.name
    Category     string            `json:"category"`      // ProviderCategory
    IsCurrent    bool              `json:"is_current"`
    Endpoint     string            `json:"endpoint"`      // 取 settings_config.baseUrl / provider_endpoints 首选
    APIType      string            `json:"apitype,omitempty"` // openai-responses 默认;google OAuth 等特殊处理
    Models       []string          `json:"models,omitempty"`  // settings_config.models / preset
    // 不返回 token:token 只进 secretstore,永远不出后端
}
```

映射规则(settings_config → AIModeConfigType 平铺 DTO):
- `display:name` ← `provider.name`
- `ai:provider` ← `"custom"`(所有 cc-switch 导入项归 custom;若 endpoint 命中 google/groq 等预置域名可保留原始值,见 §3.3)
- `ai:apitype` ← `openai-responses`(默认;gemini 类 provider 用 `google-gemini`)
- `ai:endpoint` ← `settings_config.baseUrl`(无则报错,必须有显式 endpoint)
- `ai:model` ← 用户在 cc-switch 选中的模型或首模型
- `ai:apitokensecretname` ← secretstore 名称(生成规则见 §3.4);**绝不落 `ai:apitoken`**
- `ai:capabilities` ← 从模型 preset 推导(pdfs/images/tools)
- `is_current` 为 true 的 provider 在导入后通过 `SetConfigCommand({waveai:defaultmode: <导入key>})` 设为默认(可选,遵循任务 AC:空配置只建 `custom@default`,不翻旧配置)
- mode key:保持兼容性,导入项用 **固定命名空间 key**,如 `ccswitch@<vendorID>`;key 必须通过 `^[A-Za-z][A-Za-z0-9_@-]*$` 净化,与内置 `waveai@*`、用户 `custom@*` 均不冲突。

### 2.3 RPC / service 边界建议

分层(严格单向依赖,不可反向):

```
frontend (waveai-modes.ts / waveaivisual.tsx)
   │  import 按钮
   ▼
wshcmd / wshserver 只读命令:
   CcSwitchListWaveAIVendorsCommand(ctx) → *ccswitch.VendorList   // 只读拉列表,含 model 清单,无 token
   │
   ▼ 后端 service(建议 aitestservice 或新 ccswitchservice):
   ImportWaveAIFromCCSwitch(ctx, req) → ImportResult{waveAIKey}
      ├─ ccswitch.GetWaveAIVendor(ctx, vendorID)          // 读 DB 单条
      ├─ secretstore.SetSecret(mappedName, token)         // token 后端直写,不进前端
      └─ 合并现有 waveai 配置(读 waveaiModeConfig) → FileWriteCommand(eq. 现有 upsertWaveAIMode 路径)写回 waveai.json
```

- **新 RPC 只加只读命令** `CcSwitchListWaveAIVendorsCommand`,与既有 4 个 ccswitch 只读命令平齐(wshrpctypes.go / wshserver / wshclient)。导入写操作放在后端 service 方法,继续走现成的 `SetConfigCommand` + `FileWriteCommand` + watcher 广播链路,**不新增第 5 类写 RPC**,复用 `waveai:modeconfig` 事件让前端 atom 自动刷新。
- service 注册:`pkg/service/service.go` ServiceMap 增加 `"ccswitch": &ccswitchservice.CCService{}`(或放 `aitestservice` 扩展方法),实现 `<Method>_Meta()` 供 tsgen;跑 `ValidateServiceMap`。
- 隔离语义:后端负责把 `{endpoint, model, token}` 组装成**独立的** AIModeConfigType 条目;各导入项互不污染,不注入全局 env(与现有 claude vendor 的 `ClaudeConfigDir` 隔离思路一致,但 waveai 不需要磁盘 configDir — 配置天然按 mode 隔离)。
- 边界红线:cc-switch DB 只以只读打开(SQLite `mode=ro`),导入过程不得修改 `providers` / `is_current` / `failover` 表;cc-switch 自己的"当前供应商"切换不影响已导入的 waveai 条目。

## 3. 安全风险清单(按严重度排序)

1. **[高] token 落明文**:`ai:apitoken` 字段会让 key 直接进 `waveai.json`(明文,随配置文件分发)。对策:一律走 `ai:apitokensecretname` + `secretstore.SetSecret`;DTO 层面干脆**不提供** `APIToken` 输出字段,强制走 secretstore。
2. **[高] 整段 settings_config 泄露**:cc-switch provider 的 `settings_config` 可能含 Claude 全量 env、Codex auth/config、多个 API key。导入时只提取 `baseUrl/apiKey/models` 三个字段做归一化,**绝不整体序列化 settings_config 进 waveai.json**;也不要把 secret 名 = 原始 provider id(可能与其他 app 的 secret 撞名)。
3. **[中] sqlite 读取安全**:`~/.cc-switch/cc-switch.db` 是第三方可写文件。要以 `PRAGMA query_only` / 只读 URI 打开,容忍缺失表/旧 schema(cc-switch 升级加列时 reader 不崩);字段全部按 JSON 解析失败容错处理。
4. **[中] secret name 冲突/非法**:cc-switch provider id 可含 `-` `.` 空格,secretstore 命名约束是 `^[A-Za-z][A-Za-z0-9_]*$`。生成规则建议 `waveai_<sanitizedID>` 并去重/加时间戳;导入前必须校验 waveai.json 中是否已有同名 key(拒绝覆盖用户数据)。
5. **[中] mode key 冲突与默认值覆盖**:导入项 key 用 `ccswitch@<id>` 命名空间;空配置场景遵守 AC 只建 `custom@default`,导入不静默改写 `waveai:defaultmode`(要改必须用户显式选择)。
6. **[中] 命令注入/URL 校验**:endpoint / model 来自用户自有 DB,仍应按 URL 解析(仅允许 http/https)、拒绝 CRLF/控制字符;model 字符串限长并过白名单字符集,防 RPC 日志打印时被 payload 污染(日志脱敏)。
7. **[低] 代理链**:waveai 已有 `ai:proxyurl` 字段,若导入走企业代理,proxyurl 也应走 secretstore 或至少只读校验,不记录到诊断日志。
8. **[低] cc-switch 侧加 app_type 影响面**:cc-switch `AppType` enum 变更会让其编译期强制处理(provider.rs 注释已注明),属于上游改造;snorkeling 侧要用 app_type 字符串读取,不引入对 cc-switch enum 的编译依赖,做好未知 app_type 忽略。

## 4. 兼容性结论(对照任务 AC)

- 保留 `waveai@quick/balanced/deep`:key 命名空间 `ccswitch@*` 与其天然不冲突,现有前端 mode picker / `waveai:modeconfig` 广播链路不变。
- 空配置只建 `custom@default`:导入功能只在用户主动触发时运行,不参与空配置 seed 流程。
- English-only UI:无新增 i18n;导入提示/分类文案("My Models" vs "Built-in Wave AI")沿用现有英文文案。
- 现有 `waveai.json` 格式与 `waveai:defaultmode` setting 不改变,仅新增条目。

## 5. 开放问题(需产品/实现拍板)

1. cc-switch 是否新增 `AppType::WaveAI`(上游改造),还是先只支持从现有 openai-compatible provider(OpenCode/OpenClaw/custom)导入?
2. 导入入口放哪:waveconfig 可视化页加 import 按钮(waveaivisual.tsx),还是 term 侧 provider 切换面板?
3. 导入后是否默认替换当前 default mode(建议:不替换,只提示用户手动选)。
4. waveai 专用 provider preset 目录是否需要在 cc-switch 侧补一份(供 `fetch models` 预填官方模型名)。