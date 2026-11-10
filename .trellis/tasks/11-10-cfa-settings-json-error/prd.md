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

- `npx vitest run frontend/app/view/waveconfig/` → 全绿，新增 ≥ 3 用例。
- 手动在 Raw JSON 制造 `"term:fontsize": "13"`（类型错）→ 点复制 → 粘贴文本
  `grep -c "term:fontsize"` ≥ 1、`grep -c "### Output"` = 1。
- 真机验证台（waveconfig area，如无则走最小 e2e：CDP 开面板造错断言按钮）+ 台账一行。

## Touch（白名单）

- `frontend/app/view/waveconfig/waveconfig-model.ts`（失败详情收集）
- `frontend/app/view/waveconfig/waveconfig.tsx`（按钮）
- `frontend/app/view/waveconfig/*.test.ts*`

## Out of Scope

- 可视化表单校验（settings-density 落地任务的事）。
- 自动修复 JSON。
