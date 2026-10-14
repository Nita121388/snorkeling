# A3 在位编辑 —— 进度与续接点

> 最后更新：2026-10-14（A3 切片 1 / 2a / 3 / 4 + D2 第一阶段已提交）
> 提交序列：`cebb647f` → `c2869fb8` → `5db13852` → `53a4580f` → `7d2e3f6b` → `8d94274d`
> → `4505e1fa`（md-dom 建包 + 块语法层）→ `27d5fdcb`（md-dom 提交前置层）

## 目标（两条，同一条链）

1. **所见即所得**：编辑面 = 渲染面，只有一套样式（Wolai/思源/Milkdown 同构），保留本地文件优先（Obsidian 风格）。
2. **md 预览+编辑模块可单独拿出去**给其他页面工具用（`md-core` + `md-dom` + `md-react` + `md-schema` + playground）。

---

## 已完成（每条都有实测证据）

### A3 切片 1 + 2a + 4：p / h1-6 / quote / callout / ul / ol 零差异并转正

`flag wysiwyg-inplace` **默认开**（`DEFAULT_OFF_FEATURES` 清空；显式写 off 仍是回滚阀，有单测锁）。

实测命令与结果（沙箱 9333，真实应用 computed style 逐项对拍 30 项 × 2 bucket）：

| 块 | 模式 | 结果 |
|---|---|---|
| h1@1 / h2@5 / h3@10 | inplace | **0 差异** |
| p@3 | inplace | **0 差异** |
| ul@7 | inplace | **0 差异** |
| callout-quote@12 / callout-note@14 | inplace | **0 差异** |
| code@17 | overlay 回落 | 0 差异（用 overlay 的松豁免表） |
| table@21 | 单元格内联编辑（tablecell） | 非块级会话，跳过 |

写盘往返（真实文件，测完还原）：
- p：`**加粗**` / `*斜体*` 逐字节保真
- ul：多行列表**不丢项**
- callout：只有目标行改动，`[!NOTE]` 前缀与渲染器结构保持

### 修掉的三类「第二样式来源」（这是差异的根）

1. `previewRootAttrs` 手抄 `srcLineAttrs` → 退化节点（`end.line < start.line`）产出**倒置**的 `data-source-line-end`。改为调用真源。
2. `headingRootAttrs()` 抽进 md-core 真源，`CollapsibleHeading` 与 `EditableBlock` 共用（此前在位根缺 `data-heading-level/-id`）。
3. overlay 专属物从在位根剥离：内联 `typography` 快照（实测表现为 `whiteSpace: normal → pre-wrap`）、`data-block-kind`、`data-placeholder`。

### 修掉一个数据安全 bug

callout 提交凭空插入一行裸 `>`（remark 把软换行渲染成 `<br>` **加一个字面换行**，序列化器数成两次换行）。
修在 `serializeChildren`：只剥紧随 `<br>` 之后的空白。回归锁 fixture 从**真实渲染 DOM 逐字抄下**。

### 修掉门禁盲区（切片 3）

`overlay-style-contract.test.ts` 原来只扫 `markdown.scss:690-853`（`.inline-edit-overlay` 块）。
顶层 `.wysiwyg-editor*` 组（865-956，**52 条**结构性声明）因为 overlay 经 portal 渲染必须写在顶层，
**从来没被审计过**。现扫描面扩为两段，52 条全部登记为 `parity-2`（在位路径零镜像；这组只服务
flag 关闭时的 overlay 回退，是减法目标）。文件头那句「台账已无 parity-2」已改写成两句实话。

### D2：`packages/md-dom` 已存在，两块引擎层已搬入

新包 `packages/md-dom`（`@md/dom`），别名三处已同步（`electron.vite.config.ts` 是构建期真源 /
`vitest.config.ts` / `tsconfig.json`）+ `package.json` workspaces + `package-lock` 注册。

已搬入（宿主 `markdown-inline-edit.tsx` 改为 re-export，**调用点一个字节未改**）：

| 模块 | 内容 |
|---|---|
| `src/block-syntax.ts` | `initialContentFor` / `stripCodeFence` / `stripListMarker` / `wrapListMarker` / `wrapCodeFence` / `isEmptyBlockShellDraft` / `isEmptyQuoteShellDraft` / `captureCalloutPrefix` / `applyCalloutPrefix` / `indentListDraft` / `indentListRange` / `inlineKindToTreeKind` / `InlineEditBlockKind` |
| `src/commit-prep.ts` | `relocateByBlockId` / `relocateByContent` / `isStaleTargetBlock` / `prepareInlineEditCommit` / `MarkdownRenderRootSelector` / `BlockEditTarget` / `CommitPreparation<T>` |

边界门禁 `src/boundary.test.ts`（6 用例，**任一条违反即红**）：
① 零 React 运行时依赖（react / react-dom / react-markdown / jotai / wos / electron）
② 零宿主静态依赖（`@/` alias + 相对路径解析后不得逃出包外）
③ 包间依赖单向（只允许 `@md/core`）　④ 包内不得出现 `.tsx`

包内自带测试面（44 用例）：`block-syntax.test.ts` / `commit-prep.test.ts`。

**类型设计要点**：`BlockEditTarget` 是**结构化最小类型**（不含 React 类型），
`prepareInlineEditCommit<T extends BlockEditTarget>` 用泛型保住宿主完整会话类型 ——
既不需要为一个类型把 React 拖进包，也不用改宿主 12 处调用。

