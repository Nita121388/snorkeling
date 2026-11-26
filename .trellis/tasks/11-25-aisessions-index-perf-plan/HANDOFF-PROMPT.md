# 接手 prompt：AI Sessions 索引性能调查收尾（给另一个 agent）

> 用法：把下面代码块整段复制给接手 agent。am 工具用法已补充在文末「工具」一节。

````text
# 任务：AI Sessions 索引性能深入调查与整改计划（接手已有调查，只读、零生产改动）

## 背景与目标

Snorkeling（WaveTerm fork，仓库 E:/code/snorkeling）的 AI Sessions 索引库
~/.snorkeling/ai-sessions/index-v2.sqlite 约 3.42GB（117 万条消息、text 1.06GB、thinking 590MB），
线上出现两类高频报错：
1) service?service=aisessions&method=Summary → 503（43.65s，返回 7 字节 "Timeout"）
2) LiveSessionState → ERR_EMPTY_RESPONSE

本任务（Trellis: .trellis/tasks/11-25-aisessions-index-perf-plan，状态 planning）已在前一天完成大半调查，你接手收尾并交付最终 HTML 整改计划。**本轮只调查不实施**：不改 frontend/、pkg/、emain/ 生产代码，不改当前索引库，不 VACUUM 当前库，不重启用户运行中的 Snorkeling，不动 pi/codex/claude/opencode 的会话 JSONL。

## 必读（接手前按序读完）

1. .trellis/tasks/11-25-aisessions-index-perf-plan/prd.md —— 硬约束 R1-R5
2. .trellis/tasks/11-25-aisessions-index-perf-plan/design.md —— 分阶段方案（已定稿）
3. .trellis/tasks/11-25-aisessions-index-perf-plan/implement.md —— 调查清单第 1-6 项已完成，第 7-10 项是你的工作
4. .trellis/tasks/11-25-aisessions-index-perf-plan/NEXT-STEPS.md —— 前任 agent 留的接手说明（含工具用法和已知 bug）
5. .trellis/tasks/11-25-aisessions-index-perf-plan/research/performance-baseline.md —— 已固化基线数字
6. .trellis/tasks/11-25-aisessions-index-perf-plan/research/rpc-timeout-root-cause.md —— 503/空响应调用链

## 已证实的核心结论（不要重复调查）

- 索引命中路径（列表/单会话元数据/详情正文）不慢：列表摘要 P50 103ms、单会话 0.33ms、最大正文详情（25.93MB）39ms。
- 主要用户可感知缺陷是搜索：当前实现拉取 866MB text 到 Go 逐条匹配，P50 4.32s。
- 朴素 SQL instr(lower(text)) 更慢（8.86s）且 SQLite lower() 是 ASCII、与 Go strings.ToLower 的 Unicode 语义不等价（ß/İ/希腊 sigma/CJK/emoji 均有反例），禁止直接替换。
- 503 根因：Summary(false) 缓存 miss → resolveSession 回退全量扫描（manager.go:1557-1587）→ join 到 60s/120s 后台扫描 flight（scancoordinator.go:227-280，joiner 无独立预算），21s http.TimeoutHandler（web.go:548）或 21s WriteTimeout（web.go:578）先到 → 503/空响应。
- LiveSessionState 根因：chat/session.go:291-309 GetState 忽略 ctx，rpc.Send 固定 30s（chat/rpcprocess.go:43-48,144-160）；disk fallback 走 CurrentModelState → Summary 同一条长扫描链。
- loadAll 写放大（代码链已证实，缺运行时复现）：DetailDelta continuation summary 只填 Key/ID/Source/FilePath/MessageCount，缺 MTime/Size（aisessionsservice.go:1268-1283）→ 每帧 GetMessages 必 miss → provider 整文件解析 + SaveMessages 整会话 delete+insert，且把 mtime/size 写回 0（manager.go:752-830、sqlite_index.go:1496-1582,2090-2140）。前端 agent.tsx:225/277、subagent-card.tsx:109/163 用 loadAll:true。已确认无 loadAll 回归测试。
- 存储收益已测：删重复 idx_ai_session_messages_session（295.86MB，与 PK autoindex 完全重复）+ user 索引改部分索引（278.55→14.36MB）+ VACUUM → 2.83GB（-17.38%）；整数 fk 窄元数据表 44.88MB 让最大会话 turn 扫描 30.3→9.2ms；独立正文表初版三表 equijoin 详情 39ms→2761ms（70.7× 回退），暂缓拆表。

