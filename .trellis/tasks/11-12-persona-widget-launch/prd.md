# A3 widget 🎭 图标 + hover 登场弹窗 + 注入开关

## Goal

「叫某个人设登场」= 右侧栏一次 hover + 一次回车。

## Requirements

- 右侧 widget 条新增 🎭（同尺寸/同 hover 语义）
- hover >300ms 弹选择弹窗（bloom-menu 语言）：选 Agent（provider 网格 + 模型）、选人设（● 登场中/○ 空闲，复用 agentstatus）、「＋ 新建人设…」
- 注入开关（默认关）：勾选 → 首条提示前置 `[登场上下文] 本次主工作目录: <path>`
- 登场 = `agent-launch` 管线 + `cmd:cwd`=据点 + block meta `persona:id` + 写 `props.persona`
- 点击 🎭 → 打开名册 Block（A4）
- Esc 关闭；悬停离开 220ms 收起

## Acceptance Criteria

- [ ] `npx vitest run frontend/app/workspace` → passed
- [ ] 真机 area `persona-launch`：300ms 前不弹/后弹出两断言
- [ ] 注入开/关两种首条消息断言各 1 条
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `<=47`

## 依赖

A1；A2（弹窗内新建入口在其前隐藏）。
