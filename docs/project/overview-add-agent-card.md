# Overview 看板：Tab 下新建 Agent（F-1120-overview-add-agent-card）

> 事实层文档：记录**已实现**的能力。设计资产见
> `design/prototypes/overview-dashboard/overview-add-agent-card/`（● 已落地）。

## 用户可见行为

Overview 面板两个视图都能在 Tab 组里直接新建 agent 会话：

| 视图 | 入口 | 位置 |
|---|---|---|
| 看板（按 Tab 分组） | 虚线卡「＋ 新建」 | 每个 Tab 列的卡片列表末尾 |
| 列表 | 「＋ 在此 Tab 新建 agent」行 | 每个 Tab 组的块列表末尾 |

点开后是**居中弹窗**（样式与 New Agent 弹窗同款：chip 行 + 32px 内左 accent 条、h-28 模型输入框、border-t footer）：

1. **选择 agent 类型** —— 只列**探测到**的 profile（`FindCommand` 真探测），默认预选第一个；
2. **模型** —— 输入框不带占位文案（留空 = 不传 `--model`，用 profile/CLI 默认；填写即本次启动覆盖，不回写 profile）；
3. **选择一个路径。** —— 该 Tab 的路径候选**可滚动列表**，默认选中「随 Tab」项，远端候选第二行显示 connection；
4. **取消 / 创建** —— 创建后**不切 Tab、不抢焦点**，新卡以入列动画出现在该 Tab 列。

分组守卫：只有 `tab` 分组有入口；`status` / `provider` / `project` / `tags` 是派生列，不提供（避免假交互）。

## 实现落点

| 文件 | 职责 |
|---|---|
| `frontend/app/session-overview/overview-add-agent.ts` | 纯逻辑：`shouldShowAddAgent`（分组守卫）、`parseBoardTabColumnKey`（`tab:<id>` → tabId）、`collectAddAgentPathRows`（去重 + 默认置顶 + 远端第二行）、`buildAddAgentLaunchContext`（`inheritWorkspaceContext:false`） |
| `frontend/app/session-overview/overview-add-agent-modal.tsx` | 弹窗：全局 `<Modal>` 容器 + New Agent chrome；只产出 `AddAgentSubmitRequest`，不直接建块 |
| `frontend/app/session-overview/overview-board.tsx` | 看板入口 `AddAgentButton`（`onAddAgent` prop 才渲染；tabId 从列 key 解析） |
| `frontend/app/session-overview/session-overview.tsx` | 接线：弹窗开关、按 Tab 现算 `targets`（`collectAgentLaunchTargetsInTab`）与 `defaultPath`（`resolveWorkspaceAgentContextMeta`，**不取焦点块**）、提交建块 |
| `frontend/app/session-overview/session-overview.scss` | `.session-overview-board-add` / `.session-overview-tab-add` / `.session-overview-add-agent-*` 样式（只用 token 色） |

建块链路：`createAgentBlockDefForProfile(profile, settings, context)` →
`ObjectService.CreateBlockInTab(tabId, blockDef, rtOpts, false, false)`（`activateTargetTab=false`）。

上下文关键点：`context.inheritWorkspaceContext = false`。不置 false 时 `agent-launch.ts` 会用**当前聚焦
工作区 context** 兜底，用户在弹窗里选的目录会被静默换掉（该坑在 `agent-launch.ts` 内有注释）。

## 测试与判据

| 文件 | 覆盖 |
|---|---|
| `overview-add-agent.test.ts` | 分组守卫、列 key 解析、路径行（去重/默认置顶/远端第二行）、context 组装（不继承焦点块） |
| `overview-add-agent-modal.dom.test.tsx` | 弹窗结构（Modal 壳 / 两段 / 头部 Tab 名）、chip 预选与切换、路径行选中、提交请求体（cwd/connection/modelOverride） |
| `overview-board-add.test.tsx` | 看板入口数量/位置、派生分组不渲染、点击回传 tabId+Tab 名、不传回调不渲染 |

```bash
npx vitest run frontend/app/session-overview/overview-add-agent.test.ts \
  frontend/app/session-overview/overview-add-agent-modal.dom.test.tsx \
  frontend/app/session-overview/overview-board-add.test.tsx   # 28 passed
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "overview-add-agent"   # 0
npx eslint frontend/app/session-overview/overview-add-agent.ts \
  frontend/app/session-overview/overview-add-agent-modal.tsx \
  frontend/app/session-overview/overview-board.tsx \
  frontend/app/session-overview/session-overview.tsx        # 0 problems
```

## 已知边界

- 看板 tab 分组**空 Tab 不渲染列**（既有行为），所以空 Tab 在**看板**里没有入口；列表视图仍有。
- 弹窗不提供 New Agent 弹窗的「启动方式（TUI/GUI）」「环境变量」「cc-switch 供应商」三块。
- 仓库 tsc 基线非零（其他在途包），本包只对自己新增/改动文件取 0 错误基线。
- `session-overview/` 目录内 3 个老夹具（`overview-board-memo/jump/empty-label`）因 `propRows` 字段未补仍红，属
  `11-17-overview-card-props` 在途包，不在本包修。
