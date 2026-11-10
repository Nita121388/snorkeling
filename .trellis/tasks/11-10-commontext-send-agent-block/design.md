# 技术设计

## 模块边界

```
frontend/app/commontext/
  commontext-send-target.ts        # 纯逻辑：agent block 判定 / 目标解析 / Folder 候选收集（可单测，无 React）
  commontext-send-target.test.ts
  pending-input.ts                  # pending input 队列：register / take / peek / TTL（无 React）
  pending-input.test.ts
  commontext-send-button.tsx        # UI：Send split button + 目标 popover（编辑器 footer 与详情 footer 共用）
frontend/app/view/term/term.tsx     # 消费端：TermWrap 挂载后注入 pending input（仅小段 hook）
frontend/app/commontext/commontext-compose-modal.tsx  # 接线：替换三处 Send
```

## 数据契约

### 1. Agent block 判定（R2）

```ts
export type AgentBlockInfo = {
    blockId: string;
    provider: string;          // meta["agent:provider"]
    model: string | null;      // meta["agent:requestedmodel"] ?? null
    cwd: string | null;         // meta["cmd:cwd"]
    connection: string | null;  // meta["connection"]
};

export function extractAgentBlockInfo(block: Block | null | undefined): AgentBlockInfo | null
// block.view === "term" && meta["agent:provider"] 非空 → info，否则 null
```

### 2. 目标解析（R5）

```ts
export type SendTargetSelection = {
    agentProfile: string;        // profile name
    tab: { kind: "current" } | { kind: "existing"; tabId: string } | { kind: "new" };
    folder: string;             // cwd（绝对路径或 ~ 开头）
};

export type ResolvedSendTarget =
    | { kind: "existing"; label: string; block: AgentBlockInfo }
    | { kind: "create"; label: string; tab: SendTargetSelection["tab"]; cwd: string };

export function resolveSendTarget(sel: SendTargetSelection, focused: AgentBlockInfo | null): ResolvedSendTarget
// existing 当且仅当 focused != null
//   && focused.provider 等价于 sel.agentProfile（profile→cmd basename 对齐 provider）
//   && sel.tab.kind === "current"
//   && cwdEqual(sel.folder, focused.cwd)
```

provider↔profile 对齐：`resolveAgentProvider`（agent-launch.ts）以 cmd basename 为准；解析时用同一函数从 settings/profile cmd 推 provider，避免第二份映射。

### 3. pending input 队列（R7）

```ts
type PendingInputEntry = { text: string; registeredAt: number; quietMs: number; ttlMs: number };
export function registerPendingInput(blockId: string, text: string, opts?): void   // 覆盖旧值
export function takePendingInput(blockId: string): string | null                    // 取走即删
export function peekPendingInput(blockId: string): string | null
export function pendingInputCount(): number
```

- 发送前 `stripSessionTagHashes`（与 copy/send 现语义一致）。
- 注入失败（TTL 到、term 不可用）由消费端回退：`navigator.clipboard.writeText` + 弹窗 status 提示（通过回调 `onPendingInputFallback`）。

### 4. term 消费 hook（R7，term.tsx）

TermWrap 挂载后（`model.termRef.current = termWrap` 处）：

```
entry = peekPendingInput(blockId)
if (entry == null) return
轮询（300ms 间隔）：
  - 记录 termWrap.lastUpdated（termwrap 已有字段，doTerminalWrite 更新）
  - 首次观察到输出（lastUpdated > 基线）后，等待 quietMs(600) 无新输出
  - 到点 → takePendingInput → terminal.paste(text) → 结束
  - 超过 ttlMs(60s) → takePendingInput → 剪贴板回退 + console.warn + status 提示
```

轮询用 `setTimeout` 链，组件卸载（block 关闭）即清理；termwrap 未挂载/未 loaded 时继续等待（块可能仍在布局中）。

## UI 组件（commontext-send-button.tsx）

`CommontextSendButton` props：

