# 进度快照 · 2026-11-04 下班前

> 状态：**代码已改完并落地在工作区（未提交、未验证通过）**。下次开工从「下一步」第 1 条继续。

## 1. 本次会话做了什么

### 已提交（3 个 commit，都在 main）

| commit | 内容 |
|---|---|
| `b88a24f9` | 验证台骨架：`scripts/verify/preview-edit/`（observe → oracle → loop） |
| `62b92ce7` | 产品修复：编辑态**软换行丢失**（7.07%→4.77%）+ **内联标记样式未镜像**（code/strong 在 portal 覆盖层吃不到 `.markdown` 作用域）；验证台加 `09-pixel-visual-parity` 整块像素判据 |
| `c8b4b77d` | 修我自己造成的事故：验证台全局注入 `caret-color:transparent` 未撤销 → 用户点标题看不到光标。改为「截图前临时加、只作用于覆盖层、截完立刻删」+ `finally` 统一清 `style[id^=verify-]` |

### 未提交（工作区，本次会话的后半段工作）

`frontend/app/element/markdown-inline-edit.tsx` / `markdown.scss` / `markdown.tsx`

内容：**折叠式有序列表项的「首行缩进」几何建模**（修 `ol-collapsible` 最后一处真实差异）。

改动要点：

1. 新增纯函数 `resolveListContinuation(targetEl, blockKind)`
   → 返回 `{ firstLineIndent, markerOffset, liLeft, liWidth } | null`（null = 非折叠项）
2. `InlineEditSession` 新增 `listIndentMode?: "first-line"` + `listMarkerOffsetPx`
3. `beginEdit` / `measureOverlay` 都用它：折叠项的 `listIndentPx` 取**首行缩进**（实测 33.03px），不再取 marker 列宽（24.5px）
4. `measureOverlay` 的锚点从 `targetRect.left` 换成 **`liLeft`（li 内容盒左边）**，宽度同步收窄
5. Overlay 新增 `data-list-indent-mode="first-line"` + CSS 变量 `--inline-edit-first-line-indent` / `--inline-edit-marker-offset`
6. `markdown.scss` 新增首行缩进模式规则：缩进用 `li { text-indent }`（只影响首行）、marker 用 `left` 定位；**根 padding 必须归零**（否则首行和续行一起右移）

## 2. 为什么这么改（实测数据，别重新推）

渲染态结构（CDP 实测）：

```
li.ordered-list-collapsible             left=42（盒子）/ 44（内容盒）
  .ordered-list-summary-row (flex)
    button.ordered-list-collapse-button   left=40
    .ordered-list-summary-content         left=64  ← ::before 画 "1."，推进 13.03 → 文字 77.03
  .ordered-list-collapse-body             left=44  ← 续行从这里开始
```

⇒ 这是**首行缩进**（首行 77，续行回 44），不是悬挂缩进（两行都在 77）。
我原来的编辑器是悬挂缩进 ⇒ 续行右移 **33.02px**。

> 历史误判记录：早期 report 报过"2px"和"38px"，都是墨迹行带取样假数据，**真值是 33.02px**。

## 3. 中断在哪（下次第一件事）

改完后验证时发现 **`ol-collapsible` 双击打不开编辑器**，于是做了对照实验：

- 用 `git stash` 撤掉我的三个文件 → **仍然打不开** ⇒ 不是我的改动导致的
- 同一 fixture 里普通 `li` 双击**能**打开（`overlay:true, kind:wysiwyg`）
- 用修正后的探测脚本（`client.dblclick`，三个点位：summary 文字 / body 文字 / summary 右半）→ **三个点位全部能打开** ✅

⇒ 结论：**代码没问题，是当时实例状态异常**（估计是之前一轮 `Esc` 在"编辑器没打开"的情况下按下去，把整个 preview block 关掉了 → 后续 case 全是 `no-root`）。

两个必须记住的坑：

1. **验证台失败路径会破坏现场**：`observe` 在编辑器未打开时仍按 `Esc` → app 把 md preview block 整个关掉 → 后续 case 全红（假红）。**待修：Esc 只在确认 overlay 存在时才按。**
2. 我的探测脚本用 `ensureFixtureOpen` 反复重开 → 开了 **8 个重复 preview block**（用户已提醒）。**待办：关掉重复 block，只留 1 个。**

## 4. 下一步（按顺序）

1. `node scripts/verify/preview-edit/run.mjs --attach --expect=fixed` 复跑，确认 `ol-collapsible` 是否转绿
   - 若 `Δx ≈ 0` 且 parity ≤ 2% ⇒ 5/5 全绿，进入第 4 步
   - 若仍有残差，先跑 `.cache/tmp/measure-collapsible.mjs` / `probe-before.mjs` 拿真实几何（不要靠 report 的墨迹行带推断）
2. 修验证台的两个副作用：
   - `lib/observe.mjs`：`Esc` 前先确认 `.inline-edit-overlay` 存在；不存在就不按（避免关掉 block）
   - `lib/open.mjs`：`ensureFixtureOpen` 复用前先数一遍带哨兵的 `.markdown-render-root`，>1 时优先复用并**不新建**
3. 清理：关掉那 **8 个重复 preview block**（用户已提醒过）
   - 已探明：`window.ln` 不可用（`typeof window.ln === 'undefined'`，HMR 后未暴露），拿不到 layoutModel，**没有可靠的内部 API 可批量关**
   - 关闭入口在 block header 的 **More 菜单**（`button.block-frame-settings`，title="More"）
   - 关闭方式：逐个 More → Close，或用真实指针点 header 上的关闭 affordance；**不要按进程名杀 node**（pi 自己也是 node）
4. 5/5 全绿后：连跑 3 次验确定性 → `--against=<上一轮>` 确认 `newFailures=0`
5. 走流程：`trellis-check` → 补 rule（首行缩进 / 失败路径不关 block）→ `trellis-update-spec` → commit → `/trellis:finish-work`
   - 任务 `11-04-preview-edit-verify-harness` 仍 in_progress，**未归档**

## 5. 环境现状

- 隔离验证实例：`--profile verify --vite-port 51799 --cdp-port 9231`，**当前在跑**，页面里有重复 fixture block（见上）
- 用户自己的实例**没有 CDP**，不可杀、不要动
- 探测脚本（临时，`.cache/tmp/`，已被 gitignore）：`measure-collapsible.mjs` / `measure-collapsible2.mjs` / `probe-before.mjs` / `probe-real.mjs` / `probe-points.mjs` / `reopen-fixture.mjs` / `patch-collapsible-indent.py`
  - `reopen-fixture.mjs` **会新建 block**，下次复用已有那个，别再跑它
- 最新验证产物：`verify-runs/20261104-155417/`（全红那轮，是环境坏的，不作为结论）

## 6. 关键认知（避免下次重走弯路）

- **像素判据不能只看"最左墨迹 x"**：必须加整块差异率（`09-pixel-visual-parity`，阈值 2%），否则字体/字重/内联标记/换行全漏
- **portal 到 body 的覆盖层吃不到 `.markdown` 作用域的样式**，内联标记必须显式镜像
- **`whiteSpace: normal` 会折叠真实软换行**：种子阶段显式转 `<br>`（`normalizeWysiwygSeed`）
- **注释/临时改动必须与宿主隔离**：往用户看得见的窗口注入样式 = 真实事故（caret 那次）
- **锚点要用「内容盒」不用「盒子」**：li 的 `rect.left` 与内容盒差 2px（padding/border）
