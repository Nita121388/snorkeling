# `.mockup/` 整理导览

> 生成于 2026-07-22 审查。本目录原 42 个文件已按"建议删除 / 保留 / 待你拍板"分成三个子文件夹,**没有删除任何文件**,只移动。逐文件夹审查即可。

## 命名速查

| 文件夹 | 含义 | 你要做 |
|---|---|---|
| `_to-delete/` | 已被真实实现覆盖 / 被后续 mockup 取代 / 全仓 0 引用。**强烈建议删**。 | 抽样核一眼就放心删 |
| `_to-keep/` | 当前活跃设计稿、被设计文档显式引用、对应尚未实现的功能。 | 保留 |
| `_review-boundary/` | 7/6 三联主题方向探索稿,未被 `design-system.html` 4 套主题采纳。 | **二选一**:三份一起删 / 三份一起留。默认建议删 |

## `_to-delete/` — 30 项

### Common Text(5)
- `commontext-feedback-toast.html` — 5 种气泡方案对比稿;真实 compose modal 只取单行 `statusKind`
- `commontext-list-row-hover-actions.html` — hover actions 已在真实列表项落地,且与已被取代的 full.html 内容重复
- `commontext-save-dialog-tags.html` — 真实 `commontext-tags.tsx` 的 `CommonTextTagChip` 已存在
- `debug-commontext-overflow.html` — 临时调试页(含 setInterval 重算),非设计资产
- (注:`commontext-compose-modal-full.html` 在审查期间已被另行删除)

### 主题/配色/设计系统(7)
- `_cream_accent_cards.html` — 米黄 accent 探索稿,方案 38/39 已并入 `light-theme-variations.html`
- `_gen_cream_accent_cards.py` — 上者生成脚本
- `_litter_themes.json` — `_litter_cards.html` 源数据,方案已并入 `light-theme-variations.html`
- `_gen_litter_cards.py` — 上者生成脚本
- `_litter_cards.html` — 213KB 临时卡片稿,内容一字不差并入 `light-theme-variations.html`
- `_litter_cards.txt` — 上者纯文本镜像(同 213980 字节),完全冗余
- `accent-color-candidates.html` — 早期候选;最终 accent `#7c49a1/#a76fca` 已定型入 `design-system.html`
- `button-accent-redesign.html` — 同期按钮细化稿,风格已落入 `design-system.html`
- `checkbutton-redesign.html` — 7/2 CheckButton 探索,accent 仍是旧绿色,已被紫 accent 取代
- `theme-design.html` — V1 设置面板原型,V2 总览 PNG 已是其后继(注:V2 PNG 在审查期间已被另行删除)

### Agent/Session/Block(15)
- `agent-card-responsive.html` — 布局已落地 `session-overview.scss:455`(上中下三段 + message-strip)
- `agent-status-current.html` — 状态已由 `agent-status/*` + commit c66c1c07 完整覆盖,`-current` 阶段性对比稿
- `agent-terminal-redesign.html` — 7/2 Agent Type 样式稿,被 7/22 `new-agent-vendor.html` 接力
- `terminal-agent-redesign.html` — 6/29 全流程稿,链路 `terminal-agent-redesign → agent-terminal-redesign → new-agent-vendor` 前端被迭代
- `card-wireframe.html` — 7/2 早期线框,被 `agent-card-responsive` 细化取代且后者已落地
- `combine-vs-overview.html` — V2 联动方案;`docs/project/combine-dashboard-design.md:15` 已明确否定,采纳 V3
- `session-detail-redesign.html` — 6/30 早期稿,真实 `session-detail.tsx` 已实现且方向演进到 session-overview
- `sessions-redesign.html` — 6/26 早期稿,真实 `aisessions.tsx` + `session-overview/` 已落地
- (注:`sessions-redesign.png` 在审查期间已被另行删除)
- `move-block-modal.html` — 视觉美化主体已合入 `tab-target-modal.tsx`(hover/spinner/is-working)
- `x-button-adaptive.html` — OverViewAgentCard 一次性微调稿,全仓 0 引用
- `filter-redesign.html` — 6/25 早期稿,真实 filter UI 已在 session-overview 落地
- `filter-redesign.png` — 配套 PNG
- `tag-chips.html` — 6/25 早期稿,真实 `session-tag-chips.tsx` + `session-tags.ts` 已落地
- `tag-chips.png` — 配套 PNG

### 单点小修(2)
- `markdown-inline-code-wrap.html` — bug 在 commit `6e81834a` 已修在 `markdown.tsx`,`markdown.preview.tsx` 永久 preview 已取代复现作用
- `tooltip-overflow-redesign.html` — 三方案均未落地;真实 `tooltip.tsx` 用 `@floating-ui` 的 `shift/flip` 从根本解决

## `_to-keep/` — 6 项

