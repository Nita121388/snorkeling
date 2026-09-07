# Snorkeling Modal 重构设计

Status: Design（待评审）
Owner: Snorkeling frontend
Last updated: 2026-07

本文档是 Snorkeling **所有弹窗（Modal / Dialog）** 的唯一设计规范与迁移计划。与
`docs/design-system.md` 分层：design-system 管基础 token 与通用组件，本文档管
**弹窗的形态、结构、行为与落地迁移**。二者冲突时以 design-system 的语义 token 为准。

---

## 1. 目标与原则

让所有弹窗看起来、用起来是同一套东西。四条硬原则：

1. **单一入口**。全项目只有 `frontend/app/modals/modal.tsx` 一个 `Modal` 基座；
   `Frontend/app/element/modal.tsx` 的遗留 `Modal`/`WaveModal` 废弃移除。
2. **统一三段结构**。Header / Content / Footer 严格三段，Footer 永不随内容滚动。
3. **功能与视觉分离冲突最小化**。语义按钮，禁止为了装饰塞 icon。
4. **行为可预期**。Esc / 点遮罩 / X 的关闭语义统一，焦点进出可恢复。

---

## 2. 数量与分类

一处仓库（`modalregistry.tsx`）+ 若干就地使用。按**用途/形态**分为 5 类：

| 类 | 定义 | 现成员 | 迁移形态 |
|---|---|---|---|
| **Confirmation** 确认/拦截 | 二次确认，防止误删/覆盖/关闭丢数据 | `CloseTabModal` `UnsavedFileModal` `FileConflictModal` `MessageModal` `UserInputModal` | `ConfirmModal` 统一 |
| **SettingForm** 设置/表单 | 输入并保存 | `NoteDirectoryModal` `AgentHookSettingsModal` `ExportOptionsModal` `EnvModal` `AISessionNoteModal` | `FormModal` 统一 |
| **ReadInfo** 信息/查看 | 只读或富展示 | `AboutModal` `AISessionDetailModal` `WidgetQuickLaunchModal` `RestoreBackupModal` | `ReadModal` 统一 |
| **QuickSearch** 轻量搜索/输入 | 列表即时搜索选择 | `TypeaheadModal` `Conntypeahead` `CommonTextComposeModal` | 保持左栏宽度规范 |
| **Onboarding** 引导 | 首启/升级 | `NewInstall/UpgradeOnboarding*` 系列 | 白名单例外（全屏形态） |

**邻近非弹窗组件**（不归 Modal 管，但视觉须对齐 overlay token）：
`Popover`(element)、`inlinetab-dropdown`、`session-menu`、`emojipalette`、`connstatusoverlay`、`minimized-blocks-float`。

### 2.1 现状不一致账本

| # | 现状 | 冲突 |
|---|---|---|
| M-1 | 双 Modal 基建并存 | `element/modal.tsx` 是第二套样式 |
| M-2 | Footer 两套写法：内置 `onOk/onCancel` vs 手写 `<Button>` | 间距、按钮序、危险角色各不同 |
| M-3 | 按钮内塞 icon | FileConflict/Env/About/CommonText/WidgetLaunch |
| M-4 | 标题层级混乱 | `text-[25px]` ~ `text-base` ~ scss 类 |
| M-5 | 宽度各写各的 | 420/440/470/520/680 硬编码 |
| M-6 | 关闭入口冗余 | AISessionNote 内置 X + 自定义 Close |
| M-7 | 主题语义违规 | `bg-white/12`、`rgb(...)`、`text-red-400`(DS-009) |
| M-8 | 遮罩半透明色 `0.5px` 边框 | DS-008（待专项） |

---

## 3. 统一设计规范

### 3.1 组件骨架（唯一）

只保留 `frontend/app/modals/modal.tsx` 的 `Modal` + `FlexiModal`。`FlexiModal` 是
低糖基座（Content/Footer 由调用方自拼），`Modal` 是含 Header/Footer 的高糖封装。

移除 `frontend/app/element/modal.tsx` 的 `Modal`/`WaveModal`，把所有使用方迁到
`@/app/modals/modal`。

### 3.2 结构布局（Header / Content / Footer）

