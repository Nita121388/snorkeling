# Persona 系统 — 实现事实（A1：数据地基）

> 设计：`design/plans/persona-system.md`（§3.1 布局 / §3.2 gitignore / §4.5 写入纪律）
> 任务：`.trellis/tasks/11-12-persona-core/`（loop 包 `F-1112-persona-core-r2`）
> 状态：A1 已落地（`pkg/persona` + `wsh persona`）；A1.5/A2/A3/A4/A5/A5.5/A6 未开始

## 1. 代码位置

| 单元 | 文件 | 说明 |
|---|---|---|
| 数据模型 / 根目录 / slug | `pkg/persona/persona.go` | 仅标准库；无 DB、无 RPC |
| scaffold 生成器 | `pkg/persona/scaffold.go` | 15 个文件；`.persona/` 下 12 个 |
| 名册（L0） | `pkg/persona/roster.go` | `.index/PERSONAS.md`，原子替换 |
| rename | `pkg/persona/rename.go` | move + id 重写 + 名册重生成 |
| CLI | `cmd/wsh/cmd/wshcmd-persona.go` | `create/list/get/rename` |

## 2. 落盘事实

```
<root>/<id>/.persona/persona.json      schemaVersion=1，id=目录名
<root>/<id>/.persona/persona.local.json 本机专属（workdir/sync.mode）
<root>/<id>/.persona/CHARTER.md        唯一真源（人写）
<root>/<id>/.persona/MEMORY/           facts/lessons/journal/inbox + playbook/archive
<root>/<id>/.persona/agents/           AGENTS/CLAUDE/GEMINI（GENERATED，登场重建）
<root>/<id>/AGENTS.md                  ≤6 行指针（GENERATED）
<root>/<id>/work/                      工作产物（不同步）
<root>/<id>/.gitignore                 §3.2 清单
<root>/.index/PERSONAS.md              名册（派生、gitignore）
```

根目录解析优先级：`--root` > `PERSONA_ROOT` 环境变量 > `~/.snorkeling/personas`。
A5.5 在环境变量与默认之间插入 `settings.json: "persona:rootdir"`。

## 3. 行为契约

- **写命令默认 dry-run**：`--yes` 才落盘；显式 `--dry-run` 可强制预览
- **幂等**：已存在的 slug → 读回该人设、零写入、退出码 0、stdout 明说「nothing written」
- **dry-run 零副作用**：不 `MkdirAll`、不写名册
- **rename 是唯一合法改 id 路径**：目标已存在 → 报错不覆盖；显示名不变
- **slug 可复现**：小写 + 非 `[a-z0-9_-]` 折叠为 `-`；含非 ASCII 字符追加 8 位 sha1 后缀，避免不同中文名撞同一 slug
- **名册 L0 不含显示名**：`emoji id | role | provider/model | ./id`，每行都是注入面
- **block meta `persona:<id>` 引用重写 = A3 钩子**（当前恒 0，因为该 meta 尚未写入）

## 4. 有意收窄（与 PRD 的差异）

PRD 要求「`data` scope」。A1 只有本地人类 CLI，没有外部入口；scope 门只在
外部 agent 经 RPC/MCP 调用时才有意义。故：
- 包内导出 `persona.Scope = "data"` 作为词表锚点
- 真正的强制点在 A2.5：`agentscope.commandScopes` + `agentguide` 注册 MCP 工具时
提前往 `commandScopes` 塞不存在的 command 只会造出假门。

## 5. 验证

```bash
go test ./pkg/persona/...        # 8 个测试
go build ./cmd/wsh/
wsh persona create --name smoke --root /tmp/p --dry-run   # 0 落盘
wsh persona create --name smoke --root /tmp/p --yes       # .persona/ 12 文件
wsh persona create --name smoke --root /tmp/p --yes       # 幂等，CHARTER 不变
wsh persona rename smoke second --root /tmp/p --yes       # 旧目录消失、名册 0 引用
```

loop 包 `F-1112-persona-core-r2` 的 7 条判据由 `queue prove` 机器采数，全绿。

## 6. 未做（后继包）

- A1.5：AISessions `persona` 属性、🎭 分组折叠、登场史
- A2：右键/launcher/card 三个交互创建入口 + 两步向导
- A2.5：MCP 工具 + proposals 闸门 + 配额 + provenance 批准流
- A3：widget 🎭 + hover 弹窗 + `persona:<id>` block meta（rename 钩子在此接实）
- A4：`persona://` 名册 Block
- A5 / A5.5：同步 v1 / rootdir 设置 + relocate + journal 轮转
- A6：journal 写入器 + 提议制记忆 + 蒸馏