- `combine-dashboard.html` — 7/22 最新;`docs/project/combine-dashboard-design.md:136` 显式引用,真实 `combinedashboard/` 组件尚未实现,设计仍活跃(V3 当前方案)
- `new-agent-vendor.html` — 7/22 最新;cc-switch vendor 区域设计,codex vendor 隔离尚未落地
- `commontext-compose-modal-improved.html` — 07-22 11:41 最新,Mater-Detail 改进 + 明暗主题 + 600ms blur 折叠;真实 tsx 仍是"compact 拥挤"
- `commontext-search-virtual.html` — 虚拟滚动提案,真实仅采纳"limit 提至 500"未做真正虚拟化
- `design-system.html` — 项目唯一权威 visual reference,`docs/design-system.md` 显式引用
- `light-theme-variations.html` — 150KB 浅色主题候选总集,light 选型母本

## `aisessions-chat-redesign/` — 1 项（自建目录）

- `aisessions-chat-redesign/` — **▲ 设计活跃**;AI Sessions GUI 对话界面重构（上下布局）+ New Agent GUI/TUI 双模式选择设计。覆盖范围：(1) aisessions 视图改造（左右列表+上下聊天详情）(2) 底部输入框 PromptInput (3) 消息组件 MessageCard/ToolCallCard/StreamingBubble (4) New Agent 多步创建表单（来源选择→提炼设定→绑定Agent→GUI/TUI模式→加入群组）(5) 群聊界面预览。镜像源：`frontend/app/view/aisessions/session-detail.tsx, session-message.tsx, chat-composer.tsx, aisessions.tsx`；参考：beui PromptInput/MessageScroller/SignupForm + Paseo 聊天界面。

## `session-detail-block-header/` — 1 项（自建目录）

- `session-detail-block-header/` — **▲ 设计活跃**（2026-10-22）;会话详情块「双 Header」问题的四方案对比原型:现状(块框头 30px + 详情面板头 46px,两条相邻下边框)、A 合并入块框头(单一 Header,会话标题/来源 chip/模型 chip 走 viewText+endIconButtons,保留原生块交互)、B 隐藏块框头(面板头升级并补块级按钮)、C 双层弱化(压高度去分割线)。含明暗主题切换、hover 显隐、标题改名交互。镜像源:`frontend/app/view/aisessions/session-detail.tsx`, `frontend/app/block/blockframe-header.tsx`, `frontend/app/block/block.scss`;真实组件尚未实现。配套任务 `.trellis/tasks/10-22-aisessions-detail-single-header/`。

## `message-queue-redesign/` — 1 项（自建目录）

- `message-queue-redesign/` — **▲ 设计活跃**;AI Sessions ChatComposer 消息队列交互重构：替换当前仅有 11px text 的「N messages queued」为可交互 MessageQueuePill（折叠态/展开列表/拖拽排序/优先级切换/取消/abort 恢复 toast）。参照 Paseo `GitProcessScheduler` 双优先级队列 + drain 调度模式。镜像 `frontend/app/view/aisessions/session-detail.tsx`（queuedMessagesRef + flushQueuedRef + handleChatQueue）+ `chat-composer.tsx`（queuedCount prop + 11px text 渲染）;真实组件尚未实现。

## `ssh-config-edit/` — 1 项（自建目录）

- `ssh-config-edit/` — **▲ 设计活跃**;连接下拉框新增「Edit SSH Config」入口,打开 `~/.ssh/config` 可编辑 preview 视图;真实 `conntypeahead.tsx` 尚未实现。

## `notion-property-agent-card/` — 1 项（自建目录）

- `notion-property-agent-card/` — **▲ 设计活跃**（2026-10-29）；把 Agent / Session 卡片上硬编码的 Note + Tags 升级为 Notion 式「属性 schema + 属性值 + 类型化渲染」的像素级参照原型。覆盖：page icon（品牌 Logo vs emoji 分层覆盖）、40px 标题、属性行（hover `⋮⋮`）、完整类型选择器（Basic/Advanced/System）、Select/Status/Multi-select/Date/Checkbox/Text/Number/URL/Person/Relation/Formula 编辑器、`+ Add a property`、`⋮⋮` 属性菜单（Rename/Change type/Delete）、AI 自动填充 + 新属性提议 + `✨` 来源标 + Undo、窄卡形态（前 5 条 + `+N more`）。镜像源：`frontend/app/element/info-card/session-note-section.tsx`, `frontend/app/view/aisessions/session-row.tsx`, `frontend/app/view/term/agent-hover-card.tsx`, `frontend/app/block/session-detail-info-card.tsx`, `frontend/app/view/preview/plugins/md-properties/frontmatter-block.ts`, `frontend/app/view/term/agent-logo.tsx`；真实组件尚未实现。配套设计文档：`design/plans/aisession-notion-properties.md`。

## `vcs-header-hover-panel/` — 1 项（自建目录）

- `vcs-header-hover-panel/` — **▲ 设计活跃**;Files Block header 版本管理图标 hover 快捷面板:按 Git/SVN 区分内容(分支/ahead-behind vs Update/远端文件数),8 场景可切换(Git/SVN × 文件/目录、多仓库、非 repo、检测中、解析失败);点击图标本体行为不变。镜像 `preview-model.tsx` endIconButtons + `blockframe-header.tsx`,真实组件尚未实现。

