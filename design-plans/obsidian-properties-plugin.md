# Obsidian 笔记属性（frontmatter）样式化渲染插件 — 调研与设计

> 调研时间：2026-08-14（cooking session）

---

## 1. 需求背景

在 Snorkeling 预览区打开一个含 YAML frontmatter（Obsidian 属性）的 `.md` 文件时，frontmatter 区域被当作普通 Markdown 渲染：

- 开始/结束的 `---` 被 GFM 解析为 `<hr>`（分隔线）
- YAML 键值对渲染为纯文本段落

Obsidian 原生会把 frontmatter 渲染为**属性面板**（Properties），样式为：
- 顶部卡片容器（圆角、内边距、浅背景、边框）
- 每行：左侧类型图标 + 键名；右侧值（按类型格式化：tag 为彩色 chip、list 为多值 chip、boolean 为开关、link 为 wikilink、date/datetime 为日期格式等）

目标：新增一个插件（利用 `preview-plugin-registry`），将 frontmatter 渲染成 Obsidian 风格的属性卡片，正文保持原有 Markdown 渲染。

---

## 2. 现状调研

### 2.1 渲染管线

```
text (fileContent)
  → transformBlocks()     ← @@@ 块 → !!!type[id]!!! 占位
  → remark 插件链          ← remarkMermaidToTag → fileRefs → softBreaks → GFM → blankSpacers → contentBlock
  → rehype → rehype-sanitize (tagNames 含 waveblock)
  → ReactMarkdown → markdownComponents["waveblock"] → WaveBlock
```

**frontmatter 的现状**：remark 链中无 `remark-frontmatter` 插件。`---` 被 GFM 拓展解析为 `thematicBreak`（hr），YAML 行成为 `paragraph` 文本。即：**纯文本渲染**。

### 2.2 已有基础设施（可复用）

| 模块 | 位置 | 可复用内容 |
|------|------|-----------|
| YAML 解析 | `yaml@2.8.3`（package.json） | base-view 已依赖 |
| frontmatter 解析 | `plugins/base-view/base-filter.ts` `parseFrontmatter()` | 正则 `^---\r?\n...\r?\n---`，返回 `Record<string,unknown>` |
| 插件注册表 | `preview-plugin-registry.ts` | `PreviewPlugin` 接口（match/render/priority/canEdit） |
| content-block 机制 | `remark/index.ts` `makeRemarkPlugins` + `markdown-contentblock-plugin.ts` | `!!!type[id]!!!` 占位 → `waveblock` 节点 → `components["waveblock"]` → `WaveBlock` 组件 |
| 主题 CSS 变量 | `markdown.scss` | `--panel-bg-color` `--border-color` `--main-text-color` `--secondary-text-color` `--accent-color` `--highlight-bg-color` |
| sanitize schema | `markdown.tsx` 1735 行附近 | `tagNames` 含 `waveblock`；`attributes` 含 `waveblock: [["blockkey"]]` |
| 测试工具链 | vitest + unified + remark-parse（`blank-line-spacers.test.ts`） | 相同的 remark 插件测试模式可直接复用 |

### 2.3 关键约束：inline-edit 坐标语义

这是本方案设计的**核心约束**，源自 inline-edit 的实现（`markdown-inline-edit.tsx`）：

```
InlineEditSession.startLine = 1-based, inclusive, original text coordinate (NOT transformedText)
```

- DOM 上的 `data-source-line` 来自 rehype 节点的 `position.start.line`（**渲染文本/transformedText 的行号**）
- `useInlineEdit` 的 `fullText` = 传给 `Markdown` 组件的 `text` prop（原文）
- commit 时用 `replaceLinesRange(originalText, startLine, endLine, newText)` 基于**原文坐标**替换片段
- 隐含前提：transformedText 的行号 ≈ 原文行号（管线保持此对应关系）

**推论**：
- ❌ **渲染文本改写方案会破坏 inline-edit 草稿保存**：若把 frontmatter 行替换为空白/占位，commit 时 frontmatter 会丢失
- ✅ **唯一安全路径是 mdast 节点级替换**：文本与行号不变，只替换渲染输出（frontmatter 区域在 DOM 中从多个文本节点变成 1 个 waveblock 卡片组件）
- waveblock 节点不输出文本 → inline-edit 双击卡片区域：无 `[data-source-line]` → 不进入编辑，符合 Phase 1 只读需求

