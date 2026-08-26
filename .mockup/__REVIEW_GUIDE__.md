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

## `ssh-config-edit/` — 1 项（自建目录）

- `ssh-config-edit/` — **▲ 设计活跃**;连接下拉框新增「Edit SSH Config」入口,打开 `~/.ssh/config` 可编辑 preview 视图;真实 `conntypeahead.tsx` 尚未实现。

## `vcs-header-hover-panel/` — 1 项（自建目录）

- `vcs-header-hover-panel/` — **▲ 设计活跃**;Files Block header 版本管理图标 hover 快捷面板:按 Git/SVN 区分内容(分支/ahead-behind vs Update/远端文件数),8 场景可切换(Git/SVN × 文件/目录、多仓库、非 repo、检测中、解析失败);点击图标本体行为不变。镜像 `preview-model.tsx` endIconButtons + `blockframe-header.tsx`,真实组件尚未实现。

## `agent-id-card/` — 1 项（自建目录）

- `agent-id-card/` — **▲ 设计活跃**;Agent 开篇身份证卡:新建/resume Agent 时终端 block 先展示证件风开篇卡(照片位 provider logo + 状态环、Title/Status/Output/Note/Sessions 五信息行、波纹底纹、底部 sessionId 编号行、可选印章),跑起来后折叠成 header 状态灯徽标;10 场景可切换(working·tool/thinking、blocked、error、rate-limited、done、idle、stale、unbound 待落户、missing 户籍注销)+ 印章开关 + 深色桌面对照。状态文案逐字对齐 `agent-status-derive.ts`;镜像 `term.tsx` + `blockframe-header.tsx`,真实组件尚未实现。

## `save-conflict-protection/` — 1 项（自建目录）

- `save-conflict-protection/` — **▲ 设计活跃**;保存状态优化两个界面:① Inline Tab 脏点（未保存圆点）② 冲突弹窗（覆盖/放弃/复制差异交 Agent/取消）;对应 Obsidian 方案 `Snorkeling-打开md预览与保存状态优化方案.md`,真实组件尚未实现。

## `inline-tab-add-menu/` — 1 项（自建目录）

- `inline-tab-add-menu/` — **▲ 设计活跃**（2026-08-26）;Blocks 组（Inline Tab 化 Block）tab 行右上角新增固定区「＋」按钮（拆滚动区+固定区,tabs 溢出滚动时钉死右上角不挨着最后一个 tab）,点击弹出 widget 注册表驱动的新建菜单:Terminal/Agent/Files 继承激活 tab 的 connection/cmd:cwd,其余 widget 直通 blockdef 创建并加入本组（`addBlockToInlineTab`）,action 型跳过;镜像 `block.tsx` InlineTabBlock + `block.scss` + `widgets.json`,真实组件尚未实现。

> **2026-08-04 对账补充**：`_to-keep/` 实际还有 3 项在本指南生成后被放入（此前 42 项清单之外），暂保留待拍板是否入目录：
> - `aisessions-no-tag-filter.html` / `aisessions-path-filter/` — session 列表筛选方向
> - `commontext-pinned-detail-insert.html` — pinned 详情插入方向
> - **2026-08-16**：`aisessions-path-filter/` 已按 PROCESS 目录化（v1 裸 html → `index.html` + `README.md`，位于 `_to-keep/aisessions-path-filter/`），并重做为 **v2 目录导航设计**（▲ 设计活跃）：父级面包屑回退 + 直接子目录 chips 下钻，匹配语义改为组件边界前缀，计数改用后端全量 projectPath 分布。v1 两处根因（公共前缀面包屑天花板、子串/无边界前缀泄漏兄弟目录）与落地计划见其 README。

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

- `vcs-block-redesign.html` — VCS block 重设计（顶层），待登记。

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