## `vcs-repo-switcher/` — 1 项（自建目录）

- `vcs-repo-switcher/` — **▲ 设计活跃**（2026-09-10）;VCS Block（版本管理）头部新增**多仓库切换器**:后端 `RemoteVcsRepositoriesCommand` 已返回全部仓库（`detectRepoRoots` scandepth=3+includeparent），但前端 `vcs.tsx` 只渲染 `activeRepo`（固定 `repoList[0]`）无切换入口→看不到多仓库。本原型在头部加 `.repo-switcher` 自定义下拉（仓库名+GIT/SVN 徽标+rootpath 副标题+分支，选中 ✓ 高亮），切换即更新头部分支/ahead-behind/changed 与 Changes/Branches/Pipelines 三 Tab;单仓库收起为只读。含 `E:/projects` 真实 5 仓库场景（月度报/quartz-site/嵌套 quartz/tab-out/tabshelf）。镜像 `frontend/app/view/vcs/vcs.tsx`, `vcs-tabs.tsx`, `pkg/wshrpc/wshremote/vcs.go`,真实组件尚未实现。

## `vcs-repo-switcher-v2/` — 1 项（自建目录）

- `vcs-repo-switcher-v2/` — **▲ 设计活跃**（2026-09-10）;VCS Block 多仓库切换器 v2:针对 v1 问题（下拉列表无仓库状态一目了然），改为 **chips 横排 + 溢出 +N 下拉** 双形态。6 场景覆盖：Single（切换器隐藏）、Duo（一净一脏）、Quad（monorepo 4 子包）、Overflow 6+（横滑+溢出下拉）、Mixed（Git+SVN）、Nested（父目录 git + 子仓库）。新增聚合信息条（N repos · Σ changed · behind/ahead）与总览浮层（逐仓库摘要+点击切换）。Dropdown 形态支持搜索过滤（按仓库名/分支）。DOM 结构逐字段对齐 `vcs.tsx`（RepoHeader/TabsBar/TabsContent/ChangesTab），状态模型与真实 `repos[]/activeRepoId` 对齐。镜像 `frontend/app/view/vcs/vcs.tsx, vcs-tabs.tsx, vcs-changes-tab.tsx, pkg/wshrpc/wshremote/vcs.go`，真实组件尚未实现。

## `agent-id-card/` — 1 项（自建目录）

- `agent-id-card/` — **▲ 设计活跃**;Agent 开篇身份证卡:新建/resume Agent 时终端 block 先展示证件风开篇卡(照片位 provider logo + 状态环、Title/Status/Output/Note/Sessions 五信息行、波纹底纹、底部 sessionId 编号行、可选印章),跑起来后折叠成 header 状态灯徽标;10 场景可切换(working·tool/thinking、blocked、error、rate-limited、done、idle、stale、unbound 待落户、missing 户籍注销)+ 印章开关 + 深色桌面对照。状态文案逐字对齐 `agent-status-derive.ts`;镜像 `term.tsx` + `blockframe-header.tsx`,真实组件尚未实现。

## `agent-card-beautify/` — 1 项（自建目录）

- `agent-card-beautify/` — **▲ 设计活跃**（2026-11-03）；Agent hover card 的**信息层级重排**方案集：8 张同数据对照卡（0 现状基线 + A–G 七套参考成熟产品）。A **Linear**（星标上行、空值行不给高度、相对时间、行高 26）、B **Vercel**（顶部 2px 渐变状态条、状态收 chip、属性折叠成 `Properties · 6` disclosure、mono meta 圆点分隔）、C **Raycast**（大写分组头 + 30px 行 + 选中行 accent + 底栏键位提示，仅适合弹窗）、D **GitHub**（32px 品牌头像块、标签 pill + `+ label` 占位、标题引用块、hover 工具组）、E **Warp**（Duration/Cost/Context 三列指标上抬、TASK/DETAILS caps 分区）、F **Arc**（品牌色渐变面 + 发光徽标，一屏多卡会变噪声）、G **Stripe**（两列 key/value 网格 + 单一主按钮）。推荐组合 A+B+E 并可分批落地。可切 5 态/320·360·420 宽/深浅主题/密度标注，抽屉给每方案落地要点与 CSS 片段，支持 `?state/width/theme/guides/notes` 深链。**已合成落地版**（C 行骨架 + D 头像/引用块，2026-11-03）见 `agent-card-hybrid/`；实机落地后卡高 296→251px、星标上移右上角、`title_source` 并入副标题、空值 `—`、相对时间、footer 单行（详见 `docs/project/agent-card-layout.md`）。镜像 `frontend/app/view/term/agent-hover-card.tsx`, `frontend/app/element/info-card/info-card.scss`, `frontend/app/element/info-card/session-note-section.tsx`, `frontend/app/view/aisessions/property/property-list.tsx`；真实组件尚未实现。

## `agent-card-hybrid/` — 1 项（自建目录）

