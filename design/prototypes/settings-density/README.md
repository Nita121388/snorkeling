# Settings 去密化 — waveconfig 设置界面重排原型

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/view/waveconfig/waveconfig.tsx, frontend/app/view/waveconfig/waveconfig-model.ts, frontend/app/view/waveconfig/agentnotifysettings.tsx, frontend/app/view/waveconfig/syncsettings.tsx, frontend/app/view/waveconfig/agentaccesssettings.tsx, frontend/app/element/toggle.scss
> 最后同步：2026-11-10
> 对应方案：`My Projects/Snorkling/方案/UI布局与Block/设置界面去密化-头脑风暴.md`（Obsidian）

## 需求

用户的反馈原话：「设置界面希望进行优化 现在文字太密集了」，并要求参考成熟 UI 组件库
（`https://uiarc.dev/components/card-stack`、HeroUI 等）。

问题不是「字太大」，而是：

1. **General（settings.json）根本没有界面** —— 第一屏是 30+ 行 JSON 代码墙，是全应用最高频的设置面。
2. **共享行组件 `SectionRow` 没有节奏** —— `text-sm` 标题 + `text-xs` 灰描述双行、`divide-y` 全宽发丝线连排、
   `py-3`（实测行高 ~49px），读起来像表格而不是设置。
3. 左栏 11 条目无分组、无搜索，外观 / Agent / 云同步 / 高级混排。
4. 同一屏里三种保存心智（即时保存 / 草稿 + Save / 编辑器 + Save）。
5. 除 App Theme 外没有「设置会产生什么」的预览。

## 结构镜像对照

| 原型元素 | 镜像真实源 | 说明 |
|---|---|---|
| `.proto-strip` | — | **原型控制条，非产品 UI**：面板 / 提案-现状 / 主题切换 |
| `.wcfg-shell` + `.wcfg-sidebar` | `waveconfig.tsx` L26–105 `ConfigSidebar`（`flex flex-col w-48 border-r`） | 左栏宽度 192px → 原型 208px（分组后需要额外缩进） |
| `.wcfg-header` | `waveconfig.tsx` L190–245 | 标题 + docs 图标 + 路径 + Save；提案把标题改为 `h1` |
| `.wcfg-tabs`（Visual / Raw JSON） | `waveconfig.tsx` L247–282（`bg-highlightbg` 实心块） | 提案改为下划线 Tab（23 屏研究：0 个实心块 Tab） |
| `.wcfg-panel` | 各 `visualComponent`（`agentnotifysettings.tsx` / `syncsettings.tsx`） | 面板区 |
| `.set-group` / `h2.set-group-title` | **新增** | 组标题在组卡**外**上方（12px/500） |
| `.set-card` | **新增** | 组卡：`--surface-color` + 1px `--border-color` + radius 10 + padding 10/20 |
| `.set-row` | 替换 `SectionRow`（`agentnotifysettings.tsx` L68–92） | 行高 49 → 58px，标题 14/500，描述 12.5px，**组内无发丝线** |
| `.switch` | `element/toggle.scss` `.checkbox-toggle` | 32×20 / thumb 16，几何一致 |
| `.stepper` | **新增**（原为裸 `<input type="number">`） | 30 秒 / 13 px 这类数值设置 |
| `.radiocards` / `.rc` | **新增**（HeroUI RadioGroup card 变体） | 选择型设置卡片化：默认 Agent、Sync 传输方式 |
| `.radio-row` / `.radio-dot` | **新增**（Sync 冲突策略） | 整行可点的 radio 行，组内无线 |
| `.acc` | **新增**（HeroUI Accordion） | 高级项默认折叠（90+ 键、冲突策略、git 间隔） |
| `.saved-stamp` | **新增** | 即时保存的安静反馈，替代各面板手写的 "Saving..." |
| `.save-bar` | `syncsettings.tsx` header Save | 草稿型面板的唯一保存位置（面板底部右） |
| `.toast-preview` | **新增** | 「设置产生什么」预览：真会弹出的通知 |
| `.before-panel` / `.bw-*` | 现状复刻 | `divide-y` + `text-sm`/`text-xs` + `max-w-2xl`，用于对照 |

## 关键几何（before → after）

