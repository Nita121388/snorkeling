# Design Routing Rules — 设计资产分流规则

> 本文件是所有 Agent（包括 pi agent、codex、claude-code）生成/编辑设计相关文件时的**路由决策表**。
> 最后更新：2026-09-09

---

## 四个"家"的职责（不可越界）

| 家 | 路径 | 职责 | 内容类型 | 约束 |
|---|---|---|---|---|
| 🧠 Obsidian | `E:/File/NitaFile/Obsidians/Obsidian/My Projects/Snorkling/` | **思考层**：头脑风暴、计划、记录 | 头脑风暴、需求文档、竞品调研、开发记录、Bug 修复记录、方案草案、TODO | 有 Frontmatter 强制规范（tags/area/type/status），见 `CLAUDE.md` |
| 🎨 design/prototypes | `<repo>/design/prototypes/` | **原型层**：可交互的 HTML/CSS/JS 演示 | 可浏览器打开的交互原型 | 每个原型目录必须有 `README.md`，顶部带状态标记 |
| 📐 design/plans | `<repo>/design/plans/` | **设计层**：成型的、可交付的设计文档 | 定稿设计文档、最终方案、设计规范 | 有状态标记（▲/●/▼），注明镜像源 |
| 📄 docs/project | `<repo>/docs/project/` | **事实层**：实现后的记录 | 已落地功能的事实文档、用户面向特性清单、架构决策记录 | 只记录**已实现**的能力，不写方案阶段内容 |

---

## 分流决策树

Agent 生成设计相关文件时，按以下顺序判断：

```
I 刚写了一份文档，它应该放哪里？

1. 它是"可浏览器打开的交互原型"（HTML/CSS/JS）吗？
   └─ YES → design/prototypes/（按 design/prototypes/PROCESS.md 规范）
   └─ NO ↓

2. 它是"已落地实现"的记录/事实吗？（功能已写入代码并可运行）
   └─ YES → docs/project/
   └─ NO ↓

3. 它是"成型的、可交付的设计文档"吗？（方案已定稿，不是草稿）
   └─ YES → design/plans/
   └─ NO ↓

4. 以上都不是 → Obsidian `My Projects/Snorkling/`
   - 调研/竞品分析 → 方案/竞品与生态调研/
   - 方案草案 → 方案/{领域}/
   - 需求文档 → 需求/
   - Bug 修复记录 → 开发记录/
   - 调查/根因分析 → 开发细节/{领域}/
   - 总览/规划 → 根目录或方案/架构与文档/
```

---

## 各家与 Obsidian 的关系

Obsidian 是**思考层的中枢**，代码仓库的三个目录是**产出层**：

```
Obsidian（思考中枢）                     代码仓库（产出）
┌─────────────────────────┐       ┌─────────────────────────────────────┐
│ 头脑风暴 → 需求 → 草案  │──────→│ design/plans/（定稿设计）           │
│                          │       │     ↓                               │
│ 方案演进 → 原型需求      │──────→│ design/prototypes/（交互原型）                │
│                          │       │     ↓                               │
│ 实现记录 ← 开发过程      │←──────│ docs/project/（实现后事实）         │
│                          │       │     ↓                               │
│ 开发细节/调试 ← 实际问题  │←──────│ （代码里的 AGENTS.md/CLAUDE.md）    │
└─────────────────────────┘       └─────────────────────────────────────┘
```

**流转规则：**
- 从 Obsidian → 代码仓库：只有**定稿设计**才进 `design/plans/`，草稿永远留在 Obsidian
- 从代码仓库 → Obsidian：实现过程中的调试/记录可以同步回 Obsidian `开发记录/`
- `design/prototypes/` 是单向：原型只从设计文档派生，落地后状态改为 ●，最终进 `_to-delete/`

---

## 各家的状态标记体系

### design/prototypes/ 原型状态

README 顶部 blockquote 必须包含（格式见 `design/prototypes/PROCESS.md`）：

```markdown
> 同步状态：▲ 设计活跃（未实现）｜● 已落地（真实组件已实现）｜▼ 过时待清理｜◐ 部分落地
> 镜像源：frontend/app/...（真实组件路径）
> 最后同步：YYYY-MM-DD
```

### design/plans/ 设计文档状态

每篇 md 头部包含：

```markdown
> 状态：▲ 设计活跃（未实现）｜◐ 落地中｜● 已落地（真实组件已实现）｜▼ 过时待清理
> 镜像源：（指向真实组件路径）
> 对应原型：（指向 design/prototypes/ 对应目录，如有）
```

### Obsidian 笔记

Frontmatter 强制字段见 `My Projects/Snorkling/CLAUDE.md`。

---

## 清理规则

### 应清理的文件类型

| 类型 | 清理方式 |
|------|---------|
| design/prototypes/_to-delete/ 里的文件 | git rm 或移到 Obsidian `_archive/` |
| design/plans/ 里标记为 ● 已落地的文件 | 移到 docs/project/ 或删除 |
| design/plans/ 里的 *result*.md（实现结果） | 移到 docs/project/ |
| design/plans/ 里的 *research*.md（调研） | 移到 Obsidian `方案/` |
| docs/project/ 里的设计/方案文档 | 移到 design/plans/（定稿）或 Obsidian `方案/`（草案） |
| design/prototypes/ 里无状态标记的 README | 补标记，或标记为 ▼ 过时 |

### 对账（design/prototypes/ 已有机制）

对账脚本：`node docs/sync-audit/audit-sync.mjs --json`
- 检查每个原型 README 的"镜像源"是否在真实代码里仍然存在
- 标记过时原型为 ▼，移入 `_to-delete/`

---

## Agent 自检清单

在写入任何设计相关文件前，Agent 应确认：

- [ ] 这份文件的内容是已落地实现的事实？→ `docs/project/`
- [ ] 这份文件是定稿设计？→ `design/plans/`（需有状态标记 + 镜像源）
- [ ] 这份文件是可交互原型？→ `design/prototypes/`（需有 README + 状态标记）
- [ ] 以上都不是？→ Obsidian `My Projects/Snorkling/`
- [ ] 检查是否与已有文件重复（用 Obsidian 搜索 + `ls` 检查设计目录）

---

## 示例路由

| 场景 | 路由结果 |
|------|---------|
| "调研 Agent Multiplexer 竞品" | Obsidian `方案/竞品与生态调研/Agent Multiplexer 竞品调研.md` |
| "Agent Dashboard 看板方案定稿" | `design/plans/agent-dashboard.md`（带状态标记） |
| "给 agent-id-card 写可交互原型" | `design/prototypes/agent-id-card/`（README 标记 ▲） |
| "实现完看板，写功能文档" | `docs/project/agent-dashboard-features.md` |
| "排查 agent status 复活问题" | Obsidian `开发细节/Agent状态与识别/...排查方案.md` |
| "某 Bug 修复完成，记录结果" | `design/plans/` 里有结果文件？不，应该在 `docs/project/` 或 Obsidian `开发记录/` |
