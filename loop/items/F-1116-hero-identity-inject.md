---
id: F-1116-hero-identity-inject
title: "Hero 登场身份注入：据点根级 AGENTS.md 带 CHARTER 摘要"
type: arch
priority: P1
status: open
origin: self
source: "2026-11-16 会话：hero 对 hi 泛泛回复，headless pi 实测注入面无身份正文"
task: 11-16-hero-identity-inject
order: 100
touch: [pkg/hero/scaffold.go, pkg/hero/scaffold_identity_test.go, frontend/app/workspace/hero-launch.ts, .trellis/tasks/11-16-hero-identity-inject/**, loop/**]
rollback: null
budget: {minutes: 60, retries: 2}
releaseCandidate: false
createdAt: "2026-11-16T03:12:35Z"
---

# Hero 登场身份注入：据点根级 AGENTS.md 带 CHARTER 摘要

## 背景

rootPointerTemplate 只生成 6 行指针，pi/codex 注入面无使命正文（实测确认）。修复 = AGENTS.md 加身份段 + 必读 CHARTER 硬规则，对齐 design/plans/persona-system.md L245。

## 来源

- self：2026-11-16 会话：hero 对 hi 泛泛回复，headless pi 实测注入面无身份正文

## 验收判据

- [ ] `go test ./pkg/hero/ -run "TestRootAGENTSIdentifiesHero|TestScaffoldedRootAGENTSIdentifiesHero"` → `ok`
- [ ] `go test ./pkg/hero/` → `ok`
- [ ] `go build ./cmd/wsh/ && echo BUILD_OK` → `BUILD_OK`

## 记录

- 2026-11-16 实施：`rootPointerTemplate` 加「身份段（emoji+name+role）+ ## 你是谁 / 必读 CHARTER.md 与 facts.md 硬规则」，保留原 4 行指针；`hero-launch.ts` L84 过期注释对齐实现。
- 红证（G2）：旧源跑新断言 2 FAIL（`TestRootAGENTSIdentifiesHero` / `TestScaffoldedRootAGENTSIdentifiesHero`，输出 loop/red/…-g2.txt）→ 新源全绿。
- 真机探针（loop/red/…-probe.txt）：旧据点注入面零身份；新据点 pi 引用注入含「你是该 Hero…必读」硬规则。
- 证明 `queue prove` 3/3 绿（prove 需继承本地工具链 PATH / GOCACHE / GOMODCACHE / GOPROXY，否则 'go' 不在路径）。
- 附带：`.trellis/tasks/11-12-persona-system/task.json` 为 task.py 建子任务时的系统挂链改动（非代码越界）。
- 遗留：`.hero/agents/*.md` 生成物无人消费、及独立 wsh 读不到 settings（relocate 写不回 hero:rootdir）→ 另开包。
