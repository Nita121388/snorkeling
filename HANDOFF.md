# HANDOFF — 接手必读（2026-11-24 更新）

## 2026-11-24：晚间批次五包已全部交付并发版 0.0.137（真机验证 22/22 全绿，G7 待 nita 验收）

> nita 2026-11-23 15:11 布置 4 条 + 会话面批注包，当晚全流程跑完：loop 建包 → G1/G6 签 → 红证先行 → 子代理实现（拖拽/emoji 由主代理接管）→ prove 判据全绿 → 真机验证 → 发版。
> **Release 0.0.137 已发布**（三平台产物 20 个；发布信息已编辑为中文分区式：`Snorkeling 0.0.137`）。tag 指向 `9a6c0a224`；验证台 commit `412a71e02` 随后推上。

| 包 | commit | 真机/单测证据 | 状态 |
|---|---|---|---|
| `N-1123-hero-sched-core`（Go） | `50b258b12` | go build/4包test/Hero三测 PASS=3；prove 三绿 | G1-G6 清，**G7 待 nita** |
| `N-1123-hero-group-emoji` | `693d0a821` | 红证→实现→aisessions 53文件/822例全绿 | G1-G5 清，**G7 待 nita** |
| `N-1123-overview-drag` | `06f03dbf8` | 红证→290例全绿→prove三绿；真机拖拽 5 条断言全绿（块真值守恒/同Tab零变更/空Tab可落） | G1-G5 清，**G7 待 nita** |
| `N-1123-hero-sched-ui` | `6dedfc2ce` | 四判据绿；tsc 58 不增；真机 7 条断言绿（含 hero 下拉默认「不绑定」） | G1-G5 清，**G7 待 nita** |
| `N-1123-schedtask-modal` | `8939d11f5` | 四判据绿；真机 4 条断言绿（工具栏入口/行数/新建/复用编辑） | G1-G5 清，**G7 待 nita** |

- 真机验证台：`scripts/verify/scheduled-hero/verify.mjs`（**22/22 全绿**，报告 `verify-runs/20261123T23175-scheduled-hero/REPORT.html` 含 6 截图；area 已登记 README）。
- 教训入库：L-0007（子代理 managed worktree 完成即销毁——唯一写者直接主树写，必须并行时收工落盘 patch）、L-0008（判据 `| tail -N` 配 `passed` 会假红——一律 `&& echo MARKER`）。
- 待办（已登记 INBOX）：overview-board / overview-ux 因端口/profile 冲突未复跑；i18n:check 硬编码 CJK 基线红（存量 14 条 allowlist 外）待专项收口。



## 2026-11-24：文件夹索引徽标（实验插件）— 已实现并 prove 4/4 全绿，G7 真机验收待 nita

> 用户布置（2026-11-23）三个功能点合成一个包；2026-11-24 会话拍板 D1-D5（全按推荐 + D5 改采 setmeta 事件链），
> G1 已签（nita「ok go」）、红证先行、当日实现完成。
> **实现事实文档：`docs/project/folder-index-badges.md`**（怎么开 / index.md 与 badges.js 写法 / 刷新命令 / 降级语义 / 实现锚点）。

| 项 | 内容 |
|---|---|
| 方案页 | `docs/answers/folder-index-icon-badges-20261123.html`（可折叠版解释页） |
| 原型 | `design/prototypes/files-preview/folder-index-badges/`（▲ 设计活跃，README 有玩法/差异/判据） |
| 镜像源 | `frontend/app/view/preview/preview-explorer.tsx`, `frontend/app/treeview/treeview.tsx` |
| 刷新通道候选 | `pkg/wshrpc/wshrpctypes.go:60-61` 已有 `ControllerResyncCommand` / `ControllerRedrawCommand` |

**三个功能点**

1. **索引状态表**：目录内 `index.md` 写明每个文件状态（🔄 会改版 / 🧊 冻结 / 🔒 只读 / 🗄 归档），树图标长徽标。
2. **用户自定义脚本**：`.index/badges.js` 导出 `decorate(entry)`，返回 `{ status }` 或 `{ emoji, label, color, title }`；合并策略 = 脚本 > 表格 > 无徽标。
3. **Agent 定向刷新 Block**：`refreshBlock(tab, block)` 让装饰缓存失效重算，agent 改完索引后用户立刻看到效果；watch 自动刷新为可选增强。

**D1-D5 拍板记录（2026-11-24，已按推荐项落地）****

