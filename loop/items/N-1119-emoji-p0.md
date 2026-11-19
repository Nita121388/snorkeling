---
id: N-1119-emoji-p0
title: "Emoji 偏好 P0：后端地基（NormalizeEmoji + 两表 + 偏好 UPSERT + 推荐器纯函数）"
type: arch
priority: P2
severity: S3
status: open
origin: self
source: "nita 2026-11-19：emoji 后端化 + AI 推荐（采用 design.md §8 四项建议）；今晚只放 P0"
task: 11-18-aisessions-emoji-preference
order: 120
touch: [pkg/aisessions/normalize_emoji.go, pkg/aisessions/emoji_prefs.go, pkg/aisessions/emoji_recommend.go, pkg/aisessions/emoji_*.go, pkg/aisessions/sqlite_index.go, pkg/aisessions/fixtures/**, .trellis/tasks/11-18-aisessions-emoji-preference/**, loop/items/N-1119-emoji-p0.md]
rollback: "纯新增文件 + 建表，无调用方；revert 即无痕（回滚点 1）"
budget: {minutes: 180, retries: 2}
releaseCandidate: false
createdAt: "2026-11-19T10:40:00Z"
---

# Emoji 偏好 P0：后端地基

## 背景

`11-18-aisessions-emoji-preference` 的 P0 批次（见该任务 `implement.md §1`）。目标是让后续 P1–P5
有可用的数据层与打分器，且**不改变任何现有行为**：session emoji 仍从 localStorage 读，没人调用新 API。

## 来源

- self：nita 2026-11-19 拍板 design.md §8 四项（persona 维度退化 / if-absent 免 hash / prop 隐藏 / 不加 provider 维），
  并同意今晚只放 P0。

## 交付物

1. Go 版 `NormalizeEmoji`（uniseg）：单 grapheme / ZWJ 复合合法 / pictographic 判定
2. 两表建表 + 老库幂等迁移：`ai_emoji_prefs`、`ai_emoji_recommend_cache`
3. 偏好 UPSERT / 负信号：`BumpEmojiPref(dim, dimKey, emoji, delta)`（count 地板 0）
4. 推荐器纯函数包：五信号打分 + 规则表（tag/title 双语常量）+ top5 + `autosetEligible`
5. Go/TS 共享 grapheme 测试向量 `fixtures/emoji-grapheme-cases.json`

## 验收判据

- [ ] `go test ./pkg/aisessions/... -run Emoji` → 全绿（`&& echo EMOJI_GO_OK`）
- [ ] 老库启动后 `sqlite3 <index.db> ".tables"` 含 `ai_emoji_prefs`、`ai_emoji_recommend_cache`
- [ ] 打分表单测覆盖：单命中 / 多信号加总 / 同分裁决 / 空库兜底 / `autosetEligible` 仅 1 号信号命中
- [ ] `go build ./...` 通过（新包无调用方，不得改动既有导出签名）
- [ ] 白名单外零改动：`git status --short` 只出现 P0 新文件与 `sqlite_index.go`

## 记录

- 门状态：G6 方案 = 任务 `design.md`（已存在）；G2 器具 = 上面四条判据。
  **本机无 loop 引擎**（引擎在 Windows `E:/primary/projects/loop`），门凭据待引擎侧代录。
- P0 回滚点：纯新增 + 建表，无调用方 → revert 即无痕。