- `agent-card-hybrid/` — **◐ 部分落地**（2026-11-03 主体已落地：`agent-hover-card.tsx` + `info-card.scss` + `session-note-section.tsx` + `property-list.{tsx,scss}` + `session-note-hook.ts`；折叠态与 usage 指标未做）；在 `agent-card-beautify/` 8 套对照里取三个可共存的胜出点合成一版：**C 的行骨架**（icon + label 左 / value 右，一行一条信息） + **D 的身份与主体**（30px 头像块承载 Logo/emoji/文字徽标三态、2px 状态色标题引用块、tags pill） + **右上三件套**（状态 chip / 收藏 / 放大同一基线右对齐，`agent-card-head` 不再各占一行）。配套文本简化：`first_user_message` → 副标题 `First message`、`Empty` → `—`、绝对时间 → 相对时间（hover 绝对）、`Add property` / `AI auto-fill` 收进底部单行、session id 8+4 截断。高度实测 340 宽/2 行标题：现状 296px → 251px，折叠态 140px（页面右下角实时 `offsetHeight` 回写）。页面含主卡 + 5 态 + 宽度/填充/折叠/emoji/超长标题情境，支持 `?state&width&theme&collapsed&hover` 深链。镜像 `frontend/app/view/term/agent-hover-card.tsx`, `frontend/app/element/info-card/info-card.scss`, `frontend/app/element/info-card/session-note-section.tsx`, `frontend/app/view/aisessions/property/property-list.tsx`, `frontend/app/view/aisessions/title-source-badge.tsx`；真实组件尚未实现。

## `agent-card-accent/` — 1 项（自建目录）

- `agent-card-accent/` — **◐ 部分落地**（2026-05-20；方案 E 已写入 `info-card.scss`）;Agent hover card 强调线改造：原 `.info-card.agent-card` 用 `border-left: 3px` + `border-radius: 8px`，圆角把左侧色条在上下端切成斜段，视觉上两头向外弯（用户明确不喜欢）。**已落地方案 E：通长直条 + 色条自身的圆头**——`::before` 伪元素 `left/top/bottom: 0` + `width: 3px` + `border-radius: 2px`（圆头来自条本身），卡片 `border-radius: 0 6px 6px 0` + `padding-left: 15px`，CSS-only 不碰 JSX。原型里的备选：A 全直角 / B 左直角右圆角 / C 顶部色带 / D 状态章 / F 卡外并列条（需 JSX）/ G 卡全圆角+条在卡内（反例，条端会探出尖角）。原型可切 working/done/blocked/error、280/320/380 宽度、圆头半径 1.5/2/3px、1.5x 放大镜，点卡片看 CSS 片段。镜像 `frontend/app/view/term/agent-hover-card.tsx` + `frontend/app/element/info-card/info-card.scss`。

## `save-conflict-protection/` — 1 项（自建目录）

- `save-conflict-protection/` — **▲ 设计活跃**;保存状态优化两个界面:① Inline Tab 脏点（未保存圆点）② 冲突弹窗（覆盖/放弃/复制差异交 Agent/取消）;对应 Obsidian 方案 `Snorkeling-打开md预览与保存状态优化方案.md`,真实组件尚未实现。

## `inline-tab-add-menu/` — 1 项（自建目录）

- `inline-tab-add-menu/` — **◉ 真实代码已落地**（2026-08-26，行为二次迭代：菜单条目点击而非悬浮、右栏不再被连带带出）;Blocks 组（Inline Tab 化 Block）tab 行右上角新增固定区「＋」按钮（拆滚动区+固定区,tabs 溢出滚动时钉死右上角不挨着最后一个 tab）,点击弹出 widget 注册表驱动的新建菜单:Terminal/Agent 经 launch-popup-bus 复用右栏同款目标浮窗（footer 标 "Add to Group",创建改道进组）、Files 继承激活 tab 的 connection/cmd:cwd、其余 widget 直通 blockdef 创建并加入本组（`addBlockToInlineTab`）,action 型跳过;新增 `inlinetab-addmenu.tsx` + `launch-popup-bus.ts`,复用 `block.tsx` InlineTabBlock + `block.scss` + `widgets.json` + `widgets.tsx`。

## `widget-quick-launch/` — 1 项（自建目录）

## `block-sidebar/` — 1 项（自建目录）

- `block-sidebar/` — **▲ 设计活跃**（2026-08-31）;暂存 Block 的常驻 Icon 侧栏:替换现有 `MinimizedBlocksFloat`（浮动按钮+Popover）为左侧常驻 Icon 列（类似 PS 工具条），支持三种模式（固定态占布局常驻 / Hover态 overlay 浮出 / 隐藏态完全不显示），支持收纳整个 Blocks 组（文件夹式 icon 可展开/折叠），底部 ⚙ 固定/隐藏切换。镜像 `minimized-blocks-float.tsx` + `block-minimize.ts` + `widgets.tsx`（pinned/hover 模式参考），真实组件尚未实现。原型含可交互 HTML（模式切换/组展开/Tooltip）。