| 编号 | 决策 | 我的推荐 |
|---|---|---|
| D1 | 索引物形态：`index.md` 表格 / `.index/` 多文件 | `index.md` 表格 |
| D2 | 徽标画法：前缀 emoji / 角标叠加 / 只改颜色 | 前缀 emoji |
| D3 | 「只读」徽标：🔒 / 📁 | 🔒（📁 与文件夹图标撞形） |
| D4 | 脚本形态与执行：独立 `badges.js` + worker / index.md 内嵌 | 独立文件 + sandbox worker |
| D5 | 刷新通道：新增 `refreshBlock` RPC / 复用 Resync / **复用 setmeta 事件链**（实际落地） | `preview:idxrefresh` meta + 既有 SetMetaCommand 链，零 Go 改动 |

**已交付（2026-11-24）**

- 包 `N-1124-folder-index-badges-3`（前两包因判据 bash 语法在 cmd.exe 必红丢弃重建，教训已登记）：G1-G5 清，prove **4/4 绿**
  （folder-index 15 断言 / refresh 6 断言 / treeview-badge 3 断言 / eslint 0 error）；tsc 58 = 基线不变、新文件 0 错。
- 纯前端实现，零 Go 改动；改动 = `frontend/app/view/preview/folder-index/`（5 新文件）+ `preview-explorer.tsx` + `treeview.tsx`。

**2026-11-24 追加：agent 入口 + 装饰协议 v2 已交付**

| 包 | commit | 证据 | 状态 |
|---|---|---|---|
| `N-1124-idxbadges-agent-surface` | `7d5b9dfe` | prove 4/4（wsh block refresh 子命令 + agent guide 条目） | G1-G5 清，G7 待 nita |
| `N-1124-idxbadges-decoration-protocol` | 本次 | prove 4/4（folder-index 23 断言 + render 3 + eslint） | G1-G5 清，G7 待 nita |

- `wsh block refresh [<block|this>]`：agent 改完 index.md / badges.js 后一条命令让树重生（写 `preview:idxrefresh`，零新 RPC）。
- `wsh agent guide` 已含该条目 → `wsh agent install-skill` 自动同步，**不需要新建 skill**。
- 装饰词表 v2：`emoji/color/title/note` + `icon/iconColor/labelColor/hidden/order` + 自定义状态注册表；脚本上下文 BFS 全树（≤3 层/≤50 目录/≤1500 项）。
- 文档：`docs/project/folder-index-badges.md`（含自定义状态与词表示例）。

**G7 真机验收步骤（nita 手动，约 2 分钟）**

1. 起一个 Files block（某目录），右键树空白处 → 「开启索引徽标（实验）」→ 树暂无变化（目录没索引，正常）。
2. 目录里放 `index.md`（表格见 docs/project/folder-index-badges.md）→ 右键空白 → 树刷新或点开关两下 → 应见 🔄🧊🔒🗄 徽标。
3. 关掉开关 → 徽标全消失（零变化）。
4. （可选）`wsh setmeta -b <blockid> preview:idxrefresh=<ms>` → 不动树也应重算出新徽标。

**隔离四道**：开关默认关（关时零 IO）/ 任一数据源失败返回空 Map（无徽标不报错）/ 纯前端读文件（不改 `FileInfo` 与后端 RPC）/ 脚本 worker 限时执行（单条失败只跳过该条）。

## 2026-11-23（晚·新批次）：Hero 定时执行 + Overview 拖拽 + 定时任务弹窗 + Hero 折叠栏图标（已拍板，待开工）

> nita 2026-11-23 15:11-15:12 布置 4 条，**方案已确认**（2026-11-23 晚，采用推荐项）：
> Hero 定时走「方案 A：复用现有 ScheduledTask 系统 + 加 `hero` 字段」，默认 `mode=block`，
> 看板用「独立定时任务展示区」（不挂在 hero 卡上）。
> 开工前先走 loop 门链建工作项（新交互面 → 需要 H 门白天签，夜间只做已批部分）。

### 现状锚点（不要重复造轮子）

| 组件 | 位置 |
|---|---|
| 调度/补跑/cron | `pkg/scheduler/`（`scheduler.go` InProcess、`catchup.go` 启动补跑、`schedulespec.go` CLI/MCP 口径） |
| 任务模型 | `pkg/wconfig/settingsconfig.go:176` `ScheduledTaskType`（已有 agentProfile/model/prompt/workdir/**mode(headless\|block)**/tab/schedule） |
| 落块执行 | `pkg/wshrpc/wshserver/scheduledtask.go` `launchBlockForTask`（`AgentLaunchRequest` **目前不传 hero meta**） |
| Hero 登场语义 | `frontend/app/workspace/hero-launch.ts`（cwd=hero home + block meta `hero`/`hero:name`，后端需镜像这部分） |
| 任务编辑弹窗 | `frontend/app/modals/scheduledtaskeditormodal.tsx`（已在 `modalregistry.tsx` 注册） |
| 任务 Block 视图 | `frontend/app/view/scheduledtasks/*`（本次要弹窗化） |
| Overview 卡片=块 | `frontend/app/session-overview/overview-board.tsx`，Tab 分组 `overview-tab-groups.ts` |
| Hero 分组折叠栏 | `frontend/app/view/aisessions/session-group.tsx:100`（组头固定画 `fa-folder`；`heroId` 字段已有，见 `utils.ts:groupSessionsByProject`） |

