# CommonText Send → 选择 Agent / Block 直接建块

> 同步状态：● 已落地（2026-11-10，`frontend/app/commontext/commontext-send-button.tsx` + `pending-input.ts` + `term.tsx`）
> 镜像源：frontend/app/commontext/commontext-compose-modal.tsx, frontend/app/workspace/agent-launch.ts, frontend/app/modals/agentcardmodal.tsx, frontend/app/view/term/agent-hover-card.tsx
> 最后同步：2026-11-10

## 一句话

CommonText 的 Send 升级为「目标选择器」：目标是 **Agent Block 专属**（term 块 + `agent:*` meta），目标行内嵌 **agent 小卡信息**；新建路径拆成三个正交选项——**选择 Agents**、**选择 Type（Tab）**、**选择 Folder（项目目录 / cwd）**。Type 默认当前 Tab、其他 Tab 可选、`+` 新建 Tab；Folder 默认聚焦块目录，可选其他项目目录或浏览。新建块时文本作为 pending input 排队，TUI 就绪后自动注入，用户不用等 agent 加载。

## 用户规则（2026-11-10 对话，两次迭代后定稿）

1. **发送目标必须是当前聚焦的 block，且必须是 Agent Block**——普通终端不再作为 Send 目标。
2. **目标需要展示该 agent block 的 agent card 信息**——头像 / 标题 / provider·model / 状态 chip / 运行时长（字段对齐 AgentCardModal）。
3. **目标配置拆成三项正交选择**（v3 修正：v2 的两个区块重复已合并；v3 补 Folder）：
   - **选择 Agents**：profile 选择，默认跟随聚焦块（无聚焦 agent 时跟随 default profile）。
   - **选择 Type**：默认显示当前 Tab；下拉列其他 Tab 作为可选项；末尾 **`+` 图标** 表示新建 Tab。
   - **选择 Folder**：新建块的项目目录（cwd），默认聚焦块目录；下拉可选其他项目目录，末尾「浏览其他目录…」接入系统目录选择器。

## 解析规则（消除重复入口的核心）

单条判定，不出现第二个新建入口：

| 条件 | 结果 |
|---|---|
| Agents == 聚焦块 agent 且 Type == 当前 Tab 且 Folder == 聚焦块目录 | **直接注入聚焦块**（已存在，不新建） |
| 其他任意组合 | **按所选 Type + Folder 新建 agent block** + pending input |

popover 底部是**确认按钮**（选择 → 确认两段式，不做隐式自动解析）：按钮文案随三项选择实时变（如「发送到聚焦 Claude」「新建 Codex 并发送」），左侧摘要行同步显示目标；点确认才执行。Send 按钮旁 hint 同步。

## 原型交互

- 顶栏：场景切换（聚焦 Agent Block / 聚焦普通终端）、深浅色、重置。
- 左：Workspace mock（tab 栏 snorkeling / files / vcs + 两个块）。
- 右：CommonText 弹窗，Send 为 split button（主键按解析结果发送，caret 打开目标 popover）。
- popover 四段 + 确认行：
  1. 「聚焦的 Agent Block」：agent 小卡；聚焦普通终端时禁用 + 警示条。
  2. 「选择 Agents」：Claude Code / Codex ★default / Pi / OpenCode / Gemini。
  3. 「选择 Type」：当前 Tab 值 + 下拉（其他 Tab 带「已存在」标注）+ 右侧 `+` 新建 Tab。
  4. 「选择 Folder」：默认聚焦块目录（「聚焦」徽标）+ 下拉（其他项目目录）+ 右侧 `⋯` 浏览其他目录。
  5. 底部确认行：摘要 + 「取消」+ 主按钮（文案随三项选择实时变：existing→「发送到聚焦 X」；create→「新建 X 并发送」），点确认才执行。
- 发送演示：注入已有块 → TUI 输入区打字；新建块 → 工作区出现新块并演示「启动中 → 就绪 → 注入」三段，tab 栏同步高亮目标 Tab（`+` 新建 Tab 时新增 tab chip）。

## 实现注记（给落地参考）

- 复用 `agent-launch.ts`：`getAgentProfileOptions` / `createAgentBlockDefForProfile|ForTarget` / `prepareAgentBlockDef`，与 WidgetsBar 走同一条建块路径，不写第二条。
- Type 选择器数据源 = tab 列表；Folder 选择器数据源 = 项目目录候选（镜像 `collectAgentLaunchTargetsInTab` 的 cwd 来源：聚焦块 / Files 块 / 最近项目）+ 系统目录选择器。「新建 Tab」走现有新建 tab 路径。
- pending input 队列建议独立模块（如 `frontend/app/commontext/pending-input.ts`），term 就绪（首输出 + 静默窗口）后经 `insertTextIntoTerm` 同一 PTY 路径注入；TTL 兜底回退剪贴板。**不要依赖 `cmd:initialinput`**（全仓库零消费点，见 `docs/project/agent-session-plan.md` 评审）。
- `focusedTermBlockIdAtom` / `availableTermBlockIdsAtom` 需收窄为「agent block」判定（`viewModel.viewType === "term"` + `agent:provider` meta）。
- 解析规则抽成纯函数（如 `resolveCommonTextSendTarget({focusedAgent, agents, type, folder})`），便于单测覆盖组合（existing / create×Tab×Folder）。
