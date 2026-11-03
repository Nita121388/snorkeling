# 设计：Agent Card 合体版

## 1. 目标结构（hover 卡，340px）

```
┌───────────────────────────────────────────────────────┐
│ ┌────┐  Pi                              ● Working  ★  ⤢ │
│ │ π  │  未指定 · First User Message                     │  avatar 30 / name 13-600 / sub 10.5 mono
│ └────┘                                                 │
│ ┃ 功能问题：列表编辑时文本位置抖动、样式变化…             │  border-left 2px status, clamp 2
│ ◷ Updated                                      2m ago  │
│ ▤ Created                                       3d ago │  26px rows
│ ◇ Tags                                              —  │  icon 12 + label 68 + value right
│ ≡ Note                                              —  │
│ + Add property              ✨  3ce67d75…7ca2      ⧉   │  单行 footer（border-top）
└───────────────────────────────────────────────────────┘
```

- 头部、标题、属性区、footer 四段，无独立状态行、无独立 session id 行。
- 状态色只出现在：状态 chip、状态圆点、标题引用线。整卡不再有左侧 3px 色条。

## 2. 组件 API 变更

### 2.1 `useSessionNoteState`（`frontend/app/store/session-note-hook.ts`）

```ts
export type SessionNoteState = {
    // …既有字段
    /** 星标（summary.marked）。写库期间为 true，按钮应 disabled。 */
    starPending: boolean;
    /** 切换星标：Mark(key, !marked) → dispatchAISessionNoteUpdated。失败写 error。 */
    toggleStarred: () => Promise<void>;
};
```

实现要点：

- `starPending` 用 `useRef` 防重入 + `useState` 供渲染。
- 调 `AISessionsServiceType.Mark(summary.key, next, "")`；成功 `dispatchAISessionNoteUpdated(updated)`（`session-note-cache` 的 `handleNoteUpdatedEvent` 会 merge `marked`，hook 的 `summary` 随之更新，无需本地 copy）。
- 失败：`setError(message)`、`setSaveStatus("error")`（沿用既有错误条），不修改 `summary`。
- 不引入全局 atom：星标是单个 summary 的字段，随 cache 走。

### 2.2 `PropertyList`（`property-list.tsx`）

```ts
type PropertyListProps = {
    // …既有
    /** 行骨架。notion = 现状（Notion 属性面板）；agent = hover 卡紧凑行。默认 notion。 */
    layout?: "notion" | "agent";
};
```

`layout === "agent"` 时的行为：

| 项 | 行为 |
| --- | --- |
| 隐藏内置行 | 过滤 `starred`、`title_source`（已由头部/副标题承载） |
| 排序 | `updated_at → created_at → tags → note → 自定义（按 order）` |
| 行数 | 内置 4 行恒定显示；自定义属性最多 `CardPropertyLimit`(5)，多余进 `+N more` |
| 空值 | 渲染 `—`（`.property-empty--dash`，非斜体） |
| 行结构 | `icon + name + value`，value 右对齐；`className` 追加 `property-row--agent` |
| 只读行 | `created_at / updated_at` 仍只读（无编辑 affordance） |
| 折叠组 | 不使用 `SecondaryBuiltinKeys`（该逻辑只属于 detail 模式） |
| footer | 渲染 `.property-footer`：左 `+ Add property`（inline 变体），右 `footer` 插槽；`AddPropertyForm` 展开表单仍在 footer 下方 |

行内 icon 映射（`layout === "agent"` 才渲染 `.property-row__icon`）：

```
created_at → fa-calendar          updated_at → fa-clock
tags       → fa-tags              note       → fa-note-sticky
自定义     → fa-hashtag（按类型可后续细化）
```

时间渲染：`created_time / updated_time` 在 agent 布局下用
`formatSessionRelativeTime(ms)`（复用 `frontend/app/view/aisessions/utils.ts:437`），
`title={formatDateTimeValue(value)}`。notion 布局保持原样。

### 2.3 `SessionNoteSection`（`session-note-section.tsx`）

```ts
type Props = {
    // …既有
    /** 展示形态。detail = 现状（详情卡 / 弹窗默认）；hover = agent hover 卡。 */
    variant?: "detail" | "hover";
    /** hover 卡底部右组的额外内容（session id + 复制），与 AI 按钮同一行右对齐。 */
    footerExtra?: React.ReactNode;
};
```