| 项 | 现状 | 提案 |
|---|---|---|
| 面板阅读列 | `max-w-2xl` = 672px | 700px（表单）/ 880–1200px（卡组） |
| 行高 | ~49px（`py-3`） | **58px**（`padding 15px` + 内容） |
| 标题 | 14px / 400 | **14px / 500** |
| 描述 | 12px，贴标题 2px | **12.5px / line-height 1.5**，距标题 3px |
| 行分隔 | 1px 全宽发丝线（`divide-y`） | **组内无线**，靠行高与 32px 组间距 |
| 控件与文字 | `gap-4`（16px）+ `pt-0.5` | `gap-20px`，控件与行垂直居中 |
| 组 | 无 | 组标题 + 组卡（radius 10，内含 1 组） |
| 选择型 | 原生 radio / 圆点 | **RadioCard**（2px accent 边 + `action-soft` 底 + 右上勾） |
| 状态 | 无 | 标题后 8px 徽标（`On` / `recommended`） |
| 保存 | 三种混用 | 每视图一种：即时保存 + 印章（默认）｜草稿 + 底部 Save（Sync） |
| 预览 | 仅 App Theme | 有产物就给（通知卡片、字体样本、token 路径） |

## 覆盖的三个面板

1. **Agent Notifications**（`agentnotifysettings.tsx`）——从「发丝线连排的 6 行开关」变成
   Master / When to notify / Pacing 三组卡 + 右侧通知预览；总开关关掉时其余行置灰、预览同步变成
   "Notifications off"。
2. **General**（当前为纯 Monaco JSON 编辑器）——新增 `Visual` 层：默认 Agent 的 RadioCard 组、
   Interface（字号 stepper ×2 + Block 序号开关）、Windows & tabs、Updates，底部
   `settings.json` 折叠卡 + `Edit all 100+ keys in Raw JSON →`；`Raw JSON` 保留为第二个 Tab。
3. **Sync**（`syncsettings.tsx`）——**按传输渐进展开**，核心路径只有 Transport → Backend → This device → Status → Save：
   - **Transport**：4 张 RadioCard（blocked 态永远可点——选不中就看不到后端字段，死锁）；
   - **Baseline 选择卡**：从活动传输切到另一个时出现，「This device wins / Remote wins / Cancel」，
     两套数据相遇必须明说哪边赢；
   - **Backend**：组标题与字段随所选传输切换（folder 路径+监视开关 / git remote+token+间隔 /
     server URL+token+推送模式+insecure），用户只看到所选方式的字段；
   - **Server status**（仅 Self-hosted service）：服务端版本与健康——**信号格图标**（对齐
     `connectionbutton.tsx` 的 signal-bars 语汇：4 格绿=强 / 2 格橙=降级 / 斜线=不可达 / 呼吸=检测中，
     tooltip 承载完整文案）+ `app 0.14.6 · protocol v1`、`214 items · rev 3187`、token accepted、
     realtime not supported；不可达态给 `offline` + 可复制 `wsh commontext-sync doctor --json`
     （数据源：真实代码 `/health` → `syncclient.Probe`，当前只有 CLI 能看到，落地时需加 RPC）；
   - **This device**：name + 只读 Device ID；
   - **Status**（live 徽标）：last sync、**Waiting to upload（pending 计数，后端
     `Status.Pending` 已有但现面板未渲染）**、未解决冲突数、Sync now；
   - **Advanced**（默认折叠）：Conflicts（3 选 1 radio 行）+ Scope（Common Text 锁定 + tombstones）+
     Maintenance（Re-sync / Reset，danger 色）；
   - **Off · local only**：极简视图——隐藏组标题、This device、Status、Advanced，
     只剩一行说明卡 + Save；
   底部唯一 Save 条（草稿模型明说）。
   交互验证：`node verify-runs/settings-density-sync/smoke.mjs`（headless Chrome + CDP，68 项断言
   + 9 张截图存于同目录）。

左栏改为 5 组（Appearance / Basics / Agents / Sync & cloud / Security）+ 搜索框。

## 为什么不用 card-stack

`uiarc.dev/components/card-stack` 是「一次决定牌堆顶上那张」的交互（拖拽 / 甩出 / 撤销），
适合 shortlist、review queue、onboarding pick。设置的语义是「随时看见当前值并修改」，
牌堆会把其它选项藏起来，且撤销与「改错再改回」的语义冲突。所以取的是同站更对症的三件：
**Radio cards / Expandable card / Segmented control**。