- `widget-quick-launch/` — **● 已落地**（2026-08-28；居中浮层 `widget-quick-launch.tsx` + `keymodel.ts` 加 `Cmd:Shift:p` + `widgets.tsx` 右键菜单；Terminal/Agent 经 `requestLaunchPopup` 复用右栏目标浮窗，sink 改道进组）键盘快捷启动面板:按 `Cmd/Ctrl+Shift+p` 弹居中浮层,列出全部 supported widget(无搜索框,widget 数量少),选一个后底部出现两按钮 `[New Block]` / `[Current Group]`——New Block=当前 Tab 新建兄弟 Block;Current Group=加入当前 focused Block 所在组成为新 Tab(单 Block 节点被 `addBlockToInlineTab` 自动升级为组)。Terminal/Agent 同样两选放置,经 `requestLaunchPopup({mode, anchorEl, sinkNodeId?})` 复用右栏目标浮窗(sink 改道进组)。镜像 `widgets.tsx`(WidgetsBar 点击=createBlock) + `inlinetab-addmenu.tsx`(widget 注册表菜单) + `keymodel.ts`(全局快捷键) + `inlineTabs.ts`/`layoutModel.addBlockToInlineTab`(Blocks 组);计划新增 `widget-quick-launch.tsx`,真实组件尚未实现。

> **2026-08-04 对账补充**：`_to-keep/` 实际还有 3 项在本指南生成后被放入（此前 42 项清单之外），暂保留待拍板是否入目录：
> - `aisessions-no-tag-filter.html` / `aisessions-path-filter/` — session 列表筛选方向
> - `commontext-pinned-detail-insert.html` — pinned 详情插入方向
> - **2026-08-16**：`aisessions-path-filter/` 已按 PROCESS 目录化（v1 裸 html → `index.html` + `README.md`，位于 `_to-keep/aisessions-path-filter/`），并重做为 **v2 目录导航设计**（▲ 设计活跃）：父级面包屑回退 + 直接子目录 chips 下钻，匹配语义改为组件边界前缀，计数改用后端全量 projectPath 分布。v1 两处根因（公共前缀面包屑天花板、子串/无边界前缀泄漏兄弟目录）与落地计划见其 README。

## `files-block-favorites/` — 1 项（自建目录）

- `files-block-favorites/` — **▲ 设计活跃**（2026-09-04）;Files Block（Preview 视图）常用目录收藏 + 自动识别最近访问目录：folder icon 点击居中弹出 FavoritesFloatingWindow（AgentTargetFloatingWindow 风格毛玻璃浮窗），分 Favorites（手动收藏 + hover × 移除 + "Add current dir" 按钮）+ Recent（自动识别 session 内访问历史，最多 10 条）两区域，选中态 accent 左侧 bar，footer 有 Go to Path / Open / New Tab 三个操作按钮；右键文件/目录新增 "Add to Favorites" / "Remove from Favorites" 菜单项，folder icon 有收藏时显示 ★ 绿色徽标。替换现有硬编码 BOOKMARKS（Home/Desktop/Downloads/Documents/Root）+ longClick context menu。数据走 `preview:favorites` setting key，Recent 前端 session 内追踪。镜像源：`frontend/app/view/preview/preview-model.tsx`, `preview-directory-utils.tsx`, `preview.tsx`。4 场景可交互切换。

## `files-header-split-reveal/` — 1 项（自建目录）

- `files-header-split-reveal/` — **▲ 设计活跃**（2026-11-06）;Files Block header 的 icon 显示不全（把路径挤成 `…`）。方案：悬浮 header 左半 → 只出左侧组；悬浮右半 → 只出右侧组，且左侧 chevron + 路径**收起让位**，腾出的宽度**全部转给右组**。**核心陷阱用"锁存"结构性消除**：方向只在 `pointerenter` 那一刻按进入点判定一次，**整个 hover 会话内锁死**，`pointermove` 完全不参与分区 —— 所以"右组向左伸过中线"根本不会被重新判定，不存在翻区/点不到/闪烁（对照中线实时切分：240px 下右组第 0 个 icon `goto` @x=35 < mid=119 立刻翻成 left，实测 FAIL；锁存版全程 right，PASS）。离开 header 后启动 `resetTimer(graceMs)`（默认 400ms，可配 0~1200），宽限内回来**沿用原方向**，到期才回 NEUTRAL、下次进入才重新判定；溢出菜单/浮层打开时 FROZEN（`pointerleave` 不启动定时器）。三项自动断言全 PASS（①横穿全宽含 icon 越中线不翻区 ②宽限内从另一侧回来不翻区 ③超宽限后从另一侧进入必须切换）。窄块按 5 级 tier 降级（≥360 完整 / 240-360 削尾进 `…` / 192-240 `…` 升主入口 / 88-192 只留类型图标+`…` / <88 浮层工具条接管），硬判据「header 可见 + 溢出菜单 + 浮层 = 12」在 40~520px 十档 × 左右两方向全部 PASS（功能零丢失）；对照组现状 `overflow:hidden` 硬切在 240px 下 6 个全被裁。镜像源：`frontend/app/block/blockframe-header.tsx`, `frontend/app/block/block.scss`, `frontend/app/view/preview/preview-model.tsx`, `frontend/layout/lib/layoutModel.ts`。真实组件尚未实现。

