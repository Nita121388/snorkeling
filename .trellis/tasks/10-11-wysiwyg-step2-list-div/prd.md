# step2：列表结构自持 + 规范化（根除列表编辑丢内容 / 光标漂移）

父任务：`10-11-wysiwyg-overhaul`。依赖：step1（已完成）。

## 为什么改范围（原计划是「列表 div 块化」，现改为「自持 + 规范化」）

原方案要照抄思源的 div 块载体以绕开浏览器规范化，代价是自研 Enter/Tab/Backspace/粘贴整套
列表语义（思源 `list.ts` 71KB）。开工前用**隔离沙箱实例**（`.runcfg/scratch`）实测当前行为，
拿到三条证据：

1. **Tab 缩进会丢内容（数据丢失，已确定性复现）**
   CDP 实测：在 `- item C` 上按 Tab → 浏览器 `execCommand("indent")` 产出
   `<ul><li>item A</li><li></li><li>inserteditem B</li><ul><li>item C</li></ul></ul>`
   —— 嵌套 `ul` **直接挂在 `ul` 下（没在 `li` 里）**。提交后源码变成
   `- item A` / `- ` / `- inserteditem B`，**item C 整项消失**。
   单测复现：`serializeListDomToMarkdown('<ul><li>A</li><li></li><li>B</li><ul><li>C</li></ul></ul>')`
   → `"- A\n- \n- B"`（C 被丢弃）。

2. **Enter 原生行为是好的**：在项首回车 → 上方插入空 `<li>`，提交后源码 4 项、行号重算正确，
   往返无损。（但浏览器会**克隆 `li` 的属性**，新 `li` 带重复的 `data-source-line`。）

3. **丢失的根因是「结构没被自持 + 序列化只认规范结构」**，而不是 `<ul>/<li>` 这个标签本身。

因此最小充分解是：**自己拥有结构操作（不再依赖 `execCommand`）+ 每次结构变更后规范化 DOM +
序列化器对非规范结构兜底**。仍保留 `<ul>/<li>`（div 块化收益不足以覆盖其成本，推迟到 step3 之后评估）。

## 需求

- **R1 结构操作自持**：Tab / Shift+Tab 改为显式 DOM 结构操作（搬移 `li`），不再使用
  `document.execCommand("indent"/"outdent")`。产出**规范结构**：嵌套列表只能作为 `li` 的子元素。
- **R2 规范化**：每次结构变更（Tab/Shift+Tab/Enter/Backspace/粘贴）后调用
  `normalizeListDom`：游离子列表并入其前一个兄弟 `li`（无前一个则提升为顶层，**内容不得丢失**）。
- **R3 序列化兜底**：`serializeListDomToMarkdown` 遇到非规范结构（`ul/ol` 直接挂在 `ul/ol` 下）
  必须输出该子树（按嵌套处理），**绝不静默丢弃**。
- **R4 光标锚定**：结构变更前插 `<wbr>` 锚点，变更后按邻居文本节点重解析为 collapsed Range 并
  focus（思源 `focusByWbr` 语义）。Tab / Shift+Tab / Backspace 后光标必须仍在被操作项。
- **R5 边界**：第一项按 Tab 不动；顶层项按 Shift+Tab 不动；`li` 内含子列表时缩进/降级后子树跟随。

## 验收标准

- [ ] 单测：probe HTML（游离子列表）序列化**包含** `  - item C`（当前会丢弃）
- [ ] 单测：Tab 后 DOM 结构规范（嵌套 `ul` 在 `li` 内）；Shift+Tab 反向正确
- [ ] 单测：第一项 Tab / 顶层 Shift+Tab 为 no-op
- [ ] 单测：`normalizeListDom` 把游离子列表并入前一个 `li`；无前一个时提升为顶层且内容保留
- [ ] 单测：结构变更后光标仍在被操作项（`<wbr>` 锚定）
- [ ] 沙箱实测（可见窗口）：Tab → 提交 → **源码项数不变**、缩进为 2 空格/层
- [ ] `npx vitest run frontend/app/element` 全绿；`npx tsc --noEmit` 无新增错误（基线 68）

## 明确不做

