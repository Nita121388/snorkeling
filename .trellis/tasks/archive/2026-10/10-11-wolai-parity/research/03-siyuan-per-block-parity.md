# 车道 3/4：思源逐块实现对标 —— 交付索引

唯一交付物（已写入 Obsidian）：

`/Users/nita/Primary/obsidians/Obsidian/My Projects/Snorkling/方案/Block-Editor 笔记编辑体验升级/参考-Wolai对标/03-思源对标-逐块实现.md`
（954 行 / ~79 KB）

## 内容
- §0 事实获取方法：在 Node 中加载思源自带 `app/stage/protyle/js/lute/lute.min.js`，用与
  `kernel/util/lute.go:57-101 NewLute()` 完全相同的选项集跑 `Md2BlockDOM` / `BlockDOM2StdMd` /
  `BlockDOM2Md` / `SpinBlockDOM`，得到 26 组块类型的**实测 DOM 与往返结果**；其余结论来自源码阅读。
- §1 逐块总表：38 行 × 6 列（类型 | DOM | CSS 类 | 交互入口 file:line | 编辑模型 | markdown 映射）。
- §2 逐类详述：18 小节，每节「思源怎么做 / 为什么 / 能借鉴 / 不该照抄」。
- §3 对**本地 markdown 文件**模型的适配结论：3 条硬性前提差异（P1 源码=块树 vs markdown、
  P2 DOM 是 AST 无损编码 vs 视图反推、P3 有内核 vs 纯本地），
  以及「可直接迁移 13 项 / 必须改造 8 项 / 明确不做 8 项」三张表。
- §4 实测样本对照表（输入 markdown → 输出块 DOM 根类型 → 往返结果）。

## 关键结论（供汇总用）
1. **最高性价比**：复用思源「渲染 + 源码面板」单范式（`toolbar/index.ts:1490 showRender`
   + `:1523-1559 switch(data-subtype)`），一次性覆盖数学块 / HTML 块 / mermaid 等图表 / frontmatter。
2. **图表零成本**：思源把 mermaid/echarts/graphviz/flowchart/plantuml/abc 处理成**围栏代码块的
   render-node 形态**（`enter.ts:126-150`，`constants.ts:959-961`），源码存 `data-content`，往返无损。
   我们不需要新增语法或块类型。
3. **脑图 = 列表的另一种视图**（`listMindmap/render.ts:118-151`，派生 DOM 不落库），
   与我们的 markdown 嵌套列表天然契合；第一阶段只做只读预览。
4. **HTML 块是最值得抄的一条**：`protyle-html` Shadow DOM + `data-content` 存**源码**（不是渲染产物）
   + DOMPurify 默认消毒 + 输入时实时预览。
5. **思源主动关掉了** TOC（`lute.go:83`）、脚注（`:82`）、缩进代码块（`:84`）、定义列表（不解析）
   —— 实测 `[toc]` / `[^1]` 都是普通段落。这个"不能有"本身就是情报：我们保持它们为普通文本更安全。
6. **不可迁移的根因**：思源源码是块树，DOM 是块树的无损编码。我们源码是 markdown 文本，所以
   ①块身份必须留在文本里（行号 + 会话内 ID）；②折叠不能删内容；③渲染状态不能进 DOM；
   ④尺寸与表格富文本单元格这类"超 markdown"能力必须二选一（扩展语法 or 不做）。

## 工作范围
仅读取 `/Users/nita/Primary/projects/siyuan`，未修改任何仓库代码。
临时验证脚本位于 `/tmp/luteprobe/`（probe.cjs + 三个 markdown 样本）。
