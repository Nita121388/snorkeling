# 项目日志系统 — 设计

> 状态：▲ 设计活跃（未实现）
> 镜像源：`pkg/pslog/pslog.go`、`frontend/app/store/pslog-trace.ts`、`emain/emain-log.ts`、`pkg/wconfig/settingsconfig.go`
> 关联：`design/plans/commontext-background-send.md`（其 §4.2 竞态与 §7 剩余风险的可观测性由本设计提供）、`docs/project/verify-ledger.md`
> 原型：`design/prototypes/logging/diagnostics-hub/`（诊断中心融合面：三视图 + 双向跳转 + 导出诊断包，smoke test 30 项 PASS）
> 日期：2026-11-12

---

## 0. 问题与目标

项目当前的"日志"是 5 块互不相通的碎片，缺一条能把一次用户操作从渲染进程、后端、主进程串起来的通道。结果：用户报"后台发送没反应"时，没有任何数据可查。

目标：

1. **一条统一通道**：三个进程（emain / Go 后端 / 渲染进程）写同一种事件格式，落在同一个目录。
2. **能事后定位**：一次操作有 `traceid`，`wsh log tail --trace=<id>` 能按时间序还原全过程。
3. **默认不吵**：`error` / `warn` 常开；`info` / `debug` 默认关闭，由设置开关。
4. **有容量上限**：磁盘占用可控（预算 + 保留期），"默认关闭"也不会长大到失控。
5. **不泄漏隐私**：只写不透明引用，不写正文、路径、token、正文级字符串。

非目标：

- 不合并 `AI Audit`（`frontend/app/view/aiaudit/` 是**业务审计**：用户可见的"我让 AI 做了什么"，存 DB 有翻页 UI）。日志是**诊断**：给开发者和报障用。两者边界在第 9 节写死。
- 第一版不做应用内日志面板（另立工作项，见 §12 P3）。
- 不做远程上报 / 崩溃收集服务（`pkg/telemetry` 是产品遥测，另一条线，不动它）。
- 不改 `pkg/blocklogger`（那是把 `log` 输出重定向进块的终端的工具，不是持久化日志）。

## 1. 现状盘点

| 通道 | 现状 | 缺口 |
|---|---|---|
| Electron 主进程 | winston → `<dataDir>/waveapp.log`，>10MB 轮转到 `logs/waveapp.<n>.log`，保留 5 个（`emain/emain-log.ts:69-110`），`level: info`，dev 下多一个 Console transport | 自由文本、无级别字段、无结构化；只有主进程 |
| Go 后端 | **733 处 `log.Printf` + 58 处 `slog`**。stdout/stderr 被 electron 逐行 `console.log` 转投（`emain/emain-wavesrv.ts:98-136`）；`log.SetFlags(0)` 主动去掉时间戳（`cmd/server/main-server.go:527`） | 无级别、无结构化、无 trace 关联；格式混杂不可解析 |
| 渲染进程 | **286 处 `console.*`**，只在 DevTools | 崩溃/关窗后全丢，报障时零证据 |
| `pkg/pslog` | 已有结构化通道：`Event` 9 字段（`v`/`ts`/`event`/`stage`/`traceid`/`blockid`/`sessionref`/`durationms`/`outcome`/`reason`）、一行一条 JSON、按进程落 `<dataDir>/pslog/pslog-<ts>-<pid>.log`（0600）、由 `debug:pslog` 设置门控、默认关闭 | **无级别**、字段不够（缺 comp/domain）、**无轮转也无上限**（只增不减）、无读取面 |
| `pkg/pslog` 前端桥 | `frontend/app/store/pslog-trace.ts` 是 FE 唯一入口：`pslogEvent()` 已经写**结构化 JSON v1**，`pslogTrace()` 走 raw 文本；`POST /wave/pslog` + 可选 localStorage 缓冲（cap 500）；门控与后端同一设置（`global.ts:49-50` 注入）。服务端 handler 已支持 JSON 直通 `pslog.AppendEvent`（`pkg/web/web.go:207-218`） | 门控只认 `debug:pslog`；无级别/限流；handler 对版本是**严格相等**检查（升级即破）；无 `comp` 标注 |
| `AI Audit` | 业务审计表 + 翻页 UI（`aiaudit-model.ts`） | 与运行诊断无关，**不并入** |

