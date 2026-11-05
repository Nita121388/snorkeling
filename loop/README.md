# loop/ — 本仓库的台账数据（不是引擎）

引擎在 `E:/primary/projects/loop`。这里只有数据：

| 文件 | 内容 |
|---|---|
| `items/*.md` | 工作项笔记（人写：标题/优先级/来源/背景/判据） |
| `gates.json` | 门凭据（机器写：hash/时间/签字人） |
| `LEDGER-YYYY-MM.jsonl` | 事件流（append-only） |
| `INBOX.md` | 我自己的随手记录 |
| `INDEX.md` / `QUEUE.md` / `LEDGER.md` | 生成物，别手改 |
| `VERSION` | 数据 schema 版本 |
| `REPORTS/` | 晨报 |

```bash
node E:/primary/projects/loop/bin/loop.mjs queue list --root .
node E:/primary/projects/loop/bin/loop.mjs queue introspect --root .
```
