# Implement — Files 树节点悬浮信息 Tooltip

## 0. 前置

- [ ] 读 `frontend/app/treeview/treeview.tsx`（行渲染 / 虚拟滚动 / 事件绑定）
- [ ] 读 `frontend/app/view/preview/preview-explorer.tsx`（`toTreeNode` / `fetchDir`）
- [ ] 读 `frontend/app/element/hover-timing.ts`（共享 hover 常量）
- [ ] GitNexus `impact` 已在规划阶段完成（`TreeNodeData` LOW / `toTreeNode` LOW / `TreeView` LOW）
- [ ] 工作区当前有其它未提交改动（`git status` 已确认）→ **只提交本任务涉及的文件**

## 1. 共享 hover 延迟常量

- [ ] `frontend/app/element/hover-timing.ts` 增加 `export const FileTooltipHoverDelayMs = 700;`
      并补注释说明取值依据（树很密，需要比普通 tooltip 更长的意图确认）

## 1.5 叶子格式化模块（复用收敛）

- [ ] 新建 `frontend/util/fileformat.ts`（只依赖 dayjs）：
  - [ ] `formatFileSize(bytes: number | null | undefined): string`
        —— 从 `frontend/app/view/aisessions/utils.ts:438` 平移，**行为逐字不变**
        （`0 → "0 B"`、`1536 → "1.5 KB"`、`5MB → "5 MB"`、负数/undefined → `""`）
  - [ ] `getLastModifiedTime(unixMillis: number): string`
        —— 从 `frontend/app/view/preview/preview-directory-utils.tsx:67` 平移，含 `padDay` 私有函数
  - [ ] `frontend/app/view/aisessions/utils.ts`：删除本地实现，改为 `export { formatFileSize } from "@/util/fileformat";`
  - [ ] `frontend/app/view/preview/preview-directory-utils.tsx`：删除本地实现与 `dayjs` import，
        改为 `export { getLastModifiedTime } from "@/util/fileformat";`
  - [ ] 回归：`aisessions/utils.test.ts`（已有 formatFileSize 用例）+ `preview-directory-utils.test.ts` 必须仍然通过

## 2. Tooltip 组件与纯函数

- [ ] 新建 `frontend/app/treeview/treeview-file-tooltip.tsx`
  - [ ] `describeMimeType(mimeType?: string, isDirectory?: boolean): string`（自实现，design.md §2.2 表格）
  - [ ] `buildFileMetaRows(node): { label: string; value: string }[]`（缺数据不产出该行）
  - [ ] `FileMetaTooltip` 组件：`props { reference: HTMLElement | null; node: FileMetaNode | null; icon?; iconColor?; open }`
        - `useFloating({ open, placement: "right", middleware: [offset(10), flip(), shift({padding: 12, crossAxis: true})], whileElementsMounted: autoUpdate })`
        - `refs.setReference(reference)`，`refs.setFloating`
        - `FloatingPortal` 渲染卡片
        - 入场动效：先以隐藏态渲染，下一帧（rAF）再翻到可见态 → `transition` 才会真的触发
        - `role="tooltip"`、`pointer-events-none`、`z-50`
  - [ ] 卡片 DOM 结构：头部（图标 + 名称 + 类型徽章）→ 分隔线 → 元信息行 → 分隔线 → 路径
  - [ ] 大小/时间格式化 **直接用 `@/util/fileformat` 的 `formatFileSize` / `getLastModifiedTime`**（不自造轮子）
- [ ] 新建 `frontend/app/treeview/use-hover-intent.ts`
  - [ ] `createHoverIntentController(options)`：纯计时控制器（无 React / 无 DOM 依赖，用 `globalThis.setTimeout`）
        - `pointerEnter()` → 延迟 `delayMs` 后 `onOpen()`
        - `pointerLeave()` → 立即 `onClose()`，`closeDelayMs` 后 `onUnmount()`
        - `dispose()` → 清掉待触发计时器
  - [ ] `useHoverIntent(options)`：React 封装（回调放 ref，卸载时 dispose）

## 3. TreeNodeData 扩展 + 透传

- [ ] `frontend/app/treeview/treeview.tsx`：`TreeNodeData` 增加 `size?: number; modtime?: number;`
- [ ] `frontend/app/view/preview/preview-explorer.tsx`：`toTreeNode()` 透传
      `size: fileInfo.isdir ? undefined : fileInfo.size`、`modtime: fileInfo.modtime`

## 4. TreeView 接入

