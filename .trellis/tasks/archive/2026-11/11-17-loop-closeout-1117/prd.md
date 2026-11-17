# loop 台账收尾：F-1117 补记 + Tab「收起到更多」补包

## Goal

补齐 2026-11-17 两个没进账的交付，让台账与事实对齐：

1. **F-1117-overview-card-props**（Overview 卡面自定义属性，commit `83b6e5c8d`）：
   代码已落、g1/g2/g5 已清，但 item 文档「背景/记录」全是待补，绿证没跑没记，
   台账零事件（引擎不在本机）。
2. **Tab 右键「收起到更多」+ 激活/未读置灰**（commit `f44ec0942`）：
   完全游离——无任务、无 loop 包、无台账事件。

## 背景与限制

- **单一写者契约**（`.trellis/spec/guides/day-night-loop-contract.md`）：
  `loop/LEDGER-*.jsonl` / `loop/gates/**` 只能由引擎（queue.mjs，Windows 机器
  `E:/primary/projects/loop`）写，本机（macOS）手改违约。因此引擎侧动作只能
  写进 `loop/INBOX.md` 待分诊，不伪造 ledger 事件、不代签 G7。
- QUEUE.md / LEDGER.md / INDEX.md 是生成物，不手改。

## 交付物

1. **F-1117 绿证**：跑 `overview-board-props.test.ts` 确认由红转绿，结果记进 item 记录。
2. **F-1117 item 补记**：`loop/items/F-1117-overview-card-props.md` 的背景/来源/记录
   按事实补齐（含 commit、门现状、G6/G7 待办）。
3. **Tab 收起到更多补包**：
   - 建 Trellis 任务 `11-17-tab-collapse-to-more`（记录已交付范围 + 待 G7）；
   - 建 loop item `N-1117-tab-collapse-to-more`（feature，来源=回填，含 touch 白名单）；
   - **红证**：临时 revert 实现文件 → 跑 `tabcontextmenu.test.ts` 证红 → 还原，
     红证存 `loop/red/N-1117-tab-collapse-to-more.txt`。
4. **引擎侧欠账**：`loop/INBOX.md` 各记一行（F-1117 补 ledger 事件 + G6/G7；
   新包入库/判据分诊），由 Windows 引擎侧处理。
5. 复核两个既有欠账包状态不动（conn-typeahead G7、v2-gutter 人工走查——都等人，不是我）。

## 验收判据

- [x] `npx vitest run frontend/app/session-overview/overview-board-props.test.ts` → 全绿（红证记 11 failed，绿证必须 0 failed）—— 2026-11-17 实测 11/11 passed
- [x] `git status` 干净（红证用的临时 revert 必须完全还原）—— 临时回退三文件后已 `git checkout HEAD --` 完全还原，仅余本任务新增文件
- [x] `loop/items/N-1117-tab-collapse-to-more.md` 存在且 frontmatter 含 id/type/priority/task/touch
- [x] `loop/red/N-1117-tab-collapse-to-more.txt` 存在且内含 FAIL 输出（5 failed，含测试名）
- [x] `loop/items/F-1117-overview-card-props.md` 无「（待补）」残留
- [x] `loop/INBOX.md` 新增 2 行引擎侧欠账——实际记 3 行（含 package-lock 版本字段脱节，顺手发现）
- [x] QUEUE.md / LEDGER.md / INDEX.md / LEDGER-*.jsonl / gates/** 零改动（git status 验证）

## 不做

- 不代签任何 G1/G6/G7（人门凭据只能人签，L-0005）
- 不手改 ledger / gates / queue.json（单一写者契约）
- 不动 conn-typeahead 与 v2-gutter 的收尾（等用户验收）
