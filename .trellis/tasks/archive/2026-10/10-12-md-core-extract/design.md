# 设计：md-core 抽离 P0

## 目标结构

```
frontend/app/element/
  markdown-transform/        ← 纯逻辑（Phase B 将成为 md-core/src/transform）
    block-range.ts           ← 新增：从编辑壳下沉的纯块区间函数
    structural-ops.ts        ← 改为只依赖 block-range（不再依赖编辑壳）
  block-model/               ← editor-controller.ts 同上
  remark/                    ← markdown-file-refs.ts 改走 adapter
  markdown-render/           ← image.tsx 改走 adapter
  markdown-core/host.ts      ← 新增：MdHostAdapter 接口 + setMdHost/getMdHost + 默认实现
  markdown-inline-edit.tsx   ← 保留对外 API（re-export 下沉的函数），21 个引用点不动
```

## 不变量（本任务建立）
1. **单向依赖**：`markdown-inline-edit` → `markdown-transform`（可），反向（不可）。
2. **零宿主依赖**：4 个目录不 import `@/view`、`@/store`、`@/util`、`@/app/view`、`@/app/store`、`jotai`、`wos`。
3. **宿主能力只走 adapter**：图片/文件引用等宿主差异全部经 `MdHostAdapter`。

## 改造点

### C1 反向依赖解除（数据安全上最关键）
- 目标函数：`moveBlockRange`、`deleteBlockRange`、`replaceSourceRange`、`spliceInsertBlock`
- 落到 `markdown-transform/block-range.ts`；`markdown-inline-edit.tsx` 从该模块 import 并 **re-export 同名符号**（保持对外 API 与类型签名逐字不变）
- `structural-ops.ts` / `editor-controller.ts` / 两个测试文件改为从 `markdown-transform/block-range` 取
- **前置校验**：先确认这 4 个函数不读模块级可变状态、不引用 React/DOM/会话对象；若引用，先抽出其纯内核（只搬纯部分），并记录
- 验收：`grep -rn "markdown-inline-edit" markdown-transform block-model` 只允许出现在 `*.test.ts` 之外的空结果（0）

### C2 宿主适配层
```ts
// frontend/app/element/markdown-core/host.ts
export interface MdHostAdapter {
  resolveImageSrc?(src: string, opts: {...}): { src: string; ... } | undefined; // 默认返回 undefined → 走原逻辑
  openImageLightbox?(...): void;
  resolveFileRef?(...): ...;
}
export function setMdHost(host: MdHostAdapter): void;
export function getMdHost(): MdHostAdapter;
```
- 默认实现 = **调用现有的 Wave 代码路径**（延迟 import 以避免静态依赖），保证行为零变化
- `image.tsx`、`markdown-file-refs.ts` 改为只用 adapter 暴露的能力
- 若某处宿主依赖过深（如灯箱 / contextmenu store），**优先保留在 adapter 的默认实现里**，不要为了「干净」而改交互

### C3 边界门禁测试
- 新增 `frontend/app/element/markdown-core-boundary.test.ts`
- 做法：读 4 个目录的源文件（排除 `*.test.ts(x)`），正则提取 `from "..."` specifier
- 断言：specifier ∈ { 相对路径, 白名单绝对路径, 第三方包 }；命中禁列（`@/view`、`@/store`、`@/util`、`@/app/view`、`@/app/store`、`jotai`、`wos`、`markdown-inline-edit`）即失败并打印文件:行 + 原文
- 白名单形如 `const SHARED_ROOT_ALLOWLIST = [{ path: "@/app/element/markdown-util", reason: "Phase B 将移入 md-core" }]`，**每条必须带 reason**

## 风险与回滚
| 风险 | 缓解 |
|---|---|
| 4 个函数其实不纯 | 先读源码确认；不纯则只搬纯内核或放弃 C1 并上报 |
| re-export 造成循环 import | 依赖方向单向（编辑壳 → block-range），不会成环；跑全量测试验证 |
| adapter 默认实现改动了行为 | 默认实现保留原代码路径；跑 741 测试 + 沙箱冒烟 |
| 门禁白名单被「放宽式」绕过 | 白名单每条必须写 reason，且不得包含禁列项 |

回滚点：C1 / C2 / C3 各自独立可回滚（三个 commit）。
