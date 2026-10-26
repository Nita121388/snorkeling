# Implement — 终端 file:// 链接识别与默认程序打开

## 0. 前置

- [x] 现状核查（WebLinksAddon 正则、openTerminalLink、open-native-path、OSC 7 解析、tooltip 配色）
- [x] GitNexus 影响面分析（`TermWrap` CRITICAL / 其余 LOW）
- [x] 用户确认范围：只做 `file://` URL；右键菜单加"在文件夹中显示"

## 1. 实现（顺序即依赖顺序）

- [x] 1.1 新增 `frontend/app/view/term/term-file-url.ts`
  - [x] `TerminalLinkRegex`（http(s) + file，不带 `g` flag）
  - [x] `isFileUrl(uri)`
  - [x] `fileUrlToNativePath(uri)`：盘符 / 百分号编码 / UNC / POSIX / 非 file 协议
  - [x] `terminalLinkHint(uri, modKey)`
- [x] 1.2 新增 `frontend/app/view/term/term-file-url.test.ts`
  - [x] 路径解析用例（盘符 / 中文百分号编码 / UNC / POSIX / 非 file / 畸形 URL / 坏编码）
  - [x] 正则：命中中文 `file://` 路径、不命中 `profile://`、不吃尾部标点、仍命中 https
  - [x] `terminalLinkHint` 文案分流
- [x] 1.3 `frontend/app/view/term/termwrap.ts`
  - [x] 传 `urlRegex: TerminalLinkRegex` 给 `WebLinksAddon`
  - [x] activate 按协议分流到 `openNativePath` / `openTerminalLink`
- [x] 1.4 `frontend/app/view/term/term-tooltip.tsx`
  - [x] `TermLinkTooltip` 保存 hovered URI，文案走 `terminalLinkHint`
  - [x] 气泡皮肤改用主题变量（背景/文字/边框/阴影）
- [x] 1.5 `frontend/app/view/term/term-model.ts`（`getContextMenuItems`）
  - [x] `file:` 链接 → "Open File in Default App" + "Show in Folder"
- [x] 1.6 `frontend/app/view/term/osc-handlers.ts`
  - [x] `handleOsc7Command` 复用 `filePathFromFileUrl`，输出约定不变

## 2. 验证

- [x] 2.1 `npx vitest run frontend/app/view/term` 全绿（12 文件 / 99 用例，含新增 24 例）
- [x] 2.2 `npx tsc --noEmit -p tsconfig.json` 无新增错误（修掉 `fireAndForget` 包 void 的一处 TS2322；
      其余 73 条为既有错误，均在本任务改动文件之外）
- [x] 2.3 `npx eslint`（6 个改动文件）0 error；1 条既有 warning（`term-model.ts:600` 未使用参数）
- [ ] 2.4 手动（CDP）：用户 2026-10-22 晚自行验证（本轮未运行 app）
  - [ ] 终端打印 `file:///E:/code/snorkeling/docs/answers/vcs-中文路径乱码-20261022-145411.html`，hover 出现提示气泡
  - [ ] Ctrl+点击后默认浏览器打开该 html
  - [ ] 浅色主题下气泡浅底深字，深色主题下深底浅字
  - [ ] 右键 file 链接出现两项菜单；右键 http 链接菜单不变
- [x] 2.5 影响面：改动集中在 `WebLinksAddon` 正则与 activate 分流；http(s) 分支语义未变

## 3. 收尾

- [x] 3.1 更新 `.trellis/spec/snorkeling-docs/frontend/quality-guidelines.md`（终端链接与浮层提示约定）
- [x] 3.2 提交（`42972ee5 feat(term): open file:// links with the default app`，已推送）
- [ ] 3.3 归档任务：等 2.4 手动验证通过后再 `task.py archive`

## 回滚点

- 步骤 1.1–1.6 均为独立小改，任一步失败可单独 revert 对应文件。
- 不涉及后端与协议，无需回滚服务端。
