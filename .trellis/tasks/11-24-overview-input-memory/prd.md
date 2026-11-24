# PRD：Overview 输入记忆 + 存 CommonText

> 父任务 `11-24-overview-agent-batch`。需求 R3/R4/R5，方案 `../11-24-overview-agent-batch/design.md` §3，步骤 `implement.md` P3。

## Goal

用户输入的 agent 选择与文本不再"一关就没"，并支持一键存进 CommonText 复用。

## R3 新建 agent 弹窗记忆

- 现状：`overview-add-agent-modal.tsx` 每次都默认选 profile 列表第一项（`profileOptions[0]`），路径恒为「随 Tab」，发送内容关掉即丢。
- 目标：记住**上次 agent 类型**与**未提交的发送内容**；下次打开仍在。路径仍默认「随 Tab」（父 PRD D1）。
- 约束：profile 记忆需按本次探测结果校验，不在列表内则回落第一项（不报错）。

## R4 composer 草稿持久化

- 现状：`useCardSendState().draftByBlock` 纯内存（`overview-card-send-panel.tsx:79`）。
- 目标：按 `blockId` 持久化到 localStorage；重开面板/切列表⇄看板/重启后仍在；发送成功后清除（失败保留；`unknown` 保留并打标）。
- 约束：写入防抖 400ms；`maxEntries=50`、`maxAgeMs=14 天`、单条上限 8KB。

## R5 存 CommonText icon

- 目标：composer footer 增加 icon 按钮，点击把当前草稿存为一条 CommonText（不发送、不清稿）。
- 约束：空草稿 disabled；重复内容内联提示「已存在」不弹窗；成功轻量内联反馈；不改 CommonText 同步语义。

## 存储通道决策

用 localStorage（`sessionoverview:senddrafts` / `sessionoverview:addagent`），不加 Go settings 字段。先例：`displayLimit` / `viewMode`（`session-overview-model.ts:121-128`）。

## 验收判据

```bash
npx vitest run frontend/app/session-overview/overview-input-memory.test.ts && echo MEM_STORE_OK
```
→ `MEM_STORE_OK`

```bash
npx vitest run frontend/app/session-overview/overview-card-send-panel.dom.test.tsx && echo MEM_PANEL_OK
```
→ `MEM_PANEL_OK`

```bash
node scripts/i18n/check-parity.mjs && echo MEM_I18N_OK
```
→ `MEM_I18N_OK`

单测覆盖：读写往返、非法值回落、LRU 上限、过期清理、超长截断、空草稿 disabled、重复内容内联提示、存后草稿仍在。

## 非目标

不做跨设备同步；不做草稿的多 tab 实时互同步（storage 事件可选，不阻塞验收）。