### 1. Hero 定时执行（方案 A）

- `ScheduledTaskType` 加可选 `hero`（hero id）。选了 hero 的任务：
  `workdir` 默认 `<hero root>/<id>`；provider/model 默认取 `hero.json`（任务可覆盖）；
  `mode=block` 建块时注入 `hero` / `hero:name` meta（后端镜像 `buildHeroLaunchBlockDef`），headless 模式同样 cwd=hero home。
- 调度、启动补跑、配额（agent 10 个）、CLI/MCP 全部复用，不新建调度器。
- **Overview 独立「定时任务」区**：hero emoji + 任务名 + 下次运行时间 + 上次状态 + 启停开关；点击打开编辑弹窗。
- 判据：
  1. `go test ./pkg/scheduler/... ./pkg/wshrpc/wshserver/...` 全绿；新增单测 ≥ **10 断言**（hero 字段读取/覆盖优先级/meta 注入）。
  2. 任务带 hero + `mode=block` 到点运行后：新建块 meta 含 `hero=<id>` 且 `hero:name` 非空，`cmd:cwd` = hero home。
  3. `mode=headless` + hero：日志目录 `~/.snorkeling/scheduledtask-runs/` 新增 **1** 个文件，进程 cwd 记录为 hero home。
  4. Overview 定时任务区：有 N 个 enabled 任务时渲染 **N** 张卡；禁用任务仍列出但状态置灰（数量不变）。
  5. 下次运行时间文案与 `GetNextRunTime` 一致（同一 task 前后端取值差 < **1s**）。

### 2. Overview：Agent Card 跨 Tab 拖拽

- 卡片=block 投影，拖到目标 Tab 组（含折叠组头）松手 = `MoveBlock(blockId, tabId)`。
- 判据：
  1. 拖 A→B：`tab(B).blockids` 含该 block 且 **+1**、`tab(A).blockids` **-1**，块数守恒。
  2. 拖到当前所在 Tab 或空白处：**0** 次 RPC 调用（无变更）。
  3. 折叠组头 drop 热区可命中：DOM 断言 `data-drop-target` 存在且拖放后组计数 **+1**。
  4. 单元测试 `overview-board-drag*.test.ts` ≥ **12 断言**全绿。

### 3. 定时任务弹窗化（对齐 CommonText）

- 把 `scheduledtasks` Block 视图的管理面（列表 + 新建 + 编辑）整体搬进一个 CommonText 式弹窗；入口换成工具栏按钮/命令，不再靠建块。
- 判据：
  1. 打开弹窗后 `atoms.modalOpen === true`（走 `modal-open-registry` 登记来源），关闭后恢复。
  2. 与 CommonText compose 同款 chrome（同一 `Modal` 组件 + 标题/关闭/快捷键），无页面跳转、无新建块。
  3. 增删改后列表数即时 **±1**（不刷新整块）。
  4. i18n：zh/en 两套 key 全齐，`npm run check:i18n`（或等价）**0 miss**。

### 4. Hero 折叠栏只留 emoji icon

- `session-group.tsx` 组头：`group.heroId != null` 时不渲染 `fa-folder`/`fa-folder-open`，只显示 emoji（hero 自身 emoji，回落 🎭）+ 名称。普通项目组**不变**。
- 判据：
  1. hero 组头 DOM：`fa-folder`/`fa-folder-open` 节点数 = **0**，emoji 字符节点数 = **1**。
  2. 普通项目组：icon 仍为 `fa-folder(-open)`，数量 **1**（不回归）。
  3. 未归类组（`fa-inbox`）不受影响。
  4. 单测 `session-group*.test.tsx` +2 用例全绿。

## 2026-11-23（晚）：晚间开发清单（nita 布置：优先卡片融合，其余在案）

> 原型已出：`design/prototypes/overview-dashboard/session-card-unify/`（▲ 设计活跃，README 有实现口径与三步里程碑）。
> **前置**：`overview-refresh` 的 5 步人工复现结果（nita 未回报前不动工）。
>
> 已移出（2026-11-23 nita：先去掉这个事项）：~~看板卡恢复+composer~~ —— 代码在 `b5f08dc7c`，
> 恢复热区判定冗余（卡=块投影，恢复无对象），孤卡恢复随 `session-card-unify` 重新设计；✈ 发消息保留。