**关键判断：不新造系统，把 `pkg/pslog` 升级成项目唯一运行日志通道。** 它已有的纪律（只写不透明引用、默认关闭、跨进程 traceid）正是本项目需要的；其余四路往里灌即可。前端结构化通道**已经存在**（`pslogEvent()` + `web.go` JSON 直通），本设计主要是加字段与闸门，不是造投递链路。

## 2. 设计原则

1. **结构化优先**：一条事件 = 一行 JSON，字段固定可枚举，不写自由文本 prose。
2. **失败不阻塞**：写日志永不影响主流程；写失败静默丢弃（最坏退化到当前状态）。
3. **门控分级**：`error`/`warn` 常开（低频），`info`/`debug` 由设置控制。
4. **字段白名单**：只允许登记过的字段名；不认识的键拒绝写入。
5. **一个 traceid 串起全链路**：跨进程靠调用方显式传递（沿用 pslog 现有约定，不自动传播）。
6. **磁盘有主**：预算 + 保留期 + 启动自检，超限删最旧。

## 3. 事件模型（schema v2）

在现有 `pslog.Event` 上扩展，保持向后兼容（旧调用点不改也能跑）：

```go
type Event struct {
    Version    int    `json:"v"`                    // 写出恒为 2；读入接受 1..2（见下方兼容性红线）
    Timestamp  string `json:"ts"`                   // RFC3339Nano
    Level      string `json:"level"`                // error | warn | info | debug（新增，缺省 info）
    Comp       string `json:"comp"`                 // emain | srv | web | wsh（新增）
    Domain     string `json:"domain"`               // 域标签，见 §8（新增；存量调用点不填也能跑）
    Name       string `json:"event"`                // 既有字段保留：存量 `<tag>`；新代码填 `<subject>-<stage>`（域信息在 Domain）
    Stage      string `json:"stage,omitempty"`
    TraceId    string `json:"traceid,omitempty"`
    BlockId    string `json:"blockid,omitempty"`
    SessionRef string `json:"sessionref,omitempty"`
    DurationMs int64  `json:"durationms,omitempty"`
    Outcome    string `json:"outcome,omitempty"`    // ok | fail | skip | timeout（枚举）
    Reason     string `json:"reason,omitempty"`     // 机读码，非人类句子；≤ 128 字符
}
```

硬约束（第 10 节有单测守）：

- **兼容性红线**：`/wave/pslog` handler 现在对 `event.Version != EventVersion` 是**严格相等**检查（`pkg/web/web.go:212`）。schema 升 v2 时必须改为**只拒 `Version > EventVersion`**（向前拒、向后收），否则更新窗口内旧 FE（v1 record）全部被 400 丢弃。`wsh log` 读取端必须同时解析 v1 / v2 行。
- `Level` / `Comp` / `Outcome` 必须是枚举值，非法值降级为 `info` / `wsh` / 空并记一次 `log-invalid-enum`（自举，防循环，只写一次进程级）。
- 所有字符串字段 ≤ 256 字符，超长截断并置 `truncated: true`。
- 禁止自由文本：任何字段不得包含空格分隔的自然语言句子（`Reason` 为机读码，如 `tui-not-ready`）。中文/英文正文一律不允许进日志。
- 每条事件行 ≤ 2KB。

## 4. 三条写入通道

