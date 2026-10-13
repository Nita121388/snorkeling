# 执行计划（切片 1：p/h/quote/callout 在位编辑）

## 0. 前置
- [ ] 工作树干净；基线 58 文件 / 851 用例；tsc 68

## 1. 建立可复现基线（先红，再绿）
- [ ] 沙箱（quickdev + 9333 + 草稿含 p/h/quote/callout）跑 parity-check，记录 overlay 路径下
      color/fontWeight/backgroundColor 的现实差异（用户报告的症状复现证据）
- [ ] 新增 flag `wysiwyg-inplace`（block-editor/flags.ts），默认关

## 2. EditableBlock 组件（核心新增）
- [ ] 在 markdown-render 侧新增 `EditableBlock`：props（kind, seedHtml, className 前缀, 会话回调）
  - 根元素：与预览完全一致的 tag + className（引用同一渲染器产出的 class）
  - contenteditable + 共享键盘/IME 语义（**先抽 hook**：把 WysiwygEditor 的 keydown/composition/enter 逻辑
    提为 `useWysiwygEditing` 供两路径共用，overlay 路径引用它保持行为不变）
  - blur/esc → commit 回调；内部同步 draftText（与 overlay 的 sync 镜像逻辑一致）
- [ ] 序列化：编辑体 DOM → markdown 走既有 serialize（与 overlay 相同的函数）
- [ ] 提交：调既有 chain（prepareInlineEditCommit 等）—— 具名导出避免复制

## 3. 渲染器接线 + 冻结
- [ ] 会话 atom：活跃会话 {kind,startLine,blockId}（global store）
- [ ] 渲染器（registry 的 p/h/quote/callout 路径）：若该块 ∈ 活跃会话 → 渲染 EditableBlock（同一根 class）
- [ ] 冻结：EditableBlock 分支天然不依赖 textAtom 内容 → 无重渲染冲突；验证编辑中输入/失焦期间
      textAtom 变更不会重写该块 DOM（单测 + 沙箱）
- [ ] beginEdit 入口：点击块（markdown.tsx 的 click/dblclick 路径）→ flag 开时走 inplace 会话，
      flag 关时走 overlay（双轨，互不影响）

## 4. 测试与验证
- [ ] 单测（新增 inplace 测试文件）：
  - EditableBlock 根 className/attrs 与渲染器输出一致（结构同构）
  - 会话中 textAtom 变更不重渲染该块（冻结断言）
  - 编辑→序列化→提交 与 overlay 路径相同输入产相同 markdown
  - blur 空稿/Esc 取消不写盘（复用空壳守卫测试语义）
- [ ] 沙箱：开 flag 后对 p/h/quote/callout 跑 parity-check（差异应 0 或仅定位豁免）；
      往返 md5 一致
- [ ] 全量：58 文件 / 851+ 用例全绿；门禁全过

## 5. 收尾
- [ ] spec 记录「wysiwyg-inplace 双轨 + EditableBlock 契约（根 class 必须等于渲染器输出）」
- [ ] 不提交（主线复核）；标题用 refactor(wysiwyg-inplace)

## 纪律
- 绝不在 9222 点/改；新增样式必须过 overlay 契约门禁（或明确为「非 overlay 作用域」）
- 不改写盘逻辑；不新增颜色值；不动 package-lock/HANDOFF；不跑全量 tsc/build