## `vcs-block-redesign/` — 1 项（自建目录）

- `vcs-block-redesign/` — **▲ 设计活跃**;VCS Block（Version Control）Quiet List 重设计：去掉深色半透明→纯浅色背景，Badge 简化（C:2 U:1→3 changed + ↓4 ↑1），次要操作 hover 浮现，tabular-nums 数字对齐，accent 仅用于主按钮+链接。覆盖 4 视图（vcs/vcscommits/vcshistory/vcsdiff）+ 6 场景（Clean/Dirty/Behind-Ahead/SVN/Multi-repo/Detached HEAD）可交互切换。镜像源：`frontend/app/view/vcs/vcs.tsx`, `frontend/app/view/vcs/vcs-filter.ts`, `frontend/app/view/vcscommits/vcscommits.tsx`, `frontend/app/view/vcshistory/vcshistory.tsx`, `frontend/app/view/vcsdiff/vcsdiff.tsx`。落地计划见 `PLAN.md`（8 Phase，P0 视觉重构 1-2 天 → P2 Commit Graph 3 天）。

## `_review-boundary/` — 3 项

7/6 12:55–13:17 三联式主题方向探索稿。**未被 `design-system.html` 4 套主题(dark/light/monochrome)采纳,无后续引用**。三者同命运,要么一起删、要么一起留。

- `cool-pine-ink.html` — 冷松石墨绿
- `eink-inkwash.html` — 水墨
- `retro-monochrome.html` — 复古无彩色

**默认建议:三份一起删。** 若想留一组历史方向以备日后重启,就三份一起留。

## 净效果

- `_to-delete/`:30 项 → 抽样核完执行 `rm -rf .mockup/_to-delete/`
- `_review-boundary/`:3 项 → 拍板后或删或并回保留集
- `_to-keep/`:6 项 → 留下作为 .mockup 的常驻设计资产
- 总体从 42 项收敛到 6(+可选 3)项

## 2026-08-04 补充：原型管理与同步状态

### 顶层文件（不在 42 项清单内）

- `vcs-block-redesign.html` — VCS block 重设计（顶层），已被 `vcs-block-redesign/` 目录版取代，建议移入 `_to-delete/`。

### 原型管理已制度化

- 新增 `PROCESS.md`：统一状态标记（▲设计活跃/●已落地/▼过时/◐部分落地）、镜像源跟踪、生命周期、检查清单。
- 新增 `audit-sync.mjs`（现于 `docs/sync-audit/`）：`node docs/sync-audit/audit-sync.mjs` → 校验每个原型 README 的镜像源在仓库是否仍存在。
- 新增原型 `env-launch-entry/`（New Agent/New Terminal 运行前自定义 env，▲ 设计活跃）。
- **2026-08-08**：`env-launch-entry/` 按 PROCESS.md「结构镜像」重做——两 launch 弹窗逐字段对齐真实 `widgets.tsx`（含真实 SVG agent logo、`AgentProfileColors` 7px 圆点回退、2px 选中竖条/分隔点、DefaultCheckButton），Env 入口落 footer 最左（对齐设计方案最终形态），env 弹窗上半镜像 `envmodal.tsx/scss` 下半新增自定义变量编辑区；4 个镜像源对账通过。
- **2026-08-08（同日）**：阶段 2/3 已进真实代码并实测通过（状态 ▲→◐）——New Agent/New Terminal footer `[Env]` 入口 + envmodal 可编辑（launch 模式回调 / block 模式 merge cmd:env）+ `withLaunchEnv` 合并；后端零改动（复用 SetMetaCommand，未新建 SaveBlockEnvCommand）；`audit-sync.mjs` 无新增缺失。阶段 4（Codex 浅色预设）未做。

### 对账发现的历史脱结点（待拍板）

| 原型 | 问题 | 建议 |
|---|---|---|
| `shell-settings/README.md` | 镜像 `pkg/util/shellutil/scanshells.go` 已不存在（全仓 0 引用），可能已重构/改名 | 查明新位置或更新镜像源，或一并进 `_to-delete/` |
| `new-agent-panel/README.md` | 无状态标记、无源码引用（相对已落地内容可为 ●） | 补标记或标注已落地 |
| `_to-keep` 内 3 个未登记项 | 超出 42 项清单 | 补入目录或拍板去留 |

> 上述逐项不擅自处理；`audit-sync.mjs`（`docs/sync-audit/audit-sync.mjs`）已能自动标出，后续照此跟进。

## 2026-10-28 新增原型

