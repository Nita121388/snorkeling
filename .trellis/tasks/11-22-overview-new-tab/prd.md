> **Confirmed: 2026-11-22 @nita**

# PRD：Overview 新建 Tab（两处入口 + 三选一弹窗）

> 父任务：`11-22-overview-tab-card-ux`。UX：父任务 `ux-ascii.md` §④
> 状态：planning（design/implement 排到时补齐）

## Goal

在 Overview 里直接建 Tab，不用跑去 Tab 栏点 `+` 再切过去。

## 需求

### R1 入口两处
- R1.1 **工具栏** `＋ 新建 Tab`（全局建，建完不自动切过去，留在 Overview）。
- R1.2 **组列表尾部** 一行 `＋ 新建 Tab`（就近建，位置=末尾；建完新组插在尾部）。

### R2 弹窗三选一（对齐父 PRD C 决策）
| 选项 | 行为 |
|---|---|
| 空 Tab | `createTab()` + `tab.rename(name)` |
| 空 Tab + Agent(默认 provider) | `createTab()` → `agent launch --tab <newTabId> --profile <default>`（复用 11-09/11-20 链路） |
| 从模板… | 本轮**只留占位**（置灰 + tooltip「即将支持」），不实现模板系统 |

- R2.1 可选名称，默认 `新 Tab`；空名回落默认。
- R2.2 `Esc` 取消、`Enter` 创建（焦点不在名称框时聚焦名称框）。

### R3 创建后
- R3.1 新组**原地插入**该 Tab 的组行（`▾ 新 Tab` + 一行「空 Tab（刚创建）」），不整页刷新、
  不自动跳转、不抢焦点。
- R3.2 失败原地报错（`E_*` + 一句话 + 重试），不弹模态。

## 验收判据（数字）

1. 单测：弹窗三选一的状态机 + 空名回落 + Enter/Esc。
2. 真机（`overview-ux` area 第 8-9 条断言）：
   - 空 Tab：`workspace.tabids` 长度 +1，且 Overview 组头数 +1；
   - 空 Tab + Agent：新 Tab 的 `blockids` 长度 = 1 且该块 meta 含 `agent:*`；
   - 两种路径都不改变当前激活 Tab。

## 依赖

- `createTab()`（`frontend/app/store/global.ts:729`）
- `agent launch --tab`（11-09 已交付，含 `--no-focus`）
- 分组修复子包（新组要落在新分组渲染里）

## 不做

- 不做模板系统（占位即可）。
- 不做 Tab 命名唯一性校验、不做批量建 Tab。
- 不自动把新 Tab 设为激活（除非用户勾「创建后打开」，本轮不提供）。
