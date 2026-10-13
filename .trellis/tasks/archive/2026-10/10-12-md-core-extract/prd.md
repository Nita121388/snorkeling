# md-core 抽离 P0：解除核心层反向依赖 + 宿主注入 + 边界门禁

## Goal
用户希望「markdown 编辑部分可单独抽离、甚至作为独立项目」。本任务完成抽离的**第一步（P0）**：让「可抽离」从愿望变成**可验证的不变量**，且**行为零变化**。

## 背景（实测，2026-10-12）
- 4 个候选层共 38 文件 / 9910 行 / 25 个测试文件：`markdown-transform`(12) `block-model`(4) `remark`(10) `markdown-render`(12)
- **真正的阻塞不是 Wave**，而是**核心层反向依赖编辑壳**：
  - `markdown-transform/structural-ops.ts:39` + `:213`、`block-model/editor-controller.ts:35` 从 `../markdown-inline-edit`（2461 行编辑壳）取纯函数 `moveBlockRange` / `deleteBlockRange` / `replaceSourceRange` / `spliceInsertBlock`
  - 两个测试文件同样如此
- 其余向外依赖：`@/util/util`、`@/app/view/preview/file-link-navigation`、`../../store/global`、`../../store/contextmenu`、`block-editor/flags`、`iconbutton`/`copybutton`/`image-lightbox`、`table-block`、以及若干 `frontend/app/element/markdown-*.ts` 根文件
- 外部引用这 4 层的文件共 **21 个**（编辑壳、block-editor UI、md-properties/html-export/banner 插件）

## Requirements
- R1 **解反向依赖**：把 4 个纯函数从 `markdown-inline-edit.tsx` 下沉到 `markdown-transform/block-range.ts`，核心层只依赖纯模块；`markdown-inline-edit.tsx` 对外 API **保持不变**（re-export），使 21 个外部引用点无需改动。
- R2 **宿主注入**：定义 `MdHostAdapter`（图片 src 解析/灯箱、文件引用解析等宿主能力），把 `markdown-render/image.tsx`、`remark/markdown-file-refs.ts` 的宿主依赖改为注入；默认实现 = 现有行为。
- R3 **边界门禁**：新增测试，把「4 个目录不得依赖宿主（`@/view`、`@/store`、`@/util`、`@/app/view`、`@/app/store`、`jotai`、`wos`）」变成可执行断言；白名单必须逐条有理由（白名单即 Phase B 的搬移集）。
- R4 **行为零变化**：不改任何写盘路径、不改渲染输出、不改交互；无 flag 变更。

## Acceptance Criteria
- [ ] `npx vitest run frontend/app/element` = **49 文件 / 741 用例全绿**（不多不少；若新增门禁测试则为 50 文件）
- [ ] `npx tsc --noEmit` 错误数 = **68**（基线，无新增）
- [ ] `markdown-transform` / `block-model` 对 `markdown-inline-edit` 的依赖为 **0**（`grep` 可验证）
- [ ] `image.tsx` / `markdown-file-refs.ts` 不再直接 import 宿主模块，改走 adapter（默认实现保持现行为）
- [ ] 边界门禁测试落地且通过，白名单每条有注释理由
- [ ] 未改动任何外部 21 个引用点（`git diff --stat` 可验证）

## Notes
- **不做**物理抽包（`packages/md-core`）——那是下一个任务；本任务只让边界成立。
- 数据安全：本任务不触碰写盘逻辑，但仍不得在真实笔记上做交互验证。
- 若发现这 4 个函数并非纯函数（依赖模块级状态/闭包），**停下来记录并上报**，不要强行搬。
