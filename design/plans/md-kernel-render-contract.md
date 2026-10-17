# 渲染契约 + 块类型描述符（md 内核的分层规范）

> 状态：▲ 设计活跃（未实现 / 落地中）
> 镜像源：Obsidian `My Projects/Snorkling/方案/Block-Editor 笔记编辑体验升级/11-我们自己的Milkdown-架构与公开API.md`（架构总纲）
> 关联：`design/plans/block-editor-goals.md`（最终目标与三条第一原则）

## 0. 这份文档解决什么

**同一件知识存在两份**，是本项目已知的**全部**事故来源：

| 表现 | 实测证据 |
|---|---|
| 「渲染认识、序列化不认识」→ 静默改写用户文件 | wiki 链接 / 脚注 / 图片三类数据损坏（`ff16ef19` 起修复） |
| 提交守卫写两遍且**已经不一致** | `markdown-inline-edit.tsx` 9 处 + `commit-plan.ts` 7 处 |
| overlay 专属样式通道 | 60 处（`data-block-kind` / 内联快照 `captureBlockTypography` …） |
| overlay CSS 镜像台账 | 60 条未审计条目 |
| 一个块类型的知识散在 6 个文件 | 加一个新块类型要同时改 6 处 |

本文档**只做两件事**，其余都是执行细节：

1. **定义渲染契约** —— 渲染产物与编辑引擎之间的**公开接口**（谁实现它，谁就能被引擎驱动）。
2. **定义块类型描述符** —— 一个块类型的**全部知识集中在一处**，六项齐全由门禁机器检查。

---

## 1. 分层与依赖规则

```
   host          适配层：每个项目一份，**全部可选、全部有默认实现**
    ↑
 md-react        React 绑定：薄（挂载 + 生命周期），不管 DOM 内容
    ↑
  md-dom         编辑引擎：caret / 种子 / 提交 / 往返 / 块级更新调度
    ↑
  md-core        模型 + 渲染：remark 管线、块模型、DOM↔markdown、DOM 渲染、
                 契约、**块类型描述符**、sanitize
```

规则（由门禁锁死，每条都可测试）：

| # | 规则 | 判据 |
|---|---|---|
| R1 | 只能向下依赖，包间单向 | 扫描 import 图 |
| R2 | `md-core` / `md-dom` 内**零框架** | 不出现 `react` / `react-dom` / `react-markdown` / `jotai` |
| R3 | `md-react` 是**唯一** React 层 | 同上，反向断言 |
| R4 | 每个包**零必需 CSS** | 包内不 import `.scss` / `.css` |
| R5 | 每个包可独立构建与测试 | 各自的 test 命令不需要宿主 |

> **修正一处文档谬误**：设计文档写 `md-core 无 DOM`，但 `md-core/src/transform/dom-to-markdown.ts`
> 本来就是 DOM 代码（序列化器）。**正确的边界是「无框架」，不是「无 DOM」。**

---

## 2. 渲染契约（公开接口）

契约是**渲染与编辑之间的唯一约定**。任何渲染实现（我们自己的、第三方的）只要满足它，
就能被 `md-dom` 驱动 —— 这是「可复用」的技术含义。

### 2.1 必须一致的字段

| 字段 | 语义 | 谁产出 | 谁消费 | 缺失/错误后果 |
|---|---|---|---|---|
| `data-source-line` | 块在源码里的起始行（1-based） | 渲染 | 编辑引擎 | 写盘坐标错 → **写错位置** |
| `data-source-line-end` | 结束行；多行视觉块（软换行段落/标题/多行列表）必需 | 渲染 | 编辑引擎 | 只改到首行 → **丢后续行内容** |
| `data-block-id` | 块身份（稳定，重渲染不变） | 渲染 | 编辑引擎 | 无法重定位 → 陈旧检测失效 → **覆盖别人的改动** |
| 块根 `tagName` + 块 class | 样式与种子采集的依据 | 渲染 | 编辑引擎 + 宿主 CSS | 种子错 → 编辑态样式漂移 |
| `data-source-markdown` | **往返有损构造**的原始源码（wiki 链接/脚注/图片） | 渲染 | 序列化器 | 用户源码被改写（**已发生过的数据损坏**） |
| `data-action` | 交互件标识（折叠/勾选/emoji），由事件委托处理 | 渲染 | 编辑引擎 | 交互件需绑框架 → 无法复用 |

### 2.2 明确**不必**一致的东西（避免过度约束）

- 是否有多余的 `<button>` 等交互 chrome
- 包装层级的深浅（wrapper div 的有无）
- 事件处理器、内联 style、`title` 之类
- React 特有的 memo 边界

