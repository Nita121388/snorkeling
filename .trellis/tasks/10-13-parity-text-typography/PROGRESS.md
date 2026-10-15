# A3 在位编辑 —— 进度与续接点

> 最后更新：2026-10-15（A3 切片 1 / 2a / 3 / 4 + md-dom 全部纯层 + 提交决策/锚点解析收敛）
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

### D2：`packages/md-dom` —— **全部纯层已搬完，只剩会话驱动**

新包 `packages/md-dom`（`@md/dom`），别名三处已同步（`electron.vite.config.ts` 是构建期真源 /
`vitest.config.ts` / `tsconfig.json`）+ `package.json` workspaces + `package-lock` 注册。

| 模块 | 内容 | 性质 |
|---|---|---|
| `src/block-syntax.ts` | `initialContentFor` / `strip*`·`wrap*` 成对函数 / 空壳守卫 / callout 前缀 / 列表缩进 / `inlineKindToTreeKind` | 纯字符串 |
| `src/commit-prep.ts` | `relocateByBlockId` / `relocateByContent` / `isStaleTargetBlock` / `prepareInlineEditCommit` / `BlockEditTarget` / `CommitPreparation<T>` | DOM |
| `src/seed.ts` | `captureWysiwygInfo`（宿主 flag 由**注入** `isWysiwygEnabled`）/ `captureInplaceSeedHtml` / `calloutSeedHtml` / `normalizeBreaksAroundNewlines` / `stripInsignificantWhitespace` / `WYSIWYG_KINDS` | DOM |
| `src/edit-target.ts` | `resolveInlineEditTarget` / `fallbackSelector` / `isSelectingRange` / `EditableHostTarget` | DOM |
| `src/edit-anchor.ts` | `resolveEditAnchor`（块定位+切片+归一化基准+块身份+callout 前缀）/ `EditAnchor` | DOM |
| `src/commit-plan.ts` | `planBlockCommit`（四道判定收敛为单一真源）/ `BlockCommitOp` / `BlockCommitPlan` / `BlockCommitRequest` | DOM+md-core |

边界门禁 `src/boundary.test.ts`（6 用例，**任一条违反即红**）：
① 零 React 运行时依赖（react / react-dom / react-markdown / jotai / wos / electron）
② 零宿主静态依赖（`@/` alias + 相对路径解析后不得逃出包外）
③ 包间依赖单向（只允许 `@md/core`）　④ 包内不得出现 `.tsx`

包内自带测试面（73 用例）：`block-syntax` / `commit-prep` / `seed` / `edit-target`。

**类型设计要点（通用经验）**：搬包遇到「宿主那边的类型含框架类型」时，不要为了一个类型
把框架拖进包，也不要改宿主 N 处调用 —— 用**结构化窄接口 + 泛型**：
`BlockEditTarget`（只列重定位/陈旧检测真正需要的字段）、
`EditableHostTarget`（只列定位需要的字段）、`prepareInlineEditCommit<T extends BlockEditTarget>`。

**踩过的坑（必须成对检查 + 必须跑 tsc）**：
`export { type X } from "..."` **不会**把 X 带进本模块作用域，而要再导出又要本地使用的符号必须
**同时**写 import 与 export —— 只写一个要么编译报错、要么运行时报 ReferenceError。
本仓库 `vitest` 用 esbuild 剥类型，**全绿也照不出这类错误**；只有 `npx tsc --noEmit` 能。
（实测踩过：5d9c5437 修了 4 处，其中两处是只在特定提交路径才炸的 ReferenceError。）

---

## 已完成的关键收敛（2026-10-15）

`planBlockCommit`：**「一次提交该写什么 / 该不该写」的四道判定收成一份定义**
（重定位+陈旧检测 → callout 前缀回写 → 空壳守卫 → 无变化跳过）。
此前 overlay 与在位路径各写一遍 —— 这里漏一道的后果是**用户内容被覆盖**，不是样式错。
`markdown.tsx` 的 `inplaceCommit` 从 ~90 行手工串联改成调这一个函数。
真实应用验证：真写盘往返只改目标行、markdown 格式逐字节保真；parity 仍 0 差异。

## 已关闭：渲染有损 → 静默改写用户文件（2026-10-15，`ff16ef19`）

