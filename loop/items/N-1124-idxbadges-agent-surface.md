---
id: N-1124-idxbadges-agent-surface
title: "索引徽标的 agent 发现面：wsh block refresh + agent guide 能力条目"
type: feature
priority: P2
status: open
origin: self
source: "nita 2026-11-24 会话拍板「ok go on」：先 B（发现面）后 A（装饰词表泛化）；guide 与 install-skill 共用同一张表"
task: 11-24-idxbadges-agent-surface
order: 100
touch: [cmd/wsh/cmd/wshcmd-block.go, cmd/wsh/cmd/wshcmd-block-refresh.go, cmd/wsh/cmd/wshcmd-block-refresh_test.go, pkg/agentguide/agentguide.go, pkg/agentguide/agentguide_block_refresh_test.go, loop/red/**, .trellis/tasks/11-24-idxbadges-agent-surface/**, docs/project/**]
rollback: null
budget: {minutes: 90, retries: 2}
releaseCandidate: false
createdAt: "2026-11-24T03:28:21Z"
---

# 索引徽标的 agent 发现面：wsh block refresh + agent guide 能力条目

## 背景

_（待补）_

## 来源

- self：nita 2026-11-24 会话拍板「ok go on」：先 B（发现面）后 A（装饰词表泛化）；guide 与 install-skill 共用同一张表

## 验收判据

- [ ] `go test ./cmd/wsh/cmd/ -run TestBlockRefresh && echo BLOCK_REFRESH_TEST_OK` → `BLOCK_REFRESH_TEST_OK`
- [ ] `go test ./pkg/agentguide/ -run TestGuideHasBlockRefreshEntry && echo GUIDE_TEST_OK` → `GUIDE_TEST_OK`
- [ ] `go build -o tmp/wsh-check.exe ./cmd/wsh && echo WSH_BUILD_OK` → `WSH_BUILD_OK`
- [ ] `go test ./pkg/agentguide/... ./cmd/wsh/cmd/... && echo GO_TESTS_OK` → `GO_TESTS_OK`

## 记录

_（待补）_
