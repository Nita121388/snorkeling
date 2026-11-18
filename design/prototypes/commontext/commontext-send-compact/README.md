# CommonText 发送目标弹窗 · 紧凑化

> 同步状态：◐ 部分落地（2026-11-18：A 档常显形态 + 目录候选随 Tab 已实现于 `frontend/app/commontext/commontext-send-button.tsx`；B 折叠档未实现）
> 镜像源：frontend/app/commontext/commontext-send-button.tsx, frontend/app/commontext/commontext-send-target.ts, frontend/app/workspace/agent-launch.ts, frontend/app/element/splitbutton.scss
> 最后同步：2026-11-18（v2：三个选择器常显 + 目录候选随所选 Tab）

## 一句话

把 `SendTargetPanel` 的 6 段平铺（真机 380×**379px**）压成「目标卡 + Agent / Tab / 目录三行 + footer」，
**三个选择器全部常显不折叠**，减掉的只是重复表达与段头 hint；并新增 **目录候选随所选 Tab 变化**
（复用 `collectAgentLaunchTargetsInTab`）。真机实测高度 ≈ 298–330px。

## v2 修正（2026-11-18 用户反馈）

v1 为了压到 130px，在「聚焦块」模式把 Agent / Tab / 目录三段整体藏了、新建模式又塞进折叠区。
用户反馈：**"这些你都给都没有了？"** —— 功能还在代码里，但界面上等于消失。v2 全部改回常显：

- 三段永远可见；聚焦块模式下它们就是「跟随聚焦块」的当前值，点任意一项即自动切到「新建」。
- 折叠只作为**用户主动**动作（B 档），默认 A 档全平铺；即便收起，折叠行右侧仍显示 `Codex · T6 · ~/…`。
- 新增目录候选随 Tab：选 Tab 即换该 Tab 打开块的 cwd 候选，默认项自动高亮并标「自动/随 Tab」。

## 问题（真机实测，非估算）

| 段 | 实测高度 | 问题 |
|---|---|---|
| 选择目标（chip + 摘要） | 77px | 落点信息第一次出现 |
| 选择 Agent（段头 + 32px logo 行） | 69px | 段头带 10px mono hint |
| 选择 Type（段头 + picker + `+`） | 67px | hint「默认 = 当前 Tab」与行内徽标「当前」重复 |
| 选择 Folder（段头 + picker + `⋯`） | 67px | 候选与所选 Tab 无关（见下） |
| 后台执行（开关 + 右侧说明） | 29px | 第三个文本元素 |
| 确认行（摘要 + 取消 + 发送） | 51px | 落点信息**第三次**出现 |

三个根因：

1. **同一决策出现 3 次**：chip → 段 1 摘要 → 确认行摘要。
2. **每段头部 3 个元素**：图标 + 标签 + 右侧 mono hint（9–11px），且 hint 与行内徽标语义重复。
3. **目录候选不随 Tab 走**：`collectTabAgentBlocks()` 遍历 `blockComponentModelMap`（只含当前挂载块），
   选了别的 Tab 后候选仍来自当前 Tab，与「新建到那个 Tab」的语义不一致。

## 目录候选随 Tab（本次新增需求）

真实代码已有可复用的按 Tab 收集能力：

```
agent-launch.ts
  collectAgentLaunchTargetsInTab(tab, getBlockById, focusedBlockId, { localHomeDir })
    → AgentLaunchTarget[]（terminal 块 / files 块 / agent 块，按 Tab 内 blockids 遍历）
```

现状 `commontext-send-target.ts#collectFolderCandidates` 的入参是 `blocks: {blockId, info}[]` + `workspaceCwd` + `homeDir`，
**接口本身不需要改**，只换数据源与作用域：

| 项 | 现在 | 改成 |
|---|---|---|
| 数据源 | `collectTabAgentBlocks()`（`blockComponentModelMap`，等价当前 Tab） | `collectAgentLaunchTargetsInTab(targetTab, ...)` |
| 作用域 | 恒定当前 Tab | `config.tab`：current → 当前 Tab；existing → 该 tabId；new → 工作区 cwd |
| 默认值 | `defaultSendFolder(focusedAgent, workspaceCwd)` | 所选 Tab 的第一个候选（推荐项）→ 工作区 → home |
| 切 Tab 后 | 已选 folder 不变（可能指向别的 Tab 的目录） | `folder` 重置为 `null`（= 跟随所选 Tab 的推荐项） |
| 下拉内容 | 聚焦块 / 项目 / 工作区 / home | 首项「跟随该 Tab（自动）」+ 该 Tab 打开块的 cwd（带来源说明） |

