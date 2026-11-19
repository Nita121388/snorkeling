# Design — 模型展示新鲜度与供应商拆分

## 1. 边界与最小行为差

现在：卡片模型 = `block.meta["agent:requestedmodel"]`（启动串）或被 `LiveSessionState` 磁盘兜底改写的「最后一条 assistant 消息 model」；provider 位 = cc-switch vendor 或 `agent:provider`。
目标：卡片模型 = 会话当前模型；`provider/model` 拆成两段，完整串只进 tooltip / 复制。

行为真正所在的位置：
- 当前模型来源：`pkg/aisessions/provider_*.go` 的会话文件 + `pkg/service/aisessionsservice/chatcontrol.go` 的磁盘兜底。
- 模型身份拆分：`frontend/app/view/term/agent-identity.ts`（已有身份解析归口）。
- 刷新时机：`frontend/app/agent-status/agent-runtime-metadata-store.ts` + 三个显示面。

明确不改：`agent:requestedmodel` 写入者、`titleSource`、后台标题生成、模型目录、GUI chat 切换 UI。

## 2. 数据流（跨层契约）

```
pi/codex JSONL ──(有界尾部解析，先走)──> aisessions.ModelState{Provider,Model}
        │                      └─ 命中即返回，绝不调用 manager.Load
        └─ 未命中才 manager.Load(消息) ──> 最后一条带 Model 的消息（原兜底）
                                               │
                         LiveSessionStateResponse{modelProvider, modelId, modelName}
                                               │
                       agent-runtime-metadata-store（TTL 5s + in-flight 去重，无 timer）
                                               │
                       resolveAgentModelIdentity(raw, provider) → {provider, model, raw}
                                               │
            AgentHoverCard / AgentCardModal（异步富化）
            TabMoreAgentCard mini（只拆串，不发 RPC）
```

边界约定：
- Go 侧只返回**原始模型串**与**会话级 provider**，不做 `provider/model` 拆分（避免前后端两套 split 规则）。
- 前端唯一拆分入口是 `resolveAgentModelIdentity()`；渲染代码不得自行 `split("/")`。
- `LiveSessionState` 不启动 agent、不改变 `Live` 语义；失败仍返回 `Live=false` 且保留前端旧值。

## 3. Go 侧设计

### 3.1 新增可选接口（`pkg/aisessions/types.go`）

```go
type ModelState struct {
    Provider string
    Model    string
}

type ModelStateProvider interface {
    CurrentModelState(ctx context.Context, filePath string) (ModelState, bool)
}
```

`Provider` 主接口不变；`Manager` 新增 `CurrentModelState(ctx, key)`：先 `Summary` 拿 `Source/FilePath`，按 `p.Source()` 找实现了可选接口的 provider，找不到返回 `ok=false`。

### 3.2 pi 实现（`provider_pi.go`）

- 从文件尾部有界读取：`maxModelStateScanBytes = 1 MiB`，最多 2000 行，250ms ctx timeout（只约束尾部读，不含 `Summary`）。**必须用 `bufio.Reader.ReadBytes('\n')` 逐行读，不能用 token 上限 =1 MiB 的 `bufio.Scanner`**：后者遇到 pi 常见的大于 1 MiB base64 图片行会 `ErrTooLong` 直接停扫，导致 `ok=false` 并退回整场 Load（正是要避免的回退）。窗口起点若落在行中间，丢弃第一段残行，只解析完整行。
- 在窗口内解析每条 entry 的 `id` / `parentId`，从文件最后一条 entry 逆 `parentId` 回溯出活跃 leaf 链；只接受链上的 `model_change.provider/modelId` 与 assistant `message.provider/model`。`forks/` 是独立文件没问题，但**同一 JSONL 里也有废弃分支**（`provider_pi_test.go:185-209`），盲取「文件最后一条 model_change」会取错。回溯限定在窗口内，超窗按 `ok=false`。
- `ok = (Model != "")`；只有 provider 没有 modelId 的 `model_change` 可以贡献 Provider，但不得短路兜底。
- 单测：`TestPiCurrentModelState` 覆盖「model_change 后无 assistant 回复」「只有 assistant model」「同文件废弃分支反例」；`TestCurrentModelStateSkipsOversizedLine` 覆盖 >1 MiB 行之后仍有 `model_change`。

### 3.3 codex 实现（`provider_codex.go`）

- 同样有界尾部读取：模型取活跃链最后 `turn_context.payload.model`；provider 取 `session_meta.payload.model_provider`（**本机真实数据确认该字段在 session_meta 而非 turn_context**：`~/.codex/sessions/2026/11/03/rollout-...jsonl` 第 1 行 `model_provider="custom"`，而 `turn_context.payload` 没有该键）。缺失 provider 时留空并回落到最后 `message.model`。
- 单测：`TestCodexCurrentModelState` 覆盖两次 turn_context 取最后一次 + session_meta provider。

### 3.4 service 兜底（`chatcontrol.go`）

`LiveSessionState` 磁盘路径顺序：GUI live state（不变）→ `manager.CurrentModelState`（有界尾部读，**命中即返回，不再 `manager.Load`**）→ 仅在未命中时 `manager.Load` 取最后消息（原行为）→ 空。冷路径上这比当前「每次 hover 都可能整场 Load」更轻；但热路径 `manager.Load` 走 SQLite 缓存且当前并不带 `Message.Model`（`sqlite_index.go:1339-1348`），所以准确说法是「冷路径减负、热路径多一次 ≤1 MiB 尾部读且第一次真正拿到模型」，不宣称无条件净收益。250ms 只约束尾部读，不含 `Summary` 本身的耗时。
`ModelProvider` 只在拿到会话级 provider 时覆盖；拿不到时留空，不再写 `summary.Source`。
新增 `TestLiveSessionStateCurrentModel`：注入 pi fixture，断言 provider 不是 `"pi"`、model 来自最新 `model_change`；新增 `TestCurrentModelStateDoesNotLoadMessages`：计数 provider 断言 `LoadMessages` 调用数 = 0。

