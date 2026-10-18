// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * `@snorkeling/md-codemirror` 公共类型。
 *
 * 不变量（由 `boundary.test.ts` 锁死）：
 *   - 包内**零 React 运行时依赖**（不 import react / react-dom / react-markdown）；
 *   - 包内**零 Monaco**（CodeMirror 只服务 Markdown / 卡片文本，不碰代码编辑器）；
 *   - 包内**零宿主静态依赖**（不 import 宿主 `@/`；相对路径必须落在包内；只允许裸包名
 *     与 `@snorkeling/md-core` 的**纯子路径**（`core/markdown-refs` 这类零 React 模块））。
 */

import type { EditorView } from "@codemirror/view";
import type { Extension, Transaction } from "@codemirror/state";

/** 编辑器模式：`live-preview` 是默认、主路径。三种模式共用同一个 CodeMirror 文本状态。 */
export type MarkdownEditorMode = "preview" | "source" | "live-preview";

/** 一次用户编辑产生的文本变化（基于当前文档坐标）。 */
export type MarkdownChange = {
    /** 变化起点（新文档坐标，code units）。 */
    from: number;
    /** 变化终点（新文档坐标）。 */
    to: number;
    /** 插入的文本。 */
    inserted: string;
    /** 被删除的原文（可用于往返校验）。 */
    removed: string;
    /** 变化来源：用户输入 / `setValue` / command（默认不传 = 用户输入）。 */
    origin?: "user" | "external" | "command";
};

/** 光标/选区变化回调的参数（`to === from` 时是折叠光标）。 */
export type MarkdownSelection = { from: number; to: number } | null;

/** 宿主事件：复杂业务 UI 由宿主接管，编辑器只发语义事件。 */
export type MarkdownHostEvent =
    | { type: "link-activate"; href: string; text?: string; from: number; to: number }
    | { type: "image-action"; src: string; alt?: string; from: number; to: number }
    | { type: "slash-request"; from: number; to: number }
    | { type: "block-command"; command: string; from: number; to: number };

/**
 * 宿主适配器（与 md-core 的 `MdHostAdapter` 概念对齐，但**只含编辑内核需要的面**）。
 *
 * 默认实现是行为安全的空实现：
 * - 链接激活：不打开（消费方接入后才会导航）；
 * - 图片：按原 src 直出，失败显示占位文案；
 * - 自定义 widget 的交互：全部落到 `onEvent`，由消费方决定如何响应。
 */
export type MarkdownEditorHost = {
    /**
     * 把 markdown 图片 src 解析成可加载 URL。
     * 默认：原样返回（`null` → 渲染占位）。
     */
    resolveImageSrc?(src: string, opts: { from: number; to: number }): string | null;
    /** 激活普通链接 / wiki link / 文件引用（默认：不处理）。 */
    openLink?(href: string, opts: { from: number; to: number; text?: string }): void;
    /**
     * 编辑内核无法内部处理的语义事件（链接点击 / 图片点击 / slash 请求 / block 命令）。
     * 消费方用它接管复杂 UI；返回 true 表示已处理（内核不再兜底）。
     */
    onEvent?(event: MarkdownHostEvent): boolean;
};

export type MarkdownEditorOptions = {
    /** 挂载节点（编辑器会清空其内容并接管）。 */
    parent: HTMLElement;
    /** 初始 Markdown 文本（**事实源**：CodeMirror doc 保存的就是它）。 */
    value: string;
    /** 初始模式，默认 `live-preview`。 */
    mode?: MarkdownEditorMode;
    /** 宿主能力（链接 / 图片 / 事件）。不传 = 默认实现。 */
    host?: MarkdownEditorHost;
    /** 追加的 CodeMirror extensions（消费方自带 keymap / 主题 / 插件）。 */
    extensions?: Extension[];
    /** 用户输入回调：`value` 是**完整**新文本（增量编辑看 `change`）。 */
    onChange?: (value: string, change: MarkdownChange) => void;
    /** 光标/选区变化回调（每次 selection 变化都触发，含点击与键盘）。 */
    onSelectionChange?: (range: MarkdownSelection) => void;
};

/** 内置/宿主可执行的命令。结构化，便于序列化与撤销日志。 */
export type MarkdownCommand =
    | { type: "insert-text"; text: string; at?: number }
    | { type: "replace-text"; from: number; to: number; text: string }
    | { type: "delete-line"; at?: number }
    | { type: "toggle-task"; at?: number };

/** `createMarkdownEditor` 的返回实例。 */
export type MarkdownEditor = {
    /** 底层 CodeMirror EditorView（受控访问，理论上有 `view` 就等于解锁全部能力）。 */
    view: EditorView;
    focus(): void;
    getValue(): string;
    /** 外部同步入口：直接替换全文，**不触发** `onChange`（避免循环）。 */
    setValue(value: string): void;
    /** 切换模式：只 reconfig Compartment，不重建 EditorView / 不复制文本状态。 */
    setMode(mode: MarkdownEditorMode): void;
    getMode(): MarkdownEditorMode;
    /** 发送一个原生 CodeMirror transaction（供高级扩展用）。 */
    dispatch(transaction: Transaction): void;
    /**
     * 执行结构化命令。返回是否产生了实际 changes。
     * 所有命令必须产生明确的文本 change，**不能直接改 DOM**。
     */
    runCommand(command: MarkdownCommand): boolean;
    /** 销毁：清空 DOM、解绑事件、释放资源。之后 `view` 不可再用。 */
    destroy(): void;
};