| Comp | 入口 | 现状 → 动作 |
|---|---|---|
| `srv` | `pslog.AppendEvent(Event{...})` | 已有，只需补 `Level` / `Comp` / `Domain` 赋值。新代码禁止新增裸 `log.Printf`（存量不动） |
| `web` | `frontend/app/store/pslog-trace.ts` 的 `pslogEvent()` → `POST /wave/pslog` | handler **已支持** JSON Event 直通 `AppendEvent`（`web.go:207-218`）；动作 = 补 `comp=web`、版本兼容改为只拒新（见 §3）、加限流 |
| `emain` | `emain/emain-log.ts` | 新增第二个 winston transport：JSON 行写入 `<logsDir>/pslog-emain-<ts>.log`，`log()` 包装保留（自由文本继续进 `waveapp.log`，结构化事件另走 `logEvent()`） |

`wsh`（CLI 进程）复用 `srv` 的 `pslog.AppendEvent`，`Comp` 标 `wsh`，落自己的进程文件。

**web 通道限流（错误风暴防线）**：前端令牌桶 20 事件/秒；超限丢弃并在桶恢复后补一条 `log-dropped count=<n>` 聚合事件（不逐条丢逐条报）。`pslog-trace.ts:97` 现在是 fire-and-forget 无限流，循环报错会打成无限 POST。

**跨进程关联约定**：traceid 不自动跨进程传播（pslog 既有纪律）。FE 铸的 `fe-<n>` id 不会出现在 backend 事件里（RPC 无携带参数）——**需要跨 FE/backend 串联的域，用双方都已知的业务 id 做关联键**（如 `blockid`），traceid 仅在同一进程内或显式传递时使用。第一批域的关联键见 §8。

写入端不做同步 fsync，沿用现有 `open + append`（`pslog.go:127-147`）；进程被杀最多丢最后几行，可接受。

## 5. 采集分级与设置

现有设置键 `debug:pslog`（`pkg/wconfig/metaconsts.go:179`）保留为**总闸**，新增两级：

| 设置键 | 类型 | 默认 | 语义 |
|---|---|---|---|
| `debug:pslog` | bool | false | info/debug 总闸。false 时只有 `error`/`warn` 落盘；true 时按 `log:level` |
| `log:level` | string | `warn` | 级别闸：`off` / `error` / `warn` / `info` / `debug`。**`off` 是隐私总退出**：包括 error/warn 在内全部不写（唯一例外：写入一条 `log-disabled` 标记行后完全静默） |
| `log:domains` | string[] | 空 | 非空时只采这些域（如 `["commontext.send","agent.status"]`）；空 = 全采 |

**D1（待拍板，默认采纳）：`error`/`warn` 常开**。理由：报障时唯一能救命的等级；量级可控（一次会话通常个位数）。**隐私总退出由 `log:level=off` 承担**（覆盖 error/warn），不开第二个开关。

前端门控沿用现有机制：`global.ts:50` 已注入 `pslogEnabled()`，扩展为读 `log:level` + `log:domains` 三个设置，一处计算、两端共享同一判定函数（纯函数，可单测）。

## 6. 存储与预算

- **目录收敛**：`pslog-*.log` 从 `<dataDir>/pslog/` 移到 `<dataDir>/logs/`，与 `waveapp.log` 同目录 → 设置页一个"打开日志目录"按钮覆盖全部日志。
- **文件名**：`pslog-<comp>-<yyyymmdd-HHMMSS>-<pid>.log`（加 `comp` 便于按进程来源分开看）。
- **轮转（写入路径触发，不是启动时）**：pslog 文件名含进程启动 ts+pid，进程启动时文件必然是新的——启动检查永远不触发。轮转必须在**写入路径**上做：writer 持有累计字节计数，超过 10MB 时关闭当前文件、打开新文件（文件名追加序号，同 `waveapp.log` 语义）。
- **预算（三闸，现在完全没有）**：保留期 7 天 + 目录总量 200MB + **文件数 ≤ 200**（wsh CLI 每次启用日志的调用都开新进程文件，只有容量/天数闸，小文件会无限累积）。任一超限触发修剪。
- **修剪者 = srv，不是 emain**：srv 常驻且拥有数据目录语义；emain 无法知道 srv 正在写哪个文件（"永不自删当前进程文件"跨进程不可判定）。修剪判定用 **mtime 活跃性**：跳过最近 10 分钟内修改过的文件（视为活跃，可能是任何进程的当前文件）。检查时机：srv 启动 + 每 10 分钟（srv 侧 ticker，一处实现，与 `backupCleanupLoop` 同模式）。
- **保护**：修剪后目录只剩活跃文件时，停止增长（丢弃后续 `debug`/`info`，保留 `error`）并记一条 `log-budget-exceeded`。