---

## 3. Obsidian 原生属性面板对标

Obsidian Properties UI 特征：

| 特征 | 实现 |
|------|------|
| 顶部卡片 | 圆角、边框、背景色、内边距 |
| 每行 | 左：类型图标 + 键名；右：值 |
| 类型图标 | text=字体、number=井号、boolean=开关、date=日历、tag=标签、list=列表、link=链接、json=大括号 |
| tag 值 | `#tag` 渲染为彩色 chip |
| list 值 | 多值 chip 列表 |
| boolean | true/false 文本或开关样式 |
| link | `[[wikilink]]` 样式 |
| 折叠/排序 | Phase 2+ |
| 编辑 | Phase 2+ |

类型推断策略（对齐 Obsidian）：

1. 键名匹配 known table：`tags`/`tag` → tag-list；`aliases`/`cssclasses` → list；`date`/`created`/`modified` → date/datetime；`publish`/`draft`/`permalink` → boolean（仅当值为 boolean 时）
2. YAML 值类型推断（按优先级）：
   - boolean（true/false）→ boolean
   - number → number
   - array → 根据元素：
     - 全是 string 且以 `#` 开头 → tags（多标签）
     - 含 `[[...]]` → links
     - 否则 → list
   - string：
     - 以 `#` 开头 → tag
     - 含 `[[...]]` → link
     - ISO 日期格式（YYYY-MM-DD 或含时间）→ date/datetime
     - 其他 → text
   - object（非 null/非数组）→ json

---

## 4. 方案对比

### 方案 A：插件整体接管 Markdown 渲染

插件 match `.md` → render 里自行组装属性卡片 + `<Markdown>` 组件渲染正文。

- ✅ 最符合插件注册表语义
- ❌ 需复制 `MarkdownPreview` 的 ~20 个 props 组装逻辑（resolveOpts、idPrefix、collapse seeds、scroll、inline-edit 回调等），维护两套并行
- ❌ `MarkdownPreview` 的 live preview / 双栏滚动等封装无法复用

### 方案 B：渲染文本改写（frontmatter 行替换为空白行）

插件 render：把原文 frontmatter 行替换为空行，渲染 `<Markdown text={替换文本}>`，卡片叠加在外部。

- ✅ 实现最简单
- ❌ **破坏 inline-edit 保存**（frontmatter 丢失）—— 核心约束违反，❌

### 方案 C：mdast 节点级替换 + 通用 waveBlockRenderers 委托（推荐）

新 remark 插件把 frontmatter 对应的 mdast 节点组替换为 `waveblock` 节点；`Markdown` 组件增加通用 `waveBlockRenderers` 委托（按 block.type 分派 React 组件）+ `frontmatterBlock` 可选 prop；插件负责解析与卡片渲染，通过透传 `MarkdownPreview` 复用全部现有能力。

**组件流**：
```
MdPropertiesView(model)
  ├ 无 frontmatter → <MarkdownPreview model/>               ← 原样复用
  └ 有 frontmatter → <MarkdownPreview model
       frontmatterBlock={fb}              ← 传行范围+yaml
       waveBlockRenderers={{              ← 按 type 渲染卡片
         "obsidian-props": ObsidianPropertiesCard
       }}/>
```

- ✅ **文本/行号不动** → inline-edit 零破坏
- ✅ **正文管线完全复用** → 无需复制 MarkdownPreview 逻辑
- ✅ markdown.tsx 只加通用能力（frontmatterBlock + waveBlockRenderers + remark 插件挂载），**无业务耦合**
- ✅ 插件可独立回退、独立测试
- ⚠️ 需小幅扩展 `Markdown` 组件（~10 行 props + ~5 行注册 + WaveBlock 分派）

### 推荐：方案 C

---

## 5. 方案 C 详细设计

### 5.1 文件清单

```
frontend/app/element/remark/
  frontmatter-to-waveblock.ts        ← 新增：通用 remark 插件（按行范围替换节点为 waveblock）
  frontmatter-to-waveblock.test.ts   ← 新增

frontend/app/view/preview/plugins/md-properties/
  frontmatter-block.ts               ← 新增：解析（行范围 + YAML + 类型推断）
  frontmatter-block.test.ts          ← 新增
  obsidian-properties-card.tsx       ← 新增：Obsidian 风格卡片组件
  obsidian-properties-card.scss      ← 新增
  md-properties-plugin.tsx           ← 新增：插件定义 + MdPropertiesView
  md-properties-plugin.test.ts       ← 新增

frontend/app/element/markdown.tsx     ← 修改：MarkdownProps 扩展 + WaveBlock 分派
frontend/app/view/preview/preview-markdown.tsx  ← 修改：透传 frontmatterBlock/waveBlockRenderers
frontend/app/view/preview/preview.tsx           ← 修改：注册插件
```

