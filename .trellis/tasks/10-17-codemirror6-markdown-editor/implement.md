# Implement：CodeMirror 6 Markdown Live Preview 编辑内核

## Phase 0：基线与依赖

- [ ] 提交并 push 当前上一阶段已验证变更；确认工作树干净。
- [ ] 新增 CodeMirror 6 依赖（state/view/language/commands/markdown 等最小集合）并同步 lockfile。
- [ ] 建立 `packages/md-codemirror`（或明确现有包内边界），零 React、零 Monaco、零 SCSS。
- [ ] 添加包边界门禁与纯 ESM build 入口。

## Phase 1：核心实例

- [ ] 实现 `createMarkdownEditor(options)`。
- [ ] 实现 `preview/source/live-preview` mode 切换，不复制文本状态。
- [ ] 实现 `getValue/setValue/focus/dispatch/runCommand/destroy`。
- [ ] 把 CodeMirror transaction 转为 `onChange(value, change)`。
- [ ] 接入 Markdown language support、history、selection、滚动和 IME。

## Phase 2：Markdown Live Preview MVP

- [ ] 实现标题/强调/删除线/行内 code 的语法隐藏和样式。
- [ ] 实现列表、task checkbox、blockquote。
- [ ] 实现普通链接/wiki link、脚注、图片的安全 widget/decoration。
- [ ] 未知语法保持 source 可见，不能静默删除或改写。
- [ ] 添加至少一个自定义 decoration/widget 扩展示例。
- [ ] 添加至少一个宿主 command 示例。

## Phase 3：journal 卡片真实接入

- [ ] 在 journal card editor 中替换 `editorContent` textarea，保留 title/type/status 等其他字段。
- [ ] 实现 source/live-preview 切换。
- [ ] 保存时只提交 `content` Markdown 字段。
- [ ] 重新打开卡片时恢复文本、模式、光标/选区的合理行为。
- [ ] 用真实隔离卡片数据验证 wiki/footnote/image/列表/标题往返。

## Phase 4：体验与性能门禁

- [ ] 点击位置、中文 IME、Enter/Backspace/Tab、Undo/Redo、滚动回归测试。
- [ ] 验证无多余边框、无错误背景、无 focus scroll loop。
- [ ] 小卡片、中等 Markdown、100 次连续输入、滚动、提交、销毁基准。
- [ ] 记录目标结果和阈值；失败时禁止接入 Snorkeling。

## Phase 5：Snorkeling 薄绑定原型

- [ ] 新增 React 薄绑定，只负责 lifecycle/props/ref。
- [ ] 独立 prototype 接入一个 Markdown 页面/块。
- [ ] Monaco 代码路径保持不变。
- [ ] 现有手写 WYSIWYG 作为显式回退，直到新路径通过全部验收。

## Validation gates

- `npx tsc --noEmit`：错误数量与错误集合不得新增。
- CodeMirror package boundary tests：零 React/Monaco/宿主 import，纯 ESM 可加载。
- 现有 `md-core`/`md-dom` 往返与提交测试全部通过。
- journal card fixture：source/live-preview/save/reopen 全链路通过。
- 性能基准产出可重复记录，不以肉眼判断。
- 提交前运行 `git diff --check`、局部 vitest、全量失败集合对比基线。

## Rollback points

- P0：依赖或核心实例未通过边界门禁 → 不接 journal。
- P1：Live Preview 语法损坏或 IME/scroll 失败 → 保留 textarea fallback。
- P2：journal 保存/重开往返不保真 → 回滚 card adapter，不影响卡片数据。
- P3：Snorkeling 原型回归 → 不启用 React 绑定，继续使用旧路径。