- `aisessions-annotation-card-ux/` — **▲ 设计活跃**（2026-10-28）；会话详情批注节点悬浮卡重设计：去掉卡片「Node」字样改为「类型图标 + #seq + 时间」身份头；圆点交互从「单击既跳又钉」改为 **单击选中留卡 / 双击跳转高亮**；卡片移除 Jump 按钮与图钉，改为 external-link 直接打开 `AnnotationEditor`；工具节点按 `tool-group.tsx` 画成工具行（wrench + 名称 + summary + 状态点），summary 节点显示截断总结（渐隐），批注的类型/标题/正文/标签分层展示。覆盖 message / tool / summary 三类节点 + 明暗主题。镜像源：`annotation-card.tsx`、`annotation-rail.tsx`、`annotation-model.ts`、`session-detail.tsx`、`tool-group.tsx`，真实组件尚未实现。

## 2026-11-02 新增原型

- `tab-card-v2/` — **▲ 设计活跃**（2026-11-02）；Tab 悬浮卡样式与图标重设计。8 套变体同数据对比：GitHub Hovercard / Linear / Raycast / Notion·Things / Vercel Geist·shadcn / Discord 成员列表 / Warp 终端 / Windows Fluent 2，各变体同时换「布局 + 图标容器 + 状态表达」。共同结构主张：计数并入 header、相同 provider 提到分组标题、行内主信息换成状态短语、定宽 268px、无状态不显示 `—`。镜像源：`tab-info-card.tsx`、`info-card.scss`、`tab.tsx`，真实组件尚未改造。

## 2026-11-05 新增原型

- `commontext-list-meta-sort/` — **✅ 已落地**（2026-11-05，`frontend/app/commontext/`，分支 `feat/commontext-list-meta-sort`）；CommonText 列表要展示创建时间 / 更新时间 / 支持多排序 / 显示使用次数。按真实双栏 Master-Detail 镜像重做（首版窄单栏作废），只加两处新增点：左栏搜索下方的排序控件、列表行右侧的「使用次数 + 更新时间」列（不加行高，完整时间走悬浮提示）。排序控件按项目 UI 原则「能用图标表示的不用文字」做成纯图标按钮组（含义走 title/aria-label），列表行与详情页脚的「时间 / 次数」同样用图标 + 数字。原型同时复刻了「搜索态相关度优先、置顶只作并列次序」的真实行为。README 记录落地前必须定的三件事：排序作用域、使用次数写入点缺失（Copy 与行内插入不计数、新建虚记 1 次）、排序函数需独立注入不改 `sortCommonTextItems`。镜像源：`commontext-compose-modal.tsx`、`commontext-model.ts`，真实组件尚未改造。

落地回执：真实组件已按本原型实现两处新增点（列表行右侧「次数 + 更新时间」列、搜索框下方纯图标排序控件）
+ 详情页脚元信息组；三条待定项按原型推荐值定稿——排序作用域（浏览态用用户排序 / 搜索态相关度优先且控件置灰，
用 `aria-disabled` 保留 tooltip）、使用次数口径（补 Copy 与行内 hover 插入，新建不再虚记 1 次但刷新 `lastusedat`）、
排序函数独立注入（新增 `sortCommonTextItemsBy`，`sortCommonTextItems` 行为逐位不变）。

## 2026-11-06 新增原型

- `commontext-cloud-sync-notion/` — **▲ 设计活跃**（2026-11-06）；Common Text 三项需求：① 云同步 + 来源元数据（`createdBy.kind/name`、`origin.deviceId/deviceName/platform`、`rev`、`deletedat` 墓碑）；② 按创建者 / 电脑筛选（`All / 👤 Humans / 🤖 Agents` chip + 设备下拉，计数随其它条件重算，与 tag 筛选 AND 叠加）；③ 详情右栏升级为 Notion/Obsidian 页面式（page icon emoji + 大标题 + `name 值` 两列属性网格 + `Preview/Edit` 正文切换 + 复用 markdown `:` 选择器的 emoji picker）。同步状态只暴露 `已同步 / 同步中 / 有冲突` 三态 + 悬浮面板（上次同步、设备列表、冲突条数、模拟另一设备新建 / Agent 改这条）。README 记录四项待拍板：同步后端（推荐先云盘目录 `commontext.json` 后自建服务）、agent 身份来源（命令显式传参优先）、设备展示名（默认 hostname 可改）、冲突粒度（推荐行级自动合并 + 标记）。同步方式部分按「**编译期枚举 + 单活跃**」实现（非插件化）：Transport 单选（Local folder / Git / Self-hosted / Off），前置条件不满足就置灰并给配置入口（Git 未配 token → 灰 + `Configure token…`，配好后立刻可点），切换 = 全量重同步 + **内联**显式选边（This device wins / Remote wins），从 Off 首次启用不需确认。另配独立 **`Sync settings` 弹窗**（入口 = 面板 footer gear），照 `modal.tsx` 结构化壳：Transport 单选 + 各后端配置（folder 路径 / git token+interval）+ This computer（Name/DeviceID/Platform）+ Conflicts 三选一 + Scope（Common Text / tombstones）+ Maintenance（Full re-sync / Reveal file / Reset）；**草稿态**（Cancel 全丢、Save 才落库），token 因存 keyring 而点保存即刻生效。README 记录为什么不做可安装插件（仓库无运行期加载能力 + 同步复杂度在不变量层而非后端数量）与「什么时候才真值得插件化」三条判据。镜像源：`commontext-compose-modal.tsx`、`commontext-model.ts`、`pkg/wconfig/settingsconfig.go`、`pkg/commontextstore/commontext_store.go`，真实组件尚未改造。