```
┌──────────────────────────────────────┐
│  .modal-header                        │  ← 标题 + 可选副标题/描述（副标题=12px secondary）
│  ── 分隔线 ──                          │
│  .modal-content（可滚动，min-height:0）  │  ← 内容区
│  ── 分隔线 ──                          │
│  .modal-footer（不随内容滚动）           │  ← 操作按钮，右对齐
└──────────────────────────────────────┘
  · 右上角固定 X 关闭（Modal 内置渲染）
  · Content 溢出时只滚动 content，Footer 不动
  · 禁止在 modal 内容里再套卡片（design-system §8）
```

**标题规范**：一律 `text-base font-semibold text-primary`（Panel title 14px）。副标题
`text-xs text-secondary`。废弃 `text-[15px]` / `text-[25px]` / scss 自定义标题类。

**宽度规范**：全部走统一档位（Tailwind），禁止每弹窗发明魔数：

| 档位 | 宽度 | 适用 |
|---|---|---|
| xs | `w-[360px] max-w-[calc(100vw-32px)]` | 迷你确认 |
| sm | `w-[420px]` 同左 | 确认/轻表单 |
| md | `w-[520px]` 同左 | 常规表单 |
| lg | `w-[680px]` 同左 | 富展示/详情 |
| custom | 仅 `commontext-compose-modal`（可 resize） | 白名单例外 |

圆角统一 `8px`（design-system 上限 8px），边框 `1px var(--border-color)`（修掉 0.5px）。

### 3.3 Footer 按钮规范（核心）

1. **按钮内一律禁止 icon**。语义文字即可（FileConflict 的 `Save & overwrite`、Env 的
   `Add Variable` 保持纯文字）。这是 M-3 的落点。
2. **统一用 Modal 内置 `onOk/onCancel`（即 `modal-footer`）**，除非有第三个按钮的场景
   （确认类多选项），那才用 `FlexiModal` 自拼、但仍走同一 footer 样式。
3. **顺序**：次要在前、主要在后；危险角色放在末尾（如 `Don't Save` 紧邻 `Save` 前）。
4. **角色 token**（来自 design-system §4.2）：
   - 主操作：`Button`（默认 green/solid）= `bg-action text-actiontext`
   - 次操作：`Button className="grey ghost"`
   - 危险/破坏：`Button className="red ghost"`，不加实心红（可由主默认承担）
5. **Loading**：按钮 label 变 `Saving...` / `Restoring...` 并 `disabled`，宽度不跳变。

### 3.4 关闭 / 移除弹窗规范（"移除弹窗"落点）

**所有 Modal 必须**提供且只提供以下关闭途径，语义统一：

| 途径 | 行为 | 对应 props |
|---|---|---|
| **Esc** | 触发 `onClose`（等于取消） | Modal 内置 |
| 点遮罩 backdrop | 触发 `onClickBackdrop` | 传 `onClickBackdrop` |
| 右上角 X | 触发 `onClose` | Modal 内置，无需关 |
| Footer 取消/确认 | 各自回调 | `onCancel` / `onOk` |

约束：

- **关闭语义 = 取消**，不静默丢数据。有未保存改动时，关闭前需二次确认或自动保存
  （AISessionNote / CommonText 已做 autosave，保留）。
- **禁止**在 Content 里再加自定义 Close/X 按钮（M-6：AISessionNote 的 Close 删掉）。
- 关闭（卸载）后**恢复打开前焦点**（`restoreFocus`，当前 Modal 已内置）。
- 打开时由 `initialFocusRef` 或首焦控件收焦点（当前已内置）。
- 确认类弹窗的 `onResolve` 只允许触发一次（各 Modal 已有 `resolvedRef` guard，保留）。

### 3.5 语义 token 与主题

- 表面：`--modal-bg-color` / `bg-modalbg`；边框 `--border-color`；阴影沿用 `modal.scss`。
- 文字：主 `text-primary`、次 `text-secondary`、弱 `text-muted`。
- **禁止**任何 `bg-white/N`、`rgb(...)`、`gray/zinc/red-400` 等硬色进弹窗（M-7，含
  `tab-target-modal` 的 `text-red-400` → `text-error`）。
- 三主题均需可达；危险/警示在 monochrome 下用 icon+文字+边框（design-system §7.4）。
- 整个弹窗边界稳定 `1px`（修 DS-008）。

### 3.6 图标使用边界

弹窗内允许 icon 的地方**仅有**：

- 右上角内置 X（Modal 提供）。
- 语义性状态图标（如 file-conflict 顶部的 `fa-triangle-exclamation`）——是状态不是按钮。
- 输入框内的放大镜（typeahead/search 前缀，属输入控件）。

