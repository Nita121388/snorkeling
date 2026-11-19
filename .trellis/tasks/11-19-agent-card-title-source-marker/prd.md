# 标题来源短标记

## Goal

agent card 副标题不再显示 `First User Message` 之类的长串英文，改成一个能看出来源的小标记；完整说明只在 tooltip 里出现。

## Background / 确认事实

- `frontend/app/view/term/agent-hover-card.tsx:184-186`：`subline = `${modelText} · ${humanizeKey(titleSource)}``；`first_user_message` 经 `humanizeKey()` 变成 `First User Message`（`property-model.ts:335-341`）。
- `agent-hover-card.tsx:249`：tooltip 用 `i18n.t("term:hoverCard.titleSource", { source: titleSource })`，中英文资源在 `frontend/i18n/locales/{zh,en}/term.json:27`。
- `frontend/app/view/aisessions/title-source-badge.tsx:12-24`：已有小标记组件，但只识别 `ai`（✨），完整文案来自 `aisessions:titleBadge.aiGenerated`。
- `frontend/app/view/aisessions/property-list.tsx:64`：已明确 `title_source` 从属性区移到副标题；AISessions 列表/详情属性区的完整标签不在本任务范围。

## Requirements

- **R1**：agent card（悬浮卡及复用它的放大弹窗）副标题不再展示 `humanizeKey(titleSource)` 长串。
- **R2**：新建 **card-local** `AgentCardTitleSourceMark`（只给 agent card 副标题用），`ai` 沿用现有 ✨ 语义、`first_user_message` 用小消息标记；`user` / `source_title` / `project` / `id` 不额外标记。**不改共享 `TitleSourceBadge`**：它被列表行、详情头、`EditableTitle` 和 `SessionNoteSection` 共用，改它会泄漏到明确 out-of-scope 的面，且会在同一张卡上出现两次标记。
- **R3**：标记带中英文 tooltip（如「标题来自首条用户消息」/ "Title from first user message"），完整来源值只存在于 tooltip/aria-label。
- **R4**：Tab 更多紧凑行没有标题来源位，不需要新增；不引入新依赖。
- **R5（性能红线，用户硬约束）**：标记渲染必须是纯函数 + 静态图标，不新增 RPC、定时器、订阅或文件读取；hover 首帧不增加任何异步工作。

## Acceptance Criteria

- [ ] 单测 3/3 PASS（`agent-card-title-source-mark.test.tsx`）：`first_user_message` 渲染标记且副标题文本不含 `First User Message`；`ai` 仍渲染 ✨；`user` 不渲染标记；另断言共享 `TitleSourceBadge` 对 `first_user_message` 仍返回空（`badge_unchanged PASS`）。命令尾部 `&& echo VITEST_OK` → 期望含 `VITEST_OK`。
- [ ] 真机 area 由兄弟任务 A 独占，本任务只往 `scripts/verify/agent-card-model/verify.mjs` 追加 3 条断言（副标题无长串 / 有标记 / tooltip 含完整来源），`node scripts/verify/agent-card-model/verify.mjs` → 输出含 `12/12 PASS`。
- [ ] `npm run i18n:check && echo I18N_OK` → 期望含 `I18N_OK`，新增 key 在 zh/en 两份资源都存在；`npx vitest run && echo VITEST_OK` → 期望含 `VITEST_OK`。

## Out of Scope

- 不改 `titleSource` 取值、优先级、存储、后台生成与 `autoTitleEligible`（契约见 `aisessions-title-contract.md`）。
- 不改 AISessions 列表/详情属性区的完整标题来源标签。
- 不改模型/subline 的其它部分（由兄弟任务 `11-19-agent-card-model-provider` 负责）。

## 流程约束

与兄弟任务 A **共用一个 loop 包** `N-1119-agent-card-display`（type=bug, severity=S3, task 指向父任务），门链 G2 + G7，避免两个包抢同一个 verify area。`touch` 白名单：`frontend/app/view/term/agent-hover-card.tsx`、`frontend/app/view/term/agent-card-title-source-mark.tsx`、`frontend/app/view/term/agent-card-title-source-mark.test.tsx`、`frontend/i18n/locales/{zh,en}/term.json`、`scripts/verify/agent-card-model/verify.mjs`、`docs/project/verify-ledger.md`、本任务目录。**不写** `title-source-badge.tsx` 与 `scripts/verify/README.md`。