| # | 事项 | 状态 | 下一步 |
|---|---|---|---|
| 5 | **列表卡与看板卡融合（优先）** | 原型成稿（2026-11-23） | 前置满足后：三步里程碑①抽组件+看板切换②列表切换③删旧分支；判据 = 像素回归 79/79 + overview-ux 15/15 |
| 3 | Overview/悬浮卡不刷新（三症状） | 等 nita 的 5 步复现结果 | 按结果矩阵定性 → 修订阅/过滤/建块链路之一 |
| 6 | 手工粘贴吞回车提示（可选） | 未动工 | 最后再说 |

## 2026-11-23：会话面 5 个未闭环问题（已登记，按优先级排好）

> 父任务：`.trellis/tasks/11-23-session-surface-fixes-1123/prd.md`（含证据锚点与两条待拍板决策）
> **实现前先读它**；每个子包自带 prd（序 1 还有 implement.md，可直接开工）。

| 序 | 子包 | 问题 | 规模 | 状态 |
|---|---|---|---|---|
| 1 | `11-23-commontext-create-send` | CommonText「新建 agent 并发送」文本发了没出去（静默丢消息） | S | prd+implement 就绪，待开工 |
| 2+3 | `11-23-overview-refresh-1123` | 恢复的会话在 Overview 没卡 / Tab 新增 agent 在 Overview 看不到 / 激活 Tab 悬浮卡不刷新（疑同根） | S | 需先跑复现台定性 |
| 4 | `11-23-board-card-actions` | 看板卡补「恢复 agent」+ composer 浮层 | M | 等 D1/D2 拍板 |
| 5 | `11-23-session-card-unify` | 列表卡与看板卡融合成单一 SessionCard | M-L | 依赖序 4 |
| 6 | `11-23-manual-paste-submit-guard` | 手工粘贴+回车被 pi 启动期吞掉的提示（可选） | S | 最低优先级 |

**已核实的两个关键结论（别重复劳动）**

1. 运行实例 = **0.0.136**；`logs/waveapp.69.log` 是旧实例的轮转文件，当日实时日志在
   `Data/waveapp.log`（`[wavesrv] [agentstatus]` 有，`[agentsend]` 为 0 = 当天没走发送链路）。
2. CommonText 两条路：existing → `AgentSendCommand`（有提交确认）；**create → 前端
   `registerPendingInput` + `term.tsx` paste + 固定延迟回车（无确认无补发）**，这就是丢消息的根因。

**优先级硬理由**：序 1 是唯一"成功假象"型 bug（UI 说已发、对方收不到）；序 2+3 三症状共享一个
"块集合变化未订阅"假设，拆开做等于同一个东西查三遍，且它是序 5 的前置。



> 上一个会话在这里停下。最新发布 **`0.0.121`**（今晚连续发了 `0.0.119 / 0.0.120 / 0.0.121`）。
> 本文件只有一页；细节在下面指向的任务文档里。
> **夜间无人值守开发的逐段记录在 `docs/project/night-run.md`**（计划 / 约束 / 看板 / 已知红灯），
> 接手先看那一页，再看本页。

## 2026-11-20（下午）：Overview 看板点 agent 卡「点不开」根因查清 + 建包（未改代码，晚上做）

- **主因已复现**：`overview-board.tsx` `openCardFromTarget` 的 `event.target !== event.currentTarget` 卫语句
  （b35075532 / 11-08 引入，为挡动作按钮冒泡而加，但按钮已各自 stopPropagation）。卡片内部全是子 span，
  点标题/头像/预览/Note/tags/属性/度量时 target ≠ currentTarget → 两层 onClick 全 return，**只有卡片裸内边距
  能开弹窗**。jsdom 实测：标题/预览/头像 onOpenCard 0 次，内边距 1 次。
- **卡顿两个放大器（11-10 修复轮漏网，另拆包）**：① `columns`/`columnKeys` 未 memo → 每次渲染重跑
  `captureBoardSnapshot`（querySelectorAll + 每卡 getAnimations + getBoundingClientRect）+ ResizeObserver 重建，
  点击必触发的那次面板重渲（markBlockViewed）正好压在弹窗入场帧；② 15s summary 轮询 + 30s now tick 让
  `boardCards`/`miniTimelines` 全量换引用 → 整板全量重渲（BoardCard memo 挡不住）。
- **方案（nita 已确认）**：整卡默认可点 + 热区白名单（button/a[href]/input/textarea/select/[contenteditable]/`[data-card-interactive]`）；
  emoji 头像改独立 `<button>` 接 `openAgentEmojiPicker`（需给 `OverviewBoardCard` 补 raw `provider`，providerLabel 是显示名不能用）；
  顺带修 Enter 在内部按钮上冒泡导致的双触发；文本选区未折叠时点击不开。
