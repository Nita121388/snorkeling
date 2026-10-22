# Implement — 终端 file:// 链接识别与默认程序打开

## 0. 前置

- [x] 现状核查（WebLinksAddon 正则、openTerminalLink、open-native-path、OSC 7 解析、tooltip 配色）
- [x] GitNexus 影响面分析（`TermWrap` CRITICAL / 其余 LOW）
- [x] 用户确认范围：只做 `file://` URL；右键菜单加"在文件夹中显示"

## 1. 实现（顺序即依赖顺序）

- [ ] 1.1 新增 `frontend/app/view/term/term-file-url.ts`
  - [ ] `TerminalLinkRegex`（http(s) + file，不带 `g` flag）
  - [ ] `isFileUrl(uri)`
  - [ ] `fileUrlToNativePath(uri)`：盘符 / 百分号编码 / UNC / POSIX / 非 file 协议
  - [ ] `terminalLinkHint(uri, modKey)`
- [ ] 1.2 新增 `frontend/app/view/term/term-file-url.test.ts`（先写测试再实现）
  - [ ] 路径解析 5 类用例
  - [ ] 正则：命中中文 `file://` 路径、不命中 `profile://`、不吃尾部标点、仍命中 https
  - [ ] `terminalLinkHint` 文案分流
- [ ] 1.3 `frontend/app/view/term/termwrap.ts`
  - [ ] 传 `urlRegex: TerminalLinkRegex` 给 `WebLinksAddon`
  - [ ] activate 按协议分流到 `openNativePath` / `openTerminalLink`
- [ ] 1.4 `frontend/app/view/term/term-tooltip.tsx`
  - [ ] `TermLinkTooltip` 保存 hovered URI，文案走 `terminalLinkHint`
  - [ ] 气泡皮肤改用主题变量（背景/文字/边框/阴影）
- [ ] 1.5 `frontend/app/view/term/term-model.ts`（`getContextMenuItems`）
  - [ ] `file:` 链接 → "Open file in default app" + "Show in Folder"
- [ ] 1.6 `frontend/app/view/term/osc-handlers.ts`
  - [ ] `handleOsc7Command` 复用 `fileUrlToNativePath`，输出约定不变

## 2. 验证

- [ ] 2.1 `npx vitest run frontend/app/view/term` 全绿
- [ ] 2.2 `npx tsc --noEmit -p tsconfig.json` 无新增错误
- [ ] 2.3 `npx eslint frontend/app/view/term` 无新增错误
- [ ] 2.4 手动（CDP）：`npm run dev:cdp` → `node scripts/inspect-electron-ui.mjs state`
  - [ ] 终端打印 `file:///E:/code/snorkeling/docs/answers/vcs-中文路径乱码-20261022-145411.html`，hover 出现提示气泡
  - [ ] Ctrl+点击后默认浏览器打开该 html
  - [ ] 浅色主题下气泡浅底深字，深色主题下深底浅字
  - [ ] 右键 file 链接出现两项菜单；右键 http 链接菜单不变
- [ ] 2.5 `node .gitnexus/run.cjs detect-changes` 复核影响面

## 3. 收尾

- [ ] 3.1 更新 `.trellis/spec/snorkeling-docs/frontend/quality-guidelines.md`（终端链接与 tooltip 主题变量约定）
- [ ] 3.2 提交（仅本任务相关文件，勿带入工作区其它未提交改动）
- [ ] 3.3 `python3 .trellis/scripts/task.py archive 10-22-terminal-file-url-ctrl-click`

## 回滚点

- 步骤 1.1–1.6 均为独立小改，任一步失败可单独 revert 对应文件。
- 不涉及后端与协议，无需回滚服务端。
