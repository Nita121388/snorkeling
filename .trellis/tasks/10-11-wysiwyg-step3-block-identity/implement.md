# 实施计划：块身份 + 块级提交定位 + 逆操作记账

按 S1 → S2 → S3 顺序执行；每步跑 `npx vitest run frontend/app/element` + `npx tsc --noEmit`。

## 0. 开工前

- [ ] `pwd && git branch --show-current` → `~/Primary/projects/snorkeling-wysiwyg` + `feat/wysiwyg-block-editor`
- [ ] 读 `prd.md`（**关键判断：id 是身份、不是坐标**）与 `design.md`（探针结论 + 算法 + 守卫顺序）
- [ ] 基线：47 文件 / 678 用例全绿；tsc 68

## 1. S1 块身份

- [ ] `remark/block-ids.ts`：`fnv1a` + `collectText` + `remarkBlockIds`（白名单块级节点、
      `hProperties` **合并不覆盖**、id = `摘要-出现序号`）
- [ ] `remark/index.ts`：插件插到**管线靠后**（loose-list spacing 之后、content block 之前）
- [ ] `markdown-sanitize-schema.ts`：`attributes["*"]` 加 `"dataBlockId"`（**只加一次**）
- [ ] 顺带修 `markdown-render/calloutalert.render.test.tsx` 的**镜像 schema**：改用
      `makeMarkdownSanitizeSchema()`（刚入库的维护规则要求测试 import 真实 schema）
- [ ] 单测 `remark/block-ids.test.ts`（5 例，见 design S1）
- [ ] 提交：`feat(block): 块身份 data-block-id（内容寻址、确定性、重复块消歧）`

## 2. S2 陈旧检测与重定位

- [ ] 先抽 `initialContentFor(kind, sourceSlice)`（list 去 marker / code 去围栏），
      **beginEdit 与守卫共用**；回归：现有 beginEdit 相关用例全绿
- [ ] `InlineEditSession.blockId`（beginEdit 从 `targetEl.dataset.blockId` 读）
- [ ] `commit()` 内、写盘之前：① 用 `[data-block-id=…]` 重定位取当前行号；
      ② 陈旧检测（跳过 `insertMode` 与空 `initialContent`）不符则中止 + 调试日志
- [ ] 单测 5 例（见 design S2），含「中止时不调用 onCommit」
- [ ] 提交：`feat(block): 提交前按块身份重定位 + 陈旧检测（宁可丢一次编辑，不写错块）`

## 3. S3 逆操作记账

- [ ] `use-editor-history.ts`：条目类型加可选 `op: EditorHistoryOp`
- [ ] `markdown.tsx` 提交通道把 `{blockId, startLine, endLine, before, after}` 一起 push
- [ ] 单测：条目携带 op；**现有撤销/重做用例行为不变**
- [ ] 提交：`feat(block): 提交记账块级逆操作数据（为阶段 4 结构操作准备）`

## 4. 沙箱实测（窗口必须先置为可见）

```bash
node scripts/dev-isolated.mjs --profile scratch --vite-port 51752 --cdp-port 9333
node /tmp/cdp-keepalive.mjs http://127.0.0.1:9333 "Wave Terminal - T1" 600 &
node scripts/inspect-electron-ui.mjs --endpoint http://127.0.0.1:9333 --target "Wave Terminal - T1" state
```

- [ ] 场景 1：编辑块 A → 提交（行号位移）→ 编辑块 B → 提交；B 写对位置、A 完好
- [ ] 场景 2：编辑器打开时从磁盘改草稿（触发重渲染）→ 提交 → **拒绝写入**，文件只有外部改动
- [ ] 场景 3：两个内容相同的块分别编辑 → 各改各的
- [ ] 每个场景前后 `md5` 比对 + `sed -n` 看关键行；草稿可从 `.backup-*.md` 还原

## 5. 收尾

- [ ] 全量 vitest + tsc（基线不退化）
- [ ] spec：`component-guidelines.md` 补「块身份：id 是身份、行号是坐标」+「陈旧检测」；
      `directory-structure.md` 补 `remark/block-ids.ts`
- [ ] `prd.md` 记实测结果与偏差；归档 + 推送；Obsidian 开发记录 + TODO

## 回滚点

- S1 独立（纯新增 + allowlist）；S2 依赖 S1（无 id 时自动退化，不崩）；S3 完全独立
