# Design — 弹窗单壳收敛 + AgentCardModal 重构

## 1. 唯一壳：`Modal`

不新建文件、不新建组件。`frontend/app/modals/modal.tsx` 里的 `Modal` 就是最终壳，
`FlexiModal` 合并后删除。

### 1.1 DOM 结构

```
div.modal-wrapper                     (position:fixed; inset:0; flex center; padding:16px)
├─ div.modal-backdrop                 (复用现有 class，不动)
└─ div.modal[role=dialog]             (flex column; max-height: min(80vh, calc(100vh - 40px)))
   ├─ div.modal-header                (仅当 title / subtitle / onClose 任一存在时渲染)
   │   ├─ div.modal-header__text      (min-w-0; title + subtitle)
   │   ├─ div.modal-header__extra     (shrink-0)
   │   └─ button.modal-close          (shrink-0; 在流内，不绝对定位)
   ├─ div.content-wrapper             (flex:1; min-height:0; overflow-y:auto; overscroll-contain)
   │   └─ div.modal-content           (padding:0; 保持空容器以兼容既有调用方)
   └─ footer.modal-footer             (仅当 onOk/onCancel/footer 存在时渲染; shrink-0)
```

**为什么保留 `.content-wrapper` + `.modal-content` 两层**：
`confirmmodal` / `restartconfirmmodal` 等调用方自己在 children 里写了
`<div className="modal-content">`。删掉这个类会静默改变它们的布局。
所以两层保留、把滚动和 padding 都放到外层，内层归零。

### 1.2 Props（全部向后兼容）

```ts
type ModalProps = {
    // —— 现有，语义不变 ——
    children?: React.ReactNode;
    className?: string;            // 注意：仍然作用于 .modal 根节点
    style?: React.CSSProperties;
    okLabel?: string;
    cancelLabel?: string;
    okDisabled?: boolean;
    cancelDisabled?: boolean;
    onOk?: () => void;
    onCancel?: () => void;
    onClickBackdrop?: () => void;

    // —— 新增 ——
    /** 关闭回调。有值 → 渲染 ✕；无值 → 不渲染 ✕。 */
    onClose?: () => void;
    /** 点 backdrop 关闭。仅在没传 onClickBackdrop 时生效，回落调 onClose。 */
    closeOnBackdrop?: boolean;
    /** header 标题（同时作为 aria-labelledby 目标）。 */
    title?: React.ReactNode;
    /** header 副标题。 */
    subtitle?: React.ReactNode;
    /** header 右侧、✕ 左侧的插槽（状态点 / 模型名 / 徽标）。 */
    headerExtra?: React.ReactNode;
    /** 自定义 footer 内容（替代 ok/cancel 按钮组）。 */
    footer?: React.ReactNode;
    /** 默认 true。false → .modal--flush，内容自己管内边距。 */
    padding?: boolean;
    /** 默认 true。false → 内容区不滚动（自带滚动容器的调用方用）。 */
    scrollBody?: boolean;
};
```

### 1.3 `.modal-close` 从绝对定位改为流内

现在：`.modal-close-btn { position:absolute; right:8px; top:8px }`，
导致 3 个调用方写 `pr-7` / `pr-8` 让位，`agentcardmodal` 干脆被压住。

改为 header 的 flex 子项后：

- 不需要任何让位代码 → 删掉 3 处 `pr-*`
- 不再和右上角内容重叠
- 无 `title` 但有 `onClose` 时，`.modal-header` 仍渲染，此时只有右侧的 ✕（
  `justify-content: flex-end`），高度 20px，不引入额外视觉噪声

尺寸遵循 `design-system.md` §6「compact icon controls: stable square 20px」：
`.modal-close { width:20px; height:20px; flex:0 0 20px }`。

### 1.4 滚动契约

- `overflow-y: auto` **只出现在 `.content-wrapper`**；
- 加 `overscroll-contain`，防止滚到底后外溢到背后的 block；
- `.modal` 的 `max-height: min(80vh, calc(100vh - 40px))`，配合 `flex:1; min-height:0`，
  长内容才会被吸收到这里而不是把弹窗撑出视口。

### 1.5 内边距

