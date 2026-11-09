# Journal - nita (Part 1)

> AI development session journal
> Started: 2026-10-03

---

## 2026-10-21 Wave AI：`ai:endpoint` 填 base URL 导致 chat 404

用户报「设置模型后报 404 page not found，但获取模型正常」。根因不是模型选择，是 endpoint 契约：
`ai:endpoint` 一直是完整请求 URL，而 cc-switch 导入和手填都会给成 base URL。FetchModels 早就会
剥 `/chat/completions`，所以模型列表看着正常；三条 chat 链原样 POST 裸 base，网关回 404。

修复走 Lyra `joinUrl` 的思路但更保守：新增 `pkg/aiusechat/aiutil/endpoint.go`，只把「确定是 base」
的形态（裸主机、版本段结尾）补上终止路径，自定义路径（Wave `/api/waveai`、Azure `?api-version=`、
Gemini `models/<m>:method`）一律原样返回。接入 openai-chat / openai-responses / anthropic /
gemini + FetchModels，错误信息加上实际 URL。24 个单测 + openaichat 2 个，全绿，真实端点复验 404→401。

## 2026-10-30 opencode 作为 agent 的支持缺口补齐（进行中）

梳理后发现 opencode 支持是「壳子接好、核心没落地」。三件事落地 + 一个架构性发现：

1. **后端 provider 重写（10-26）**：实测 opencode 1.18.32 真实 schema 是
   `session(model JSON, parent_id, directory)` + `message(data.role)` + `part(type=text/tool)`，
   `session_message` 0 行且无 role/content。旧代码全查错列 → provider 整体扫不到。
   已重写 `provider_opencode.go`：路径探测改 XDG data home（`~/.local/share/opencode`）优先、
   session 读真实列 + 解析 model JSON 填 VendorID + parent_id→Kind/ParentKey、
   消息走 message+part 聚合、工具从 part.type=tool 提取、snippet 走 bounded JOIN、
   新增 LoadMessageDelta（基于 LastSeq 行游标）。legacy role/content 保留为防御回退。
   测试套件按新 schema 全重写 + 新增 model/parent/delta 用例。`go test ./pkg/aisessions` 全绿。

2. **前端 ccswitch loader bug（10-30-ccswitch-loader-fix）**：`loadCcSwitchVendors` 只分
   codex/claude，opencode/pi 全落 claude RPC → opencode 厂商下拉实际是 claude 厂商。
   已补 opencode→CcSwitchListOpenCodeVendorsCommand、pi→...PiVendorsCommand。tsc 该文件 0 错。

3. **关键实测发现：`OPENCODE_HOME` 对 opencode 完全无效**（用非法 json 探测：
   `OPENCODE_CONFIG_DIR` 会报解析错=生效，`OPENCODE_HOME` 无反应=无效）。
   项目里 agent-launch / resume 命令 / cc-switch 物化全用 `OPENCODE_HOME`，等于厂商隔离一直没生效。
   已把 agent-launch 和 restoreCommandForSession 的注入改成 `OPENCODE_CONFIG_DIR`（实测有效），测试同步。

4. **架构性缺口（待决策）**：opencode 会话存在单一全局 DB，`model.providerID`（opencode-go）
   是 opencode 自带 provider，≠ cc-switch vendor id。所以「按会话恢复原厂商」反推不出来，
   恢复隔离对 opencode 不成立。需要产品决策：要么接受 opencode 恢复不隔离厂商，要么在启动时
   把 block→vendor 映射落库做 provenance。

5. **agent-status 钩子**：hookinstall 已用 `OPENCODE_CONFIG_DIR`（正确），但插件自动发现
   需 TUI 启动验证事件 payload，non-interactive 探不到，留作 10-30-hook-verify 真机项。

## 2026-11-04 下班快照 · 11-04-preview-edit-verify-harness