`variant === "hover"` 时的差异：

1. 标题：`InfoCardHead`（tag 图标 + 11px 灰 marquee）→ `.agent-card-title-block`
   （12.5px 正文色、2 行 clamp、左 2px `--info-card-accent` 线、`title` 全文）。
   `TitleSourceBadge` 保留在标题块内（只对 `ai` 生效）。
2. 工具：放大按钮不再渲染（头部已有）；AI 标题 / AI metadata 两个 `GenActionButton`
   收进 `.agent-card-title-tools`（绝对定位右上，卡片 hover/focus-within 才可见）。
3. 属性区：`<PropertyList layout="agent" mode="detail" canEdit … footer=… />`。
4. footer：`footer={<><AIPropertiesButton compact />{footerExtra}</>}`。
5. `isEditing` 的 textarea 分支不变（note 内联编辑仍在 hover 卡可用）。

`variant` 缺省 `"detail"`，`SessionDetailInfoCard` 不改调用即保持现状。

### 2.4 `AgentHoverCard`（`agent-hover-card.tsx`）

新结构（替换 `showMetaRow` 段 + 删除 `.agent-card-status-row` + 删除 `.agent-card-session-id`）：

```tsx
<InfoCard className="agent-card …" style={{ "--info-card-accent": statusAccent }}>
    {showMetaRow && (
        <InfoCardSection className="agent-card-head-section">
            <div className="agent-card-head">
                <span className="agent-card-avatar" …>{logo | emoji}</span>
                <div className="agent-card-id">
                    <span className="agent-card-name">{provider}</span>
                    <span className="agent-card-sub">{model · titleSource}</span>
                </div>
                <div className="agent-card-actions">
                    <span className="agent-card-status-chip">{dot}{label}</span>
                    <button className="agent-card-icon-btn is-star" aria-pressed={starred} …/>
                    {!embedded && <button className="agent-card-icon-btn agent-card-expand-btn" …/>}
                </div>
            </div>
        </InfoCardSection>
    )}
    <SessionNoteSection
        state={noteState}
        canEditProperties
        variant="hover"
        footerExtra={<SessionIdActions />}
    />
</InfoCard>
```

- 头像：`getAgentIcon` 结果三态
  - `kind === "logo"`：18px SVG 放大到 16px 字面尺寸，**保留厂商自带色**；
  - `kind === "emoji"`：`<span className="agent-emoji-icon">` + `.is-emoji`；
  - 未来 badge（`10-29-agent-avatar-text-badge`）：字形仍落在同一 30px 盒里，`is-badge` 时用徽标自带的 bg/fg。
- 头像盒：30×30、圆角 9、`--form-element-bg-color` 底 + `inset 0 0 0 1px var(--border-color)`。
  **不**采用原型里的紫色渐变：真实卡片的 logo 自带厂牌色（Claude/Codex/Pi 各不相同），重涂会串味。
- 副标题：`${model || "未指定"} ${titleSource ? "· " + humanizeKey(titleSource) : ""}`；
  `humanizeKey` 来自 `property-model.ts`。`title` 挂原文 `first_user_message`。
- 状态 chip：`statusPres.label` + `title={statusPres.description ?? label}`；
  working/blocked/error 用既有 `statusAccent` 派生（`color-mix` 底 11% + inset 26%）。
- 星标：`marked = noteState.summary?.marked === true`；点击 `void noteState.toggleStarred()`；
  pending 时 `disabled` + `aria-busy`。
- 放大：保留 `openCardDialog`；`embedded` 不渲染。
- session id：`<span className="agent-card-sid">`（8+4 截断，`title` 全量）+ `CopyButton`；
  复制失败态沿用现有 `copyFailed`（2.5s 自清）。

## 3. SCSS 规划（`info-card.scss`）

### 3.1 移除

```scss
/* 删除整块：左侧通长圆头色条（agent-card-accent 方案 E） */
.info-card.agent-card { border-radius: 0 6px 6px 0; padding-left: 15px; }
.info-card.agent-card::before { … }
.info-card.agent-card.agent-card--frameless::before { … }
.agent-card-status-row { … }      /* 状态移进 chip */
.agent-card-status-dot { … }      /* 改为 chip 内 .agent-card-status-dot 复用 */
.agent-card-session-id { … }      /* 并入 footer */
.agent-card-logo { … }            /* 由 .agent-card-avatar 取代 */
```