### 5.2 remark 插件：`remark-frontmatter-to-waveblock.ts`

通用能力：按 `[startLine, endLine]`（1-based, inclusive）把 mdast 顶层节点替换为 waveblock 节点。

```ts
// 输入
type Options = {
    startLine: number;   // frontmatter --- 起始行
    endLine: number;     // frontmatter --- 结束行
    blockKey: string;    // waveblock blockkey（如 "obsidian-props[fm]"）
};

// 输出：mdast tree 原地替换
// frontmatter 区域的所有顶层节点 → 1 个 paragraph 节点
// data.hName = "waveblock", data.hProperties.blockkey = blockKey
// position = 原首尾节点 position（保持 spacer 计算稳定）
```

### 5.3 解析模块：`frontmatter-block.ts`

```ts
type FrontmatterBlock = {
    startLine: number;     // 1-based, --- 起始行
    endLine: number;       // 1-based, --- 结束行
    yamlText: string;      // 去分隔符的 YAML 纯文本
    data: Record<string, unknown>;   // YAML.parse 结果
};

// frontmatter 要求文件开头：第一非空行为 ---
// 结束符：--- 或 ...（YAML 规范）
// 兼容 CRLF
// 行号计算：用文本 split('\n') 的索引映射

type PropertyEntry = {
    key: string;
    value: unknown;
    displayType: PropertyDisplayType;
    displayValue: string | string[] | boolean | number;
};

type PropertyDisplayType = "text" | "number" | "boolean" | "date" | "tag" | "tags" | "list" | "link" | "json";

function parseFrontmatterBlock(content: string): FrontmatterBlock | null;
function inferPropertyType(key: string, value: unknown): PropertyDisplayType;
function formatPropertyValue(type: PropertyDisplayType, value: unknown): string | string[] | boolean | number;
function buildPropertyEntries(data: Record<string, unknown>): PropertyEntry[];
```

### 5.4 卡片组件：`obsidian-properties-card.tsx`

- 输入：`block: MarkdownContentBlockType`（block.content = YAML 文本）
- 解析 → `buildPropertyEntries()` → 遍历渲染行
- 只读：Phase 1 无编辑、无折叠、无排序
- 样式：`.obsidian-props-card` 圆角 + 边框 + 主题背景色；每行 flex；类型图标；键名 secondary-text；值按类型格式化

### 5.5 插件：`md-properties-plugin.tsx`

```ts
export const mdPropertiesPlugin: PreviewPlugin = {
    id: "md-properties",
    displayName: "属性视图",
    priority: 0,
    match: (ctx) =>
        (ctx.fileName.endsWith(".md") || ctx.fileName.endsWith(".mdx")) && !ctx.editMode,
    render: ({ model, parentRef }) => <MdPropertiesView model={model} parentRef={parentRef} />,
    canEdit: () => false,
    icon: "file-lines",
};

// MdPropertiesView
function MdPropertiesView({ model, parentRef }) {
    const textLoadable = useAtomValue(loadable(model.fileContent));
    const text = textLoadable.state === "hasData" ? textLoadable.data : undefined;
    const fb = useMemo(() => (text ? parseFrontmatterBlock(text) : null), [text]);

    if (fb == null) {
        // 无 frontmatter 或解析失败 → 原样 markdown
        return <MarkdownPreview model={model} parentRef={parentRef} />;
    }

    const blockKey = "obsidian-props[fm]";
    return (
        <MarkdownPreview
            model={model}
            parentRef={parentRef}
            frontmatterBlock={{ ...fb, blockKey }}
            waveBlockRenderers={{ "obsidian-props": (block) => <ObsidianPropertiesCard block={block} /> }}
        />
    );
}
```

### 5.6 `markdown.tsx` 扩展

新增 MarkdownProps（可选）：

```ts
frontmatterBlock?: {
    startLine: number;
    endLine: number;
    yamlText: string;
    blockKey: string;
} | null;

waveBlockRenderers?: Record<string, (block: MarkdownContentBlockType) => React.ReactNode>;
```