**意外收获**：包内往返测试抓到一处**既有不对称** —— `initialContentFor` 对列表保留行首缩进，
而 `wrapListMarker` 又按原文再加一次，缩进项首行会多一个空格。本层**不做猜测性修复**（
改它要同时看 listIndent 链路与写盘结果，否则可能把嵌套缩进改坏、进而变层），已钉成显式用例。

---

## md-dom 还没搬的部分（编辑引擎本体）

`md-dom` 目前是「引擎的纯部分」。仍留在宿主、且**确实属于 md-dom** 的：

1. **种子采集层**（DOM-only，可直搬）：`captureWysiwygInfo`、`captureInplaceSeedHtml`、
   `calloutSeedHtml`、`resolveTextElement`、`captureBlockTypography`、
   `stripInsignificantWhitespace`、`normalizeBreaksAroundNewlines`、`SEED_BLOCK_TAGS`
2. **编辑会话驱动**（最难）：`useInlineEdit`（现为 React hook）、就地编辑 DOM 生命周期、
   caret/选区、键盘语义。**这是「编辑引擎」的核心**，也是 `md-react` 只做薄绑定的前提。
   拆法：先把状态与 DOM 操作分离，再逐段搬迁，每段都有测试护栏。
3. 其余：`resolveInlineEditTarget` / `fallbackSelector` / `isSelectingRange` / `inlineEditDebug`

再往后：`md-schema`（块类型 + sanitize + 序列化白名单正式化）→ `md-react`（从 `markdown.tsx`
剥离 slash / 块菜单 / 拖拽 / emoji）→ fixture 驱动 playground → **journal 真跑通**（唯一诚实的
「可复用」验收）。

### D2 前提证据：编辑链路零 React 已验证可跑

`frontend/app/element/host-free-editor-pipeline.test.ts`：不 import react / react-dom /
react-markdown，用手写的预览态 DOM 走完 源码切片 → 种子 → 就地编辑 → 序列化 →
重定位/陈旧检测 → 写盘拼接，覆盖 p / list / callout。
这就是「搬得出去」的判据：如果这些函数需要 React 运行时，包就不可能被 journal 用。

已搬走的那些符号（见上表）现在从 `@md/dom/*` 导入；剩下的仍住在
`frontend/app/element/markdown-inline-edit.tsx`（该文件同时含 React 组件）——
**这就是「编辑引擎与框架绑在一起」的机械原因，搬完即解耦**。

---

## 未完成

| # | 切片 | 内容 | 状态 |
|---|---|---|---|
| 1 | 切片 3 减法 | 删掉那 52 条 overlay 镜像（需先决定是否保留 flag 关闭的回退路径） | ⬜ |
| 2 | 切片 2b | table / code 在位化（当前 code 走 overlay、table 走单元格内联编辑器） | ⬜ |
| 3 | **D2** | ~~建 `packages/md-dom`~~ **[已做]**；剩：种子采集层 + 编辑会话驱动搬迁 | 🔄 |
| 4 | D2 | `md-schema`（块类型 + sanitize + 序列化白名单正式化） | ⬜ |
| 5 | D2 | `md-react`（从 `markdown.tsx` 剥离 slash / 块菜单 / 拖拽 / emoji） | ⬜ |
| 6 | D2 | fixture 驱动 playground（兼视觉回归载体） | ⬜ |
| 7 | D2 验收 | **journal（零框架 Chrome 扩展）真跑通** —— 唯一诚实的「可复用」验收 | ⬜ |
| 8 | D3 | 逐块覆盖 7 子任务、交互层 | ⬜ |

---

## 关键事实（别重复踩）

- flag：`snorkeling:block-editor:wysiwyg-inplace`，**默认开**；显式 `off` 回退 overlay。
- 沙箱：`http://127.0.0.1:9333`，vite `51752`，草稿在 `.runcfg/scratch-ws/`。
  当前 `scratch-lists.md` 内容 = `scratch-parity-all.md`（h1@1 / p@3 / h2@5 / list@7 / h3@10 /
  callout@12,14 / code@17 / table@21）。pristine md5 = `77da01f2a73ba02032f34a85c7cb41cd`。
- **跑任何点击类验证前**必须先起长连接 focus：
  `nohup node scripts/cdp-focus-hold.mjs --endpoint http://127.0.0.1:9333 --target "Wave Terminal - T1" --hold-ms 3600000 & disown`
  否则窗口抢不到前台 → `visibilityState=hidden` → CDP 输入不投递 → 点击全落空。
- parity 用法：`node scripts/parity-check.mjs --endpoint http://127.0.0.1:9333 --line N [--keep-open] [--allow-no-session]`
  脚本会自己识别 inplace / overlay 并选对应豁免表（inplace 用**更严**的表：几何属性一律不得豁免）。
- 沙箱写盘类验证：前后比对 md5，测完还原。备份在 `/tmp/parity-roundtrip.BACKUP.md`。
- `calloutSeedHtml`（overlay）与 `captureInplaceSeedHtml`（在位）**故意不同**，不要合并。
- `heading` 在位根是两层：外层 `.heading`（非 contenteditable）+ 内层 `span.heading-title`（contenteditable）；
  `headingSeedInnerHtml()` 剥掉种子里多出的一层。
- 全量测试有 **17 个既有失败**（`html-export` / `obsidian-properties-card` / `preview-directory-utils`，
  会话初始基线就是 18 个），与本任务无关；判断回归用「失败集合是否变大」而不是「是否全绿」。