> **为什么必须写这一节**：如果不写清「哪些不必一致」，契约测试会被写成"整个 DOM 全等"，
> 而 Snorkeling 的渲染器有交互 chrome、第三方渲染器不会有 —— 那种测试永远不可能通过，
> 最后只能靠豁免表维持，等于没有契约。

### 2.3 契约的验证方式

**可执行的判据**（不是"看一眼对不对"）：

1. **字段存在性**：对固定语料，每个块根必须有 `data-source-line` + `data-block-id`。
2. **坐标正确性**：`data-source-line` 必须能在原文里定位到该块的内容（切片比对）。
3. **往返保真**：对每个块，`序列化(渲染(源码切片))` 必须与源码切片**逐字节相同**，或该块
   必须带 `data-source-markdown` 且有对应的还原测试。
4. **引擎可用性**：`md-dom` 对渲染产物能完整走通「锚点 → 种子 → 提交」而不需要任何补充信息。

第 3 条是最强的那一条：**它把"渲染与序列化成对"变成可测的不变量**，
而正是这一对的缺失造成了本项目的两类数据损坏。

---

## 3. 块类型描述符（`BlockDescriptor`）

### 3.1 为什么必须是"一处声明"

现状（实测）：一个块类型的知识散在**六个文件**——

```
md-core/src/render/renderer-registry.tsx          渲染器（24 个 key）
md-core/src/transform/dom-to-markdown.ts          DOM→markdown（22 个 case 分支）
md-core/src/shared/markdown-sanitize-schema.ts    sanitize 白名单
md-dom/src/seed.ts                                渲染 DOM → 编辑器种子
md-dom/src/lossy.ts                               往返有损判定
md-dom/src/block-syntax.ts                        块语法 / 空壳守卫
```

加一个新块类型要同时改六处。**漏改的后果不是样式错，是数据被覆盖。**

### 3.2 六项（缺一不可）

```ts
export type BlockDescriptor = {
  kind: string;                          // 稳定标识（如 "h"、"list"、"math"）
  tags: readonly string[];                // 产出的 DOM tag 名（如 ["h1","h2",...]）

  // ① 渲染：AST 节点 → DOM
  render: BlockRenderFn;

  // ② 序列化：DOM → markdown（与 ① **成对**定义 —— 防"漏改"的关键）
  serializeFromDom: BlockSerializeFn;

  // ③ 种子：渲染 DOM → 编辑器初始内容（返回 null = 这个块不可用 WYSIWYG 编辑）
  seedFromDom: BlockSeedFn;

  // ④ 往返保真：能不能逐字节还原；不能就必须拒绝编辑（绝不静默改写）
  roundTrip: {
    recoverable: boolean;
    sourceAttr?: string;                  // 如 "data-source-markdown"
    lossyReason?: string;                 // 不可还原时给用户的解释
  };

  // ⑤ sanitize：白名单（tag + 属性），由描述符**生成**而不是各处手写
  sanitize: { tagNames: readonly string[]; attributes: SanitizeAttributes };

  // ⑥ 可编辑：是否允许原位编辑 + 判据（如"根必须带 data-block-id"）
  editable: (ctx: BlockEditContext) => boolean;
};
```

### 3.3 门禁（机器检查，不靠人）

| # | 检查 | 失败含义 |
|---|---|---|
| G1 | 六项全部存在且非空 | 有人只写了一半 |
| G2 | `tags` 与渲染注册表的 key 互相覆盖（无遗漏、无死条目） | 新增块类型时漏注册 |
| G3 | `sanitize.tagNames ⊆ 渲染 tag`，且 schema 由描述符生成 | `data-*` 被 sanitize 静默剥掉（**已踩过的坑**） |
| G4 | `roundTrip.recoverable === false` 的描述符，**必须**有对应拒绝路径 | 有损构造被放行 → 数据损坏 |
| G5 | `serializeFromDom` 对 `render` 的产物**逐字节可逆**（或按 G4 拒绝） | 渲染与序列化不成对 → 就是本次修的两类事故 |

G5 是这套设计的**核心价值**：它把「渲染认识、序列化不认识」从
「靠人记得」变成「测试必红」。

### 3.4 与业界对照

| | 我们的 `BlockDescriptor` |
|---|---|
| ProseMirror | `NodeSpec`（schema + toDOM + parseDOM） |
| Lexical | `Node`（子类：createDOM / updateDOM / importDOM / exportDOM） |
| 我们 | 上述 + **markdown 往返保真** + **编辑可否**（因为我们的事实源是文件，不是内存树） |

---