## 4. 前端设计

### 4.1 共享拆分纯函数（`agent-identity.ts`）

```ts
resolveAgentModelIdentity(rawModel, sessionProvider?): { provider: string; model: string; raw: string }
```

规则：
1. `raw.trim()`；含 `/` → 第一段为 provider，余段为 model（只拆第一个斜杠，兼容 `mydeepseek/deepseek-v4.1-flash` 与 `provider/model/sub`）。
2. 无 `/` → model = raw；provider 取 `sessionProvider`，但值属于 agent 类型集合（`pi|codex|opencode|claude|gemini`）或 `Agent` 时视为无效。
3. 空输入返回三段空串；不抛错。
4. `raw` 永远原样保留，供 tooltip / 复制使用。

raw 的规范来源是 `modelId || modelName`（store 侧由现在的 `modelName || modelId` 改为前者），因为 disk fallback 两者相同但 live 路径的 ID 才是可拆的规范串；tooltip 只展示 canonical raw。
测试 `agent-identity.test.ts` 6 例（带斜杠、多斜杠、无斜杠 + 有效 provider、provider=pi 负例、空串、纯空白）。

### 4.2 runtime store TTL（`agent-runtime-metadata-store.ts`）

- `ensureAgentRuntimeMetadata(blockId, sessionId, source, maxAgeMs = 5000)`；缓存与 `pending` 的键改为 `blockId|sessionId|source`。键变化（同一 block 换会话或换 provider）立即失效，防止旧会话模型串味。
- entry 增加 `rawModel` / `provider` / `model`、`sessionKey`、`lastAttemptAt`。**只有成功解析出 model 才更新 `loadedAt`**；失败/无结果只更新 `lastAttemptAt`，因此 5s 后再次打开仍会重试（修掉「先 hover 无 live → 后面切换模型仍被 TTL 挡住」的假缓存）。
- 刷新期间保留上一帧的值；不新增轮询定时器、不清空旧值、不改变首帧同步路径。长开的 modal 不在 TTL 到期时自动刷新，刷新发生在下次打开/挂载。

### 4.3 三个显示面

- 显示优先级统一为 `displayProvider = vendorName || identity.provider || sessionProvider || providerLabel`。示例：`mydeepseek/deepseek-v4.1-flash` → 名称位 `mydeepseek`；裸模型 `deepseek-v4.1-flash` + `modelProvider=magpie` → 名称位 `magpie`。这样 R3 的真实 provider 在无斜杠场景有实际显示效果。
- 抽共享纯函数 `formatAgentModel(identity, displayProvider)`：前缀与 displayProvider 相同（忽略大小写）时只返回 `model`，否则返回 `provider · model`；悬浮卡与迷你行都调它，避免一处去重一处不去重。
- `AgentHoverCard`：挂载时按 TTL 富化，副标题用 `formatAgentModel`，tooltip 含 canonical raw 串。
- `AgentCardModal`：复用 `AgentHoverCard`，不重复实现。
- `TabMoreAgentCard` 的 `AgentMiniRow`：**不调用 `ensure`**，只对 block meta 启动串做同一套拆串/格式化；零 RPC，代价是不独立刷新。

## 5. 性能红线（用户硬约束）

1. 首帧只读同步 block meta；新增逻辑全部在异步路径或纯函数里，render 中不读文件/不发 RPC。
2. 后端：尾部读 ≤1 MiB、≤2000 行、250ms context deadline（不含 `Summary`）；`ReadBytes` 逐行 + 丢残行 + 跳超长行；命中后不再整场 `LoadMessages`。
3. 前端：复合键 in-flight 去重 + 5s 成功 TTL，**不新增任何 setInterval / 后台轮询**；同一复合键 5s 内最多 1 次 RPC，失败不遮住后续刷新。
4. Tab 迷你行零 RPC；只有真正打开悬浮卡/弹窗才富化。
5. 判据（机器可判）：`load_calls=0/0 PASS`、`bytes<=1048576 PASS`、`lines<=2000 PASS`、`rpc_calls=1/1 PASS`、`perf_p95_ratio<=1.20 PASS`（相对 G2 基线，基线落 `verify-runs/`）。

## 6. 兼容与风险

- 老数据没有 provider 字段 → 退回既有 vendor/provider label，`model` 为原串，行为与今天一致。
- GUI live chat 的 `st.Model.ID` 可能是裸 id；拆不出 provider 时不误标，显示不变。
- `summary.Source` 不再写进 `modelProvider`：任何依赖该字段的消费者（当前仅本 store）都按「可能为空」处理。
- 尾部有界解析在超大 base64 图片行上必须跳过且不能停扫（`ReadBytes` 而非小 token Scanner），避免重现 OOM 或因回退整场 Load 造成卡顿。
- 同文件分支必须按 leaf 链判定；无法在窗口内完成回溯就 `ok=false` 回落旧路径，绝不猜一个错模型。
- 拆分值只用于展示，不写 meta/DB，回滚不会留下脏数据。

## 7. 回滚

单 commit 回滚（`git revert`）；新增接口是可选的，旧 provider 实现自动走 `ok=false` 兜底；前端 helper 无迁移。无配置/数据迁移。
