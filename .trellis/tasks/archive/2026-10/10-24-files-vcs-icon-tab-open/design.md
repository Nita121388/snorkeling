# Design — Files Block VCS 入口的放置策略统一

## 1. 边界

- 只改前端 placement 决策层：`preview-model.tsx`（图标 + 私有放置方法）与
  `preview-directory-utils.tsx`（右键菜单 4 个 open* 辅助函数）。
- 不改 `frontend/layout/lib/layoutModel.ts`：`addBlockToInlineTab` 已具备"单块升级为 group"能力。
- 不改 `frontend/store/global.ts` 的 `createBlock` / `createBlockSplit*` 语义。
- 不改任何 VCS 视图（`view/vcs*`）的 meta 契约。

## 2. 新增私有方法 `openBlockDefAsInlineTab`

位置：`PreviewModel`（`preview-model.tsx`，紧跟 `openVersionControlBlock` 附近）。

```ts
/**
 * 把 blockDef 以 Tab 形式并入当前 Block 所在 group，并聚焦。
 * @param dedupeMetaKeys 同 view + 这些 meta 键全部相等时聚焦已有块，不重复创建
 * @returns true = 已并入 tab；false = 无宿主节点 / 并入失败（调用方走 createBlock 回退）
 */
private async openBlockDefAsInlineTab(
    blockDef: BlockDef,
    dedupeMetaKeys?: string[]
): Promise<boolean>
```

流程：

1. `layoutModel = getLayoutModelForStaticTab()`；`node = layoutModel.getNodeByBlockId(this.blockId)`；无 node → `false`。
2. 若给了 `dedupeMetaKeys`：遍历 `getLayoutDataBlockIds(node.data)` 中**其它** Block，
   要求 `block.meta.view === blockDef.meta.view` 且全部 `dedupeMetaKeys` 值相等
   → `layoutModel.setActiveInlineTabBlock(node.id, blockId)` 并返回 true。
   - 值为空/undefined 的键不参与相等判断（避免把无关键字块误判为同一目标）。
   - connection 相等判断复用文件内既有 `isLocalConnName` 容错写法（本地连接名可互换）。
3. `newBlockId = await ObjectService.CreateBlock(blockDef, { termsize: { rows: 25, cols: 80 } })`（与文件内既有写法一致）；空 → `false`。
4. `layoutModel.addBlockToInlineTab(node.id, newBlockId)`：
   - false → `fireAndForget(() => ObjectService.DeleteBlock(newBlockId))`，返回 `false`；
   - true → `this.focusBlockById(newBlockId)`，返回 `true`。

## 3. `openVersionControlBlock` 改造

```ts
async openVersionControlBlock(options?: { forceNewBlock?: boolean }) {
    // 原 meta 组装逻辑不变
    const blockDef: BlockDef = { meta: { view: "vcs", connection, "vcs:path": vcsPath, "vcs:selectedfile": selectedFile } };
    if (!options?.forceNewBlock && (await this.openBlockDefAsInlineTab(blockDef, ["vcs:path"]))) {
        return;
    }
    await createBlock(blockDef);
}
```

- 参数为可选 → 其它潜在调用方（当前只有图标一处）不受影响。
- `forceNewBlock: true` 直接跳过 inline-tab 分支，命中原来的 `createBlock`。

## 4. 图标点击接线

`preview-model.tsx` 的 `endIconButtons`：

```ts
const vcsButton: IconButtonDecl = {
    elemtype: "iconbutton",
    icon: "code-branch",
    title: "Version Control (Ctrl/Cmd+Click: new block)",
    zone: "reveal",
    click: (e) => fireAndForget(() => this.openVersionControlBlock({ forceNewBlock: e.ctrlKey || e.metaKey })),
};
```

- 用 `e.ctrlKey || e.metaKey` 而不是只判 Ctrl：macOS 的 Ctrl+click 是右键语义，Cmd 才是"新开"。
- 与 `preview-directory.tsx:618`、`preview-explorer.tsx:1114` 的既有约定完全一致。

## 5. 右键菜单统一（`preview-directory-utils.tsx`）

4 个辅助函数改为接收 `model`，内部走 `model.openBlockDefAsInlineTab`，失败回退 `createBlock`：

| 函数 | 去重键 | 回退 |
| --- | --- | --- |
| `openVcsBlock` | `["vcs:path"]` | `createBlock` |
| `openMultiVcsBlock` | `["vcs:path"]` | `createBlock` |
| `openHistoryBlock` | `["vcshistory:repopath", "vcshistory:filepath"]` | `createBlock` |
| `openDiffBlock` | `["vcsdiff:repopath", "vcsdiff:filepath","vcsdiff:revision"]` | `createBlock` |
| `openCommitsBlock` | `["vcscommits:repopath"]` | `createBlock` |

调用点都在 `makeDirectoryVcsMenuItems(model, ...)` 内部，`model` 本来就拿得到，仅需透传。

- `openBlockDefAsInlineTab` 需从 `private` 提升为包内可见（去掉 `private` 或标注 `/** internal */`），
  以便同目录 utils 调用；不使用 `public` 也行——TS 里省略修饰符即为 public，代码库既有风格可接受。

## 6. 为什么不去做"回到已经被关掉的组"

不做。`addBlockToInlineTab` 失败时的语义就是"宿主已不存在"，此时把块放回原组会让用户在别处也看不到它，
回退到独立的 `createBlock` 是唯一能保证用户看到结果的选择。

## 7. 取舍

| 备选 | 结论 | 原因 |
| --- | --- | --- |
| 用 `global.ts` 加一个通用 `createBlockInlineTab` 全局函数 | 不采用 | 影响面从 LOW 扩大到全局 `createBlock` 邻域，收益不足；本项目已多处在 view 内部做同样的事 |
| 只在图标做，菜单保持现状 | 不采用 | 用户同一个动作（点版本管理入口）在菜单和图标上表现不一致，比"全部单开"更困惑 |
| 修饰键语义设成反向（Ctrl = 入 tab） | 不采用 | 与全仓库 `Ctrl = forceNew` 约定冲突 |
| 菜单也支持 Ctrl 单开 | 不做 | 右键菜单的点击已脱离修饰键语境，加分支只会制造歧义 |

## 8. 兼容性与回滚

- 纯前端、单 Tab 内布局行为改动，不涉及持久化格式（inline tab group 本就是 layout 既有结构）。
- 回滚 = revert `preview-model.tsx` + `preview-directory-utils.tsx` 两处改动。
- 旧布局数据（单 Block 或已有 group）都能被 `addBlockToInlineTab` 正确处理，无需迁移。

## 9. 风险

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| Files Block 处于 group 且当前 active tab 不是 Files 时，新 tab 出现在用户看不到的组里 | 低 | 本来就是这个组在承载 Files，且 `focusBlockById` 会把焦点带过去 |
| 去重误判（不同 VCS 根但路径字符串相同） | 低 | 去重键包含 path 且要求 view 相同，connection 也参与比对 |
| 菜单 4 个函数签名变化引入编译错误 | 低 | 调用点都在同一文件，`tsc` 立刻暴露 |
