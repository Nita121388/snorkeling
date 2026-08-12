# Env Launch Entry — New Agent / New Terminal 弹窗内自定义环境变量原型

> 同步状态：◐ 部分落地（阶段 2/3 已进真实代码，阶段 4 未做）
> 镜像源：frontend/app/workspace/widgets.tsx, frontend/app/view/term/envmodal.tsx, frontend/app/view/term/envmodal.scss, frontend/app/workspace/agent-launch.ts
> 最后同步：2026-08-08
> 对应方案：`My Projects/Snorkling/方案/主题/Terminal与Agent运行前自定义环境变量-设计方案.md`
> 背景：Codex CLI 浅色主题下输入框深色看不清（见 `Codex CLI浅色主题输入框深色看不清-外部Agent已知问题.md`），需在运行 Terminal/Agent 前注入 `COLORTERM/TERM` 等环境变量。

## 落地状态（2026-08-08 已进代码）

阶段 2/3 已实现并实测通过（真实应用 CDP 验证）；阶段 4（Codex 浅色主题预设）未做。

### 与设计文档的三处偏差（ponytail：复用已有能力，零后端改动）

1. **无 SaveBlockEnvCommand 新 RPC**——复用已有通用 `SetMetaCommand`（`wstore.UpdateObjectMeta` 浅 merge，顶层整 map 替换），后端零改动。
2. **launch 弹窗 Save 不写 RPC**——launch 时目标 block 尚不存在，EnvModalView 以 `onSaveCustomEnv` 回调把自定义 env 交回弹窗持有（`launchEnv` state），点 Current Tab/New/Existing 时经 `withLaunchEnv()`（agent-launch.ts）合并进新 block 的 `cmd:env`，用户自定义变量优先级最高（覆盖 profile/vendor env）。
3. **无需 modalregistry 注册**——复用现有 MessageModal 承载 EnvModalView（与 term-model.ts 打开方式一致）。

### 已落地的真实改动（frontend）

| 文件 | 改动 |
|---|---|
| `frontend/app/view/term/envmodal.tsx` | 新增「本次启动自定义变量」KV 编辑区（+Add/删除/敏感掩码）+ Save/Cancel footer；launch 模式（`onSaveCustomEnv`）跳过解析表、Save 回调；block 模式（term 右键菜单）Save 经 GetMeta+SetMeta 把自定义变量 merge 到现有 cmd:env（不冲掉 vendor 注入 key） |
| `frontend/app/view/term/envmodal.scss` | 自定义区/页脚样式（沿用现有 token） |
| `frontend/app/workspace/widgets.tsx` | New Agent / New Terminal footer 最左各加 `[⛭ Env]` 按钮；`launchEnv` state（关闭弹窗即清空，仅本次生效）；创建 block 时 withLaunchEnv 合并 |
| `frontend/app/workspace/agent-launch.ts` | 新增导出 `withLaunchEnv(blockDef, launchEnv)`（空 env 零侵入，合并到现有 cmd:env 之上） |
| `frontend/app/workspace/agent-launch.test.ts` | +3 测试（零侵入/叠加覆盖/无 cmd:env 时新建） |

### 实测验证（运行中应用，CDP 9222）

- New Terminal 弹窗 footer 出现 `[Env]` 按钮 → 点击打开 launch 模式 env 弹窗（标题 Terminal Environment、副标题 Variables applied…、1 空行、Add Variable、Save/Cancel、800px）。
- 填入 `COLORTERM=truecolor` → Save → Current Tab 启动 → `RpcApi.GetBlockEnvCommand` 查新 block：`COLORTERM=truecolor` 生效（93 vars，OS 基线 + delta）。
- New Agent 弹窗 footer 同样出现 `[Env]` 按钮。
- `npx tsc --noEmit`：改动 4 文件 0 错误（仓库遗留错误与本次无关）；vitest 82+40 全过；`npx sass envmodal.scss` 编译通过。

### 弹窗样式优化（2026-08-08，用户反馈「样式有点草率」后重做）

诊断出的 4 个问题与修法：