- 已提交：验证台骨架(b88a24f9)、软换行+内联标记样式+整块像素判据(62b92ce7)、撤销污染宿主窗口的 caret 注入(c8b4b77d)
- 工作区未提交/未验证：折叠式有序项的「首行缩进」几何建模（resolveListContinuation + data-list-indent-mode="first-line"）
  - 真因：渲染态是首行缩进(首行77/续行44)，我原来是悬挂缩进(两行77)，续行右移 33.02px（历史报的 2px/38px 都是墨迹行带假数据）
  - 中断点：验证时 ol-collapsible 双击打不开；stash 对照证明不是我的改动，是实例状态异常（上一轮 Esc 在编辑器未打开时把 block 关掉了）
- 待办：① 复跑验证 ② observe 的 Esc 要判 overlay 存在 ③ 关掉我开出的 8 个重复 preview block（用户已提醒）④ 全绿后 check/spec/commit/finish
- 详见 `.trellis/tasks/11-04-preview-edit-verify-harness/notes.md`

## 2026-11-04 任务盘点（只盘点，未开发）

- 45 个活跃任务逐一用「git log + 源码存在性」核对，不依赖 checkbox。
- 结论：22 个已落地待归档；5 组该关闭/转形态；真正未开工 8-10 个。
- 新需求「图片预览跨文件夹翻页」已完成 PRD 级设计（DFS 图库序列 + 锚点目录），未开工。
- 分支侧：13 个 snorkeling worktree；A 档 7 个可安全删，B 档 4 个需确认，C 档 3 个不可动
  （含 snorkeling-gui-chat 独立 clone 的 24 个未提交 chat 运行时改动）。
- 决策稿：Obsidian `My Projects/Snorkling/方案/2026-11-04-任务盘点与下一步编排.md`

## 2026-11-05 下班快照 · 交付批 4/4（功能 4 未完待接手）

- 已交付发版：0.0.115 验证台 / 0.0.116 图片翻页 / 0.0.117 Overview 看板
- 功能 4 Files VCS 树标记：实现 + 真机 31/31 已绿，**未发版**；剩余 3 条审核建议 + 发版 0.0.118
- 接手文档：`.trellis/tasks/11-04-files-vcs-tree-status/implement.md`（剩余 TODO 按优先级排好，含验证命令与发版步骤）

## 2026-11-05 功能 4 收尾 + 0.0.118

- 三条审核建议全部落地（a7c149c7）：中间层符号链接对齐（情形 C 子序列+首尾双锚定）、
  commit/sync 成功后清 VCS 缓存、树视图行名 title（`getLabelTitle`）。
- 实现取舍：原计划的「B 分支尾对齐」推导后发现退化成 `resolved=仓库根`，只覆盖一半场景且放松了
  无关仓库防护；改用子序列双锚定，两方向都覆盖，同级无关目录不产假标记。
- 验证：vitest 26 例 + treeview 23 例全绿，tsc 69 基线不变，真机 CDP 31/31。
- 踩坑：真机 verify 在 Windows 上必须用带盘符的 fixture（`VCS_FIXTURE=E:/tmp/vcs-fixture`）——
  `/tmp` 只有盘符相对语义，git rootpath 带盘符后两边拼写对不上；现象是 rows=0 或 rows 有但
  marks 全 undefined。已写进 preview-edit-harness spec。
- 发版：bump 0.0.118（12eab5dc）+ tag `snorkeling-v0.14.6-beta.0-0.0.118` 已推，CI run 41947396042。
- 观察（未修，非本任务范围）：情形 A 的「共享单个尾部组件」对叶子名相同的同级目录仍会误映射（既有行为）。

## 2026-11-02 Agent Control Surface P0：会话面 + 会话卡

用户要「本地 Agent 能用 wsh 受控地读实时会话、写会话卡」。设计文档 1367 行早已就位，代码只落了
只读那一半（c235c39b），而且带着三处硬伤。这一轮把 P0.0 补齐、P0.1 从零做完。

