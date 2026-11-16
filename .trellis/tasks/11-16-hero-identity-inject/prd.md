> **Confirmed: 2026-11-16 @nita**

# Hero 登场身份注入：据点 AGENTS.md 带 CHARTER 摘要

## Goal

Hero agent 在自己的据点（cwd = hero base）登场后，pi/codex 只自动注入据点根级 `AGENTS.md`。当前 `rootPointerTemplate`（pkg/hero/scaffold.go）只有 6 行指针、零身份正文 —— headless pi 实测：注入面不含任何使命文本，hero 对 "hi" 泛泛回复。设计文档（design/plans/persona-system.md L245）要求根级 AGENTS.md = "CHARTER 摘要 + MEMORY 索引 + 同事规则"。

修复目标：据点根级 AGENTS.md 内联身份段（emoji + name + role）+ 硬规则「答话/开工前必读 `.hero/CHARTER.md` 与 `.hero/MEMORY/facts.md` TL;DR」，让任何 provider 零改造地知道自己是谁。

## 做什么

1. `pkg/hero/scaffold.go` `rootPointerTemplate`：身份段 + 必读硬规则（保留指针行）
2. `pkg/hero/scaffold_identity_test.go`：模板与 Create 产物两级断言（先红后绿，红证存 loop/red/）
3. `frontend/app/workspace/hero-launch.ts` L84：修过期注释（"AGENTS.md already carries the charter"）

## 不做什么

- 不改 CHARTER.md 本身 / MEMORY 结构 / scaffold 文件清单
- 不做登场 prompt 注入机制（hero-launch.ts 只修注释；留 A3 后续包）
- 不动 `.hero/agents/*.md` 生成物的消费问题（另开包）
- 不做 i18n（据点生成物面向 agent，保持中文模板）

## 验收判据

1. `go test ./pkg/hero/` → `ok`（含新断言）
2. 红证：旧源跑新断言 ≥2 条 FAIL（loop/red/F-1116-hero-identity-inject-g2.txt）
3. 真机证据：headless pi 在临时 hero 基地确认 system prompt 注入含使命文本
4. `go build ./cmd/wsh/` → 成功

## G1 签字

- Confirmed: 2026-11-16 @nita（"ok go"，方案 A：根级 AGENTS.md 带 CHARTER 摘要）