```scss
.modal { --modal-padding: 16px; }
.content-wrapper { padding: var(--modal-padding); }
.modal-header { padding: var(--modal-padding) var(--modal-padding) 0; }
.modal-footer { padding: 0 var(--modal-padding) var(--modal-padding); }
.modal.modal--flush .content-wrapper,
.modal.modal--flush .modal-header,
.modal.modal--flush .modal-footer { padding: 0; }
```

16px 落在 `design-system.md` §6 的 `4 / 8 / 12 / 16 / 24` 刻度上（早期草案里的 20px 不在刻度内，已纠正）。
默认值用 CSS 变量而不是 Tailwind 类，避免和调用方传入的 `p-*` 类打架。

### 1.6 主题与无障碍

- 只用既有语义 token：`--modal-bg-color` / `--modal-border-color` / `--main-text-color` /
  `--secondary-text-color` / `--hover-bg-color` / `--border-color`。
- `role="dialog"` `aria-modal="true"`；有 `title` 时 `aria-labelledby` 指向它。
  （现在 `.modal` 上完全没有 role，属于既有缺口，本次补上。）
- ✕ 需要 `aria-label="Close"`；`focus-visible` 用
  `focus-visible:ring-1 focus-visible:ring-accent`（§7.2）。
- `ESC` 不重复实现：继续由 `keymodel.ts` 的 `globalKeyMap["Escape"] → modalsModel.cancelTopModal()` 处理。

## 2. 迁移表（23 个调用点）

### 2.1 `Modal` 现有 12 文件

| 文件 | 现状 | 迁移动作 |
|---|---|---|
| `builder/builder-apppanel.tsx`（2 处） | `className="p-4"`，自带 h2 | `padding={false}`（保留自己的 `p-4`） |
| `builder/tabs/builder-secrettab.tsx`（2 处） | `p-4 min-w-[500px]` | `padding={false}` |
| `modals/about.tsx` | `pt-[34px] pb-[34px] overflow-hidden` | `padding={false}`（渐变背景需铺满） |
| `workspace/widget-quick-launch.tsx` | `widget-quick-launch`，scss 自有 padding | `padding={false}` |
| `tab/tab-target-modal.tsx` | `pt-8 pb-4` + `pr-8` 让位 | `padding={false}`，删 `pr-8` |
| `modals/messagemodal.tsx` | `message-modal`，scss 只有 min-width | 不传 → 用新默认 padding（修掉它同样贴边的问题） |
| `aipanel/restorebackupmodal.tsx`（2 处） | `pb-5 pr-5` | `padding={false}`，删 `pr-5` |
| `view/term/envmodal.tsx` | `env-modal-shell`，scss 自有 | `padding={false}` |
| `modals/agenthooksettingsmodal.tsx` | 无 padding + `pr-8` 让位 + 内部 `shrink-0` 标题 | 改用 `title`；删 `pr-8`；`scrollBody` 默认开 |
| `view/aisessions/annotation-editor.tsx` | `w-[...]` + `pr-7` 让位 | 改用 `title`；删 `pr-7` |
| `modals/aisessionnotemodal.tsx` | `w-[...]` + `pr-7` 让位 | 改用 `title`/`subtitle`；删 `pr-7` |
| `modals/agentcardmodal.tsx` | 只给宽度，无 `onClose` | **重点重构**，见 §3 |

### 2.2 `FlexiModal` 11 文件 → `Modal`

`FlexiModal` 与 `Modal` 的差异只有三点：默认 padding（`pt-6 px-4 pb-4`）、无 ✕、多一个 `ref` 透传。
`Modal` 本来也 forwardRef，所以迁移就是：

1. import 换成 `Modal`；
2. 依赖默认 padding 的 → 不传（新默认 16px 四边，比旧的 24/16/16 略紧凑，视觉可接受）；
3. 自己管 padding 的 → `padding={false}`。

| 文件 | 现有 className 里的 padding | 迁移动作 |
|---|---|---|
| `builder/app-selection-modal.tsx` | 无（靠默认） | 直接换 |
| `modals/closetabmodal.tsx` | 无 | 直接换 |
| `modals/confirmmodal.tsx` | 无（内部自己写 `.modal-content`） | 直接换 |
| `modals/unsavedfilemodal.tsx` | 无 | 直接换 |
| `modals/restartconfirmmodal.tsx` | 无 | 直接换 |
| `modals/file-conflict-modal.tsx` | 无 | 直接换 |
| `modals/scheduledtaskeditormodal.tsx` | 无 | 直接换 |
| `modals/aisessiondetailmodal.tsx` | `overflow-hidden p-0` | `padding={false}` + `scrollBody={false}`（自己管滚动） |
| `onboarding/onboarding.tsx` | `${paddingClass}` | `padding={false}` |
| `onboarding/onboarding-upgrade-minor.tsx` | `${paddingClass}` | `padding={false}` |
| `onboarding/onboarding-upgrade-patch.tsx` | `!p-[30px]` | `padding={false}` |