由「为什么渲染好的 DOM 不能直接编辑」这个追问逼出来的。**实测（序列化器真实输出）**：

| 源码 | 往返后 | 后果 |
|---|---|---|
| `[[n\|label]]` | `[label](wave-wiki:n)` | wiki 语法丢失（Obsidian 打开是死链） |
| `[^1]` | `[1](#fn-1)` | 脚注引用丢失 |
| `![[a.png\|300]]` | `![](a.png)` | **alt 文本 + 尺寸全丢** |
| `![](missing.png\|100)` | `[Image unavailable: …]` | **图片语法被占位文案吃掉** |
| `[t](u)` | `[t](u)` | 无损 |

真机复现：含 `[[...]]` 的段落**只打一个字**，用户源码就被改写。
根因：**把关粒度错了一层** —— A3 按块类型放开，但 `p` 允许含这些行内结构。
且两条路径防护不对称：overlay 有正则兜底（但漏 `<sup>`），**在位路径完全没有门**。

修法：`packages/md-dom/src/lossy.ts` 单一真源 + 两条路径共用，检查「待序列化的种子」。
顺带**放宽**过度保守（旧正则拒绝所有 `<a>`，但普通链接实测往返无损 → 现在放行）。
验证：三个有损行回落 TEXTAREA 显示原始源码，编辑后 diff 只有新增字，语法逐字节保真；
普通段落仍原位编辑。

**代价**：含 wiki 链接 / 脚注 / 图片的段落暂时失去原位编辑 → 见下方 P0-2。

## 待决策 / 已知缺口（明确记账，不装看不见）

- **P0-2 让序列化器学会还原**（进行中，`a6f714c8` 完成了 wiki 链接这一类）：
  机制 = 渲染时把**原始源码**塞进 `data-source-markdown`，序列化时读回。
  - ✅ **wiki 链接**：`wave-wiki:` href 不可逆（解析时补 `.md`、分不出有无 label），
    所以必须带原文。未改动 → 逐字节输出原文；改动过 display name → 只换 label，
    目标与锚点保持不变。含 wiki 链接的段落**已恢复原位编辑**（实测 diff 只有新增字）。
  - ⬜ **脚注 `<sup>`**：sanitize 白名单已提前放好 `dataSourceMarkdown`，渲染器与序列化器未接。
  - ⬜ **图片 `<img>`**：同上；且更难 —— 还要分清 `![[a.png|300]]` 与 `![a](a.png)`。
  - 未做完之前这两类仍被 gate 拒绝（安全，代价是回落 textarea）。


1. **清空标题留下裸 `###`，而不是删块**。现在行为与 overlay 一致（忠实于用户动作、可恢复），
   但「清空标题/空段落 → 删块」是更自然的体验。**产品决策**，未擅自实施。
2. **overlay 回落路径的 callout 背景色有 1 项 parity 缺口**（预览 accent 6% 底色 → 编辑态透明）。
   `git stash` 对比确认是既有问题。overlay 是上线后的**回滚阀** ——
   要么在退役回滚阀时一起删掉，要么修它，不能当作不存在。
3. **两条提交路径的守卫仍未代码合一**。`planBlockCommit` 收敛的是在位路径；
   overlay 的 `commit` 多一道 `seedNeverLanded` 两源对比，且要覆盖 placeholder / insertMode
   两类会话。本次已让**语义**对齐（都用「用户动过没有」），代码合一要等
   placeholder / insertMode 分支先抽出来。

## md-dom 还没搬的部分（只剩会话驱动）

`md-dom` 目前是「引擎的纯部分」。仍留在宿主、且**确实属于 md-dom** 的：

1. ~~种子采集层~~ **[已搬完成]**
2. **编辑会话驱动**（唯一剩下的大块）：`useInlineEdit`（现为 React hook）、就地编辑 DOM 生命周期、
   caret/选区、键盘语义。**这是「编辑引擎」的核心**，也是 `md-react` 只做薄绑定的前提。
   拆法：先把状态与 DOM 操作分离，再逐段搬迁，每段都有测试护栏。
3. 其余：`captureBlockTypography`（overlay 专属的快照，不在 md-dom 范围）/ `inlineEditDebug`

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