- 列表 div 块化（推迟；见上「为什么改范围」）
- Enter/Backspace 的默认行为接管（实测原生可用；由 R2 规范化兜住其非规范输出）
- 阶段 4 的结构操作统一模型（跨块选择 / 拖拽 / turn into）

## 风险

- Tab/Shift+Tab 改为自持后，缩进语义必须与序列化缩进（2 空格/层）严格一致，否则源码缩进漂移
- `normalizeListDom` 若过度搬运会改变用户结构 → 只在**明确非规范**时动手，且必须保内容
- 回归面：列表渲染（折叠、任务勾选、有序编号）、列表提交、live 转换（打字生成列表）

## 沙箱（本次验证基础设施，可复用）

```bash
# 一次性：造草稿工作区
mkdir -p .runcfg/scratch-ws && # scratch-lists.md / scratch-quotes.md / scratch-misc.md
# 复制现有 profile 并把 DB 里所有 md 路径改写到草稿（含「其它笔记」也一并改写，避免误写真实文件）
sqlite3 .runcfg/scratch/data/db/waveterm.db "update db_block set data = replace(data, '<old>', '<new>');"
node scripts/dev-isolated.mjs --profile scratch --vite-port 51752 --cdp-port 9333
```

**关键坑（已踩）**：
- CDP 输入**不投递给隐藏渲染进程** —— `document.hidden === true` 时 `Input.dispatchMouseEvent` /
  `dispatchKeyEvent` 全部静默丢弃（DOM 上连 `mousedown` 都收不到）。验证前先查
  `document.visibilityState`，把窗口置前。
- 合成 `KeyboardEvent`（eval 里 dispatch）**不触发浏览器默认编辑动作**：Enter/Tab/Backspace 必须用
  `scripts/inspect-electron-ui.mjs key`（真 CDP 按键，Enter 需 `keyDown` + `text: "\r"`）。
- 合成 `MouseEvent` 只设选区、**不给 DOM 焦点** → 真实按键会被应用抢走。进编辑态要用真 CDP `click`。

---

## 范围变更记录（2026-10-11，开工实测后决定）

### 原计划「列表 div 块化」→ 改为「结构自持 + 规范化」（不做标签更换）

**依据（开工前隔离沙箱实测 + 单测复现）**：

1. Tab 缩进确实在丢内容（决定性证据）：`execCommand("indent")` 产出
   `<ul><li>A</li><li></li><li>B</li><ul><li>C</li></ul></ul>`，序列化丢弃 C 子树 → 提交后该项消失。
2. Enter 原生行为是**好的**：项首回车插入空 `<li>`，提交后 4 项、行号重算正确、往返无损。
3. 丢失的根因是「结构未被自持 + 序列化只认规范结构」，**不是 `<ul>/<li>` 标签本身**。

**决定**：以最小成本拿到正确性 —— F1 序列化兜底（单独即止血）+ F2 规范化 + F3 结构操作自持
+ F4 `<wbr>` 光标锚定。div 块化（需自研 Enter/Tab/Backspace/粘贴整套语义，思源 `list.ts` 71KB）
推迟到 step3（块身份）之后再评估。

### 实际完成情况

- [x] F1 序列化兜底（游离列表必须输出）—— 单测 3 例
- [x] F2 `normalizeListDom`（幂等、退化分支不丢内容）—— 10 例
- [x] F3 Tab/Shift+Tab 自持（去 execCommand；边界 no-op；空列表清理）
- [x] F4 `plantCaretAnchor` / `focusByAnchor`（无残留 `<wbr>`）
- [x] 沙箱实测：Tab 后源码仅缩进变化（行数 49 → 49，项数不变）；Shift+Tab 回顶层；
      边界 no-op；结构操作后打字进入被操作项；往返 + 撤销后文件与备份**逐字节相同**
- [x] `npx vitest run frontend/app/element`：45 文件 / 642 用例全绿；`npx tsc --noEmit` = 68（基线）

### 期间发现的既有问题（非本次引入，已记录）

- 点内层列表项会被既有 `resolveEditTargetFromElement` 提升为**内层列表**作为编辑根，
  因此「点内层项 → Shift+Tab 降级」路径天然不可达（降级在该根下是 no-op）
- 由点击块打开编辑器时，DOM 焦点有时落在 overlay 包裹层而非 editable 根（需再点一次才正常）