**先做同步**：分支落后 origin/main 138 个提交。`git merge-tree` 先验 → 零冲突、两边改动文件完全不重叠
（我碰 agentcontrol/wshrpc/wshcmd，main 那 138 个提交碰的是 aisessionsservice origins 与前端 agent-card）。
merge 后 go build ./... 通过、四包测试全绿、`task generate` 无 diff。分支此前没 push 过，顺手建了跟踪。

**P0.0 修的三处**：
1. **违反扫描契约（真 bug）**：`fillSummaries` 对每条会话调一次 `Manager.Summary`。
   Summary → resolveSession → refreshAllSummaries，N 条未命中 = N 次全量扫描 —— 正是
   `aisessions-scan-contract.md` 记载的 OOM 成因。新增 `Manager.ResolveSummaries`：
   live registry（内存）→ 一次开库按主键批量 GetSession → 仅未知项限流升级。
2. **`card.hash` 从来没填**：prd 要求 hash 能直接喂给 `card set`，代码里 `SessionLiveCard.Hash` 是空的。
   改用 `agentdata.HashSession`，与 agentdata 校验前置条件时算的是同一个函数。
3. **零测试**：只有 redact 两个用例。补了 24 个表驱动用例（freshness/idle/过滤/排序/去重/chatKey）
   + golden 快照锁字段名、null-vs-省略、脱敏，+ 拆 `session.go` 把 live.go 从 556 行降到 428。

**P0.1 从零做**：`SetAITitle(force)` + `ErrTitleProtected`（守 title contract 的 user > ai）、
`session_title.update` / `session_prop.update` 两个 op 全部复用既有 validate/preview/apply 管线
（所以白拿 dry-run/备份/审计/前置条件）、`wsh agent card get/set`、两个新 RPC。

**过程中撞出的两个真缺陷（都不是我写的，但必须修）**：
1. `sessionPropDiff` 把没变的 prop 也报成 changed —— "跳过 user 值" 会被误报成已修改。
2. **多 op patch 永远无法生效**：`applyOperation` 拿同一 patch 里前序 op 已改过的状态重新校验
   `expectedHash`，必然冲突，还会触发备份回滚把刚写的 note 撤掉。`card set --note --title` 必挂。
   改成只在写前统一校验一次前置条件（`ApplyPatch` 本来就这么做，只是 apply 侧重复校验了）。

**验收**：P0 全部可验证项打勾并标注对应测试；真机项（UI 一致性、kill→stale、P95）明确留白，
没有假装完成。全仓 `go test ./...` 只剩 `conncontroller` 一个既有失败（改动前后一致，已比对确认）。

**教训**：写完"能编译"不等于写完。这三处硬伤里，扫描契约那条只有读了 spec 才会发现，
`card.hash` 那条只有对着 prd 验收项逐条核才会发现 —— 任务文档的验收清单不是装饰。

## 2026-11-09 Inline Tab「更多」下拉：删除后保持菜单打开

用户报 Tab 化 Block 的「更多」下拉点 × 删一条后菜单就关了，无法连续删。根因是
`inlinetab-dropdown.tsx` 里 `handleClose` 和键盘 Delete/Backspace 都显式 `onOpenChange(false)`
（d0d4a582 有意为之，但交互上不合理）。修复：删除后不关菜单，行列表随 store 更新刷新；
键盘删除记录 `{被删行索引, blockId}`，待 `tabs` 收缩后按索引恢复焦点（越界取最后一条，
行删空落回菜单容器 tabIndex=-1）；确认弹窗取消（行还在）只清引用不动焦点。溢出消失或
组内剩 1 个 block 时由父组件自然关闭，这两条保留。14 例单测（3 个新焦点用例）+ 相关面
37 例全绿；真机 verify 台 skipped（无对应 area），已记台账。教训写进 quality-guidelines：
列表型下拉的每行删除默认不得顺手关菜单，键盘删除必须恢复焦点。