```ts
type Props = {
    text: string;                       // 待发送文本
    onSent: () => void;                 // 成功后回调（关弹窗 / 记 usage）
    config: SendConfig;                 // 弹窗级共享的三项选择 + setter
    focusedAgent: AgentBlockInfo | null;
    settings: SettingsType;
};
```

弹窗级 `SendConfig`（三处 Send 共享）存于 ComposeState 之外的新 atom 或 useState 提升（选 **module-level jotai atom** `commontextSendConfigAtom`，会话内持久、关闭弹窗保留）：

```ts
type CommontextSendConfig = { profile: string | null; tabKind: "current"|"existing"|"new"; tabId: string | null; folder: string | null };
// null = 「跟随聚焦块」默认
```

Popover 结构（对齐原型）：

1. 聚焦 Agent Block 行：`AgentMiniCard`（avatar 首字母色块 + title = provider·model + cwd + `AgentStatusChip`）。无聚焦 agent → 禁用行 + 警示文案。
2. 选择 Agents：chips（`getAgentProfileOptions`），default 星标；点击聚焦行会把三项重置为「跟随聚焦块」。
3. 选择 Type：picker 按钮（当前值 + 徽标 当前/已存在/新建）+ 下拉（tab 列表 = workspace.tabids 过滤 session overview tab，`tab.name` 显示）+ 右侧 `+`（→ kind:"new"）。
4. 选择 Folder：picker 按钮 + 下拉（候选：聚焦块 cwd / 本 Tab agent·term 块 cwd 去重 / workspace cwd / home）+ 右侧 `⋯` 浏览（`getApi().pickDirectory()`，无能力则不渲染）。
5. 底部确认行：摘要文本 + 取消 + 「发送」（primary）。

Send 主键 = 按当前 config 解析后立即执行（快捷路径），hint 文案同摘要。

## 执行路径（R6）

```
发送(existing) → sendTextToFocusedTerm(text, [focusedAgent.blockId])   // 复用现有
发送(create)   → blockDef = createAgentBlockDefForProfile(profile, settings, {connection: null, cwd: folder})
              → blockDef = await resolveAgentBlockCommandForLaunch(blockDef, FindCommandForConnection)
              → tab: current → createBlock(def)
                 existing → ObjectService.CreateBlockInTab(tabId, def, DefaultRuntimeOpts, true, false) + setActiveTab
                 new      → ObjectService.CreateBlockInNewTab(workspace.oid, tabName, def, opts, false) + setActiveTab
              → registerPendingInput(blockId, text)
```

`DefaultRuntimeOpts = { termsize: { rows: 25, cols: 80 } }`（与 widgets/global 现值一致）。

## 边界与回退

| 场景 | 行为 |
|---|---|
| editor 文本为空 | Send 报「Nothing to send」status（现有语义） |
| settings 未探测到任何 agent profile | Agents 区为空 + 警示；Send 禁用（existing 且聚焦块为 agent 时仍可用） |
| FindCommandForConnection 失败 | status 显示错误，弹窗不关 |
| 新建 Tab 激活后弹窗关闭 | `onSent` 关闭弹窗；注入由 pending input 异步完成 |
| 同 blockId 重复发送 | register 覆盖旧文本（最后一条生效），摘要提示 |
| 远程块聚焦 | existing 判定含 connection 时 Folder/cwd 用聚焦块值；new 块 connection=null（v1 本地） |

## 测试设计

- `commontext-send-target.test.ts`：extractAgentBlockInfo（term+agent meta / term 无 meta / 非 term）；resolveSendTarget 矩阵（focused null / provider 不等 / tab 非 current / folder 不等 → create；全等 → existing）；cwd 归一化（~ 展开、尾斜杠）。
- `pending-input.test.ts`：register/take 幂等、覆盖、TTL 过期判定函数、count。
- term hook 逻辑抽纯函数 `computeInjectDecision({lastUpdated, baseline, quietMs, ttlMs, now})` 便于单测，term.tsx 只做 IO。
