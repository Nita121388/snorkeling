// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * **块类型 / 行内构造描述符** —— 「同一件知识只有一份声明」的那一份。
 *
 * ## 为什么需要它
 *
 * 实测：一个块类型的知识现在散在**六个文件**里
 * （渲染注册表 / 序列化 switch / sanitize 白名单 / 种子采集 / 往返有损判定 / 块语法守卫）。
 * 加一个新块类型要同时改六处，而**漏改的后果不是样式错，是数据被覆盖**
 * —— 本项目两类数据损坏（wiki 链接、脚注、图片）正是「渲染认识、序列化不认识」造成的。
 *
 * 本模块把「有哪些块类型 / 行内构造」以及它们的**往返保真规则**集中声明，
 * 由 `descriptor.test.ts` 的门禁机器检查：
 *
 * | 门禁 | 检查 |
 * |---|---|
 * | G1 | 六项声明齐全（缺一即红） |
 * | G2 | 描述符与渲染注册表 key **双向覆盖**（无遗漏、无死条目） |
 * | G3 | 描述符声明的 sanitize tag 必须在真实 schema 里存在 |
 * | G4 | 序列化器里的每个 case 都被某个描述符认领 |
 * | G5 | **往返可逆**：可还原的块，`序列化(渲染(源码)) === 源码`；不可还原的必须显式声明 |
 *
 * G5 是这套设计的核心价值：它把「渲染认识、序列化不认识」从**靠人记得**变成**测试必红**。
 *
 * ## 现状与迁移（诚实标注）
 *
 * 本轮（Phase 1）先做**声明 + 门禁**：描述符**指向**现有实现的位置，
 * 而不是把实现搬进来。这样可以在**零行为变化**的前提下先把「集合」与「配对关系」锁住。
 * 后续阶段（Phase 2）把实现搬到描述符里，switch/白名单等位置退化为查表。
 *
 * 本模块零框架、零 DOM、零宿主：只有纯数据声明（渲染/序列化的**实现**仍在各自的位置）。
 */

/**
 * 往返保真规则。**这是本文件存在的主要理由。**
 *
 * `recoverable: false` 表示「渲染后无法逐字节还原成源码」——这类构造**必须拒绝原位编辑**，
 * 否则用户可以靠打一个字就把自己的源码改掉（已实测发生）。
 * 一旦声明为 false，`lossyReason` 必填：它既是人的解释，也是拒绝时报给用户的理由。
 */
export type RoundTripRule =
    | {
          recoverable: true;
          /**
           * 渲染时携带原始源码的属性名（如 `data-source-markdown`）。
           * 有它就说明「渲染器把原文交给了序列化器」，往返逐字节可逆。
           */
          sourceAttr: string;
      }
    | {
          recoverable: false;
          /** 为什么还原不出来 —— 必填，人读 + 用来解释为什么这个块不能原位编辑。 */
          lossyReason: string;
      };

/**
 * 行内构造描述符（`**加粗**` / `` `code` `` / `[[wiki]]` / `![img]` / `[^fn]` …）。
 *
 * 单独建模的原因：本项目**两类数据损坏都出在这一层**，而块级建模抓不住它们
 * ——`[[note]]` 与 `[^1]` 都是块内行内内容，块类型（`p`）本身完全正常。
 */
export type InlineDescriptor = {
    /** 稳定标识（用于日志与诊断）。 */
    kind: string;
    /** 产出/消费的 DOM tag 名（大写或小写都接受，比较时统一）。 */
    tags: readonly string[];
    /** 对应 markdown 语法的人类可读形式（诊断用）。 */
    syntax: string;
    roundTrip: RoundTripRule;
    /** 该构造渲染时可能需要的额外 DOM 属性（进 sanitize 白名单）。 */
    sanitizeAttrs?: readonly string[];
};

/**
 * 块类型描述符。
 *
 * `editable` 表达的是**编辑引擎当前是否接管**这种块（不是"未来应该接管"）——
 * 声明与现实必须一致，否则门禁会红。
 */
export type BlockDescriptor = {
    /** 稳定标识（与 `InlineEditBlockKind` / 渲染 ctx 的 kind 对齐）。 */
    kind: string;
    /** 产出的 DOM tag 名。 */
    tags: readonly string[];
    /**
     * 渲染注册表里的 key（**1 对多**）。
     *
     * 一个块类型常常有多个渲染 key：标题有 `h1..h6`、列表有 `ul`/`ol`/`li`、
     * 引用有 `blockquote` 与 `calloutalert`。空数组 = 该块不由注册表渲染（如 blank 块）。
     */
    rendererKeys: readonly string[];
    /** 序列化器里认领这个块的 case（HTML tag，大写）。 */
    serializeCases: readonly string[];
    /** sanitize 必须放行的 tag（与真实 schema 交叉校验）。 */
    sanitizeTags: readonly string[];
    roundTrip: RoundTripRule;
    /** 编辑引擎是否已接管原位编辑。 */
    editable: boolean;
};