## 7. 读取面

第一版只做 CLI + 一个按钮，不做面板：

```bash
wsh log tail   [--level=error] [--comp=srv] [--domain=commontext.send] [--trace=<tid>] [--since=1h] [--follow]
wsh log grep   <regex> [--level=...]                  # 只 grep 已登记字段，不扫自由文本
wsh log stat   [--days=7]                             # 各 comp/domain 事件计数 + 失败率
```

- 实现：新增 `cmd/wsh/cmd/wshcmd-log.go`，读 `<dataDir>/logs/pslog-*.log`，用 `bufio.Scanner` 流式解析 JSON；非法行跳过并在末尾汇总计数（不中断）。**第一版 local-only**：wsh 支持远程连接，remote 场景明确不在范围（`--remote` 传了就报 not supported）。
- 设置 → 高级：新增"日志"分组 = 三个新设置项 + **「打开日志目录」按钮**（复用现有 `openLogsFolder` 能力，见 `emain/emain-ipc.ts`、`frontend/app/app.tsx` 已有引用点）。
- 输出格式：默认 `ts level comp domain event outcome duration trace` 表格；`--json` 输出原始行（供 `jq`）。

## 8. 域清单（第一批）

| Domain | 事件 | 用途 |
|---|---|---|
| `commontext.send` | `-start` / `-queued` / `-inject` / `-fallback` / `-fail` | **本批重点**：`commontext-background-send.md` 的 R4 竞态与 R6 超时只有这条能事后定位。**关联键 = `blockid`**（FE/backend/PTY 四方唯一都知道的 id；FE 铸的 `fe-<n>` traceid 传不到 backend，见 §4） |
| `agent.status` | 现有 `recv-report` 等（`wshserver.go:146`） | 已有，补 `Level` 即可 |
| `ps` | 现有 pubsub 链路 | 已有，不动 |
| `term.failure` | `-spawn-fail` / `-dispose` | 终端起不来时唯一证据 |
| `sync.*` | `-conflict` / `-fail` | 同步冲突排查 |
| `update.*` | `-check` / `-download` / `-install-fail` | 应用内更新（`11-10-updater-download-restart`） |

新增域必须先在本表登记（同 `pslog.go` 现有注释纪律：不预注册域）。

## 9. 与 AI Audit 的边界（写死）

| | AI Audit | 本日志系统 |
|---|---|---|
| 受众 | 用户 | 开发者 / 报障 |
| 内容 | "哪个会话、哪个功能、什么时候调了 AI、成功还是失败、原文" | "哪一步慢、哪一步错了、哪个进程、什么码" |
| 存储 | DB 表 + 翻页 UI | JSON 行文件 + CLI |
| 生命周期 | 用户可清空 | 预算自动淘汰 |
| UI 融合 | 两者共用同一个「诊断中心」视图骨架（三视图 + 双向跳转 + 诊断包导出），见原型 `design/prototypes/logging/diagnostics-hub/`；**存储与语义不合并** | 同 |

## 10. 隐私红线与守卫

**绝对禁止写入**：用户输入正文、文件内容、路径（除已登记的 `cwd` 白名单域）、token / 凭据 / 邮箱 / URL 查询串、终端输出内容。

守卫（可机器判定，第 11 节 S4）：

