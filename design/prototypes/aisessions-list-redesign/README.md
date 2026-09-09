# AI Sessions 列表 — 按项目分组原型 (Paseo 风格)

> 同步状态：▲ 设计活跃（原型已落地，未实现）｜镜像源：frontend/app/view/aisessions/aisessions.tsx, session-row.tsx
> 最后同步：2026-08-26
> 参考：aisessions-chat-redesign（对话区 v2 设计语言）+ Paseo 列表（按项目分类）
> 原型文件：index.html（静态，浏览器直接打开）

## 为什么做这个原型
现状列表是**按时间平铺**；Paseo 列表是**按项目分类**。数据已就绪（每个
`SessionSummary` 都有 `projectPath`，后端还回了 `ProjectPathSummary[]` 项目树）。
本原型把"分组"从数据结构落实为**视觉方向**：可折叠的吸顶组头 + 组内缩进行，
同时保留现有 v2 扁平行样式与全部筛选能力。

## 设计原则（P1–P7）
| 原则 | 内容 |
|---|---|
| P1 一致性 | 只用现有主题 token（bg-panel/bg-hoverbg/border-border/bg-accent-10/text-secondary/--accent），扁平、靠间距/字重分层级，拒绝卡片盒子 |
| P2 项目即分组 | 键=`basename(projectPath)`，空路径归「未归类」；组可折叠；组内时间倒序；组序按"该项目最近活跃时间"降序 |
| P3 组头=项目身份 | folder 图标 + 项目名 + 数量 pill + chevron；`sticky top-0` 吸顶；`border-t` 分隔；未归类整体弱化 |
| P4 层级与节奏 | 组内行缩进（pl-2/pl-3）表达从属；组间留白制造呼吸感 |
| P5 行零重画 | 现有 `SessionRow` 原样保留，仅组外套缩进容器 |
| P6 选择/活跃态 | 行选中=bg-accent/10 + 左 accent 条；running 四点旋转 + 来源点 ping（活跃 GUI 聊天） |
| P7 功能不丢 | 搜索/来源筛选/标签/标记/时间范围/按路径筛选保留；新增「按项目▸按时间」分段切换（持久化） |

## 原型覆盖的状态
- 多项目组（展开 / 折叠，chevron 旋转）
- 吸顶组头（滚动时固定）
- 未归类组（弱化）
- 选中行（左 accent 条）
- running 行：四点旋转 + 来源点 ping（活跃 GUI 聊天指示，对应设计文档 P3①）
- 来源点颜色区分：pi / codex / claude / other
- 标签 chips、New Chat 钉顶、Resume/Copy（hover 显现）
- 「按项目」与「按时间」双模式并排对照

## 实施路径（原型确认后）
| 阶段 | 内容 | 文件 |
|---|---|---|
| L1 | 新增 `SessionGroup.tsx`：可折叠组头（folder+名+count pill+chevron，sticky）+ 渲染 `SessionRow[]` | 新文件 |
| L2 | `aisessions.tsx`：由 `visibleSessions` 算出 `groupedSessions`（按 `projectPath` 分组、组内 `sortSessionsByTime`、组按最近活跃排）；把 `visibleSessions.map(SessionRow)` 换成 `groupedSessions.map(SessionGroup)`；`NewSessionKey` 仍钉顶 | aisessions.tsx |
| L3 | 分组偏好：「按项目/按时间」分段控件（复用排序控件旁位置）+ `readGroupPreference`/`writeGroupPreference`（照抄 `readSortPreference`） | aisessions.tsx, utils.ts |
| L4 | `utils.ts`：`groupSessionsByProject(sessions)` 纯函数（O(n)，无新依赖） | utils.ts |
| L5 | 样式套用原型 token（bg-panel/bg-hoverbg/border-border/bg-accent-10/text-secondary），组内缩进、组头吸顶、未归类弱化 | SessionGroup.tsx |

## 影响面 / 风险
- 仅列表渲染层改动；`SessionRow` 不动；`session-row.test.tsx` 等现有测试仍覆盖。
- 搜索/筛选/标记/running 点全部在 `visibleSessions` 之上叠加，分组只做"再分段"，空组不渲染。

## 会话内 TUI/GUI 切换（决定，后续落地）
用户决策：**列表行不放 TUI 的 Resume 按钮；默认 GUI 展示会话，会话内部（标题栏）支持切换 TUI/GUI**。
- 技术前提已确认：`RestoreContext` 仅校验+返回运行时上下文；前端 `restoreSession` 调 `createBlock` 开一个绑定**同会话文件**的终端 block。GUI 聊天（aisessions block）与 TUI 终端 block 是两个独立 block、可并存，会话文件为共享真相源 → 后端零改动。
- 会话标题栏加 `GUI | TUI` 分段控件（复用 New Agent「打开方式」视觉语言）：GUI=聊天（现状）；TUI=调现有 `restoreSession` 开终端 block；切回 GUI 即回聊天。
- 列表行（`session-row.tsx`）去掉 Resume 按钮 + Copy 命令（TUI 入口进会话内）；点行=开 GUI。行 hover 终端图标：默认不留（保持行最干净）。
- 只读来源（claude/codex/opencode）天然成立：GUI 侧只读横幅，TUI 侧为继续方式。
- 落地改动：session-detail.tsx（分段控件）/ aisessions.tsx（`openInTerminal` 别名现有 `restoreSession`）/ session-row.tsx（去 Resume·Copy）。后端不动。
- 状态：**决定已定，本轮不实现，后续再改**。

## 待决问题
1. 分组默认态：按项目（**已定**，原型默认按项目）。
2. 折叠态是否持久化（localStorage）？原型用内存态，落地可加持久化。
3. 是否要两级树（磁盘 root → 项目子目录）？原型用 `basename(projectPath)` 单级，更贴近 Paseo"按项目"。
4. 组头在含选中行的组是否加细 accent 条弱提示？原型未加，可选。