## 你要做的三件事（implement.md 第 7-9 项，然后第 10 项清理）

### 1. 补搜索候选基准 + loadAll fake-provider 复现（最难的一件）

工具已写好：tmp/aisessions-index-perf-bench/followup/（Go module，followup.exe 已编译）。
已知 bug（前任已定位未修）：-mode loadall 报 "no such table: ai_session_messages"——loadall.go 里 NewManagerWithOptions 之后直接用裸 openSQLite 打开 observer，但 schema 是惰性创建的。修法：在开 observer 前先调 aisessions.OpenSQLiteIndex(manager.SQLitePath, manager.MetaPath) 再 Close 热身 schema（该函数在 pkg/aisessions/sqlite_index.go:36，已导出）。
编译：powershell -NoProfile -ExecutionPolicy Bypass -Command ". E:\code\snorkeling\scripts\use-local-env.ps1 -Quiet; go build -o followup.exe ."（在 followup/ 目录）
运行（注意 -db 相对路径、报告输出到 ../）：
  ./followup.exe -mode semantics -out-dir work -report-dir ..
  ./followup.exe -mode loadall  -db ../baseline.sqlite -out-dir work -report-dir .. -runs 3
  ./followup.exe -mode search  -db ../baseline.sqlite -out-dir work -report-dir .. -runs 3
搜索模式很慢（每次候选全表扫 4s+），-runs 3 起，耐心等。
判据：
- loadAll 多帧会话：首帧后 ProviderLoadCalls/SaveMessagesEquivalent 增量应为 0，session_mtime/size 非零（若非 0 即实锤运行时复现写放大）。
- 搜索三候选（当前 bulk / 流式 / SQL 自定义 contains_lower + 每会话 LIMIT 1）结果必须与当前实现逐条一致；语义对拍靠 -mode semantics 的 10 个 Unicode 用例。
- 若候选 P50 ≤ 1500ms 且结果一致 → design.md 阶段 C 候选 2 成立；否则结论写"保持现状单独迭代"。
- baseline.sqlite 是唯一一致性快照（quick_check=ok），删掉后重测需重新 backup（约 110s）。所有写实验只碰它，绝不碰 ~/.snorkeling/ 下的原库。

### 2. 生成 HTML 整改计划

草稿已有：tmp/aisessions-index-perf-plan.md（A-H 八节：评审裁决/实测基线/根因链/存储收益/分阶段/影响矩阵/验收数字/证据边界）。
把第 1 步的实测数字补进去后渲染：
  am render tmp/aisessions-index-perf-plan.md -o docs/answers/aisessions-index-perf-plan-<日期>.html
硬性要求：frontmatter 必须有 collapse: true 且渲染后保留；0 渲染错误（lint 0 警告）。HTML 是评审交付物，不代表已实施——页面里要写明这一点。

### 3. 收尾与清理

- 把第 1 步实测数字补进 research/performance-baseline.md，更新 implement.md 勾选第 7-9 项。
- 清理 tmp/aisessions-index-perf-bench/（当前约 13G，E 盘只剩 21G）：删 baseline.sqlite、candidate-int.sqlite、rewrite-current.sqlite、variants.sqlite、body-layout-sample.sqlite、raw/、work/、followup/work/、followup.exe；可以保留 *.go 源码和 *.json 结果做证据链。**必须在第 1、2 步全部完成并验证后再删。**
- 提交：git add .trellis/tasks/11-25-aisessions-index-perf-plan docs/answers/<新页面> research 相关文件，提交信息写明"调查收尾+实测数字"，推送 origin main。注意工作区可能有其他人未提交的改动，只提交本任务文件。

