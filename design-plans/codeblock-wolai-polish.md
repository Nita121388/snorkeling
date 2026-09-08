# 代码块优化 · 最终方案（定稿）

> 定稿时间：2026-09-08
> 依据：Wolai 实测（`design-plans/property-editor-wolai-style.md` 同源调研）+ 本项目现状（`markdown.scss` / `markdown.tsx` / `theme.scss`）
> 定位：**对齐 Wolai 的观感与秩序，保留只读预览与 markdown 优先语义，并强化本项目特有的一键执行能力。**

---

## 0. 一句话目标

让 md 预览里的代码块：**有顶栏（语言常驻、命令可一键执行）、长块自动收起、字号行高更透气、背景干净不透底**——其余照旧。

---

## 1. 最终决策总表

| # | 项 | 决定 | 值 |
|---|---|---|---|
| C1 | 背景 | 改不透明专用变量 | `--codeblock-bg-color`（暗色 `#1c1c1c`，浅色 fallback `#f7f7f7`） |
| C2 | 圆角 | 保持 6px（不学 Wolai 的 3px） | `6px` |
| C3 | 字号/行高 | 12px→**13px**，1.5→**1.6** | `code { font-size: 13px; line-height: 1.6 }` |
| C4 | 内边距 | 顶部留顶栏空间 | `padding: 1.6em 1em 0.85em`；`margin: 0.5em 0.75em` |
| C5 | 顶栏 | 新增：语言**常驻**，操作**hover** | header 高 22px，absolute 定位，不进文本流 |
| C6 | 执行按钮 | **命令类语言常驻**（本项目特色） | bash/sh/zsh/fish/shell/powershell/console 常显，其余 hover |
| C7 | 折叠 | >30 行默认收到 12 行 | `max-height: 250px` + 渐隐 + 「展开全部（共 N 行）」 |
| C8 | 复制 | 保持纯净 | 顶栏/折叠 UI 都不进 `getTextContent(children)` |
| C9 | 换行 | 默认保持 `pre-wrap` | P1 再加 per-block「不换行」开关 |
| C10 | 行号 | 默认关 | P2，CSS counter 实现，复制不带行号 |

---

## 2. 落地细节（可直接照改）

### C1 背景 —— `frontend/app/element/markdown.scss:482`

```scss
pre.codeblock {
    background-color: var(--codeblock-bg-color, #f7f7f7);
    margin: 0.5em 0.75em;
    padding: 1.6em 1em 0.85em;
    border-radius: 6px;
    position: relative;

    code {
        font-size: 13px;
        line-height: 1.6;
        white-space: pre-wrap;   // C9 保持
        word-wrap: break-word;
        background-color: transparent;
    }
}
```

`frontend/app/theme.scss`：`[data-theme="dark"]` 块内新增 `--codeblock-bg-color: #1c1c1c;`
（其余主题走 fallback `#f7f7f7`；`light/light2/monochrome` 是浅色，一眼可验收，需要再微调时单独覆盖。）

> 为什么：现状 `var(--panel-bg-color)` 在暗色是 `rgba(31,33,31,.5)` 半透明，长代码块叠在预览底色上会发灰发脏。

### C5 顶栏 —— `frontend/app/element/markdown.tsx:1031` `CodeBlock`

```tsx
<pre className="codeblock" {...sourceLineAttrs(sourceLine, sourceLineEnd)}>
    {children /* 代码本体仍在 children，复制取的就是它 */}
    <div className="codeblock-header">
        {语言区（常驻：badge / 编辑输入）}
        <div className="codeblock-ops">{复制}{执行}</div>
    </div>
</pre>
```

```scss
.codeblock-header {
    position: absolute;
    top: 0.25em;
    left: 0.5em;
    right: 0.5em;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    pointer-events: none;            // 让代码区仍可选中
    > * { pointer-events: auto; }
}
.codeblock-ops { visibility: hidden; }
pre.codeblock:hover .codeblock-ops { visibility: visible; }
```

⚠️ **两条硬约束**
1. header 必须**放在 `children` 之后且只装控件**：复制走 `getTextContent(children)`，header 文本不会进剪贴板。
2. header 用 **absolute**，不占文本流 → 不改 `pre` 的布局高度语义，`data-source-line` / inline-edit 行坐标不受影响。

### C6 执行按钮常驻

```ts
const ShellLikeLangs = new Set(["bash", "sh", "zsh", "fish", "shell", "shell-session", "console", "powershell", "ps1"]);
const isShellLike = (lang?: string | null) => lang != null && ShellLikeLangs.has(lang.toLowerCase());
```
- `isShellLike(language) && onClickExecute` → 执行按钮**常显**（类名 `is-persistent`，不被 hover 规则隐藏）
- 其余语言 → 沿用 hover 显