- **任务**：`11-20-overview-board-card-click-hotzones`（PRD-only，已 create+start）。
  记录：`.trellis/tasks/11-20-overview-board-card-click-hotzones/notes-20261120.md`（末节有今晚开发步骤）。
  可视化：`docs/answers/overview-board-card-click-diagnosis-20261120.html` / `...-plan-20261120.html`（交互矩阵即验收判据）。
- **未提交**：本次只落文档（任务目录 / journal / 两个 answer 页），工作区还有别的 agent 在途改动，晚上开发时一并提交。

## 2026-11-20：属性 status 类型彻底退役 + 改类型/值列表浮层点击即关修复（已完成，真机验证用户豁免）

- **细节全文**：`.trellis/tasks/11-20-property-status-to-select/{prd,design,implement}.md`（implement 末节有全部绿证）。
- **status 退役**：后端白名单/校验/add-options/jsonschema 只认 select；`NormalizePropertyType` 做唯一写边界归一
  （`agentdata.ApplyPatch` / `Manager.SetProps` / AI 提案）；sqlite `ai_session_props.prop_type` 与 settings
  `agent:propertyschema[].type` 一次性迁移 status→select（哨兵 + VACUUM INTO 备份）。
  live sqlite 已迁移（status 行 0，备份 `index-v2.sqlite.backup-before-prop-status-20261120-103652` 3.05GB）；
  live settings 那 1 条 status 会在下次重启新构建时由 `wconfig.MigrateAgentPropertySchemaStatus()` 改写。
- **交互修复**：改类型原生 `<select>` → `PropertyValuePopover` 点击式类型菜单（不再 blur 卸载）；
  共享 `PropertyTagEditor` 删除容器 onBlur 关门 + 列表空白 mousedown preventDefault（只认 Esc/外部点击/单选提交）。
- **判据**：go 4 包全 ok（用 `-p 1`；并行编译会撞本机 commit 上限）；vitest 154/154（新增 13 条）；
  eslint 0 error；tsc 白名单 0 新增；i18n parity exit 0（全仓 CJK scan 有 5 条既有红，非本包）。
- **真机验证 skipped（用户明确本机性能不够）**：`scripts/verify/property-editor/verify.mjs` 已备
  `agent-retype-menu-*` 5 条断言 + R7 误关闭回归单测；台账已记 3 次 fatal(未跑) + skip 结论。

## 2026-11-19（下班前）：闪退根因查清 = 整机 commit 耗尽 + git fsmonitor 常驻泄漏（纯调查，未改代码）

> 用户报「闪退时提示 PowerShell 未处理异常」，此前怀疑内存。**内存判断是对的**。

- **PS 弹窗不是凶手**：`powershell.exe` 崩的是 `System.OutOfMemoryException`。同一分钟（11-19 11:12）
  dwm.exe APPCRASH + wavesrv `fatal error: out of memory`（errno=1455 = ERROR_COMMITMENT_LIMIT）。
  旧版 emain 在 wavesrv exit 就 `app.quit()`，弹窗正好压在整窗消失那一瞬，所以看起来像「PS 异常导致闪退」。
- **账本**：物理 14.8GB + pagefile 11.5GB = 提交上限 26.4GB，实测已用 24.9GB（94%）。
  ⚠️ PRD 称 pagefile 已人工调 16/24GB、上限 38.8GB，实测只有 26.4GB，需复查。
- **新发现 2.85GB 纯泄漏**：67 个 `git fsmonitor--daemon` 常驻（每个 36-80MB，无空闲超时，一仓一只）。
  根因：系统级 `core.fsmonitor=true`（`D:/SoftWare/Git/etc/gitconfig`）+ 任何刷索引的 git 命令首跑即拉 daemon
  + `pkg/wshrpc/wshremote/vcs.go detectRepoRoots`（`MaxVcsRepos=64`/`scanDepth=3`）逐仓跑 `git status` 把几十仓 daemon 一次全拉起。
- **全文**（含时间线、证据、复现命令、今晚待办）：`.trellis/tasks/11-19-wavesrv-oom-flash-quit/findings-fsmonitor-leak-20261119.md`
  可视化页：`docs/answers/crash-powershell-oom-20261119-1532.html`
- **今晚第一步**：按 command line 过滤 PID 清掉 67 个 fsmonitor daemon（回收 ~2.9GB）；再定系统级关 `core.fsmonitor`
  还是产品侧 `newVcsCommand` 统一加 `-c core.fsmonitor=false`（同处已有 `core.quotePath=false`，改一行全量生效）。

## 2026-11-19（晚）：`agent card set --prop-add-option`（写值同时追加候选项）— 代码+测试完成，真机待验

- **细节全文**：`docs/project/agent-card-prop-add-option.md`（含验收清单与今晚待做）。
- **要解决的问题**：`--prop-scope agent` 走 `upsertSchemaDef` 只改 key/name/type/scope、Options 保持不变，
  新值进不了下拉候选；加候选只能整条重写 `agent:propertyschema`（易丢其它属性、无 dry-run）。
