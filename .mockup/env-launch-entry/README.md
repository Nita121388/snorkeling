# Env Launch Entry — New Agent / New Terminal 弹窗内自定义环境变量原型

> 2026-08-04 · 对应方案 `My Projects/Snorkling/方案/主题/Terminal与Agent运行前自定义环境变量-设计方案.md`
> 背景：Codex CLI 浅色主题下输入框深色看不清（见 `Codex CLI浅色主题输入框深色看不清-外部Agent已知问题.md`），需在运行 Terminal/Agent 前注入 `COLORTERM/TERM` 等环境变量。

## 核心交互（收敛后的最终形态）

只在 **New Agent / New Terminal 两个弹窗的 header** 各放一个 env 小图标按钮（New Agent 在 gear 左侧、New Terminal 在 header 右侧，均为最小改动落点），点击后**复用现有环境变量弹窗**（`frontend/app/view/term/envmodal.tsx`），并将其**升级为可编辑**。

- 弹窗上半：现有生效环境变量（只读表格，保留搜索/敏感掩码/Copy All，不变）
- 弹窗下半（新增）：「本次启动自定义变量」KV 行编辑器（+Add / 每行 KEY+VALUE+删除 / 敏感值掩码）
- footer：Save / Cancel

### 与真实 UI 同步（重要）

本原型<b>不重新发明弹窗布局</b>——两个弹窗的 DOM 结构、类名、文案、选中态（左侧 accent 竖条）、actionbar（crumb + Current Tab · New · Existing）全部<b>逐字段对齐真实</b> `frontend/app/workspace/widgets.tsx`（New Agent ~L717、New Terminal ~L1162），仅新增 env 入口按钮一处。

用户反馈（2026-08-04）：「原型与当前 UI 布局和交互相差较大」，参考 `.mockup/_to-keep/new-agent-vendor.html` 方案 1（其即忠实复刻真实 New Agent 弹窗）后重做。

## 怎么打开

浏览器直接开 `index.html`：

```
file:///E:/code/snorkeling/.mockup/env-launch-entry/index.html
```

或在仓库模板环境用任意静态服务器（如 `python -m http.server`）打开。

渲染预览：`_preview.png`（headless Chrome 截图，新增目录时保持同名）。

## 目录文件

| 文件 | 作用 |
|---|---|
| `index.html` | 单页原型：New Agent 弹窗 + New Terminal 弹窗 tab 切换 + 可编辑 env 弹窗 |
| `style.css` | 硬编码 token（同源 `new-agent-panel` / `design-system.html` 浅色主题 token），贴近真实 `envmodal.scss` 视觉 |
| `script.js` | 交互逻辑：tab 切换、入口按钮、env 弹窗开合、KV 行增删、敏感掩码 |

## 原型里模拟的两种弹窗入口

> env 入口放在 header，非 footer；且结构对齐真实（无 App/Vendor/Target 下拉、无 Continue/Cancel footer，用 chips + actionbar）。

### New Agent（header 加 env 按钮，在 gear 左侧）

```
┌─ New Agent ───────────────────────────────────┐
│ New Agent                    [⠿env][⚙gear] × │
│ -------------------------------------------- │
│ Select an agent type                          │
│  [★Claude Code✓] [Codex] [Gemini] [OpenCode] │
│ Vendor · from cc-switch            [⟳]        │
│  [质谱-无限·当前✓] [官方O] [+N▾]              │
│ Select a path.                                │
│  [⌂ E:\primary\projects\snorkeling-light] [✓] │
│  [⌂ ~]                                          │
│ -------------------------------------------- │
│ E:\...light-theme  [＋Current Tab]·[→New]·[Existing…]│
└───────────────────────────────────────────────┘
```

### New Terminal（header 右侧加 env 按钮）

```text
┌─ New Terminal ────────────────────────────────┐
│ New Terminal                         [⠿] │
│ -------------------------------------------- │
│ Select a path.                                │
│  [⌂ ~/code/snorkeling]                         │
│  [⌂ ~/Documents]                    [✓] │
│ -------------------------------------------- │
│ ~/Documents  [＋Current Tab]·[New]·[Existing…] │
└───────────────────────────────────────────────┘
```

## 可编辑 Env 弹窗布局

```
┌─ Terminal Environment ─────────── [remote] × ─┐
│ subtitle: N 变量 · K 掩码                     │
│ toolbar: [搜索…] [Copy All] [Show/Hide]      │
├───────────────────────────────────────────────┤
│ 生效环境变量（只读表格，保留现有全部能力）     │
│   KEY=VALUE · 敏感值掩码 · 搜索 · Copy All     │
├───────────────────────────────────────────────┤
│ 本次启动自定义变量（新增，可编辑）              │
│   KEY [__________] VALUE [__________] [🗑]    │
│   KEY [__________] VALUE [__________] [🗑]    │
│   [+ Add Variable]                            │
│   ⓘ 空 KEY 行忽略；VALUE 支持 $ENV:NAME 引用   │
├───────────────────────────────────────────────┤
│  [Save]  [Cancel]                             │
└───────────────────────────────────────────────┘
```

## 待求证的交互细节（落地时验证）

1. 自定义 env **保存范围**：仅本次启动 vs 持久化到 block/连接默认（原型默认仅本次）。
2. **远端连接**：只显示 delta（现有 `ResolveBlockEnvMap` 语义），OS 基线只读（天然满足）。
3. 敏感 key **逐行 reveal** 是否开启（原型支持）。
4. Codex 浅色主题一键预设按钮（自动填 COLORTERM/TERM）——放阶段 4，原型暂不做。

## 落地路线

- 阶段 1（本原型）：入口按钮 + 可编辑 env 弹窗交互验证。
- 阶段 2：后端 RPC `SaveBlockEnvCommand`，写入 block meta `cmd:env`（现有 `resolveEnvMap` 零改动读取）。
- 阶段 3：`envmodal.tsx` 升级可编辑 + `widgets.tsx` 两弹窗加入口 + `modalregistry` 注册。
- 阶段 4：Codex 选中时预设 `COLORTERM/TERM`，验证浅色主题输入框恢复。

## 代码落地参考点（来自方案笔记）

| 文件 | 改动 |
|---|---|
| `frontend/app/view/term/envmodal.tsx` | 加「本次启动自定义变量」编辑区 + Save/Cancel footer |
| `frontend/app/workspace/widgets.tsx` | New Agent ~L717 / New Terminal ~L1162 footer 加 `Env` 入口按钮 |
| `frontend/app/modals/modalregistry.tsx` | 注册可编辑 env 弹窗 |
| 后端 RPC（wshserver） | SaveBlockEnvCommand（写 block `cmd:env`） |
| `frontend/app/view/term/envmodal.scss` | 追加自定义变量区样式 |