## 怎么打开

```bash
# 方式一：直接开文件（无需服务）
open design/prototypes/settings-density/index.html

# 方式二：本地服务（推荐，支持 hash 直链）
python3 -m http.server -d design/prototypes/settings-density 9455
# http://127.0.0.1:9455/index.html
```

Hash 直链（便于逐面验收 / 截图对比）：

```
#panel=notify&mode=after              通知面板 · 提案
#panel=notify&mode=before             通知面板 · 现状
#panel=general&mode=after             General · 提案（Visual）
#panel=general&mode=before            General · 现状（JSON 墙）
#panel=sync&mode=after                Sync · 提案
#panel=sync&mode=before               Sync · 现状
#panel=notify&mode=after&theme=dark   深色主题
```

## 现状证据

`before/*.jpg` 是 2026-11-10 从运行中的 Electron 实例（CDP 9222 注入打开 waveconfig）实拍，
不是手绘：

| 文件 | 内容 |
|---|---|
| `before-General-raw-json.jpg` | General = 纯 JSON 编辑器 |
| `before-Agent-Notifications.jpg` | 发丝线连排 6 行的开关面板 |
| `before-Sync.jpg` | 单行塞 radio + 标题 + 长描述 + 徽标 |
| `before-Agent-Access.jpg` | token 表单 + 小字描述 |
| `before-Wave-AI-Modes.jpg` | 左列表 + 右表单全小字 |

## 度量

用 `design-taste-frontend` 技能的 app-screen 检查器实测（1440 / 768 / 390）：

```bash
node ~/.pi/agent/skills/design-taste-frontend/scripts/inspect.mjs \
  http://127.0.0.1:9455/index.html --app --allow palette-cream
# → 0 FAIL, 0 WARN
```

`--allow palette-cream` 是**有意保留**：`#f2eee5` 是 `frontend/app/theme.scss` 里 light 主题的真实
`--main-bg-color`，属既有品牌 token，不按「随机奶油底」处理。

## 落地路线（需另开 Trellis 任务）

1. **P1 共享件**：`SettingRow` / `SettingCard` / `SettingGroup` / `SettingsSection` + 排版 token
   （`--set-*` 一组数字），先把 `agentnotifysettings.tsx` 的 `SectionRow` 换掉，再迁 `syncsettings` / `agentaccess`。
2. **P2 General 可视化**：新增 `generalsettings.tsx` 作为 `settings.json` 的 `visualComponent`，
   覆盖 `agent:defaultprofile` / `term:fontsize` / `markdown:fontsize` / `app:showoverlayblocknums` /
   `tab:confirmclose` / `app:confirmquit` / `autoupdate:enabled` 等高频键，Raw JSON 保留 Tab。
3. **P3 左栏**：`ConfigFile` 加 `group` 字段，`ConfigSidebar` 按组渲染小标题 + 搜索框（过滤条目名与键名）。
4. **P4 保存印章**：统一 `saveStamp` 状态机，替换各面板手写 "Saving..."。
5. **P5 Sync 补齐**（本次原型新增）：
   - `syncmanager.Status` 已有 `pending` 字段但 `syncsettings.tsx` 未渲染 —— 补「Waiting to upload」行；
   - `ServerTransport.Probe()` 已实现但无 RPC 暴露、面板不可见 —— 加 `CommonTextService.SyncProbe` RPC +
     Server status 卡（版本 / 条目 rev / 鉴权 / 能力，不可达时给 `wsh commontext-sync doctor --json`）。
6. 每个 P 都要走真机验证台（`scripts/verify/`）与台账，按仓库 `AGENTS.md` 的收尾规则。

## 目录文件

| 文件 | 作用 |
|---|---|
| `index.html` | 单页原型：外壳 + 三个面板 + 提案/现状双视图 |
| `style.css` | 真实主题 token（`theme.scss` 的 light/dark）+ 提案排版 token（`--set-*`） |
| `script.js` | 面板切换、提案/现状、主题、开关、stepper、RadioCard、折叠、搜索、草稿保存、hash 路由 |
| `before/*.jpg` | 改造前真机截图（证据） |
| `README.md` | 本文件 |