**关键约束**：迁移后必须逐个确认「默认 padding 作用在 `.content-wrapper` 上，
而调用方传的 `p-*` 作用在 `.modal` 根上」这件事已经不存在——
即凡是 className 里带 `p-` / `pt-` / `pb-` / `px-` / `py-` 的，一律 `padding={false}`。
可以在迁移后用一条 grep 自查：

```bash
rg -n 'className="[^"]*\bp[xy]?-(|\[)' frontend/app/modals frontend/app/onboarding
```

## 3. AgentCardModal 重构

```tsx
<Modal
    className="w-[min(680px,calc(100vw-32px))] agent-dialog"
    onClose={() => modalsModel.popModal()}
    closeOnBackdrop={false}
    title={title}
    subtitle={<AgentStatusLine … />}
    headerExtra={<AgentModelBadge … />}
    footer={<SessionIdBar sessionId={sessionId} />}
>
    <AgentHoverCard blockId={blockId} blockData={blockData} mode="gui" embedded frameless />
</Modal>
```

- `title` / `subtitle` / `headerExtra` 的数据现在都在 `AgentHoverCard` 内部计算
  （`provider` / `model` / `statusPres` / `agentIcon`）。**不把这套逻辑复制到 modal 里**，
  而是把 `AgentHoverCard` 里那段「身份 + 模型 + 状态」抽成一个可复用的
  `useAgentCardIdentity(blockId, blockData)` hook（`frontend/app/view/term/agent-card-identity.ts`），
  modal 与 hover 卡都从它取数。这是 `code-reuse-thinking-guide` 的硬要求：
  同一份「模型名 / 状态色 / provider 文案」不允许存在两份推导。
- `frameless` 时 `AgentHoverCard` 内部的 `InfoCard` 不再渲染外框：

```scss
.info-card.agent-card.agent-card--frameless {
    border: none;
    border-radius: 0;
    box-shadow: none;
    background: transparent;
    padding: 0;
    max-width: none;
    min-width: 0;
}
```

只新增选择器，不改既有 `.info-card` / `.agent-card` 规则。左侧状态色条
（`.info-card.agent-card::before`）保留，但 `frameless` 下 `left: -16px`（相对 `.content-wrapper`
的 padding 对齐）——或更简单：`frameless` 时不使用 `::before`，改由
`.agent-dialog` 在 `.dialog` 根上用同一条 `border-left` 语义画在弹窗左边。
**择优**：用后一种，色条只在一个层里存在，不会出现「弹窗一条 + 卡片一条」的重影。

`embedded` 语义保持：控制「是否渲染放大按钮」；`frameless` 只控制装饰。

## 4. 功能缺陷修法

### B2 checkbox 点击即切换

在 `startEdit` 里短路，不进入编辑态：

```tsx
const startEdit = (entry: PropertyEntry) => {
    if (!canEdit || entry.def.readOnly || onChange == null) return;
    if (entry.def.type === "checkbox") {
        onChange(entry.def.key, entry.def === undefined || entry.cell.value !== true, entry.def);
        return;
    }
    if (entry.def.key === "note" && onEditNote != null) { … }
    setEditingKey(entry.def.key);
};
```

配套：`ValueDisplay` 的 checkbox 分支外层按钮补 `role="switch"` + `aria-checked`，
让键盘与读屏语义正确（`design-system.md` §8 Toggle and Checkbox）。

### B3 note 空态

`ValueDisplay` 的 `default`（text）分支对内置 note 空值返回 `Empty`，
与 Tags 的空态一致。`Click to add a note...` 只保留在 card 模式的全空占位路径。

### B4 note 行点击

- `detail` 模式（弹窗 / 详情卡）：调 `onOpenNoteDialog()`，走既有 `AISessionNoteModal`。
- `card` 模式（悬浮卡）：保留现有 inline `textarea`。