**按钮/可点项内部禁止 icon**。把原 icon 去掉后，靠文字、颜色角色（主/次/危险）、间距区分。

---

## 4. 落地改造清单

| 文件 | 改动 |
|---|---|
| `element/modal.tsx` | 删除，`WaveModal` 迁到 `Element/modal`(新) 或用模态 base |
| `element/modal.scss` | 删除（与 modals/modal.scss 合并去重） |
| `modals/file-conflict-modal.tsx` | 去按钮 icon；`bg-white/12`/`rgb` → 语义 token；危险角色按钮 |
| `modals/unsavedfilemodal.tsx` | 统一 footer 间距，危险 `Don't Save` 用 `red ghost` |
| `modals/closetabmodal.tsx` | 标题 `text-[15px]`→`text-base`；footer 统一 |
| `modals/messagemodal.tsx` | 用内置 footer；`messagemodal.scss` 的额外 footer padding 并入 base |
| `modals/userinputmodal.tsx` | 用 `okLabel/cancelLabel` 内置 footer（已是） |
| `modals/notedirectorymodal.tsx` | 已是内置 footer；标题对齐 `text-base` |
| `modals/aisessionnotemodal.tsx` | 删 Content 内 Close；状态行保留；宽度 `sm/md` |
| `modals/aisessiondetailmodal.tsx` | 用 `FlexiModal`，footer 左收起，宽度 `lg` |
| `modals/agenthooksettingsmodal.tsx` | 无 footer（tab 内联保存）→ 保持，但按钮去 icon、token 化 |
| `modals/about.tsx` | 标题层级；按钮去 icon（保留 github 品牌链接可作例外判据） |
| `view/term/envmodal.tsx` | footer 按钮去 icon；`trash/plus/copy` 去掉 |
| `view/term/envmodal.scss` | 并入 base token |
| `view/preview/export-options-modal.tsx/.scss` | 标题 class→tailwind；宽度档位；scss 并入 base |
| `workspace/widget-quick-launch.tsx` | 头部 bolt icon 保留(状态)，内部按钮去 icon |
| `tab/tab-target-modal.tsx` | `text-red-400` → `text-error`（DS-009） |
| `modal.scss` | 边框 0.5px→1px（DS-008）；抽 Header/Footer/宽度档位变量 |
| `modals/modalregistry.tsx` / modals renderer | 保留 registry 作为全局 modal 总入口 |

---

## 5. 分阶段实施（每阶段独立可交）

| 阶段 | 内容 | 风险 |
|---|---|---|
| **P0 基建** | 统一 `modal.scss`：Header/Footer/宽度档位/边框1px；删 `element/modal.tsx` 迁移遗留使用方 | CRITICAL（Modal base 全局变更），单独评审 |
| **P1 Confirmation** | 抽 `ConfirmModal` 抽象，统一 5 个确认类 | HIGH |
| **P2 按钮 de-icon** | 去所有按钮内 icon + 语义 token 化（含 tab-target DS-009） | HIGH |
| **P3 SettingForm/ReadInfo** | 标题/宽度/关闭冗余统一 | MEDIUM |
| **P4 QuickSearch** | 仅校验宽度档位与 header 规范 | MEDIUM |
| **P5 收尾** | 全量视觉走查 dark/light/monochrome，更新 registry，删 scss 冗余 | LOW |

> P0、P2 涉及 Modal base 与多个共享弹窗，按 AGENTS 强制先跑 impact 分析；P0 边界必须
> 专项隔离（对一个 Symbol 的影响可能是 CRITICAL），与 design-system Batch 6 合并评审。

---

## 6. 验证门

每个阶段交付须满足 design-system §10 验证门：

1. GitNexus impact（改 Symbol 前，P0 必做）。
2. 新增/改动的非平凡逻辑有 Vitest。
3. `npm run build:prod` 通过。
4. CDP 截图三主题（dark/light/monochrome）。
5. 键盘走查：Esc 关闭、focus-visible、disabled、焦点进出恢复。
6. patch 宽度下的窄视口布局。

---

## 7. 后续

- 落地本文档后，新加弹窗只允许：`Modal`（内置 footer）或 `FlexiModal`（Content/Footer），
  并套用 3.2 宽度档位与 3.3 按钮规范，否则视为违规合入。
- 若用户要"记一笔"沉淀，可入手工 sink 流程再落到 vault 开发细节。