1. **字段白名单**：`pslog.AppendEvent` 校验字段名，未登记的直接丢弃该键（不是整条丢弃）。
2. **值形态检查**：单测扫描 30 个典型敏感串（`sk-`、`Bearer `、`@`+域名、`\\Users\\`、`/home/`、`?token=`），命中即拒绝写入并把 `Reason` 置 `redacted`。
3. **长度截断**：>256 字符截断 + `truncated: true`（防止有人把整段正文塞进 `reason`）。
4. **CI 守卫**：`eslint` 对 `frontend/app/commontext/`、`frontend/app/view/agent*/` 等新域目录加 `no-console` 规则（仅新代码，存量 286 处按域逐步迁移）。

## 11. 成功判据

| # | 判据 | 验证方式 |
|---|---|---|
| S1 | `error`/`warn` 在 `debug:pslog=false` 时仍落盘；`info` 不落盘 | Go 单测（`pkg/pslog`），伪设置 + 临时目录 |
| S2 | 跨进程关联可还原：同一 `blockid` 的 srv + web 事件能在一个文件集合里按 ts 排序还原 | `go test` + 前端 vitest 各写一条，断言 ts 单调且 `blockid` 相等。**不要求 traceid 跨进程相等**（见 §4 关联约定） |
| S3 | 预算生效：构造 210MB 假文件 + 250 个旧小文件后启动一次，目录总量 ≤ 200MB、文件数 ≤ 200，且最近 10 分钟内修改过的文件一个未删 | Go 单测（`SetDataDirForTesting` 已有测试缝） |
| S4 | 脱敏守卫：30 个敏感样例全部被拒写，落盘文件里 grep 不到任何一个 | Go 单测表驱动 |
| S5 | `wsh log tail --level=error --since=1h` 输出行 100% 可被 `jq` 解析 | 真机命令 + `jq -e` 断言 |
| S6 | 设置页「打开日志目录」打开的是含 `waveapp.log` + `pslog-*` 的同一目录 | 真机 verify（`scripts/verify/`） |
| S7 | CommonText 后台发送四个事件在真机 verify 中全部出现且同 `blockid` | 扩展 `scripts/verify/commontext-send-agent-block` |
| S8 | 非法枚举值不崩、不递归：一条 `level=bogus` 事件写入后进程正常、只记一次 `log-invalid-enum` | Go 单测 |
| S9 | **写入路径轮转**：单文件写满 10MB 后自动切新文件（同进程内），旧文件完好 | Go 单测（写入循环 + 大 payload） |
| S10 | **版本兼容**：`v=1` 记录仍被 handler 接受并落盘；`v=3`（超前）被 400 拒绝 | `pkg/web/web_pslog_test.go` 扩用例 |
| S11 | **门控双实现一致**：一份 golden JSON（10 条样式：三设置组合 × 四级）在 `go test` 与 `vitest` 中判定结果完全一致 | 两边各跑同一 fixture |
| S12 | **web 限流**：1 秒内注入 100 条 error 事件，落盘 ≤ 20 条 + 1 条 `log-dropped count=80` | 前端 vitest |
| S13 | 隐私总退出：`log:level=off` 时零事件写入（仅一条 `log-disabled`），含故意注入的 error 级别 | Go 单测 + 前端 vitest |
| S14 | 诊断中心融合跳转：审计条目「查看相关日志」切日志视图并预设 `block:` 过滤；日志事件「回到审计条目」切回并直接打开该条目抽屉 | 原型 smoke test 已断言（30 项）；真机实现后新增 `scripts/verify/` area |
| S15 | `log:level=off` 时 AI 调用审计视图仍正常（两个数据源分离的可验证断言） | 同 S14 |

## 12. 实施顺序