| 问题 | 修法 |
|---|---|
| 底部叠两个 footer（MessageModal 自带 Ok 按钮 + 自定义 Save/Cancel） | EnvModalView 改为自包含 `<Modal onClose onClickBackdrop>`（不传 onOk → 无底部 Ok），注册到 `modalregistry`（`pushModal("EnvModalView", …)`，与 AgentHookSettingsModal 同款外壳），term-model / widgets 调用点同步改 |
| `.env-modal-btn` 基础样式失效（原嵌套在 `.env-modal-toolbar` 内，footer/Add 按钮 padding/border/radius 全 0，实测 saveBtn `pad 0px radius 0px`） | 基础样式提升到 `.env-modal-view` 顶层：30px 高、radius 6px（wave-button 同款）、border-border、hover 态；primary=accent 底+黑字（`--action-*`）、ghost=透明、次级=form-element 底 |
| 弹窗无内边距、标题/输入框与项目最新弹窗（Tailwind 风格）脱节 | 标题对齐 `text-sm font-semibold` + `border-b border-border`；输入框统一 `bg --color-surface-soft + border-border + rounded-6px + h-30px + focus:border-accent`（对应项目 `h-7 rounded border bg-surface … focus:border-accent`）；自定义区 section label 对齐项目 `text-xxs uppercase` 风格；表格 `max-height 32vh` 防自定义区被挤出 |
| `--surface-soft` 变量不存在（应为 `--color-surface-soft`） | 实测确认后全部改用 `--color-surface-*` |

实测（CDP）：弹窗底部 `modal-footer` 计数 0（Ok 消失）；Save 30px/6px/绿底/黑字，Cancel ghost，Add form-element 底；输入框 30px + surface-soft 底 + mono；launch 模式（仅自定义区）与 block 模式（表格+toolbar）均正常；敏感 key 输入 `MEM0_API_KEY` → VALUE 转 password + SENS 标；`tsc` 0 错误、vitest 97 全过。

### 交互缺陷修复（2026-08-08，用户反馈「Save 后没回到 New Terminal/New Agent，白设置」）

**根因**：点 [Env] 打开 env 弹窗时鼠标移出 launch 浮窗区域（移到弹窗上），`useOutsideHoverClose` 的 1s 延迟关闭触发 → 浮窗被误关 → 浮窗 `useEffect` 里的 `setLaunchEnv({})` 把用户刚 Save 的 env 清空 → 白设置。实测复现：Save 后 `floatingStillOpen: 0`。

**修法**：`useOutsideHoverClose`（widgets.tsx，仅两个 launch 浮窗使用）的 onPointerLeave 延迟回调里增加 `if (modalsModel.hasOpenModals()) return;` —— 模态弹窗打开期间暂停 hover 关闭。顺带修复同类问题：New Agent 浮窗点 gear（AgentHookSettingsModal）后浮窗同样会被误关。

**实测闭环**：New Terminal → [Env] → 填 `COLORTERM=truecolor` → Save → 浮窗仍在（`floatingStillOpen: 1`）+ [Env] 按钮仍在 → Current Tab 启动 → 新 block 解析 env 含 `COLORTERM=truecolor`（95 vars）→ 完整闭环。workspace 54 测试全过。

### 长路径 crumb 尾部省略（2026-08-12，用户反馈「路径长时弹窗下按钮文字换行」）

**问题**：footer crumb 用 CSS `truncate` 截断——保留无用的**开头**、末尾子目录名被省略号吃掉（如 `/Users/nita/Primary/projects/snorkeling/…`）；且三个 launch 按钮无 `whitespace-nowrap`，路径更长/字体更宽时会被 flex 压到换行。

**修法**：
- `middle-ellipsis.tsx` 增加 `variant="tail"`：省略开头保留末尾（`…/core/src/features`），按容器实际宽度测量自适应；默认 `middle` 行为不变（path 列表行不受影响）。抽出纯函数 `maxFitLength` + 测试。
- `widgets.tsx` 两处 footer：crumb 换 `<MiddleEllipsis variant="tail">`；6 个 launch 按钮（Current Tab / New / Existing…）加 `whitespace-nowrap`。

**实测闭环**（CDP）：深路径下 crumb 显示 `…/modules/core/src/features`（宽 141px ≤ 160px 上限）、footer 单行 41px、按钮全部 nowrap 24px 不换行；New Terminal 弹窗同效果。tsc 改动文件 0 错误、vitest middle-ellipsis 3 测试 + agent-launch 112 测试全过。

## 核心交互（收敛后的最终形态）

只在 **New Agent / New Terminal 两个 launch 弹窗的 footer 最左侧**各加一个 `[⛭ Env]` 小入口按钮，点击后**复用现有环境变量弹窗**（`frontend/app/view/term/envmodal.tsx`），并将其**升级为可编辑**。

