# 执行计划：parity-harness

1. [x] 盘点现存 `.inline-edit-overlay[data-block-kind]` 全部声明，逐条判定「结构性 / 可供性」→ 形成白名单与现实差异清单
2. [x] 写 `overlay-style-contract.test.ts`（先让它**红**，把现实差异暴露出来）
3. [x] 逐条消除结构性声明（改为让预览样式自然生效）——**这是本任务的主体工作量**（切片 1–4：code 块合并选择器、WYSIWYG prose 簇删 3 留 6）
4. [x] 写 `markdown-seed-parity.test.tsx`（覆盖 p / h1-h6 / ul-ol-li / blockquote / calloutalert / code / table）
5. [x] 写 `scripts/parity-check.mjs` + 在隔离沙箱对代表性块跑两态比对，输出差异表（7 类块零差异实测通过）
6. [x] 修 `--wolai-*` 悬空 token + 加 token 存在性校验测试（`token-existence.test.ts`，修 6 个悬空 token）
7. [x] 全量验证：element + md-core = 771 用例全绿（54 文件）/ tsc 68（基线）/ 沙箱 7 类块 parity 差异 0
8. [x] spec 入库（component-guidelines.md 补「overlay 只做可供性」不变量 + 门禁指针）+ Obsidian 记录

## 停手条件
若发现消除某条结构性声明会**改变预览本身的排版**（即预览样式本身依赖 overlay 覆盖），停下来报告——那属于预览侧设计问题，要单独决策。
