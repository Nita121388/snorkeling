# 设计：A3 在位编辑引擎（切片 1：prose）

## 机制（React 惯用，不与 React 打架）

出现活跃会话（`{startLine, blockId, kind}` 记入 global atom，如复用 inlineEditingActiveAtom 或新增）时，
**块渲染器对"会话中的块"改渲染为编辑体**：

```
渲染器产出（预览态）：<div class="paragraph" data-source-line data-block-id>…渲染结果…</div>
会话中（编辑态）     ：同一渲染器产出 <EditableBlock …>：根元素保留相同 className/attrs，
                      内部挂 contenteditable + 与 WysiwygEditor 同源的键盘/IME 语义，
                      种子 = captureWysiwygInfo 产物（净内容）
```

- **关键点：根元素的 class 与 data-* 与预览一致 → 命中同一套 .markdown .content 样式 → 零差异**
- 冻结：活跃会话期间，该块子树跳过 textAtom 驱动的重渲染（用 `memo` + 会话 key 判定，
  或渲染器对会话块直接走 EditableBlock 分支，天然不读 textAtom 内容）
- 提交：EditableBlock 失焦/Esc → 调既有 `commit()` 纯链（DOM 序列化 → prepareInlineEditCommit → 写盘）
- 取消：Esc → 无写盘，会话清除，块回渲染态

## 与 overlay 路径的差异（本任务要"新写"的部分）
| 能力 | overlay（旧） | inplace（新） |
|---|---|---|
| 样式来源 | 快照 + overlay CSS（追不平） | 块自身 class（同一套）✅ |
| 挂载 | createPortal(position:fixed) | 原位 React 分支 |
| 冻结 | 无需（overlay 独立） | 需防 textAtom 重渲染冲掉编辑体（memo/分支） |
| 提交链 | 复用 | **同一套复用** |
| 键盘/IME | WysiwygEditor | 共享同一实现 |

## 切片边界（本任务只做 p / h1-h6 / quote / callout）
- list/table/code 不在此切片（list 有整表语义、table/code 有专用编辑器，各归其位）
- 图片/链接块继续走 textarea 回退（现状，不在本任务范围）

## 风险与回滚
- 冻结策略若有漏（React 重渲染冲掉编辑 DOM）→ flag 关掉即回旧路径；不会影响线上行为（双轨）
- 键盘语义若与 overlay 有细微分歧 → 共享实现层必须单一（把 WysiwygEditor 语义抽成 hook/控制器，两路径共用）
- 数据安全：提交链与守卫不变 → 风险面不变