`agent-card-accent` 原型 README 状态改 `▼ 被 11-03-agent-card-hybrid 取代`（保留文件做历史）。

### 3.2 新增 / 改写

```scss
.info-card.agent-card {
    width: 340px;                                  /* 固定宽度，稳定行对齐 */
    max-width: min(400px, calc(100vw - 24px));
    padding: 11px 12px 0;                          /* 底部 padding 交给 footer */
    border-radius: 9px;
    transition: border-color 120ms ease, box-shadow 120ms ease;
    &:hover { border-color: var(--border-color); box-shadow: 0 10px 26px -22px rgba(0,0,0,.55); }
}

/* 头部 */
.agent-card-head { display: flex; align-items: flex-start; gap: 9px; }
.agent-card-avatar { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center;
    background: var(--form-element-bg-color); box-shadow: inset 0 0 0 1px var(--border-color); flex: none; }
.agent-card-avatar svg { width: 16px; height: 16px; }
.agent-card-avatar.is-emoji { font-size: 16px; }
.agent-card-id { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.agent-card-name { font-size: 13px; font-weight: 600; color: var(--main-text-color); …ellipsis }
.agent-card-sub  { font: 10.5px/1.4 var(--mono-font); color: var(--secondary-text-color); …ellipsis }
.agent-card-actions { margin-left: auto; display: flex; align-items: center; gap: 1px; flex: none; }
.agent-card-status-chip { height: 20px; padding: 0 7px; border-radius: 999px; font-size: 10.5px; gap: 5px;
    color: var(--info-card-accent); background: color-mix(in srgb, var(--info-card-accent) 11%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--info-card-accent) 26%, transparent); }
.agent-card-icon-btn { width: 20px; height: 20px; display: inline-grid; place-items: center; border: 0;
    border-radius: 5px; background: transparent; color: var(--secondary-text-color); opacity: .8; cursor: pointer; }
.agent-card-icon-btn:hover { color: var(--main-text-color); background: var(--hover-bg-color); opacity: 1; }
.agent-card-icon-btn.is-star[aria-pressed="true"] { color: var(--warning-color, #f59e0b); opacity: 1; }

/* 标题引用块 */
.agent-card-title-block { margin: 10px 0 8px; padding-left: 9px;
    border-left: 2px solid color-mix(in srgb, var(--info-card-accent) 55%, transparent);
    font-size: 12.5px; line-height: 1.5; color: var(--main-text-color);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.agent-card-title-block .info-card-marquee { … }   /* 保留 marquee 能力，但字号/颜色改由父级控制 */
.agent-card-title-tools { position: absolute; top: 0; right: 0; display: flex; gap: 1px; opacity: 0;
    transition: opacity 120ms ease; }
.info-card.agent-card:hover .agent-card-title-tools,
.info-card.agent-card:focus-within .agent-card-title-tools { opacity: 1; }

/* footer */
.agent-card-footer, .property-footer { display: flex; align-items: center; gap: 6px;
    margin-top: 8px; padding: 8px 0 9px; border-top: 1px solid var(--border-color); }
.property-footer__right { margin-left: auto; display: flex; align-items: center; gap: 2px; }
.agent-card-sid { font: 10px var(--mono-font); color: var(--secondary-text-color); max-width: 96px; …ellipsis }
```

`agent-card--embedded` 保持 `min-width: 520px; max-width: 640px; width: auto`；
`agent-card--frameless` 保持 `border: none; border-radius: 0; box-shadow: none; padding: 0;`
（新增：不渲染 `::before` 后这两条已无需覆盖色条）。

### 3.3 属性行（`property-list.scss`）

```scss
.property-list--agent { --property-name-width: 68px; font-size: 11.5px; line-height: 1.45; gap: 0; }
.property-list--agent .property-row { align-items: center; min-height: 26px; padding: 0 4px; margin: 0 -4px; gap: 7px; }
.property-list--agent .property-row__icon { width: 12px; flex: none; color: var(--secondary-text-color); font-size: 10px; }
.property-list--agent .property-row__name { line-height: 26px; color: var(--secondary-text-color); }
.property-list--agent .property-row__value { justify-content: flex-end; text-align: right; }
.property-list--agent .property-row__button { justify-content: flex-end; }
.property-list--agent .property-empty--dash { color: var(--secondary-text-color); font-style: normal; }
.property-add--inline { display: inline-flex; align-items: center; gap: 4px; font-size: 11px;
    color: var(--secondary-text-color); background: transparent; border: 0; padding: 0; }
```