> 这是本项目（终端 + AI 原生）相对 Wolai 的**优势项**：md 里的命令块一键发到终端，应该比 Wolai 更顺手，而不是照搬它藏在菜单里的做法。

### C7 折叠

```tsx
const CollapseLineThreshold = 30;   // 超过 30 行默认折叠
const CollapsedMaxHeight = 250;     // ≈12 行 × 13px × 1.6
```
- 行数：`getTextContent(children).split("\n").length`
- 折叠态：`pre.codeblock.is-collapsed { max-height: 250px; overflow: hidden }` + 底部渐隐伪元素
- 底部按钮：「展开全部（共 N 行）」/「收起」，组件内 `useState`，不持久化
- **进入 inline-edit 自动展开**：折叠态下 `onDoubleClick` 先 `setExpanded(true)`，避免"看着被截断却在编辑全文"

### C8 复制纯净性（单测）

折叠与顶栏都只改 DOM 结构里的**控件节点**，复制取 `children`，因此：
- 复制内容 = 代码原文
- 不含「展开全部（共 N 行）」、不含语言名

---

## 3. 与 Wolai 的对齐 / 差异（最终）

**对齐**：背景一色（标题栏与代码区同色的观感→我们用顶栏弱化版）、14px 级字号与 1.6 行高、语言常驻且可切换、长块可收起、代码清晰不挤压。

**有意不同**：

| Wolai | 我们 | 原因 |
|---|---|---|
| 独立可编辑标题栏（28px） | 22px 顶栏，只放语言 + 操作 | 只读预览，无标题可写（见 §4 A 类） |
| 拖拽调高 | 折叠/展开 | 高度无处存（见 §4 A 类） |
| 3px 圆角 | 6px | 项目卡片 8px，协调 |
| 不换行（pre） | 默认换行（pre-wrap），P1 给开关 | 长命令/日志换行更好读 |
| 行号常显 | 默认关 | 窄屏省空间 + 复制纯净 |
| 复制藏在块菜单 | 复制 hover 显、**执行命令常驻** | 强化本项目终端能力 |

---

## 4. 明确不做（最终，按原因分类）

**A 类：Markdown 里没有这个位置，硬做就要往文件里塞只有我们认识的元数据**

| 项 | 准确原因 | 替代 |
|---|---|---|
| 代码块标题 | fence 只有 info string（惯例第一个词 = 语言，其余规范未定义）；` ```bash title="x" ` 是 Docusaurus/VitePress 扩展，**Obsidian 只取第一个词当语言**，高亮会错 → 破坏双向兼容 | 说明写在代码块**上方正文**里 |
| 拖拽调高的高度 | 高度是 Wolai 的块属性（存后台）；.md 里无处存 | 折叠/展开，不持久化 UI 状态 |

> 严格说往 info string 写 `title=""` 不违反 CommonMark（只是未定义），但我们多一条更强的约束：**Obsidian 双向兼容**。写了别人不认 = 污染文件。

**B 类：不是不能，是别处已经能做**

| 项 | 准确原因 |
|---|---|
| 在预览里直接编辑代码 | 代码**本来就能改**：双击进 inline-edit 或切 codeedit，改的是原文。不在只读预览里嵌编辑器——产品形态（预览/编辑分离），非 markdown 限制 |

**C 类：纯 UI 取舍**

| 项 | 原因 |
|---|---|
| 3px 圆角 | 项目卡片 8px，6px 更协调 |
| 左侧块菜单 | 项目已有自己的块操作入口 |

---

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 顶栏压住首行代码 | `padding-top: 1.6em` 留位 + 顶栏 absolute + `pointer-events: none` 容器 |
| 顶栏文本进剪贴板 | header 只装控件，复制取 `children`（单测断言） |
| 折叠后 inline-edit 视觉与内容不符 | 折叠仅 CSS 裁剪不改 DOM；双击自动展开；行坐标不变 |
| 半透明改不透明后暗色对比过强 | 暗色取 `#1c1c1c`（比面板略深），四套主题各验一次 |
| 13px 影响既有排版基线 | 只改 `pre.codeblock code`，不动 inline code 与 textarea |

---

## 6. 验收清单

1. 明暗两套主题各截一张：背景干净、语言常驻且不压首行
2. 100 行代码块：默认折 12 行，展开/收起正常，滚动时顶栏不消失
3. bash 块：执行按钮**常驻**；点击把命令发到终端
4. 复制：内容 = 代码原文，无 UI 文本；✓ 反馈仍在
5. 双击长块进 inline-edit：自动展开，保存后行号不错位
6. **启动耗时无变化**（纯 CSS + 组件内 state，无新增依赖、无启动期工作）