## 工具：answer-me-with-html（am，D:/Apps/answer-me-with-html，v0.7.0）

命令行入口 `am`（am.cmd 已在 PATH）。渲染 Markdown 草稿为单文件 HTML 讲解页。本项目规范：**一律带 -o 输出**，frontmatter 固定写 `collapse: true`（可折叠版；实测只有源稿显式声明才能在 am patch 重建后保住）。

常用命令：
  am render <draft.md> -o <out.html> [--theme auto|blueprint|shadcn|paper] [--no-open] [--replace <page.html>]
      渲染草稿。不写 -o 会落到 ~/.answer-me-with-html/pages/（不符合本项目规范）。
  am patch <page.html> --panel <panel title> <draft.md|->
      只替换已有页面里同名的 ## 章节并原地覆写该 HTML；源稿从页面隐藏的 #am-source 读取。
  am lint <draft.md>  只跑 STE 写作检查（0 警告才算过）。
  am help format      草稿格式语法（frontmatter / 章节语法 / 组件）。
  am help component   组件语法（callout / flow / timeline / limits 等）。
  am list             列模板、主题、组件。

本项目要点：
- frontmatter：title / subtitle / lang: zh / template: doc / outline: right / collapse: true / source: 数据与日期。
- 有 STE 或代码警告的页面不会自动打开；修草稿后用 --replace <page.html> 重渲（旧页在新页写出后删除）。
- am patch 重建页面会丢配置级折叠，只有源稿 frontmatter 显式 collapse: true 能保住（实测 2026-11-21，am 0.6.1）。
- 输出位置规范：存在当前工作目标子目录（如 2026-MM-主题/）时输出到该目录内与源 md 同目录；否则输出到 <项目根>/docs/answers/<主题>-<时间戳>.html。
- 本任务页面必须是「可折叠、可评审」版式：一页讲清结论→证据→根因→方案对比→分阶段计划→影响矩阵→验收数字→风险回滚，禁止把未实施写成已实施。

## 通用纪律

- 零功能回退优先于一切性能指标：不截断 text/thinking、不改轮定义、不丢批注/stale 语义、搜索结果必须逐条一致。
- 所有结论三档标注：已实测（有数字）/代码证实（有 file:line）/推断（写明依据）。不许"感觉慢"。
- 性能是硬约束：任何未来实施方案若达不到验收门（design.md §5），宁可保持现状。
- Windows 环境；Go/Task 要走 scripts/use-local-env.ps1；预计超 60s 的命令放后台跑。
- 安全例外（必须随方案保留）：此前备份期间运行中的 Snorkeling 改写过原库，只能证明快照一致、不能证明原库零触碰。

## 完成标准（prd.md Acceptance Criteria）

- [ ] 搜索候选与 loadAll 复现有实测数字，边界清晰
- [ ] HTML 生成成功（collapse:true、0 渲染错误）
- [ ] tmp 副本清理完毕
- [ ] 零生产代码改动、零当前数据库改动
- [ ] 提交推送完成
````

## 附：am 用法速查（供人看，不进 prompt）

| 命令 | 用途 |
|---|---|
| `am render draft.md -o out.html` | 渲染；本项目必须带 `-o` |
| `am patch page.html --panel "标题" new.md` | 只替换一节，原地覆写 |
| `am lint draft.md` | 只跑写作检查 |
| `am help format` / `am help component` | 草稿格式 / 组件语法 |
| `am render draft.md --replace page.html` | 修警告后重渲替换旧页 |

关键坑：`collapse: true` 必须写在源稿 frontmatter，`am patch` 重建会丢配置级折叠（实测 am 0.6.1，当前装 0.7.0 仍按此规范执行）。