- `move-block-modal-v3/` — **▲ 设计活跃**（2026-11-06）；Move Block to Tab 的菜单收敛 + 动作入口重排：现有 4 条菜单（Move/Copy × New/Existing）收敛为 **1 条 `Move to Tab…`**；弹窗内「New tab 行置顶且永远可用」，其余行 **每行两个图标动作**（`→` Move / `⧉` Copy，hover 才浮现），**不做 Move/Copy 分段切换**——去掉模式状态后一步完成，标题固定 `Move Block`；行体点击仍是 Move 的快路径，`→` 是它的显式 / 键盘可达 affordance。行容器必须由 `<button>` 改 `div[role=button]`（按 project 已踩过的非法嵌套坑，`overview-board.tsx:141`）。同时把「只支持 agent Block」的成因查清并画成表：不是按 block 类型拦的，而是 `appendBlockMoveMenuItems` 只被 term / vcs / preview-directory / preview-explorer / processviewer 五个视图接力，`preview-model`（markdown/图片预览）、`aisessions`、`codeeditor` 等右键菜单没接 → 落地方案以 block header `⋯` 为保底入口 + 逐视图补齐。自检 `selfcheck.mjs`（Edge headless + CDP，复用 `scripts/verify/lib/cdp.mjs`）26/26 全绿，含「无模式控件」「行体=Move」「⧉=Copy」「真实指针 hover 图标浮现 / 移开归零」。镜像源：`blockframe-header.tsx`、`tab-target-modal.tsx`、`tab.scss`、`flyoutmenu.scss`、`modal.tsx/scss`，真实组件尚未改造。README 记录待拍板：Copy 的放置方式（每行双图标 / header 分段 / 两条菜单 / 砍掉）、行体点击语义（= Move / 只允许点图标）、New tab 是否当场输名字、空态是否保留 `No other tabs`。

## 2026-11-06 新增原型（Overview 优化 1-4）

配套任务 `.trellis/tasks/11-06-overview-optimize-1to4/`，设计见 `design/plans/overview-board-timeline.md`。

- `overview-card-click/` — **▲ 设计活跃**（2026-11-06）；Overview 看板卡片点击语义的**三级栈**原型：点卡片 → 整卡弹窗（`AgentCardModal`，内部 `AgentHoverCard` frameless）→ 卡内「打开会话详情」→ 会话详情弹窗。演示两处易踩的接线细节：① 卡内按钮必须 `stopPropagation`（否则冒泡回卡片二次触发）；② 非 agent 块没有整卡可开，点击仍是「选中 + 跳转 block」；③ 无 `sessionId` 时详情按钮 disabled。弹窗 `closeOnBackdrop: false`（属性 inline 编辑中误关会丢草稿）。镜像源：`session-overview.tsx:2518`（现状直接 `openSessionDetail`）、`overview-board.tsx:141`（卡片 `onClick`）、`modals/agentcardmodal.tsx`、`view/term/agent-hover-card.tsx`。真实接线尚未改。

- `overview-group-views/` — **▲ 设计活跃**（2026-11-06）；Overview 看板分组新增两种口径：**目录**（`basename(projectPath)`，列序按卡片数降序、「无项目」虚线框兜底列永远最后）、**标签**（tags 并集按字母序、「无标签」兜底列最后）。关键约束画在页面上：**一张卡可出现在多列**，所以「各列计数之和 = 卡片数」的旧断言在标签视图下必须改成 `之和 ≥ 卡片数`；重复出现的卡带 `DUP` 标记。四种口径共享同一份筛选结果，只有 `status` 常显 5 列并带状态色点。镜像源：`session-overview/overview-board-model.ts:385`（`OverviewBoardGroups` 现只有 status/tab/provider）、`session-overview.tsx:2437`（分组 `<select>`）。真实实现尚未加。

- `overview-board-v2/timeline-gantt.html` — **加 G2.1 分段版**（2026-11-06）；在原有 G1/G2 对比之上加第三档 `G2.1 真实分段`：段起点用 `AgentStatus.activeSince`（不再是从尾巴倒推的 6min/20%）、完成点用 `completedAt` 画竖刻度 + 圆点（hover 显示「完成于 N 分钟前」）、idle 段改中性灰实心（不再并入斜纹「状态未知」）、圆角从 9px 收到 4px（段 3px + 1px 缝，右上「圆角 9px ⇄ 4px」按钮可直接 A/B）。页面上明确写出**残留不诚实之处**：仍画不出「working → idle → working → idle」多次交替，因为后端只留当前态，等环形历史落地。镜像源：`session-overview/overview-timeline-model.ts:111-115`（`tailMsFor` 猜法）、`session-overview.scss:1873`（`border-radius: 9px`）。