- 弹窗上半：现有生效环境变量（只读表格，保留搜索/敏感掩码/reveal/Copy All，不变）
- 弹窗下半（新增）：「本次启动自定义变量」KV 行编辑器（+Add / 每行 KEY+VALUE+删除 / 敏感值掩码）
- footer：Save / Cancel（Save 模拟写入 block `cmd:env`，真实走后端 `SaveBlockEnvCommand`）

### 与真实 UI 同步（2026-08-08 重做版）

本版按 PROCESS.md「原型 = 真实代码的结构镜像」重做，逐字段对齐真实组件：

- **New Agent 弹窗**（`widgets.tsx` AgentTargetFloatingWindow ~L717）：header（标题 + gear 钩子设置按钮）→ Select an agent type（30px chips + 左侧 2px accent 选中竖条 + DefaultCheckButton）→ Vendor · from cc-switch（chips + `+N▾` 展开 + current/official badge）→ Select a path.（path 行 + 远端 sub 行）→ footer（crumb + Current Tab · New · Existing… 按钮 + 2px 分隔点）。
- **New Terminal 弹窗**（TerminalTargetFloatingWindow ~L1162）：header 只有标题（真实无按钮）→ path 列表 → 同款 footer。
- **Env 弹窗**（`envmodal.tsx` / `envmodal.scss`）：标题 Terminal Environment + remote tag、subtitle、toolbar（搜索/Copy All/Show All/Hide All）、Key|Value 表头 + mono 单元格 + SENS 红标 + eye reveal；以上全部按真实 scss 视觉语言（`--tabbar-bg-color` 表头、`--error-color` SENS 标、`--form-element-bg-color` 输入/按钮）。

### 圆形完全符合当前样式（用户明确要求）

| 元素 | 真实样式（源码直译） |
|---|---|
| agent profile 图标 | 真实 SVG 16px（claude 彩色 `#D97757` / codex OpenAI / gemini / opencode / pi），未知 provider 走 7px 圆点回退 |
| 自定义 profile 圆点 | `w-[7px] h-[7px] rounded-full` + `AgentProfileColors`（codex `#74a7cb` · claude `#cc685c` · gemini `#8e7cc3` · opencode `#e0b956` · pi `#888888`）；选中 `opacity-100 scale-110`，未选中 `opacity-50` hover `opacity-80` |
| 选中竖条 | `absolute left-0 w-[2px] bg-accent rounded-full`（chip 内 top-1/bottom-1，path 行 top-1.5/bottom-1.5） |
| footer 分隔点 | `w-[2px] h-[2px] rounded-full bg-border` |
| DefaultCheckButton | 选中 `fa-solid fa-check text-accent text-[10px]`；未选中 `w-3 h-3 rounded-[2px] border-border`，`group-hover` 才显示 |
| vendor badge | `·current` → `bg-accent/15 text-accent`；`official` → `bg-surface-soft text-muted`（均 10px/rounded/leading-none） |
| 主题 | `theme.scss` `:root`（dark 默认）：accent `rgb(88,193,66)`、modalbg `#232323`、muted `#666`、border `rgba(255,255,255,0.16)` |

## 怎么打开

浏览器直接开 `index.html`：

```
file:///Users/nita/Primary/projects/snorkeling/.mockup/env-launch-entry/index.html
```

或在仓库模板环境用任意静态服务器（如 `python -m http.server`）打开。

渲染预览：`_preview.png`（headless Chrome 截图）。

## 目录文件

| 文件 | 作用 |
|---|---|
| `index.html` | 单页原型：New Agent 弹窗 + New Terminal 弹窗并排 + 可编辑 env 弹窗 |
| `style.css` | 真实 dark 主题 token（theme.scss `:root`）+ Tailwind class 直译 + envmodal.scss 视觉语言 |
| `script.js` | 交互逻辑：chip 选择/默认勾选、vendor +N▾ 展开、path 选择、env 弹窗开合、KV 行增删、敏感掩码/reveal、搜索、Copy All |
| `README.md` | 本说明（设计意图 + 结构镜像对照 + 落地路线 + 待决问题） |

## 原型里模拟的两种弹窗入口（footer 最左，与设计文档最终形态一致）

### New Agent

