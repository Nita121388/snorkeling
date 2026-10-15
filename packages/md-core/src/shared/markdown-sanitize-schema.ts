// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Markdown 渲染的 sanitize schema（从 markdown.tsx 抽出，抽出的唯一理由是**可测**）。
//
// 动机是一个静默 bug：同一 tag 上写多条 ["className", …] 时，hast-util-sanitize 的
// findDefinition **只取第一条**，其余整条忽略。10-08 的 callout 竖排修复
// （span.markdown-alert-title-text）因此从未在应用里生效，而当时的单测用的是
// 「镜像 schema」——顺序与真实 schema 不同，于是漏掉了。schema 可被测试直接 import
// 之后，这类漂移不可能再发生。
import { defaultSchema } from "rehype-sanitize";

/** 文件路径链接允许的 href 协议（markdownUrlTransform 也用它，故导出）。 */
export const FilePathHrefProtocols = [
    ...(defaultSchema.protocols?.href ?? []),
    "file",
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
];

/**
 * 构建 markdown 渲染用的 sanitize schema。
 *
 * ⚠️ 维护规则：**同一 tag 的同一属性名只能出现一次**。
 * hast-util-sanitize 的 findDefinition（lib/index.js:744）对同名属性只取第一条定义，
 * 后面的条目整条被忽略 —— 多条 ["className", …] 不取并集，只有第一条生效。
 * 需要放宽时，把新的允许值**并进已有的那一条**。
 */
export function makeMarkdownSanitizeSchema(): typeof defaultSchema {
    return {
        ...defaultSchema,
        attributes: {
            ...defaultSchema.attributes,
            // step3 块身份：remarkBlockIds 把 `data.hProperties.dataBlockId` 交给 remark-rehype
            // 后变成 hast 属性 `dataBlockId`，**插件设的属性必须过 sanitize**（渲染器自己产的
            // srcLineAttrs 不过，所以过去不需要放行）。放行后 hast-util-to-jsx-runtime 输出
            // `data-block-id`，由渲染器的 {...domProps(props)} 落到 DOM。
            // ⚠️ 同名属性只写一条（见文件顶部维护规则）。
            "*": [...(defaultSchema.attributes?.["*"] ?? []), "dataBlockId"],
            p: [
                // blank-line-spacers plugin emits spacer paragraphs tagged with
                // className=["paragraph","blank-spacer"] + dataSpacerLines +
                // dataEmptySpacer. defaultSchema has no `p` entry so sanitize
                // would strip these and the .paragraph.blank-spacer CSS sizing
                // rules would never match.
                //
                // hast property names are camelCased (hastscript normalises
                // kebab `data-spacer-lines` -> `dataSpacerLines`); a regex like
                // /^data./ would also work, but pinning the exact names keeps
                // the surface tight.
                ["className", "paragraph", "blank-spacer", "markdown-alert-title"],
                "dataSpacerLines",
                "dataEmptySpacer",
            ],
            span: [
                ...(defaultSchema.attributes?.span || []),
                // ⚠️ className 只能有**一条**定义：hast-util-sanitize 的 findDefinition 对同名
                // 属性**只取第一条**（node_modules/hast-util-sanitize/lib/index.js:744），后面的
                // ["className", …] 会被整条忽略。10-08 把竖排修复包进
                // span.markdown-alert-title-text 时正是踩了这个坑：第一条 /^hljs-./ 生效、
                // `markdown-alert-title-text` 被静默剥成 class=""，CSS 的 flex/min-width 从未
                // 落到 DOM（沙箱实测 span flex 仍是 0 1 auto，竖排 bug 其实没修掉）。
                // 因此把「所有允许的 span class」并进这一条。
                ["className", /^hljs-./, /^markdown-alert/, "is-empty"],
                ["srcset"],
                ["media"],
                ["type"],
                // Alternatively, to allow only certain class names:
                // ['className', 'hljs-number', 'hljs-title', 'hljs-variable']
            ],
            waveblock: [["blockkey"]],
            // Callout block identity (R1): remarkCalloutAlert emits <calloutalert>
            // with a `markdown-alert*` class. Sanitize must allow the tag + class or
            // the element is unwrapped before the renderer ever sees it. The source
            // coordinates are added by the renderer (srcLineAttrs), not present here,
            // but allow them too so a future round-trip cannot strip them.
            calloutalert: [["className", /^markdown-alert/], "dataSourceLine", "dataSourceLineEnd"],
            div: [...(defaultSchema.attributes?.div || []), ["className", /^markdown-alert/], "dir"],
            button: [
                // 同上：className 只留一条（is-empty = 空 emoji 按钮的 hover 态样式）
                ["className", /^markdown-alert/, "is-empty"],
                "type",
                "ariaLabel",
                "dataAlertType",
                "dataAlertLine",
                "dataAlertEmoji",
            ],
            // remarkLooseListSpacing tags loose lists with data-loose so CSS can
            // restore the blank-line spacing between items.
            ol: [...(defaultSchema.attributes?.ol || []), "dataLoose", "start", "dataSplitGroup"],
            ul: [...(defaultSchema.attributes?.ul || []), "dataLoose"],
            // wiki 链接的**原始源码**（`[[target|label]]`）：序列化器靠它做逐字节往返。
            // 不放行就会被 sanitize 静默剥掉 —— 表现是“代码看起来都对，但往返又退回了
            // `[label](wave-wiki:…)`”，很难归因。属性名是 camelCase 形式（同上文说明）。
            a: [...(defaultSchema.attributes?.a || []), "dataSourceMarkdown"],
            // 脚注引用的原始源码（`[^id]`）：同理由（remark-gfm 生成的 sup 结构无法反推）。
            // 必须展开 defaultSchema —— 不展开会把这个标签的默认白名单**整个抹掉**。
            sup: [...(defaultSchema.attributes?.sup || []), "id", "dataSourceMarkdown"],
            // 图片的原始源码（`![[a.png|300]]` / `![alt](a.png)`）：渲染器把 src 换成了
            // 解析后 URL，尺寸与 alt 都在别的属性上，必须靠原始源码还原。
            img: [...(defaultSchema.attributes?.img || []), "dataSourceMarkdown"],
        },
        protocols: {
            ...defaultSchema.protocols,
            href: [...FilePathHrefProtocols, "wave-wiki"],
        },
        tagNames: [
            ...(defaultSchema.tagNames || []),
            "span",
            "waveblock",
            "calloutalert",
            "picture",
            "source",
            "mermaidblock",
            "div",
            "svg",
            "path",
            "button",
        ],
    };
}
