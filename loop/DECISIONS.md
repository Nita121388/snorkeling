# DECISIONS — 流程层决策留痕

> append-only，永不修改历史行（改主意就追加一条 `supersedes`）。
> 只记**流程**决策；产品/技术设计在 `.trellis/tasks/*/design.md`。

## 2026-11-05 初始决策集

| # | 决策 | 理由 |
|---|---|---|
| D1 | 台账放仓库根 `loop/`，不放 `.trellis/` | `trellis update` 会覆盖托管文件；`task.py archive` 会整目录搬走，跨任务视图会断链 |
| D2 | 人写 `queue.json` + 生成 `QUEUE.md`；机器写 `LEDGER-<月>.jsonl` + 生成 `LEDGER.md` | 多写者场景下 JSONL append-only 天然安全；Markdown 表格并发必冲突 |
| D3 | Trellis 管「任务是什么/怎么做」，`loop/` 只管「哪班跑到哪、算不算过」 | 单向引用、互不复制内容，避免四处不一致 |
| D4 | 用 Trellis 生命周期钩子自动喂 LEDGER | 手工记账必然腐烂；钩子是官方给外部看板留的接口（Trellis 自带 linear_sync 示例即为证） |
| D5 | 任务分 8 类，机械判定，拿不准就升级 | 类别决定门数；判据必须可复现、可测试，不能靠 agent 感觉 |
| D6 | 7 道门，分 H（人解）/ A（机器解） | 只有人能判断"这个需求对不对/这个好不好看"；机器能判的绝不问人 |
| D7 | H 门必须有落盘凭据（含 hash） | 夜里 agent 的上下文里没有白天的对话；口头"可以"无法传递 |
| D8 | 看板独立成项目 `E:/primary/projects/loop-board` | 要独立部署 + 远程访问；且要能看多个仓库 |
| D9 | 看板是「事实的视图 + 决策入口」，不是第二个数据库 | 允许拖到 `执行中`/`已发布` 会让看板变成"你以为的进度" |
| D10 | 看板自身按 `new-surface` 走 G1→G3→G4 才开工 | 规则对自己也生效，否则第一步就破例 |
| D11 | 参考实现取 `data-guardian-dev`（而非 `pi-session-library`） | 它已解决前端栈/零依赖 server/一键启动器/写回六道闸/远程口令发布/依赖边界声明六件事 |
| D12 | 远程 = 实时为主（本机 + 隧道）、快照可选（Pages + 口令） | 参考项目只有快照，但"睡前看夜班进度"必须实时 |

## 追加格式

```
## YYYY-MM-DD <一句话标题>
- 决策：
- 理由：
- supersedes: D<n>（可选）
- 影响面：RUNBOOK §n / queue schema / 看板列
```

## 2026-11-05 钩子注册位置修正
- 决策：钩子注册写在 `.trellis/config.yaml` 的 `hooks:` 段，不用 `.trellis/hooks.local.json`
- 理由：`common/config.py:get_hooks()` 只读 config.yaml；hooks.local.json 是 `linear_sync.py` 的私有配置。首版设计写错，实测纠正
- supersedes: D4 的落地方式（不改 D4 结论）
- 影响面：`loop/lib/paths.mjs` 白名单、design.md §7.1、queue.json 的 touch

## 2026-11-05 prd_hash 覆盖面修正
- 决策：`prd_hash` 覆盖 `## Goal` … `## G1 签字` 之前，不含头部元信息
- 理由：首版规则"签字段之前全部内容"，签完在头部补 `Confirmed:` 行就把自己的 hash 销毁了（当场实测到）
- 影响面：`loop/lib/hash.mjs`、design.md §5.3、prd.md 的 g1.prdHash
