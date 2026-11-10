# 设置 JSON 校验失败：复制给 agent

> 父任务：11-10-copy-for-agent
> 依赖：cfa-core
> 关联：settings-density 原型（General 面板已定稿 Raw JSON Tab 保留）

## Background

`~/.waveterm/settings.json` 手改出错（键名拼错 / 类型错 / 括号丢失）时报错只有一行
"invalid settings JSON"，用户向 agent 描述「我的配置坏了」时既拿不到键名也拿不到位置。
General 面板 Raw JSON Tab（`waveconfig.tsx`）有 Monaco 编辑器但没有失败详情复制出口。

## Goal

校验失败时给出 `Copy for agent`：具体键 / 错误位置 / 出错片段，agent 拿到即可修。

## Requirements

### R1 失败详情收集

- 保存校验失败时（`waveconfig-model.ts` 既有 validationError 路径），收集：解析错误信息（含
  行列号，若有）、当前文件内容中出错行 ±5 行片段、文件路径、总行数。
- 校验错误若已含具体键（schema 校验），键名必须进 payload；纯 JSON 解析错误给位置 + 片段。

### R2 入口

- 保存失败提示条（面板头部「Unsaved changes / Save」一侧或错误提示区）出现 `<CopyForAgent>`。
- payload = Context（文件路径 / 错误行:列 / 片段）+ Task（"Fix this settings JSON so it parses and
  matches the expected key types, and list every key you changed"）+ Output contract
  （`MERGED_CONTENT_ONLY`：只回修好的完整 JSON 内容）。

### R3 单测

- 解析错误（缺括号）：payload 含行号与片段。
- 键类型错误：payload 含键名。
- 校验通过时不渲染按钮。

## Acceptance（命令 → 期望输出）

- [x] `npx vitest run frontend/app/view/waveconfig/` → 全绿（新增 `waveconfig-json-error.test.ts` 9 用例 ≥ 3：解析错误含行列+片段 / 键类型错误含键名 / 无位置不造坐标 / 边界窗口钳制）。
- [x] 手动在 Raw JSON 制造键类型错（真机 e2e：双逗号语法错 + `term:fontsize`）→ 点复制 → payload 含 `term:fontsize`、`position: line`、`snippet (`、`### Output contract` = 1（真机 verify `payload-*` 锁死）。
- [x] 校验通过时不渲染按钮：初始合法态无失败条（`no-error-banner-initially`）；修复后失败条消失（`banner-gone-after-fix`）。
- [x] 真机验证台：新 area `scripts/verify/waveconfig-json-error/verify.mjs` → **11/11 全绿**（launch+reset，Monaco 真实键入驱动），台账已记；area 已登记 README。

## 实现备注（2026-11-10）

- 细节收集在纯函数模块 `waveconfig-json-error.ts`：`extractJsonErrorPosition`（兼容 V8「line N column M」与「position P」两种格式）、`buildSnippet`（±5 行编号片段，错误行 `>` 标记）、`describeJsonFailure`、`buildSettingsJsonFailurePayload`。
- model 侧统一出口 `setValidationFailure()`：三条失败路径（非对象 / schema validator / parse error）都同时置 `validationErrorAtom` 与 `saveFailureAtom`，成功保存时一并清。
- 验证台驱动经验（回写 ui-verify-playbook 的素材）：此 Monaco 用 Chromium **EditContext**（activeElement=div.native-edit-context），CDP `Input.insertText` / execCommand 都进不了输入管线，必须逐字符 `char` 事件；DOM 比对要把 `\u00a0` 归一化；Monaco 自动补全括号意味着「少打收尾字符会留残影」，驱动用双逗号语法错 + 空对象修复。

## Touch（白名单）

- `frontend/app/view/waveconfig/waveconfig-model.ts`（失败详情收集）
- `frontend/app/view/waveconfig/waveconfig.tsx`（按钮）
- `frontend/app/view/waveconfig/*.test.ts*`

## Out of Scope

- 可视化表单校验（settings-density 落地任务的事）。
- 自动修复 JSON。