组件内（transformBlocks 之后）：

```ts
// 注册 frontmatter block 到 contentBlocksMap
if (frontmatterBlock) {
    contentBlocksMap.set(frontmatterBlock.blockKey, {
        type: "obsidian-props",
        id: frontmatterBlock.blockKey,
        content: frontmatterBlock.yamlText,
    });
}
// 追加 remark 插件（在 content-block 之前；push 到数组即可，不影响顺序语义）
if (frontmatterBlock) {
    remarkPlugins.push(
        remarkFrontmatterToWaveBlock({
            startLine: frontmatterBlock.startLine,
            endLine: frontmatterBlock.endLine,
            blockKey: frontmatterBlock.blockKey,
        })
    );
}
```

WaveBlock 分派：

```ts
// markdownComponents["waveblock"] 改为：
markdownComponents["waveblock"] = (props) => (
    <WaveBlock {...props} blockmap={contentBlocksMap} renderers={waveBlockRenderers} />
);

// WaveBlock 内部：
function WaveBlock({ blockkey, blockmap, renderers }) {
    const block = blockmap.get(blockkey);
    if (block == null) return null;
    const renderer = renderers?.[block.type];
    if (renderer) return <>{renderer(block)}</>;
    // 默认文件名卡片（现有逻辑）
    ...
}
```

### 5.7 `preview-markdown.tsx` 透传

MarkdownPreview 新增可选 props（frontmatterBlock / waveBlockRenderers），内部透传给 `<Markdown>`。

### 5.8 测试计划

| 测试文件 | 范围 | 用例 |
|----------|------|------|
| `frontmatter-to-waveblock.test.ts` | remark 插件 | 正常替换、空 frontmatter、多 YAML 行、无 frontmatter（noop）、行号注入 |
| `frontmatter-block.test.ts` | 解析 + 类型推断 | 基本解析、CRLF、`...` 结尾、无 frontmatter、非法 YAML、类型推断（tags/date/boolean/list/json/link）、空 frontmatter |
| `md-properties-plugin.test.ts` | 插件 match | `.md` 只读→true、editMode→false、`.base`→false、`.txt`→false |

渲染冒烟：手动/CDP 验证（复用 `scripts/inspect-electron-ui.mjs` 工具）。

---

## 6. 风险与边界

| 风险 | 影响 | 缓解 |
|------|------|------|
| 非法 YAML | frontmatter 无法解析 | treat as 无 frontmatter，回退纯 Markdown 渲染 |
| frontmatter 含 `---` 作为 YAML 值 | 提前结束解析 | 使用 mdast 节点范围（基于行号）而非正则，更稳健 |
| frontmatter 后紧跟内容无空行 | 正文与卡片间距 | blank-spacer 处理；无空行时无 spacer（正常，Obsidian 也无） |
| live preview 内的 .md | 也有 frontmatter | 自动生效（live preview 走 Markdown 组件）；inline block 不走此路径（无 fileContent）|
| editMode | 不应接管 | match 里排除 `ctx.editMode`；getSpecializedView 会回落 codeedit |
| 大 frontmatter（>100 行） | 渲染性能 | YAML.parse 足够快；Phase 1 无虚拟化，100 行仍可接受 |
| frontmatter 为空对象 `{}` | 卡片标题显示"0 个属性" | 显示"无属性"，或不渲染卡片（视 Obsidian 行为：空属性面板仍显示标题） |
| 重复 `---`（非 frontmatter） | 误识别 | 要求第一行必须是 `---`（与 Obsidian 一致） |

---

## 7. 后续迭代（Phase 2+）

- 属性编辑：双击属性卡片 → 行内编辑 value → 写回 YAML
- 折叠/展开属性面板
- 排序拖拽
- 类型手动覆盖（配置对话框）
- 支持 YAML 的其他方言（如 TOML frontmatter：`+++` 起始）

---

## 8. 实现优先级

1. ✅ 调研文档（本文件）
2. remark 插件 + 基础测试
3. frontmatter 解析 + 类型推断 + 测试
4. 卡片组件 + 样式
5. 插件定义 + MdPropertiesView
6. markdown.tsx 扩展（props + waveBlockRenderers）
7. preview-markdown.tsx 透传
8. preview.tsx 注册
9. 端到端测试
10. 更新项目笔记（06-开发记录.md）