## 4. 交互与状态

| 交互 | 行为 |
| --- | --- |
| 星标点击 | `toggleStarred()` → Mark → 事件 → cache merge → 按钮态刷新；pending 期间 disabled |
| 放大 | `modalsModel.pushModal("AgentCardModal", …)`（不变）；`embedded` 隐藏 |
| 标题 hover | 卡片 hover/focus-within 才显示 AI 标题 / AI metadata 两个小按钮 |
| 属性行点击 | 沿用 `PropertyList` 编辑路径（tags 内联编辑、note 打开弹窗、自定义属性编辑） |
| 复制 id | `CopyButton` → `copyText`；失败 id 转红 2.5s（沿用） |
| AI auto-fill | `AIPropertiesButton compact` → 提案面板仍在 footer 下展开 |

## 5. 边界条件

1. `summary == null`：只渲染头部（provider/model/status），不渲染 Note 段（沿用现有 `showMetaRow` 判定），footer 不渲染。
2. `sessionId === ""`：不渲染 footer 右侧 id（但 `+ Add property` / AI 仍可用）。
3. `titleSource` 为空：副标题只显示 model。
4. `marked` 缺失（旧 summary）：按 `false` 处理。
5. 长 tags（>3）/ 长 note：tags `flex-wrap` 右对齐；note 2 行 clamp + `title` 全文。
6. 自定义属性很多：`+N more`（`property-more`）沿用现有展开按钮。
7. `blocked / rate-limited`：chip 用 `--warning-color`，文案取 `statusPres.label`。
8. 280–300px 视口：`max-width: calc(100vw - 24px)` 兜底；头部 `min-width: 0` 保证副标题先省略。
9. `embedded`（520–640）：布局不变，宽度放开；`agent-card-title-tools` 同样 hover 才出。
10. 浅色主题：所有颜色走 token，`color-mix` 计算基于 token，无需主题分支。

## 6. 兼容性 / 回滚

- **不动**：`InfoCard` 原语、`InfoCardHover` 关闭逻辑、`PropertyList` 默认（notion）布局、
  `SessionDetailInfoCard` 调用、`AIPropertiesButton` 默认渲染、note 自动保存。
- 新参数全部有默认值（`layout="notion"`、`variant="detail"`、`compact=false`），
  未升级的调用点行为不变 → 单文件回滚即可：`git checkout -- frontend/app/view/term/agent-hover-card.tsx
  frontend/app/element/info-card/info-card.scss frontend/app/element/info-card/session-note-section.tsx
  frontend/app/view/aisessions/property/property-list.{tsx,scss} frontend/app/store/session-note-hook.ts`。
- 与 `10-29-agent-avatar-text-badge` 的接口：徽标形态只需在 `.agent-card-avatar` 内渲染字形，
  容器尺寸已定 30px，无需再改卡片布局。

## 7. 测试计划

| 文件 | 新增用例 |
| --- | --- |
| `property/property-list.dom.test.tsx` | agent 布局：不渲染 `starred` / `title_source`；顺序 updated→created→tags→note；空值 `—`；value 右对齐 class；行点击仍能编辑 tags |
| `property/property-list.test.tsx` | `layout="agent"` 的 markup 快照要点（4 行、无 `Empty` 字样） |
| `store/session-note-hook.test.tsx` | `toggleStarred`：调用 `Mark(key, true)`、成功 dispatch 事件、失败置 error 且不翻态、pending 期间禁用 |
| `element/info-card/*`（若加） | 不做整卡快照（依赖大量 store），改为在 `agent-hover-card` 无独立测试的前提下用上面三处覆盖 |

视觉校验（人工）：

```bash
node scripts/inspect-electron-ui.mjs state
node scripts/inspect-electron-ui.mjs style ".info-card.agent-card"
node scripts/inspect-electron-ui.mjs screenshot
```
