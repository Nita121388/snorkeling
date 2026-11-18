---
id: N-1118-resolve-exact-id
title: "会话定位的 id 前缀匹配：唯一命中时静默返回另一个会话"
type: bug
priority: P1
severity: S2
solution: fixed
status: open
origin: self
source: "nita 2026-11-18：详情内容和 Header 对不上的隐患之一；resolveSession/Index.GetSession/SQLiteIndex.GetSession 三处都有 HasPrefix(id) 匹配"
task: 11-18-aisessions-resolve-exact-id
order: 100
touch: [pkg/aisessions/**, pkg/service/aisessionsservice/**, .trellis/tasks/11-18-aisessions-resolve-exact-id/**, .trellis/spec/**]
rollback: "git revert 单提交；仅缩窄匹配，不改存储"
budget: {minutes: 60, retries: 2}
releaseCandidate: false
createdAt: "2026-11-18T05:17:38Z"
---

# 会话定位的 id 前缀匹配：唯一命中时静默返回另一个会话

## 背景

strings.HasPrefix(summary.ID, identifier) 在唯一命中时不报歧义、直接返回，截断的 id 会打开别的会话。收成精确 key/id 匹配。

## 来源

- self：nita 2026-11-18：详情内容和 Header 对不上的隐患之一；resolveSession/Index.GetSession/SQLiteIndex.GetSession 三处都有 HasPrefix(id) 匹配

## 验收判据

- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/aisessions -count=1"` → `ok`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/service/aisessionsservice -count=1"` → `ok`

## 记录

_（待补）_
