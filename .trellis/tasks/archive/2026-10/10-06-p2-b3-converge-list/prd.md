# P2-B3: 列表块（bulleted/numbered/todo）编辑提交收敛到块模型控制器

## 背景

P0（渲染 registry）、P1（统一 undo 栈 + 只读块模型）、P2-A（编辑控制器 + 渲染适配器）、
P2-B1（code 语言收敛）、P2-B2（prose p/h/quote/blank 收敛，replace-content intent + 单例下沉）
已完成。prose 收敛模板已验证：`replace-content` intent 用块坐标做整体内容替换，行为等价、进
undo 栈。

**列表块现状（已勘察，别再重查）：**

| 事实 | 位置 |
|---|---|
| 列表项点击编辑走 `WysiwygEditor`（contentEditable），resolveEditTargetFromEl 对 li 是**单项粒度**（有嵌套子列表才提升到整组 ul/ol） | markdown.tsx resolveEditTargetFromEl（770-810） |
| beginEdit：`initialContent = stripListMarker(sourceContent)`（只去**首行** marker） | markdown-inline-edit.tsx beginEdit（~773） |
| 每次 input：`serializeBlockDomToMarkdown(root, ctx)` → `onInput(md)` → draftText = **每行都含 marker 的完整列表 markdown** | wysiwyg-editor.tsx syncMirror（187-194）、dom-to-markdown.ts serializeListDomToMarkdown（188-233） |
| blur：`serializeBlockDomToMarkdown` → `onBlur(md)` → `commit(md)` | wysiwyg-editor.tsx handleBlur（325-332） |
| `commit()`：list 走 else 分支 `wrapListMarker(committedDraft, originalSource)` 再包一层 marker → **重复 marker bug**（实测 `- - apple`） | markdown-inline-edit.tsx commit（~970-980）、wrapListMarker（405-410） |

**关键勘察发现（实测确认）：**

1. **现状 WYSIWYG list 提交存在重复 marker bug**：DOM 序列化产物已含 marker（每行），
   但 commit else 分支又 `wrapListMarker(committedDraft, originalSource)` 把首行 marker
   再包一遍 → 源码变 `- - apple`。实测：`serializeBlockDomToMarkdown(ul)= "- apple\n- PEAR"`，
   `wrapListMarker` 后 `= "- - apple\n- PEAR"`。textarea 路径（用户手输无 marker）的
   wrapListMarker 是对的，**只有 WYSIWYG list 路径错了**。
2. **列表会话是组级或单项**：resolveEditTargetFromEl 对普通 li 是单项（startLine=endLine），
   对含嵌套子列表的项提升到整组 ul/ol（data-source-line-end 覆盖整组）。
3. **P2-B2 的 replace-content 语义天然适配**：整体替换块内容，content 直接用 DOM 序列化
   产物（含 marker）→ 直接替换源码范围，**不重复加 marker，天然修复 bug**。
4. **R1（列表项作用域）**：块模型坐标逐列表项（splitListItems），但 transformBlockType 作用
   于整组。本任务收敛的是**提交定位**（blur 提交整体替换），不走 transformBlockType，R1 的
   turn-into 组级塌缩问题不在本任务提交路径内，留给未来（P2-B 后续/独立任务）。

## 本任务范围（P2-B3）

把列表块（bulleted/numbered/todo）的 WYSIWYG 编辑**提交定位**从「裸行号 replaceSourceRange +
wrapListMarker 重复包 marker」收敛到「块模型编辑控制器（replace-content intent）」。
内容仍来自 DOM 反序列化（serializeListDomToMarkdown，WYSIWYG 固有、成熟且正确——含 marker），
收敛的是**提交通道/定位**：直接整体替换，同时修复现状重复 marker bug。

## 验收标准（P2-B3）

1. **真实接入**：列表块 WYSIWYG 编辑提交走块模型控制器（复用 P2-B2 的 `replace-content`
   intent）→ 文本变换 → `handleInlineEditCommit`（P1 undo 栈），**不再走 wrapListMarker
   重复包 marker**；单项与整组（嵌套）列表都正确。
2. **修复现状 bug**：WYSIWYG 编辑列表项后源码不再出现 `- - apple` 重复 marker；
   用户改 apple→APRICOT 后源码为 `- APRICOT`。
3. **行为零回归**：既有 517 个 element 测试全绿；textarea 路径（非 WYSIWYG）的 list 提交
   保持 wrapListMarker 不动；list 相关测试无回归。
4. **undo 可用**：列表编辑后 Cmd+Z 可撤销（仍走 handleInlineEditCommit）。
5. **tsc** 无新增错误。
6. **可回滚**：收敛点单点可控；非 WYSIWYG 的 textarea 列表路径不动；table/code 不动。

## 明确不做（本任务范围外）

- 不改 `wysiwyg-editor.tsx` 本体（contentEditable 交互与 serializeListDomToMarkdown 仍用于
  产出编辑内容——这是 WYSIWYG 的本质）。
- 不收敛 table / code contentEditable 路径。
- 不改造 textarea（非 WYSIWYG）列表提交路径（保持 wrapListMarker，那是正确的）。
- **不解决 R1 的 turn-into 组级塌缩**（那是 transformBlockType 路径的问题，不在 blur 提交
  路径内；若 B3 完成后评估可另开任务）。
- 不解决 R2 / R3。

## 关键取舍点（按「代码质量/设计标准/用户体验/产品竞争力」原则自主选定）

- **复用 replace-content 而非新增 list intent**：列表 blur 提交与 prose blur 提交语义完全一致
  ——「整体替换块内容为 DOM 反序列化产物」。无需新 intent；P2-B2 的 `replace-content` +
  块坐标定位天然组级（会话 startLine/endLine 已覆盖单项或整组），R1 不阻塞本步。
- **修复重复 marker bug 而非保 bug**：现状 bug 是「DOM 产物已含 marker，wrapListMarker 又包
  一遍」，收敛到 replace-content 直接整体替换是正确行为；textarea 路径保持 wrapListMarker
  （其 draftText 是用户手输无 marker，包 marker 是对的）。修复符合用户体验/产品竞争力。
- **kind 映射**：wysiwyg 的 blockKind 是 "list"（不区分 bulleted/numbered/todo），DOM 序列化
  产物首行可推断具体 kind（`-`/`*` → bulleted，`1.` → numbered，`[ ]` → todo）。`replace-content`
  仅依赖坐标，kind 只作数据模型语义；可给 inlineKindToTreeKind 增加 list 分支或保持 text。
- **组级 vs 单项定位**：沿用会话 startLine/endLine（resolveEditTargetFromEl 已给出单项或整组
  范围），replace-content 的 block.startLine/endLine = 会话行号 - 1，与 P2-B2 相同的 0-based
  转换，天然支持两种作用域。

## 已知差异记录

- 空内容提交（清空整个列表）：与 P2-B2 相同的 `committedDraft.length > 0` guard，空内容回落
  原 replaceSourceRange（行删除语义），行为与现状一致。
- CRLF 文件：replace-content 与 replaceSourceRange 的边界 EOL 差异（P2-B2 已记录），非生产
  场景（wave 保存一律 \n）。