- **落地**：`--prop-add-option key=v1,v2`（可重复、逗号分隔、幂等、保序、大小写不敏感去重、绝不删已有）。
  合并实现单点 `pkg/agentdata/patch.go:MergePropertyOptions`；schema 写入 `card_schema.go:appendSchemaOptions/upsertSchemaDef`
  （无新增时返回原 slice → settings 字节级不变）；dry-run 由 `propOptionPreview` 现算 `prop:<key>.options` diff。
  两条 CLI 不变量：scope 必须 agent/all（否则 E_USAGE）、key 必须同时出现在 `--prop`。
- **判据**：`go test ./pkg/agentdata ./pkg/agentcontrol ./cmd/wsh/cmd` 全绿；`go build ./...` 通过；
  e2e `TestAgentCardEndToEndAppendsPropOptions` 覆盖 dry-run→真写→读回→重复执行不重复。
- **未提交**；工作区还有其他 agent 在途改动，提交时只带本包 10 个文件（清单见文档 §6）。
- **今晚第一件事**：重启 app/wavesrv 后按文档 §7 走真机验收（新 CLI 打旧 server 时 `addoptions` 会被静默丢弃，
  所以本轮只验证到进程内链路）。
- **顺手发现（未改）**：`patchDomains` 不给纯 props 补丁打 SQLite backup（title/prop 都不在列），属既有缺口，
  归 `11-09-agentdata-backup-granularity`，勿顺手改。

## 2026-11-19：Tab 切换卡顿调查 + reinitWave 减负（child1 已提交）

- **用户反馈**：页面加载时影响切 Tab、有时切换卡断。只读调查定位两个叠加原因：
  冷切换时主进程动作队列等 wave-ready（`emain/emain-window.ts:524-547`）；
  温切换每次重跑 `reinitWave()` 的 5 次串行 RPC + N 次 tab reload（`frontend/wave.ts:175`）。
- **任务树**：父 `11-19-tab-switch-perf`（planning 汇总）；child1 `11-19-reinitwave-relief`
  已提交 `f61ad7c29`；child2 `11-19-tab-switch-queue-decouple`（planning，默认开关关，未 start）。
- **child1 落地**：纯函数 `frontend/app/wave/reinit-wave-plan.ts` 把 reload 按依赖分 2 批并行，
  tabids 未变时跳过 N 次 reload；7 项正确性副作用全保留。回滚开关 `REINITWAVE_RELIEF_ENABLED=false`。
  13 单测绿 / 白名单 tsc 0 error / eslint 0 error；未跑真机（用户豁免本机性能差）。
- **效果边界**：child1 改善温切换；冷切换「页面加载卡断」主因在队列（child2），未触及。
  收益未量化——reinitWave 无分解计时日志，主进程 27-42ms 日志不含它（走 renderer WSH 通道）。
- **下一步**：先补执行器级 mock 测试拿「RPC 次数下降」的机器证据；
  再评估是否解锁 child2（6 项竞态，需真机 A/B 数据）。
- **文档**：根因 `docs/answers/tab-switch-perf-20261119-131307.html`，
  风险 `docs/answers/tab-switch-risk-20261119-131626.html`，
  下一步建议 `docs/answers/next-step-recommendation-*.html`，
  效果评估 `docs/answers/child1-effect-assessment-*.html`。

## 新增：昼夜循环工作流（`loop/`）

开发流程已改为「白天决策/验收/原型 + 夜里 agent 执行/发版」，规则与台账在仓库根 `loop/`：

- 开工前读 **`loop/RUNBOOK.md`**（3 分钟）：8 类任务 × 7 道门、证据阶梯、夜班三条铁律、发版 gate
- 队列状态：`node loop/queue.mjs list` / `derive --json`（看板从这里取）
- 事件流：`node loop/ledger.mjs tail -20` / `blocked`（晨会第一屏）
- 契约（改 `loop/**` 前必读）：`.trellis/spec/guides/day-night-loop-contract.md`
- 任务：`.trellis/tasks/11-05-day-night-loop/`（prd 已签 G1，design/implement 已落）
- 看板：`node E:/primary/projects/loop/board/scripts/start.mjs` → `http://127.0.0.1:7799`（只读/读写由 `LB_MODE` 决定；引擎与看板同仓）
- 第一个真实工作项：`N-1105-tab-hover-clip`（Tab 悬浮卡被截断）已走完 G2→prove→commit，停在 G7 等人验收

一句话边界：`.trellis/` 管「任务是什么/怎么做」，`loop/` 管「哪班跑到哪、算不算过」。