| 阶段 | 内容 | 出口 |
|---|---|---|
| **P0 地基** | schema v2 + handler 版本兼容（只拒超前）+ 目录收敛/迁移 + 写入路径轮转 + 三闸预算（天数/容量/文件数，srv 修剪）+ 脱敏守卫 + 单测 | S1/S3/S4/S8/S9/S10/S13 绿 |
| **P1 三路通道** | emain JSON transport（含 D7 门控）+ 前端 `pslogEvent()` 扩展（含限流）+ 枚举化 + 门控 golden vector | S2/S11/S12 绿 |
| **P2 读取面** | `wsh log tail/grep/stat`（local-only）+ 设置项（含 `off` 档）+ 打开目录按钮 | S5/S6 绿 |
| **P3 第一批域** | `commontext.send` 四事件接入（配合 `commontext-background-send.md`） | S7 绿 |
| **P4 面板（另立工作项）** | 应用内 Diagnostics Hub 块：三视图（审计 / 日志 / 联合时间线）+ 双向跳转 + 诊断包导出，见原型 `design/prototypes/logging/diagnostics-hub/` | 原型已覆盖交互定稿；实现待 P0–P3 落地后另立任务 |

P0–P2 可独立发版，不依赖 CommonText 功能。

## 13. 涉及文件

| 文件 | 改动 |
|---|---|
| `pkg/pslog/pslog.go` | `Event` 加 `Level`/`Comp`/`Domain`；字段白名单 + 枚举校验 + 截断；目录改 `logs/`；预算/轮转 |
| `pkg/pslog/prune.go`（新） | 预算与保留期淘汰 |
| `pkg/pslog/redact.go`（新） | 敏感形态检查 |
| `pkg/wconfig/metaconsts.go` / `settingsconfig.go` | 新增 `log:level`、`log:domains`；`debug:pslog` 语义收紧为总闸 |
| `cmd/server/main-server.go` | `SetEnabled` 改为读三设置；启动时触发一次预算自检 |
| `pkg/wshrpc/wshserver/wshserver.go` | `/wave/pslog` handler 补 `comp=web` 与级别解析 |
| `pkg/web/web.go` | 版本检查改 `Version > EventVersion` 才拒（现在严格相等，`web.go:212`）；handler 补 `comp=web` |
| `frontend/app/store/pslog-trace.ts` | `PslogEventInput` 加 `level`/`domain`；门控改读三设置 |
| `frontend/app/store/global.ts` | 注入门控改为 `pslogGateFromSettings()` 纯函数 |
| `emain/emain-log.ts` | 新增 pslog JSON transport + `logEvent()`；门控数据源见 D7 |
| `cmd/wsh/cmd/wshcmd-log.go`（新） | `tail` / `grep` / `stat` |
| 设置面板（`waveconfig`） | 日志分组 + 打开目录按钮 |

## 14. 未决问题（需拍板）

| # | 问题 | 我的建议 |
|---|---|---|
| D1 | `error`/`warn` 是否常开（不受总闸控制）？ | **是**（§5 已按此设计） |
| D2 | 存量 286 处前端 `console.*` 与 733 处 Go `log.Printf` 如何处理？ | **只约束新代码 + 按域逐步迁移**，不一次性改（§10 第 4 条已按此设计） |
| D3 | 读取面第一版范围 | **CLI + 打开目录按钮**，不做应用内面板（P4 另立） |
| D4 | `commontext.send` 是否作为第一批域 | **是**（§8 已按此设计） |
| D5 | 保留期 7 天 / 总量 200MB 的数值 | 先按建议值，真机观察一周再调 |
| D6 | 是否允许 `cwd` 路径进日志（有排查价值但有隐私风险） | **只允许 `agent.status` 与 `commontext.send` 两个域写 `cwd`，且截断到末两级目录** |
| D7 | emain 进程的门控数据源（emain 不直接读设置 DB，已核实 emain/*.ts 无 settings 读取路径） | **启动时经 `/wave/` 拉一次快照，不热更**；emain 只发 error/warn（常开）时连快照都不需要 |
| D8 | `pslog-*.log` 目录从 `pslog/` 改到 `logs/` 会让旧文件“失联”（用户升级后旧排查文件找不到） | **迁移：首次启动把旧 `pslog/` 下文件 move 到 `logs/pslog-legacy-*`**，不直接搬目录 |
