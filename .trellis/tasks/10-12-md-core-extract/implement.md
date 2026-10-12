# 执行计划：md-core 抽离 P0

## 准备（先读，别急着改）
- [ ] 读 `frontend/app/element/markdown-inline-edit.tsx` 中 4 个函数的实现与依赖：`moveBlockRange` / `deleteBlockRange` / `replaceSourceRange` / `spliceInsertBlock` —— **确认纯度**（是否读模块级可变状态、是否引 React/DOM）
- [ ] 读 `markdown-transform/structural-ops.ts`、`block-model/editor-controller.ts` 的引用方式（值/类型）
- [ ] 读 `markdown-render/image.tsx`、`remark/markdown-file-refs.ts` 的宿主依赖细节
- [ ] 基线：`npx vitest run frontend/app/element`（49/741）、`npx tsc --noEmit`（68）

## 步骤

### 1. C1 纯函数下沉（commit 1）
- [ ] 新建 `frontend/app/element/markdown-transform/block-range.ts`，**逐字搬运** 4 个函数及其私有依赖；文件头写清「本模块为纯函数，禁止引入 React/宿主依赖」
- [ ] `markdown-inline-edit.tsx` 删除原实现、改为 `import ... from "./markdown-transform/block-range"` 并 **re-export**（对外签名不变）
- [ ] `structural-ops.ts` / `editor-controller.ts` / 两个测试改为从 `./markdown-transform/block-range`（或对应相对路径）导入
- [ ] 验证：`grep -rn "markdown-inline-edit" frontend/app/element/markdown-transform frontend/app/element/block-model | grep -v "\.test\."` → **0 行**
- [ ] `npx vitest run frontend/app/element` 全绿

### 2. C2 宿主注入（commit 2）
- [ ] 新增 `frontend/app/element/markdown-core/host.ts`（接口 + get/set + 默认实现）
- [ ] `markdown-render/image.tsx`：宿主调用改走 adapter（默认实现保持原行为）
- [ ] `remark/markdown-file-refs.ts`：同上
- [ ] 验证：这两个文件不再出现 `@/util` / `@/view` / `@/app/view` 静态 import
- [ ] `npx vitest run frontend/app/element` 全绿

### 3. C3 边界门禁（commit 3）
- [ ] 新增 `frontend/app/element/markdown-core-boundary.test.ts`
- [ ] 白名单实测生成：对 4 目录跑一次提取，把**剩余**合法共享依赖逐条写进白名单 + reason
- [ ] 门禁必须**先失败后通过**（可用一个临时反例验证它真的能抓违规：例如临时在 core 里加一行 `import { atom } from "jotai"` 看是否被拦，然后删除）
- [ ] `npx vitest run frontend/app/element` 全绿（文件数 49→50）

### 4. 复核与收尾
- [ ] `npx tsc --noEmit` 错误数仍为 68（**不得新增**）
- [ ] `git diff --stat` 确认**未改动**任何外部引用点（`markdown.tsx`、`block-editor/**`、`view/preview/plugins/**` 等 21 个文件应无 diff，除非是必要的一行导入调整——若必须改，记录理由）
- [ ] **沙箱冒烟**（验证行为零变化）：`node scripts/dev-isolated.mjs --profile scratch --vite-port 51752 --cdp-port 9333`；在草稿笔记里做一次「点击块 → 编辑 → 失焦」，确认 md 文件 md5 与编辑前一致（不改动时逐字节不变）
- [ ] 三个 commit（C1/C2/C3），消息用 `refactor(md-core): ...` 前缀
- [ ] 更新 spec（`.trellis/spec/` 相关文件：新增「md-core 边界不变量」Pattern + `directory-structure.md` 补 `markdown-transform/block-range.ts` / `markdown-core/host.ts`）
- [ ] 写 Obsidian 开发记录 `06-开发记录.md` + 勾掉 `07-TODO.md` 中已完成的抽离 P0 条目

## 验证命令
```bash
cd /Users/nita/Primary/projects/snorkeling-wysiwyg
npx vitest run frontend/app/element 2>&1 | tail -5
npx tsc --noEmit 2>&1 | grep -c "error TS"      # 期望 68
grep -rn "markdown-inline-edit" frontend/app/element/markdown-transform frontend/app/element/block-model | grep -v "\.test\."   # 期望 0
```

## 回滚点
- C1 失败 → `git revert` commit 1（其余不受影响）
- C2 失败 → revert commit 2
- C3 失败 → revert commit 3