## 2026-11-06 深夜：Agent 卡片统一（chip 收口 + 跑时 + 标题编辑）

任务 `.trellis/tasks/11-06-agent-card-chip-title/`，提交 `1ee8db4b` + `b8550fc2`。

- **状态 chip 从 4 份实现收口成 1 份**：纯函数 `agent-status-chip-view.ts` 出 label/runtime/title/className，
  `AgentStatusChip` 按 `variant`（list/board/card/header/aggregate）只切几何与装饰；
  悬浮卡、看板、列表、Tab 聚合、Block 头部全部改读同一份。
- **运行时长**：`7s` / `3min21s` / `1h12min` / `2d3h`（不用 `00:07` 那种计时器样式）。
  1s 单例 tick **只有 chip 订阅**，面板 30s `useNow` 不动（那是性能红线）。
- **标题可编辑**：悬浮卡单击、放大弹窗双击；`renameTitle` → `service.Title` → note-cache 广播。
  改名成功后 ack `title-edit`，避免 `SetTitle` bump `UpdatedAt` 把 idle 会话误点亮成 Done。
- 判据：`agent-status` 260 · `view/term` 196 · `store` 100 · `info-card` 53 · `session-overview` 140 · `modals` 39。
- **已知红灯**：真机台 `agent-card-seen` 25/26 —— `title-edit-in-dialog` 红，因为悬浮卡的放大按钮
  在真实指针下被 xterm 的 link-layer canvas 盖住（JS `click()` 正常）。属 `info-card` 层级/命中问题
  （与 `11-06-tab-hover-clip` 同源），需另开包。

## 现状一句话

主分支 `main` 上 4 个功能的代码都在，工作区干净。`11-04-ui-delivery-batch` 这一批**已全部交付**，
没有半成品待收尾。

| # | 功能 | 代码 | 发版 |
|---|---|---|---|
| 1 | 预览编辑验证台（`scripts/verify/preview-edit/`） | ✅ | `0.0.115` ✅ |
| 2 | 图片预览翻页（`image-pager*.ts(x)`） | ✅ | `0.0.116` ✅ |
| 3 | Overview 看板（`overview-board*`） | ✅ 看板 v2：卡片信息架构 + 5 列常显 + 横向 snap + 列表/看板/时间线三视图 + 状态/Tab/Provider 三分组 | `0.0.117` → v2 已在 `0.0.119` ✅ |
| 5 | Overview 时间线（Gantt · G1 会话寿命条，`overview-timeline*`） | ✅ 真机 22/22 | `0.0.119` ✅ |
| 4 | Files 目录树 VCS 标记（`vcs-tree-status*`） | ✅ 真机 31/31 | `0.0.118` ✅ |

## 最近这一轮做了什么（功能 4 收尾）

三条审核建议全部落地，详见 `.trellis/tasks/11-04-files-vcs-tree-status/implement.md`：

1. `frontend/app/view/preview/vcs-tree-status.ts` — 新增「情形 C」中间层符号链接拼写对齐
   （macOS iCloud「桌面与文稿」；子序列 + 首尾双锚定，同级无关目录不会产假标记）
2. `frontend/app/view/vcs/vcs.tsx` — commit / sync 成功后调 `clearVcsTreeStatusCache(connection)`
3. `frontend/app/treeview/treeview.tsx` — 新增可选 `getLabelTitle`，行名带上 VCS title（读屏可达性）

## 2026-11-05 夜间批次（已发 `0.0.119 / 0.0.120 / 0.0.121`）

一、**Overview 看板 v2 + 时间线 G1**
- 卡片信息架构（emoji 头像 / 会话标题链 / 共享 `AgentStatusChip` / note 行）、5 列常显 + 横向 snap、
  三视图切换 + 三分组；时间线 = 会话寿命条（当前状态色尾巴 + 斜纹历史段 + 2h/8h/24h/7d + 40 行上限汇总）

二、**验证不再依赖人眼**
- `overview-timeline` 长条形态改为机器判定（播种真实 `createdAt/updatedAt`，断言条宽 0.563 / 斜纹 / 尾巴）
- `preview-edit` 修掉"clip 截图静默返回空片"→ 假红/假绿（新增文本区墨迹为 0 → 整窗重拍）
- `npm test` 从「12 files failed / exit 1」变 **227 files / 2532 tests passed / exit 0**
- 新增 tsc 类型债闸门 `scripts/check-tsc-baseline.mjs`（**69 → 47**）
- 台账 bug：`fatal()` 曾被记成 `✅ 0/0`（环境错误显示为通过）→ 现在一律 `❌ fatal（未跑）`
- 验证台默认档位支持 `VERIFY_PROFILE` / `VERIFY_VITE_PORT` / `VERIFY_CDP_PORT` 环境变量（并行跑台子不用改代码）

