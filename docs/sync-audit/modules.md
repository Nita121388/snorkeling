# Snorkeling 功能模块基线（modules.md）

> 巡检的新范式：**功能模块对齐**，不是文件对齐。
> 三处：代码（frontend/app/）⇄ 原型（.mockup/）⇄ 方案（Obsidian My Projects\Snorkling\）
> 深度巡检先对齐核心模块；基线稳定后，git commit 驱动增量巡检（提交涉及哪个模块就查哪个）。

## 核心原则

- **文件会迁移，功能不会死** → 同步以"功能模块"为单位，不以文件为单位
- 每个模块的同步 = 三处（代码/原型/方案）描述的是**同一功能且内容一致**
- 深度巡检（一次性）：逐模块把三处对齐
- 增量巡检（日常）：基线完成后，按 git commit 影响模块触发

## 模块清单（基线）

### 🔴 核心模块（优先深度巡检）

| 模块 | 代码 | 原型 .mockup | 方案 Obsidian | 同步状态 |
|---|---|---|---|---|
| **Agent 状态与识别** | `frontend/app/agent-status/`, `session-overview/` | `_to-keep/agent-status-current.html`(旧), `aisessions-*.html` | `方案/Agent状态与识别/` | 🔴 待深度巡检 |
| **AI 面板 / 输入** | `frontend/app/aipanel/`, `suggestion/` | `new-agent-panel/prototype.html` | `方案/Agent数据与标签/` | 🟡 部分 |
| **Common Text** | `frontend/app/commontext/` | `_to-keep/commontext-*.html`(4个) | `方案/Common Text/` | 🟡 部分 |
| **Sessions 与列表** | `frontend/app/session-overview/`, `aisessions/` | `_to-keep/combine-dashboard.html`, `sessions-redesign.html`(删) | `方案/Sessions与列表/` | 🟡 部分 |
| **UI 布局与 Block** | `frontend/app/block/`, `tab/`, `workspace/` | `_to-keep/combine-dashboard.html`, `vcs-block-redesign.html` | `方案/UI布局与Block/` | 🔴 待深度巡检 |
| **主题 / 设计系统** | `frontend/app/theme.scss`, `app.scss`, `element/` | `_to-keep/design-system.html`, `light-theme-variations.html`, `shell-settings/index.html` | `方案/主题/` | 🟡 部分 |
| **终端 / 环境启动** | `frontend/app/view/term/`, `waveenv/`, `view/launcher/` | `env-launch-entry/index.html` | `方案/架构与文档/` | 🟡 部分 |

### 🟡 次要模块（基线后按需）

| 模块 | 代码 | 原型 | 方案 |
|---|---|---|---|
| **wsh 安装与上传** | `pkg/remote/`, `cmd/wsh/` | `shell-settings/index.html` | `方案/wsh安装与上传/` |
| **Onboarding** | `frontend/app/onboarding/` | — | — |
| **Monaco / 编辑器** | `frontend/app/monaco/`, `view/codeeditor/` | `_to-delete/markdown-inline-code-wrap.html` | — |
| **Treeview / 树视图** | `frontend/app/treeview/` | — | — |
| **插件机制** | — | — | `方案/插件机制/` |
| **竞品与生态** | — | — | `方案/竞品与生态调研/` |

### ⚪ 已过时/待清理（`_to-delete/`，26 项）

`_to-delete/` 下 26 个 html：多为早期设计稿（accent-color、card-wireframe、theme-design、tag-chips 等），
评审完成后已进 `_to-delete/`。**深度巡检时确认每项对应功能是否已落地**，落地则删，未落地则移回对应模块。

## 巡检流程（新范式）

```
1. 基线：按上表逐模块深度对齐（先 🔴 核心）
   - 代码里功能实现 vs 原型 HTML 展示 vs Obsidian 方案描述 → 是否一致
   - 不一致 → 登记 TODOS → 审批 → 执行
2. 增量：基线稳定后
   - git commit 改了哪个模块 → 只巡检该模块三处是否仍一致
   - 原型被改 → 查对应代码/方案
   - 方案更新 → 查代码/原型
3. 每轮：教训沉淀（inspection-lessons.md）+ 进化 Log（evolution-log.md）
```

## 同步状态标记

| 标记 | 含义 |
|---|---|
| 🔴 待深度巡检 | 三处是否一致未知，需首次深度对齐 |
| 🟡 部分 | 部分组件已对齐，仍有关联项未验证 |
| ✅ 已同步 | 三处一致，基线稳定，进入增量巡检 |
| ⚪ 待清理 | 已过时/待确认去留 |
