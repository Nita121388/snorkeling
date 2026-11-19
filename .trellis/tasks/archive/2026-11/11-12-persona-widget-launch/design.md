# A3 设计 — widget 🎭 + 登场管线 + props.persona 补带

## 1. 边界

| 层 | 文件 | 职责 |
|---|---|---|
| 数据 | `pkg/persona/*`（已存在，只读复用） | `ResolveRoot` / `List` / `Get` 提供据点与身份卡 |
| 服务 | `pkg/service/aisessionsservice/aisessionsservice.go` | 新增 `GetPersonaRoster` RPC；`List` 里派生 `props.persona` |
| 前端纯逻辑 | `frontend/app/workspace/persona-launch.ts`（新） | meta key 常量、据点路径拼装、登场 blockDef 构造、注入文案 |
| 前端 UI | `frontend/app/workspace/persona-launch-window.tsx`（新） | 登场浮窗（三段式） |
| 前端接线 | `frontend/app/workspace/widgets.tsx` | 🎭 widget 的 hover/click → 浮窗；创建 block |
| 配置 | `pkg/wconfig/defaultconfig/widgets.json` | 新增 `defwidget@persona` |
| 类型 | `frontend/types/gotypes.d.ts` | 生成物，随 `npm run generate` 更新 |

## 2. 契约

### 2.1 block meta

| key | 值 | 读方 |
|---|---|---|
| `persona` | `<id>`（字符串） | A4 名册 / 悬浮卡 / 后续聚合 |
| `persona:injectworkdir` | `<绝对路径>`，仅当勾选注入时写 | 诊断 / 后续 provider 适配 |
| `cmd:cwd` | `<personaroot>/<id>` | 终端启动目录（A1 起的既有键） |

> 命名取设计 §5.5 的 `persona:<id>` 语义：key = `persona`，value = id。与 `agent:emoji` 等
> `agent:` 前缀键不冲突（persona 不是 agent 的从属属性，而是 block 的归属身份）。

### 2.2 RPC `aisessions.PersonaRoster`（PRD 签署时写作 `GetPersonaRoster`，同义）

```
request : {}                        // 复用 AISessionsListRequest 风格：无必填
response: { root: string, personas: PersonaSummary[] }
```

- 复用既有 `loadPersonaRoster()`（5s TTL 缓存、失败降级为空）。
- `PersonaSummary` 增加 `provider` / `model`（弹窗需要默认值）；空值时前端回退全局默认 profile。
- root 为空（本机无人设）→ `personas: []`，浮窗显示「本机还没有人设」+ 提示跑 `wsh persona create`。

### 2.3 派生 `props.persona`（纯函数，便于测）

```go
// derivePersonaProps 就地给没有 props.persona 的行补带派生值。
// 命中条件：projectPath 在 <root>/<id> 下（段边界、分隔符 / \ 都认、大小写不敏感）。
// 已存在的 props.persona（用户/AI 显式写）永不覆盖 —— A1.5 spec 的「props 优先」。
func derivePersonaProps(rows []aisessions.SessionSummary, root string, personas []PersonaSummary)
```

- 只在 `List` 且 `IncludeProjectPaths`（即已加载名册）时执行；`root==""` 直接返回。
- 派生 cell：`PropertyCell{Value: id, Type: "text", Source: "persona-derived"}`，前端可按 source 区分展示（不参与写回）。
- 不写 SQLite：派生是视图层补带，避免与 `SetProps` 的写路径竞争。

## 3. 登场 blockDef 构造（前端纯函数）

```ts
buildPersonaLaunchBlockDef(settings, persona, {
  profileName?,        // 默认 persona.provider（命中已知 profile 时）否则全局默认
  model?,              // 默认 persona.model
  root, id,            // 据点 = root/id
  injectMainWorkdir?,  // 是否注入本次主工作目录
  mainWorkdir?,        // 被注入的路径
}): BlockDef
```

- 复用 `createAgentBlockDefForProfile(profileName, settings, { connection: null, cwd: homeBase, inheritWorkspaceContext: false })`，
  再补：
  - `meta.persona = id`
  - 若 `injectMainWorkdir && mainWorkdir`：`meta["persona:injectworkdir"] = mainWorkdir`，
    且对 allowlist provider（`pi` / `codex` / `claude` / `gemini`）在 `cmd:args` 末尾追加注入文案。
- 注入文案：`[登场上下文] 本次主工作目录: <path>。你是 🎭<name>（<id>），家仍在 <homeBase>；需要读记忆先看 .persona/。`
- 非 allowlist provider：不追加（避免参数被 CLI 误解），但 meta 仍写，UI 标注「该 provider 未支持自动注入」。

## 4. 浮窗（persona-launch-window.tsx）

结构（复用 `AgentTargetFloatingWindow` 的 floating-ui 骨架：`useFloating` + `offset(8) + flip + shift + size`，
`useOutsideHoverClose` 关闭）：

```
┌ 🎭 叫人设登场 ─────────────── ✕ ┐
│ Agent   [pi] [codex] [claude]…  │  provider 芯片行（默认=人设 provider）
│ Model   [____________________]  │  input，placeholder = 人设 model 或全局
│ ─────────────────────────────── │
│ 人设（N）                        │
│  🎭 backup-guard  备份归档  ●登场 │  行点击 = 选中（高亮）
│  🎭 writer        文档写作  ○空闲 │
│  ＋ 新建人设…（A2）               │  置灰，title 说明
│ ─────────────────────────────── │
│ ☐ 注入本次主工作目录 E:/code/... │
│                  [登场]          │
└─────────────────────────────────┘
```

- 数据：打开时调 `PersonaRoster`；v1 不显示「登场中/空闲」状态点（需会话→persona 活跃判定，留 A4 聚合），行内显示 emoji + 名 + 职责。
- 选中态：默认第一项；键盘 ↑↓ 切换、Enter 登场、Esc 关闭。
- 「登场」= `env.createBlock(blockDef, false)` + 关窗（复用 `createBlock`，落到当前 Tab）。

## 5. widget 接线

- `agent-launch.ts` 新增 `export const PersonaWidgetId = "defwidget@persona"`。
- `widgets.tsx`：`isTargetWidget` 判定加入 persona；`handleWidgetHover` 加 persona 定时器（`WidgetHoverOpenDelayMs`，
  即既有 `LaunchHoverOpenDelayMs` = 300ms 量级）；`handleWidgetHoverEnd` 清理；`handleWidgetSelect` 分支打开浮窗。
- 浮窗与 Agent/Files 浮窗互斥（打开一个关掉其它）。

## 6. 风险与回滚

| 风险 | 处置 |
|---|---|
| `defwidget@persona` 默认配置对老用户生效（widgets 默认合并） | 低风险：只是多一个图标；用户可在设置里 `display:hidden` |
| 注入位置参数被某 provider 当成子命令 | 只对 4 个已知 provider 注入；其余跳过 |
| 派生 props.persona 污染用户手写的属性 | 只补空值 + `source=persona-derived`，永不覆盖 |
| 浮窗与既有三个浮窗状态互相打断 | 打开前统一 `closeXxx(false)`（notifyBus=false） |

回滚：全部改动是新增文件 + 新增 RPC + 一处 List 后处理；`git revert` 单 commit，无迁移、无数据写。