## 4. 性能：块级增量更新（硬要求，非优化项）

**绝不能每次改动重建整份 DOM。** 三层保护：

| # | 机制 | 为什么 |
|---|---|---|
| ① | 渲染产物按 `data-block-id` 索引；更新时按 id 对比内容哈希，**只替换变化的块** | 全量 `innerHTML = html` 会丢焦点、丢选区、掉滚动位置 —— 既是性能问题，**更是易用性事故**（用户正在打字，光标跳走） |
| ② | 正在编辑的块不被渲染器接管（已有：`inplaceFrozenTextRef`） | 避免编辑中被打断 |
| ③ | **序列化只在提交时**，击键时不做 DOM→markdown | 已有经验记录：每击键全量序列化会卡 |

后续增强：**视口虚拟化**（长文档只渲染可见区附近，前提是块高度可估算）。

> **诚实说明**：单一渲染真源的价值是**正确性与可扩展性**，不是"比 React 快"。
> Snorkeling 现在靠 memo 在滚动时是零 React 开销。性能目标是**不比重构前差**，
> 因此 Phase 4 必须有**大文档基准门禁**，不能靠感觉。

---

## 5. 易用性：零配置可用 + 按需覆盖

```js
// 必须直接能用，零参数、零 host 实现
const node = renderMarkdown(md);
node instanceof HTMLElement;                    // true —— 不是字符串，可直接 append

// 只覆盖想改的那几项
renderMarkdown(md, { image: myResolver });

// 零框架：显示 + 编辑
const ed = createMarkdownEditor({
  root: container,
  value: md,
  mode: "edit",                                 // "preview" | "edit"
  host: journalHost,                            // 全部可选
  onChange(nextText, op) {},
  onSelectionChange(range) {},
  onBlur() {},
});
ed.focus(); ed.insertText("x"); ed.toggleBold(); ed.setBlockType("h2");
ed.setValue(md2);                               // 外部更新（不触发 onChange）
ed.destroy();
```

要点：
- **一个 options 对象**（不用位置参数，加选项不破坏调用方）
- **host adapter 是唯一宿主接触面**，且**全部有默认实现** —— 不允许"先实现 30 个方法才能显示一段文字"
- **主题**：零必需 CSS + 可选 `theme.css`（纯 CSS 变量）
- **预览/编辑同源**：同一份 DOM → 双击进入编辑没有跳变（overlay 那一类"文字跳一下"从根上消失）
- **键盘语义是一等公民**：Enter 拆分 / Backspace 合并 / 跨块方向键 / 多选 / 拖拽集中在
  `md-dom` 的交互层，不散落在框架组件里

---

## 6. 边界：明确不做的事

| 不做 | 原因 |
|---|---|
| 自研富文本内核（第二套 ProseMirror） | 内存文档树当事实源 → 保存重写整个文件、与 Obsidian/vim/git 冲突到整篇级别。**实测过**：Milkdown 17/17 文件被改写 |
| **我们自己**维护两套渲染实现 | 每个新语法要写两遍 = 可扩展性的死刑。第三方按契约实现**支持**；我们两套同步维护**反对** |
| overlay 与在位编辑**长期**双轨 | 双份样式（60 处通道 + 60 条镜像）+ 双份守卫（已不一致）+ 双份差异。**退役 ≠ 删功能，而是机制单轨** |
| schema 拒绝用户写的 markdown | 不认识的语法必须**原样显示、不静默改写** |

---

## 7. 路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| **1** | **本文档（契约）+ `BlockDescriptor` 落地 + 六项门禁 G1–G5** | ▲ 进行中 |
| 2 | 框架无关渲染真源上线（统一 DOM 产出） | ⬜ |
| 3 | 编辑引擎接到同一份 DOM（A3 推广全类型，**退役 overlay 双轨**） | ⬜ |
| 4 | 块级增量更新 + **性能门禁（大文档基准）** | ⬜ |
| 5 | 交互层集中（键盘/多选/拖拽/块菜单） | ⬜ |
| 6 | dist 打包 + journal 接入 + fixture playground | ⬜ |

### 验收（"可复用"的定义）

| 项 | 判据 |
|---|---|
| 非 React 消费者跑通 | journal 一张卡的 `content`：渲染 + 就地编辑 + 往返不丢内容 |
| 零差异 | 契约测试：同一 md → 编辑态与预览态结构逐项一致（§2.1 字段） |
| 分层成立 | R1–R5 全部由门禁断言 |
| Snorkeling 零回归 | 既有用例 + parity 门禁 |
| 无打包器可用 | 一个纯 HTML 页面 import dist 就能渲染 + 编辑 |
