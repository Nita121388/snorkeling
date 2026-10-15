// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * **往返有损判定**：这块的渲染 DOM 里，有没有「序列化器还原不回去」的东西。
 *
 * ## 为什么需要它
 *
 * 渲染是**有损**的：`[[note|label]]` 渲染成 `<a href="wave-wiki:…">label</a>`，
 * `[^1]` 渲染成 `<sup>1</sup>`，`![[a.png|300]]` 渲染成 `<img>`（src 还是**解析后**的 URL）。
 * 而提交是「把当前 DOM 重新序列化写回文件」。
 * 于是：**只要让用户原位编辑这类块并提交，用户的源码就会被静默改写。**
 *
 * 实测（`serializeBlockDomToMarkdown` 真实输出）：
 *
 * | 源码            | 往返后                              | 后果                   |
 * |-----------------|-------------------------------------|------------------------|
 * | `[[n\|label]]`   | `[label](wave-wiki:n)`               | wiki 语法丢失（Obsidian 打开是死链） |
 * | `[^1]`           | `[1](#fn-1)`                        | 脚注引用丢失            |
 * | `![[a.png\|300]]` | `![](a.png)`                       | **alt 文本 + 尺寸全丢** |
 * | `![](missing.png\|100)` | `[Image unavailable: missing.png%7C100]` | **图片语法被占位文案吃掉** |
 * | `[t](u)`        | `[t](u)`                            | ✅ 无损                 |
 *
 * ## 这里是**安全网**，不是终点
 *
 * 命中即返回 `true`，调用方必须**拒绝原位编辑**、回落到「让用户看到原始标记」那条路。
 * 理由是这个文件族一贯的哲学（见 `seed.ts` 的注释原文）：
 * **宁可让用户看到原始标记，也不能丢内容。**
 *
 * 长期解法是让序列化器学会还原（渲染时把原源码塞进 `data-*`，序列化时读回来），
 * 做完之后这类块才能重新纳入原位编辑。在那之前，这一层是唯一拦住数据损坏的东西。
 *
 * 本模块零 React、零宿主。
 */

/** 已知的「渲染有损、序列化还原不回去」的行内构造。 */
export type LossyConstruct = "footnote-ref" | "wiki-link" | "image" | "image-unresolved";

/**
 * 选择器 → 有损类型。每一项都对应上面表里一行实测证据，不是推测。
 *
 * 注意 `img` 判据之所以这么宽（不看有没有尺寸）：渲染器把 src 换成了解析后的 URL
 * （`resolveImageSrc`），**任何**图片的 src 都已经不是源码路径了。
 */
const LOSSY_SELECTORS: ReadonlyArray<readonly [string, LossyConstruct]> = [
    // [^label] → <sup>：序列化器原本只会退回显示序号（引用关系丢失）。
    // **已救回**：remark 插件给行内引用挂 data-source-markdown（`[^label]`）→ 逐字还原。
    //   拿不到标注的是**定义区的回链**（`[^1]: 定义` 渲染出的 <sup>2</sup>），仍然有损。
    ["sup", "footnote-ref"],
    // [[target|label]] → <a href="wave-wiki:…">：只能还原成 [label](wave-wiki:…)，wiki 语法丢失
    // **但已经救回来了**：渲染器会挂 data-source-markdown（原始源码），序列化器逐字还原。
    //   所以只要**该元素**带这个属性，就不再算有损（见下方 wikiLinkRecoverable）。
    //   逐字节保真 + “用户改了 label 不能被吞”都有专门测试钉住。
    ['a[href^="wave-wiki:"]', "wiki-link"],
    // ![[a.png|300]] → <img src="解析后URL">：src / alt / 尺寸都还原不回去
    ["img", "image"],
    // 图片**加载/解析失败** → <span class="markdown-img-error">[Image unavailable: …]</span>
    ["span.markdown-img-error", "image-unresolved"],
];

/**
 * 占位文本标记：图片解析失败的**另一支**渲染是 `<span>{[img:…]}</span>`（**无 class**，
 * 见 `md-core/src/render/image.tsx`），按选择器抓不到，只能认文本。
 *
 * 宁可误判：用户真的在正文里写 `![[img:…]]` 会失去原位编辑（可恢复、只是难看），
 * 漏判则是图片语法被占位文案吃掉（不可恢复）。方向必须偏向前者。
 */
const IMAGE_PLACEHOLDER_TEXT_RE = /\[Image unavailable:|\[img:/;

/**
 * 已学会还原的构造：元素上带着 remark 层挂下来的**原始源码**时，就不再有损。
 *
 * 语义：「没有原始源码 → 无法还原 → 拒写」；「有原始源码 → 能逐字还原 → 放行」。
 * 逐字还原必须配一个「用户改过没有」的判据，否则会静默丢弃用户的编辑 ——
 * 见 dom-to-markdown 的 `A` 分支（有实现有测试）。
 */
const RECOVERABLE_ATTR = "data-source-markdown";

/**
 * 已经学会逐字还原的构造：带上原始源码就不再有损。
 *
 * **必须有白名单**：带上了源码但**序列化器不读它**的构造（目前是 image）仍然是丢的，
 * 误判成“可还原”会直接放行数据损坏。
 */
const RECOVERABLE_KINDS: ReadonlySet<LossyConstruct> = new Set<LossyConstruct>(["wiki-link", "footnote-ref"]);

/** 该元素是否「已学会还原」：构造在白名单里、且元素上带着原始源码。 */
function isRecoverable(kind: LossyConstruct, el: Element): boolean {
    return RECOVERABLE_KINDS.has(kind) && el.getAttribute(RECOVERABLE_ATTR) != null;
}

/**
 * 扫描「即将被序列化的那段内容」里所有有损构造。
 *
 * 参数应是**实际要序列化的内容**（可以是元素，也可以是 fragment），
 * 而不一定是渲染根 —— 因为判据要回答的是「提交时会丢什么」，
 * 而不是「页面上有什么」。两者不同时（渲染面有 chrome、种子已剥掉），
 * 用渲染根会**误拒**（用户白丢原位编辑）。
 *
 * 含根/fragment 自身是必要的：`img` 单独成块时，根**就是** `<img>`，只查后代会漏掉。
 *
 * 返回去重后的类型列表（空数组 = 可安全原位编辑）。
 * 去重按**类型**而非元素 —— 同一段落里 5 个 wiki 链接对调用方是同一个决策。
 */
export function findLossyInlineConstructs(root: ParentNode | null | undefined): LossyConstruct[] {
    if (root == null) {
        return [];
    }
    const found = new Set<LossyConstruct>();
    for (const [selector, kind] of LOSSY_SELECTORS) {
        const el = root as Element;
        // matches() 覆盖「根自己就命中」，querySelector 覆盖后代。
        const selfHit = typeof el.matches === "function" && el.matches(selector);
        const hits = root.querySelectorAll(selector);
        if (selfHit) {
            if (!isRecoverable(kind, el)) {
                found.add(kind);
            }
        }
        for (const hit of hits) {
            if (isRecoverable(kind, hit)) {
                continue; // 已学会还原 → 放行
            }
            found.add(kind);
            break;
        }
    }
    // 无 class 的图片占位 span：只能认文本。
    if (IMAGE_PLACEHOLDER_TEXT_RE.test(root.textContent ?? "")) {
        found.add("image-unresolved");
    }
    return [...found];
}

/** 便捷判据：这���内容能不能原位编辑（不能丢内容的那种）。 */
export function canEditInPlaceLosslessly(root: ParentNode | null | undefined): boolean {
    return findLossyInlineConstructs(root).length === 0;
}