# Milkdown 试用评估：结论（决策记录）

## Goal
免费试用 Milkdown（MIT），判断是否用它作为我们 markdown 编辑能力的底座。

## 结论（证据充分）
**不采用作底座；采用它的工程形态。** 建议把自有能力抽离为独立库（见后续任务）。

## 决定性证据
1. **往返保真不可接受**（实测 9 fixture + 8 篇真实笔记 = 17/17 全部被改写，0 字节一致；5/8 真实笔记含「写回即损坏」）：
   - `![[image/x.jpg|600]]` → `!\[\[...\]\]`：**6/6 Obsidian 嵌入图变字面文本**
   - callout / YAML frontmatter / `[[双链]]` / `![alt](p =WxH)` / `!!!key!!!` 六类语法落成 text 被转义，一次往返 **96 处**
   - 一篇表格被补 +26KB 纯空格（+48%）
2. **根因是事实源不同**：Milkdown 以内存 ProseMirror doc 为准、md 是有损投影；我们以文件为准、行号是写盘坐标。
3. **集成不适配**：整文档 contenteditable（我们是单块会话）；自定义块要重写 PM schema（量级 ≥ 现有编辑层）；Crepe 硬编码 17+ 色 + UI 是 Vue（违反「不改主题色」+ React 栈）；core 138KB gzip / Crepe 901KB，最小集 98 包 / 13MB。
4. 我方可直接受益的能力（IME/选区/undo/列表语义）**已自研并有 741 测试护栏**。

## 采纳（借工程形态，不引依赖）
- headless core + 绑定层分离 → 我们的 `md-core` / `md-react` 分法
- 对外插件契约 + 文档站 + **playground**（可做 fixture 驱动的 playground，同时补「零视觉回归」缺口）
- **schema 白名单序列化：未知节点必须显式处理，绝不静默丢弃**（对应我们序列化器 unwrap 隐患）
- step 化编辑（transaction）思想；semver + 包边界正规化

## Acceptance Criteria
- [x] 往返保真实测（字节级 diff + 证据归档）
- [x] 集成适配度评估（编辑面粒度/自定义块/主题/事实源冲突/替换成本）
- [x] 结论与采纳清单落到方案文档 `09-抽离为独立库-可行性评估.md`