/**
 * 行内构造表。
 *
 * **顺序即优先级**：更具体的（wiki 链接、脚注引用）在通用形式（普通链接）之前声明。
 */
export const INLINE_DESCRIPTORS: readonly InlineDescriptor[] = [
    {
        kind: "wiki-link",
        tags: ["A"],
        syntax: "[[target|label]]",
        // 原文由 remark 插件挂到 `data-source-markdown`；序列化器读回并逐字输出。
        // 注意：`wave-wiki:` href **不可逆**（解析时会补 `.md`、分不出有无 label），
        // 所以必须有这条通道，不能靠 href 反推。
        roundTrip: { recoverable: true, sourceAttr: "data-source-markdown" },
        sanitizeAttrs: ["dataSourceMarkdown"],
    },
    {
        kind: "footnote-ref",
        tags: ["SUP"],
        syntax: "[^label]",
        // 显示的是**序号**、源码写的是 **label**，反推必错 → 必须带原文。
        roundTrip: { recoverable: true, sourceAttr: "data-source-markdown" },
        sanitizeAttrs: ["dataSourceMarkdown"],
    },
    {
        kind: "image",
        tags: ["IMG"],
        syntax: "![alt](src|size)",
        // 渲染器把 src 换成了解析后 URL，alt 与尺寸在别处；加载失败时还会渲染成占位文案。
        // 因此也不靠 DOM 重建，而是按 position **从源文件切原文**。
        roundTrip: { recoverable: true, sourceAttr: "data-source-markdown" },
        sanitizeAttrs: ["dataSourceMarkdown"],
    },
    {
        kind: "image-unresolved",
        tags: ["SPAN"],
        syntax: "图片加载失败时的占位文案",
        // 渲染器把 `![alt](a.png)` 换成一段英文占位文案；带原文即可逐字还原。
        // ⚠ 注：`SPAN` 在序列化器里同时是「未知包装 → 原样展开」的兜底分支。
        // 这里认领的是**有明确语义**的那一支（叶子 + 文本像占位 + 带原文）。
        roundTrip: { recoverable: true, sourceAttr: "data-source-markdown" },
        // 刻意**不**声明 sanitizeAttrs：这个占位 span 是 **React 渲染期**产出的，
        // 不在 hast 里，因此不经过 rehype-sanitize。
        // （而 `a` / `sup` / `img` 上的 data-source-markdown 来自 hast → 必须放行。
        //  这个区别正是 G3 要防的那类"看起来一样、通道不同"的错。）
    },
    {
        kind: "strong",
        tags: ["STRONG", "B"],
        syntax: "**text**",
        roundTrip: { recoverable: true, sourceAttr: "" },
    },
    {
        kind: "emphasis",
        tags: ["EM", "I"],
        syntax: "*text*",
        roundTrip: { recoverable: true, sourceAttr: "" },
    },
    {
        kind: "strikethrough",
        tags: ["DEL", "S", "STRIKE"],
        syntax: "~~text~~",
        roundTrip: { recoverable: true, sourceAttr: "" },
    },
    {
        kind: "code-span",
        tags: ["CODE"],
        syntax: "`text`",
        roundTrip: { recoverable: true, sourceAttr: "" },
    },
    {
        kind: "link",
        tags: ["A"],
        syntax: "[text](href)",
        // 普通链接**无损**：渲染器 `href={props.href}` 原样透传，序列化还原 `[t](u)`。
        // （实测确认过 —— 旧的 `/<img|<a/` 一刀切把这类也拒了，属于过度保守。）
        roundTrip: { recoverable: true, sourceAttr: "" },
    },
    {
        kind: "soft-break",
        tags: ["BR"],
        syntax: "行尾两空格 / 反斜杠",
        roundTrip: { recoverable: true, sourceAttr: "" },
    },
    {
        kind: "task-checkbox",
        tags: ["INPUT"],
        syntax: "- [ ] / - [x]",
        // 勾选状态不靠文本，靠 `<input checked>`；列表序列化器读它生成 `[x]`。
        roundTrip: { recoverable: true, sourceAttr: "" },
    },
];

/**
 * 块类型表。
 *
 * `editable: true` 的四类（p / h / quote / list）与
 * `md-dom/src/seed.ts` 的 `WYSIWYG_KINDS` 以及在位编辑的块类型闸门一致；
 * 改这里必须同步改那边，门禁会比对。
 */