- [ ] `frontend/app/treeview/treeview.tsx`
  - [ ] 顶层状态：`hoveredRow: { id, node, element, icon } | null` + `tooltipOpen`
  - [ ] `pendingRowRef`：pointerenter 时记下当前行（node / DOM 节点 / 图标名），计时到期再取
  - [ ] 用 `useHoverIntent` 接管计时（整棵树共用一个计时器）
  - [ ] 行 `onPointerEnter` / `onPointerLeave` 接到上面
  - [ ] 移除行上的原生 `title={row.label}`（避免与浮层 tooltip 重叠）
  - [ ] 容器层渲染 `<FileMetaTooltip … />`（单例，不在行内）
  - [ ] `onScroll` 时收起 tooltip（行被虚拟滚动回收 → 锚点失效）

## 5. 测试

- [ ] 新建 `frontend/app/treeview/treeview-file-tooltip.test.ts`
  - [ ] `describeMimeType`：markdown / json / directory / 未知 subtype / 缺失
  - [ ] `buildFileMetaRows`：文件全量 / 目录 / 缺 size / 缺 modtime / notfound / staterror / 零字节
  - [ ] `FileTooltipHoverDelayMs === 700`
- [ ] 新建 `frontend/app/treeview/use-hover-intent.test.ts`（fake timers）
  - [ ] 延迟未到不打开 / 到点才打开
  - [ ] 未到点就移开 → 取消打开
  - [ ] 移开 → 立即 onClose，closeDelay 后才 onUnmount
  - [ ] 行间移动（连续 enter/leave）→ 只开一次、不误卸载
  - [ ] dispose 后计时器不触发
- [ ] `formatFileSize` / `getLastModifiedTime` 不重复造用例（沿用 `aisessions/utils.test.ts` 的既有断言）
- [ ] 回归：`frontend/app/treeview/treeview.test.ts` 仍通过
- [ ] 回归：`frontend/app/view/aisessions/utils.test.ts` 仍通过（re-export 后）

## 6. 验证命令

> Go/Task/npm 自测必须在子 PowerShell 进程里 dot-source 本地环境。
> 本任务只涉及前端，命令在仓库根执行：

```bash
# 单测（目标包）
npx vitest run frontend/app/treeview

# 类型检查 + lint + 格式
npx tsc --noEmit -p tsconfig.json
npx eslint frontend/app/treeview frontend/app/view/preview/preview-explorer.tsx frontend/app/element/hover-timing.ts
npx prettier --check frontend/app/treeview frontend/app/view/preview/preview-explorer.tsx frontend/app/element/hover-timing.ts
```

## 7. 视觉验证（Nova 品味自检）

> 已用 preview harness + headless Chrome 做过一轮自动校验（快速划过不弹、文件/目录节点内容正确、
> 窄视口不溢出、入场/出场动画都真的在跑）。**最终视觉仍需人眼在真实 app 里过一遍。**

- [ ] 启动预览 harness：`cd frontend/preview && npx vite` → `http://localhost:7007`
- [ ] 打开 `treeview` 预览（`frontend/preview/previews/treeview.preview.tsx`，已带 size/modtime mock）
      与 `explorer` 预览（`frontend/preview/previews/explorer.preview.tsx`）
- [ ] 悬浮节点 ≥700ms，检查：
  - [ ] 卡片层级/描边/圆角/阴影与项目其他浮层（`preview-new-files`、`widgets` 快速启动）一致
  - [ ] 排版：标签弱、值清、路径等宽换行
  - [ ] 边缘不裁切（贴屏幕右缘时翻到左侧）
  - [ ] 快速划过不弹
- [ ] 截图存 `docs/answers/` 或任务目录，作为设计证据

## 8. 收尾

- [ ] `node .gitnexus/run.cjs detect-changes` 确认只影响预期符号
- [x] 更新 spec：`.trellis/spec/snorkeling-docs/frontend/component-guidelines.md`
      新增「虚拟滚动列表上的悬浮浮层」「浮层入场动画」「floating-ui shift 交叉轴」三条 Common Mistakes
- [ ] 只提交本任务相关文件（当前工作区有其它任务的未提交改动）
- [ ] `task.py archive`

## 9. Rollback 点

- 步骤 1–3 之间任意点失败 → `git checkout -- frontend/app/treeview/treeview.tsx frontend/app/view/preview/preview-explorer.tsx frontend/app/element/hover-timing.ts` + 删除两个新文件
- 步骤 4 之后失败 → 保留数据字段（无害），仅回滚 TreeView 接入
