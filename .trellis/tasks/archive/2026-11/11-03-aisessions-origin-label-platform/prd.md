# AISessions 本地 origin 标签平台化：Windows 显示 "This PC"

## Goal

AISessions 的 Origin 下拉里，本机 origin 的标签不再无条件显示 "This Mac"，而是按当前操作系统给出正确称呼：

- Windows → `This PC`（与项目里已有的本地机叫法一致）
- macOS → `This Mac`
- 其他（Linux 等）→ `This Machine`

## Background（已核实的代码事实）

1. `pkg/service/aisessionsservice/origins.go:121-129` — `Origins()` 构造本机 origin 时把 `Label` **硬编码**为 `"This Mac"`。后端没有任何 `runtime.GOOS` 判断，所以 Windows 构建返回的也是 "This Mac"。
2. `frontend/app/view/aisessions/origin-switcher.tsx:110-111` — 按钮的 `aria-label` / `title` 在 `active` 为空（origins RPC 尚未返回）时 fallback 到写死的 `"This Mac"`，属于同一个文案硬编码的第二处。
3. 全仓 `"This Mac"` 只有上述 3 处（`rg` 核实；`emain/updater.ts` 的 "This macOS build" 是另一件事，不在范围内）。
4. 项目内 Windows 本地机的既有叫法已经是 `"This PC"`：`pkg/wshrpc/wshremote/windows_drives.go:7`、`frontend/app/view/preview/preview-windows-drives.ts:5`（`WindowsDrivesDisplayName`）。所以本次不是发明新文案，而是把 AISessions 对齐到既有约定。
5. 现有测试 (`pkg/service/aisessionsservice/origin_service_test.go`) 没有断言 label 字符串，改动不会打破已有断言，但也意味着缺少回归保护。
6. 该 label 仅用于展示（下拉行、`aria-label`、`title`、`Edit <label>`），不参与 origin 路由（路由用 `id`），因此改动无兼容性风险。

## Requirements

- R1 本机 origin 的显示标签由后端按 `runtime.GOOS` 推导，不再硬编码 `"This Mac"`。
- R2 Windows 上必须是 `This PC`，与 `WindowsDrivesDisplayName` 保持一致。
- R3 推导逻辑必须可单测：抽成接受 `goos string` 的纯函数，避免只能靠真机验证。
- R4 前端 fallback 文案改为平台中性（`origins` 未返回时的临时显示），不再写死 `"This Mac"`。
- R5 不改动 origin 的 `id` / `kind` / 路由语义，也不改外部 dump 与 "All machines" 的标签。

## Non-goals

- 不做 origin 标签的用户自定义（那是 "Edit origins..." 弹窗里外部 origin 的事）。
- 不做整体 i18n / 多语言改造。
- 不改 `emain/updater.ts` 里关于 macOS 签名的那句提示。

## Acceptance Criteria

- [ ] AC1 `pkg/service/aisessionsservice` 中存在按 `goos` 推导标签的纯函数，`windows → "This PC"`、`darwin → "This Mac"`、其余 → `"This Machine"`，并有表驱动单测覆盖三种输入。
- [ ] AC2 `Origins()` 返回的本机 origin `label` 等于该推导函数在当前平台的结果（单测断言，而不是写死字符串）。
- [ ] AC3 `origin-switcher.tsx` 中不再出现字面量 `"This Mac"`（`rg -n "This Mac" frontend/` 无结果）。
- [ ] AC4 全仓仅 `darwin` 分支保留 `"This Mac"` 字符串；`rg -n "This Mac" pkg/ frontend/` 只剩平台推导函数里的一处。
- [ ] AC5 `go test ./pkg/service/aisessionsservice` 通过；`go build ./...` 通过；前端 `tsc` / vitest 相关工作区检查（如仓库有 typecheck 脚本）不新增报错。

## Rollback

单文件改动 + 一处前端文案，`git revert` 即可回滚；无数据/配置迁移。