export const BLOCK_DESCRIPTORS: readonly BlockDescriptor[] = [
    {
        kind: "p",
        tags: ["P"],
        rendererKeys: ["p"],
        serializeCases: ["P"],
        sanitizeTags: [],
        roundTrip: { recoverable: true, sourceAttr: "" },
        editable: true,
    },
    {
        kind: "h",
        tags: ["H1", "H2", "H3", "H4", "H5", "H6"],
        rendererKeys: ["h1", "h2", "h3", "h4", "h5", "h6"],
        serializeCases: [],
        sanitizeTags: [],
        roundTrip: { recoverable: true, sourceAttr: "" },
        editable: true,
    },
    {
        kind: "quote",
        tags: ["BLOCKQUOTE", "CALLOUTALERT"],
        rendererKeys: ["blockquote", "calloutalert"],
        serializeCases: ["BLOCKQUOTE"],
        sanitizeTags: ["calloutalert"],
        // callout 的标记（`[!Note]` + emoji）不占正文 —— 编辑时被摘掉，提交时按原文大小写回写。
        roundTrip: { recoverable: true, sourceAttr: "data-source-markdown" },
        editable: true,
    },
    {
        kind: "list",
        tags: ["UL", "OL", "LI"],
        rendererKeys: ["ul", "ol", "li"],
        serializeCases: ["UL", "OL", "LI"],
        sanitizeTags: [],
        roundTrip: { recoverable: true, sourceAttr: "" },
        editable: true,
    },
    {
        kind: "code",
        tags: ["PRE"],
        rendererKeys: ["pre"],
        // 代码块的 DOM→markdown 不走 `serializeNode` 的行内 switch（走 `stripCodeFence` /
        // 专用代码编辑器），所以这里不认领 case —— 有意如此，不是漏。
        serializeCases: [],
        sanitizeTags: [],
        roundTrip: { recoverable: true, sourceAttr: "" },
        editable: false,
    },
    {
        kind: "table",
        tags: ["TABLE"],
        rendererKeys: ["table"],
        serializeCases: [],
        sanitizeTags: [],
        // 表格**单元格**是常驻可编辑的（另一套内联编辑器），整块不走在位编辑。
        roundTrip: { recoverable: true, sourceAttr: "" },
        editable: false,
    },
    {
        kind: "hr",
        tags: ["HR"],
        rendererKeys: ["hr"],
        serializeCases: [],
        sanitizeTags: [],
        roundTrip: { recoverable: true, sourceAttr: "" },
        editable: false,
    },
    {
        kind: "blank",
        tags: [],
        // 空行块由 spacer 渲染器产出（标签是带 class 的 p），不是独立 tag。
        rendererKeys: [],
        serializeCases: [],
        sanitizeTags: [],
        roundTrip: { recoverable: true, sourceAttr: "" },
        editable: true,
    },
];

/**
 * 结构性渲染 key：**不是块类型**，而是行内/结构的渲染入口。
 *
 * 它们与块描述符是两套东西（如 `a` / `img` / `sup` 由行内描述符管；
 * `source` / `button` / `span` 是渲染细节），因此不要求块描述符覆盖。
 * 显式列出而不是用正则筛 —— 新加一个 key 时**必须在这里或描述符里二选一**，
 * 否则 G2 红。这正是门禁的价值。
 */
export const STRUCTURAL_RENDERER_KEYS: readonly string[] = [
    "a",
    "img",
    "source",
    "code",
    "input",
    "span",
    "button",
    "waveblock",
    "mermaidblock",
];

/**
 * 取「不可还原」的理由：可还原返回 `null`。
 *
 * 存在的意义有两层：
 * 1. 引擎用它决定**是否拒绝原位编辑**，以及拒绝时给用户什么解释；
 * 2. 让「判别联合的收窄」只有一处。
 */
export function roundTripLossyReason(rule: RoundTripRule): string | null {
    // 用 `in` 收窄而非 `rule.recoverable ? … : …`：本项目 tsconfig 下布尔判别属性对三元
    // 的收窄不生效（实测 TS2339），`in` 更稳且不依赖 strict 配置。
    return "lossyReason" in rule ? rule.lossyReason : null;
}

/** 所有被声明覆盖的 render key（块描述符 + 结构性 key）。 */
export function declaredRendererKeys(): string[] {
    const keys = new Set<string>(STRUCTURAL_RENDERER_KEYS);
    for (const d of BLOCK_DESCRIPTORS) {
        for (const k of d.rendererKeys) {
            keys.add(k);
        }
    }
    return [...keys];
}