```
┌─ New Agent ────────────────────────────────────────┐
│ New Agent                                    [⚙] │
│ ------------------------------------------------- │
│ Select an agent type                               │
│  [▌Claude Code ✓] [Codex] [Gemini] [OpenCode]      │
│  [▌My Agent(●7px)]                                 │
│ Vendor · from cc-switch                   [⟳]      │
│  [▌质谱-无限 ·current] [Claude Official official]   │
│  [+2 ▾]                                             │
│ Select a path.                                      │
│  [▌⌂ /Users/nita/Primary/projects/snorkeling] [✓]  │
│  [⌂ ~]                                              │
│  [⌂ /root/work] (ssh://prod-box)                    │
│ ------------------------------------------------- │
│ [⛭ Env] /Users/…/snorkeling  [＋Current Tab]·[→New]·[Existing…] │
└────────────────────────────────────────────────────┘
```

### New Terminal（同款 footer 入口）

```
┌─ New Terminal ─────────────────────────────────────┐
│ New Terminal                                       │
│ ------------------------------------------------- │
│ Select a path.                                      │
│  [▌⌂ ~/Documents]                            [✓]  │
│  [⌂ ~/code]                                         │
│ ------------------------------------------------- │
│ [⛭ Env] ~/Documents  [＋Current Tab]·[→New]·[Existing…] │
└────────────────────────────────────────────────────┘
```

## 可编辑 Env 弹窗布局

```
┌─ Terminal Environment ─────────── [remote] ─┐
│ subtitle: 9 configured vars · … · 1 masked  │
│ toolbar: [filter keys/values…] [Copy All] [Show All] [Hide All] │
├─────────────────────────────────────────────┤
│ Key | Value（只读表，表头 sticky + SENS + eye）│
│ COLORTERM | truecolor                       │
│ TERM      | xterm-256color                  │
│ OPENAI_API_KEY [SENS] | •••••••• [👁]       │
│ …                                           │
├─────────────────────────────────────────────┤
│ 本次启动自定义变量（2 项）                    │
│   [COLORTERM______] [truecolor________] [🗑]│
│   [TERM_________] [xterm-256color____] [🗑] │
│   [KEY________] [VALUE__________] [🗑]      │
│   [+ Add Variable]                          │
│   ⓘ 空 KEY 行忽略；VALUE 支持 $ENV:NAME 引用；│
│      敏感 key 自动掩码                        │
├─────────────────────────────────────────────┤
│  [Save]  [Cancel]                           │
└─────────────────────────────────────────────┘
```

## 待决问题（落地时验证）

1. ~~自定义 env 保存范围~~：launch 模式仅本次生效（关闭弹窗清空），block 模式持久化到 block cmd:env（merge）。
2. ~~远端连接~~：现有 ResolveBlockEnvMap 语义天然满足（UI 只读 OS 基线）。
3. ~~敏感 key 逐行 reveal~~：自定义区敏感 key 用 password 输入框 + SENS 标（编辑态不需要 reveal，输入即所见）。
4. Codex 浅色主题一键预设按钮（自动填 COLORTERM/TERM）——阶段 4，未做。

## 落地路线

- 阶段 1（原型）：入口按钮 + 可编辑 env 弹窗交互验证。✅
- 阶段 2（后端）：~~SaveBlockEnvCommand~~ → 复用已有 SetMetaCommand，后端零改动。✅
- 阶段 3（UI 接入）：envmodal.tsx 升级可编辑 + widgets.tsx 两弹窗加入口 + withLaunchEnv 合并。✅ 已实测
- 阶段 4：Codex 选中时预设 COLORTERM/TERM，验证浅色主题输入框恢复。⏳ 未做

## 代码落地参考点（已实现，供回溯）

| 文件 | 改动 |
|---|---|
| `frontend/app/view/term/envmodal.tsx` | 自定义变量编辑区 + Save/Cancel + launch 模式 |
| `frontend/app/view/term/envmodal.scss` | 自定义区/页脚样式 |
| `frontend/app/workspace/widgets.tsx` | New Agent / New Terminal footer `Env` 入口按钮 + launchEnv state + withLaunchEnv 合并 |
| `frontend/app/workspace/agent-launch.ts` | `withLaunchEnv` 导出 |
| `frontend/app/workspace/agent-launch.test.ts` | +3 测试 |
| 后端 RPC | 无改动（复用 SetMetaCommand） |
