# Persona 人设系统：有固定据点与持续记忆的常驻角色

## 需求源（用户 2026-11-12 口述，原文）

1. agent TUI / AISessions / session detail 中支持右键创建
2. 支持设置 emoji；目录名自动生成；位置在 settings 中可设，也支持给单个单独设置
3. 创建时展示该人设的文件层次结构
4. 支持服务端远程同步 / git 同步，需跨机可用
5. 人设之间可以相互知道——互相知道目录，必要时可参考
6. 记忆先基于 md 即可
7. 右侧 widget 新增一个图标，鼠标悬浮类似 agent 选择弹窗：支持选 agent、选人设；工作目录就是人设目录，但可**可选地**把本次主工作目录注入提示词
8. 点击该 icon 新建 Block 列出所有人设，查看具体信息
9. 参考 skills 那种**渐进式了解**，避免「了解所有人设」花费很大力气
10. 需要支持 **agent 自创建**（agent 自己提议/创建人设）
11. 人设目录位置要能在设置里配（文件可能很大，要放大盘），并做大文件治理

## 定稿与原型

- 设计定稿：`design/plans/persona-system.md`（12 节）
- 交互原型：`design/prototypes/persona/`（三场景；`node design/prototypes/persona/smoke.test.cjs` → 66 断言）
- 思考层：Obsidian `My Projects/Snorkeling/方案/Persona人设系统/Persona 人设系统方案.md`

## 任务地图与顺序

```
R0 更名（必须最先，且与 10-29 同包）
 └─ A1 核心（布局/scaffold/CLI/rename）
     ├─ A1.5 AISessions 集成
     ├─ A2 创建入口 + 向导
     ├─ A2.5 Agent 自创建
     ├─ A3 widget 登场
     │   └─ A6 journal + 提议制 + 蒸馏
     ├─ A4 名册 Block
     ├─ A5 同步 v1（依赖 A1，不需要名册先落地）
     └─ A5.5 位置设置 + relocate + 轮转（依赖 A1；与设置面板任务有 UI 冲突需先行对齐）
```

## 跨子包验收（父任务层面的最终判据）

- [ ] `node design/prototypes/persona/smoke.test.cjs` → `SMOKE PASS`（原型不因实现漂移）
- [ ] 新建人设后：`ls <rootdir>/<id>/` 只有 `.persona/`、`AGENTS.md`、`work/` 三项（根级无管理文件泄漏）
- [ ] 登场一次后 AISessions 能查到该会话且带 `persona` 属性；项目分布不出现 `<rootdir>/<id>` 伪项目
- [ ] 改 rootdir 走 `wsh persona relocate --yes` 后名册全绿、旧目录空
- [ ] 渐进披露：登场注入 ≤ 2K tokens；`PERSONAS.md` 行数 = 人设数
- [ ] R0 后仓库内 emoji 相关代码无 persona 命名残留

## 非目标

- 向量库 / 语义检索记忆（记忆就是 md + grep，需求 6 明确）
- 人设之间的自动消息总线（互知 = 目录可达 + 名册索引，不做 RPC）
- 把人设做成独立进程 / 常驻服务（登场就是 agent block）
- 云端托管记忆服务（v2 仅接 SyncTransport 既有实现）