`CommontextSendConfig.folder` 语义从「null = 跟随聚焦块」扩为「null = 跟随所选 Tab（current 时等价跟随聚焦块）」，
`resolveSendTarget` 的 existing 判定（tab=current 且 folder 未显式选）不受影响。

## 方案分档

### A 全平铺（原型默认）

1. 目标只表达一次：chip → 摘要 → 确认行 三处合并成一张目标卡（logo + 落点 + Tab·路径 + 状态）。
2. 段头右侧 mono hint 全部移入 `title` tooltip；行内 pill 徽标改为行尾 10px 文本说明。
3. 分割线 5 条 → 2 条（目标区 / 选项区 / footer）；后台开关行去掉右侧说明。
4. 主按钮文案即目标（`发送到聚焦 Codex` / `新建 Codex 并发送`），确认行摘要删除。
5. Agent / Tab / 目录三行常显，行首 32px 标签，行尾操作按钮保留（`+` 新建 Tab / `⋯` 浏览目录）。
6. 目录行下方一行 9.5px 说明：`目录候选来自 <Tab> 打开的块（切 Tab 即换候选）`。

### B 可折叠（可选，用户主动）

7. 三段收进「选项」折叠行，右侧常显摘要 `Codex · T6 · ~/Primary/projects/snorkeling`；
   默认展开，收起状态可记住（建议与 `background` 同层放进 `CommontextSendConfig`）。

## 高度对照（原型实时测量）

| 状态 | 现状 | A 全平铺 | B 展开 | B 收起 |
|---|---|---|---|---|
| 聚焦 Agent Block | 377–380px | ≈298px | ≈300px | ≈210px |
| 新建 / 选其他 Tab | 360–377px | ≈330px | ≈328px | ≈240px |

## 交互

- 顶栏：状态（聚焦 / 新建 / 无 Agent Block）、档位（A 全平铺 / B 可折叠）、变更标注、深浅主题。
- 切 Tab：Tab 下拉切换后，目录候选整体换成该 Tab 的 cwd，`已选` 状态重置为「自动」。
- 点任意 Agent / Tab / 目录：若当前是「聚焦块」会自动切到「新建」（与真实 `preview.kind` 一致）。
- URL 参数：`#mode=focused|create|none&scheme=a|b&expand=0|1&theme=dark|light&marks=0&tab=T6|files|vcs|new&dir=<path>`

## 落地注记

- 只动 `SendTargetPanel` 的 JSX / i18n / Folder 数据源，`resolveSendTarget` / `previewSendTarget` 判定不动；
  `preview.kind` 仍是 chip 选中态与主按钮文案的唯一来源。
- 新增纯函数建议：`resolveFolderScope(config, tabCandidates)` → 目标 Tab + 候选列表 + 默认项，
  放 `commontext-send-target.ts` 里与 `collectFolderCandidates` 同层，便于单测覆盖（current / existing / new × 有无 agent 块）。
- i18n 需新增：`send.sendTo`、`send.createAndSend`、`send.customize`、`send.dirFollowTab`（跟随该 Tab）、
  `send.dirScopeHint`（目录候选来自 {{tab}} 打开的块）；可下线 `send.summaryExisting` / `send.summaryCreate` / `send.targetEquals`。
- 验证：`scripts/verify/commontext-send-agent-block` 需补两类断言：
  ① 聚焦块模式下 Agent / Tab / 目录三行都在（防再次被藏）；
  ② 切 Tab 后目录下拉候选变化 + 已选目录重置。
- 相关任务：`11-17-conn-typeahead-row-rail`（同类「按 Tab / 连接推荐候选」交互），可复用其候选排序与去重口径。

## 预览

```bash
open design/prototypes/commontext/commontext-send-compact/index.html
```