理由：`AISessionNoteModal` 已有 AI 生成、保存状态、未保存提示、自动保存；
`isEditing` 的「整块替换」路径会毁掉列表上下文且无取消入口。

### B5 行数上限 + 空属性过滤

```tsx
const DetailPropertyLimit = 8;

const entries = React.useMemo(() => {
    const all = toPropertyDefs(summary, schema);
    if (mode !== "detail") return all;
    // 模板定义了但本会话无值的自定义属性，不直接铺（避免把 schema 全渲一遍）
    return all.filter(e => e.def.builtin || !isEmptyValue(e.def, e.cell.value));
}, [summary, schema, mode]);
```

再复用现有 `expanded` / `hiddenCount` 机制，detail 模式超出 `DetailPropertyLimit` 显示 `+N more`。

### B6 humanize

`ValueDisplay` 的 select/status 分支用 `humanizeKey(String(value))` 兜底；
`optionsFor` 里临时构造的 option 也把 `name` 改成 `humanizeKey(v)`
（`tagToOption` 的上色逻辑不动）。

## 5. 属性区信息架构

`PropertyList` 内部新增渲染分组（不新增数据字段）：

| 组 | 成员 | 默认 |
|---|---|---|
| `primary` | `tags`、`note`、有值的自定义属性 | 显示（受 `DetailPropertyLimit` 约束） |
| `secondary` | `title_source`、`starred`、`created_at`、`updated_at`、空自定义属性 | 折叠，按钮 `More properties (N)` |

`card` 模式维持现状（`CardPropertyLimit = 5` + `+N more`），不动悬浮卡。

底部入口合并为一行 `.property-actions`，`Add a property` 与 `AI auto-fill` 同为 ghost 按钮
（`padding: 2px 8px`、`font-size: 11px`、无边框、同 hover），去掉 `property-ai-trigger` 的虚框。

## 6. 兼容与回归面

| 面 | 影响 | 验证方式 |
|---|---|---|
| 23 个弹窗调用点 | 视觉可能变（padding 归一） | 逐个打开；CDP 三主题截图抽样 4 个 |
| `SessionDetailInfoCard` | 共用 `SessionNoteSection`，detail 分组会生效 | 打开会话详情确认 Open 操作未被折叠遮挡 |
| 悬浮卡（`BlockInfoCard` / `tab-more-agent-card`） | `frameless` 默认 false、card 模式逻辑不变 | 截图对比 |
| `modalsModel` / ESC | 零改动 | 每个弹窗按两次 ESC 看是否逐层退出 |
| `PropertyList` 既有单测 7 条 | 「shows Empty placeholders in detail mode」随 B3/B5 变化 | 同步更新 |

## 7. 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| `Modal` 被 12 个文件直接用，改渲染结构是全局视觉变更 | **高**（正是 `DS-008` 判 CRITICAL 的原因） | 新增 prop 全部可选；`padding={false}` 覆盖所有自带 padding 的调用方；逐个打开验证；按 Step 分 commit 便于单点 revert |
| 默认 padding 从 FlexiModal 的 `24/16/16` 变成统一 `16` | 低 | 只是 8px 收紧，符合 §6 刻度；三主题截图对比 |
| ✕ 从绝对定位改为流内，可能改变已有弹窗的标题位置 | 中 | 3 个 `pr-*` 让位点同步删除；`tab-target-modal` / `annotation-editor` / `aisessionnotemodal` / `agenthooksettingsmodal` 四个重点看 |
| `agent-card-identity` 抽取改变 `AgentHoverCard` 内部结构 | 中 | 纯提取、不改语义；抽完 hover 卡截图与抽取前逐像素比对 |
| 删 `element/modal.tsx` 后若有漏网 import | 低 | 删除前 `rg "element/modal"` 确认为 0（已确认） |

## 8. 回滚

按 Step 分 commit，逐层可 revert：

1. `Modal` 扩展（新 prop 全可选）→ revert 无副作用
2. FlexiModal 11 点迁移 → revert 回到双壳
3. Modal 12 点迁移 → revert 回到旧布局
4. AgentCardModal 重构 → revert 回到旧弹窗
5. PropertyList 缺陷 → revert 回到旧 bug
6. 属性区 IA → revert 回到 6 行常驻

不涉及数据迁移、不涉及后端，回滚无脏数据风险。