三、**修掉的真 bug**（都有回归锁）
- 三级菜单 hover 必崩（`ReferenceError: hoverHandlers`）· 预览「用系统应用打开」必崩（未导入 `getApi`）
- 消息弹窗「删除块」必崩（没有接 `onDeleteBlock`）· 预览「在树里定位」静默失效（用了 `Block.id` 应为 `oid`）
- HTML 打开模式丢失目录根（菜单选项被当预览选项）· 导出 HTML 目录全是死链（缺 `rehype-slug`）
- 导出 `bodyOnly` 是空操作 / `<title>` 恒为空 · 导出产物里混进预览专用「加 emoji」按钮

四、**已知红灯（都不是产品坏了，属各自 in_progress 任务）**
- `image-pager` ✅ 32/32（已修断言时机）
- `agent-card-seen` ❌ 起不来：全新 profile 下 New Agent 面板未展开（`11-05-agent-card-seen`）

## 环境自检（新机器先跑）

```bash
npm run setup                                              # 本地固定工具链（约 5-10 分钟）
npx vitest run frontend/app/view/preview/vcs-tree-status.test.ts frontend/app/treeview/   # 期望 49 passed
npx tsc --noEmit -p tsconfig.json | grep -c "error TS"      # 期望 69（这是既有基线，不是 0）
```

真机 UI 验证（UI 改动都必须过）：

```bash
node scripts/verify/preview-edit/run.mjs --keep-open --expect=fixed   # 起隔离 Electron 实例（validate 环境用）
node scripts/verify/vcs-tree-status/verify.mjs --attach               # 期望 31/31
node scripts/verify/image-pager/verify.mjs --attach                   # 期望 30/30
node scripts/verify/overview-board/verify.mjs --attach                # 期望 38/38
node scripts/verify/overview-timeline/verify.mjs                        # 期望 22/22（时间线，含长条宽度判定）
node scripts/verify/preview-edit/run.mjs --expect=fixed                 # 期望 5/5
node scripts/verify/image-pager/verify.mjs                              # 期望 32/32
npx vitest run                                                          # 期望 227 files / 2532 passed
node scripts/check-tsc-baseline.mjs                                     # 期望等于基线（当前 47）
node --test "scripts/**/*.test.mjs" "tests/**/*.test.mjs"               # 期望 23 passed
```

> ⚠️ **Windows 上跑 vcs-tree-status 必须指定带盘符的 fixture**：
> `VCS_FIXTURE=E:/tmp/vcs-fixture node scripts/verify/vcs-tree-status/verify.mjs`
> （`/tmp` 只有盘符相对语义，git rootpath 带盘符后拼写对不上 → rows=0 或标记全空。
> 现象与修法已写进 `.trellis/spec/snorkeling-docs/frontend/preview-edit-harness.md`）
>
> 注意：`tsc` 基线 69 个错误是**既有存量**，任何新改动只要不让这个数字变大即可。
> `frontend/app/view/preview/` 有 34 个存量失败用例（`preview-directory-utils.test.ts` / `plugins/*`），
> 与这批功能无关。

## 发版

按 `.agents/skills/snorkeling-release/SKILL.md` 走（bump → 查远端号未占 → commit → push → annotated tag →
push tag → GitHub Actions 三平台构建 + 自动创建 Release）。当前版本号
`0.14.6-beta.0.snorkeling.0.0.118`，下一个是 `0.0.119`。

## 上下文备份

- 四个功能的设计/验收：`.trellis/tasks/11-04-*/{prd,design,implement}.md`
- 验证台规则语义与踩过的坑：`.trellis/spec/snorkeling-docs/frontend/preview-edit-harness.md`
- 上一会话流水：`.trellis/workspace/nita/journal-1.md`
- 原型（VCS 标记四方案对比）：`design/prototypes/files-vcs-tree-status/README.md`

## 已知遗留（不阻塞，别当 bug 修）

- **D（deleted）标记现实中不可见**：被删文件已不在目录列表里，D 只体现在上级目录计数。
- 噪音目录（node_modules/.git/dist/build/target/.venv/out/coverage）被跳过。
- `resolveResolvedBaseDir` 的情形 A 对「叶子名相同的同级目录」仍可能误映射（既有行为，未在本轮收紧）。

## 回滚开关（出问题先关功能，不用 revert）

| 功能 | 开关 |
|---|---|
| Files VCS 标记 | `frontend/app/view/preview/vcs-tree-status.ts` → `FILES_VCS_TREE_STATUS_ENABLED = false` |
| Overview 看板 | `frontend/app/session-overview/overview-board-model.ts` → `OVERVIEW_BOARD_ENABLED = false` |
| 图片翻页 | `frontend/app/view/preview/image-pager.tsx` → `IMAGE_PAGER_ENABLED = false` |
