# CommonText 图片粘贴默认 writer 未生效

## Goal

修复 CommonText 大编辑框粘贴图片时出现的 `Image paste failed (...): write is not a function`，让未显式传入 writer 的调用使用默认附件写盘函数。

## Requirements

- `materializePastedImages(images)` 必须使用默认 `writer`，与显式传入 writer 的 Overview 通道行为一致。
- 默认附件目录仍为 `commontext-images`，显式 writer 的注入与 subdir 参数行为不变。
- 只修改图片粘贴工具函数及其单元测试；不改焦点、弹窗、终端或发送链路。
- 按用户要求不做真机验证，以定向单元测试作为机器判据。

## Acceptance Criteria

- [x] 新增回归测试：不传 writer 时成功生成 markdown，并调用默认目录的 mkdir/write RPC。
- [x] `npx vitest run frontend/app/commontext/commontext-paste-image.test.ts` 全部通过（17/17）。
- [x] 修复前新增测试因 `write is not a function` 失败，修复后通过，红绿证据入库。

## Notes

- 轻量修复，PRD-only。
- 根因：函数已计算默认 `writer`，但循环仍调用可选的 `write`。
- 红证：新增默认 writer 用例修复前 1 failed / 16 passed，失败原文 `Image paste failed (32 B): write is not a function`。
- 绿证：定向 17/17；CommonText + Overview 三文件回归 47/47；ESLint exit 0；独立 trellis-check PASS。
- TypeScript：全仓 58 个既有错误，目标两个文件 0 错误（未引入新类型错误）。
- 按用户要求未做真机验证；G7 留待 nita 验收。
- Spec 判断：本次是一处局部参数误用，回归测试已锁定契约，没有新增跨层约定或可复用设计决策，因此不修改 `.trellis/spec/`。
