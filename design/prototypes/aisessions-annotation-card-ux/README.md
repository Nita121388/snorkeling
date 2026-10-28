# Session Detail · 批注节点悬浮卡重设计 — 原型

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：`frontend/app/view/aisessions/annotation-card.tsx`, `frontend/app/view/aisessions/annotation-rail.tsx`, `frontend/app/view/aisessions/annotation-model.ts`, `frontend/app/view/aisessions/session-detail.tsx`, `frontend/app/view/aisessions/tool-group.tsx`
> 最后同步：2026-10-28

## 目的

当前批注时间线（左侧圆点 rail + 悬浮卡）有几个别扭点，本原型给出**交互 + 节点渲染**的修改方案，直接照着改几个文件就能落地：

1. **卡片左上角「Node」字样无意义** → 换成节点身份：`类型图标 + #seq + 时间`。
2. **圆点交互冲突**：现在点一下既「跳走」又「钉住」，两个动作搅一起。改为 **单击选中留卡 / 双击跳转**（双击在 hover 卡已出时也能定位）。
3. **「节点在哪」不清楚**：圆点加 `#seq · HH:MM` tooltip；卡片头始终显示节点身份与时间。
4. **工具节点渲染错**：工具锚点的 node 文本现在显示的是挂在它上的消息文字，不是工具本身。改为工具行（wrench + 名称 + summary + 状态点），对齐 `tool-group.tsx` 的折叠组视觉。
5. **节点内容没体现批注**：卡片里把节点的「原文 / 工具 / 总结」块 + 该节点全部批注（类型 chip + 标题 + 正文 + 标签 + 来源）分层展示，不再把批注埋在空 node 块下面。
6. **去掉跳转按钮与图钉**：卡片头部改为「打开编辑」图标（external-link）直接弹 `AnnotationEditor`；选中态用轮廓高亮，不再用 thumbtack 徽标。

## 打开方式

```bash
open design/prototypes/aisessions-annotation-card-ux/index.html
```

纯静态，无依赖、无构建。顶部 `Light/Dark` 切换对照明暗（配色 token 取自 `frontend/app/theme.scss` 暗色默认值）。

## 原型覆盖的 4 种节点（示例数据）

| seq | type | 说明 | 批注 |
|---|---|---|---|
| 12 | message | 用户需求起点 | Note · 标题/正文/标签 |
| 28 | tool | bash ×3 · 测试全绿 | Milestone |
| 41 | summary | 章节总结 · 认证链路重构 | Decision |
| 57 | message | assistant 轮换逻辑说明 | Question(draft) + Note |

四种类型把「工具调用 / 章节总结截取 / 标题内容标签」三类需求一次性覆盖。

## 交互对照

| 操作 | 行为 |
|---|---|
| hover 圆点 | **延迟 70ms** 才出悬浮卡（快速掠过一排圆点不会连闪），不固定 |
| 单击圆点 | 立即出卡，210ms 后转「选中 + 固定」（轮廓高亮，原 Jump 按钮移除） |
| 双击圆点 | 收起卡片，滚到对应消息流节点并打一次 1.2s 脉冲高亮（复用 `jumpToAnnotationSeq` 的高亮逻辑） |
| 卡片内 external-link | 打开 `AnnotationEditor`（节点 seq/anchorKey 传入） |
| 选中态点 ✕ | 收起卡片 |
| 点卡片/圆点/编辑器以外 | 收起选中与悬停（`mousedown` 即响应，不等 click） |
| `Esc` | 先关编辑器，再清卡片与选中 |
| 滚动 flow | playhead（轴右侧伸出的短横线 + 右缘竖标）跟到视口中线那一段 |

## 交互打磨（第 8 轮）

目标：让「hover → 单击 → 双击 → 点外部」这条链路没有闪动感、没有状态残留。

- **悬停延迟 70ms**：`previewNode()` 起一个 show timer，期间离开就作废；收起延迟 240ms 仍保留，覆盖「圆点 → 卡片」之间 14px 的空隙。
- **卡片 DOM 复用**：卡片只在「目标节点变了」时重建（`refreshCard` 里比对 `data-seq`），同一节点 hover→选中不再重建 DOM、不重放入场动画。旧实现每次 refresh 都清空 `card-layer` 再插入，正是「点一下闪一下」的根因。
- **选中不跳位**：✕ 按钮改为常驻 DOM、未 pinned 时 `visibility: hidden`，pinned 切换不引起页脚重排；`pinned` 只切类名。
- **跳转反馈独立生命周期**：高亮拆成 `is-target`（悬停/选中，随卡片）与 `is-jump`（双击，自播 1.2s 脉冲）。原来两者共用一个 `flash-off` 定时器，鼠标一离开圆点触发收起就把 1.2s 高亮提前抹掉了。
- **点外部关闭**：`mousedown`（比 click 更跟手），豁免 `.acard` / `.rail-dot` / `.editor-layer`；`resetInteraction()` 统一清 show/hide/click 三个挂起计时器，避免 70ms/210ms 后卡片又冒出来。
- **Esc 分层**：先关编辑器，再清卡片；不再一次全掀。
- **定位修正**：卡片宽度改为读 `offsetWidth`（CSS 是 328px，旧代码写死 320 让右侧翻转阈值偏 8px）。
- **`prefers-reduced-motion`**：关闭入场动画、跳转脉冲与 transition，`scrollIntoView` 改用 `auto`。
- **顺带修复**：`refreshCard()` 里 `card.dataset.type = n.type` 引用了不存在的 `n`（应为 `node`），会抛 ReferenceError、导致 `data-type` 类型色与定位/highlight 全部失效。

## 动效打磨（第 9 轮）

目标：卡片进场/退场、圆点缩放、跳转脉冲三条动效的时长与曲线彼此协调，并且 `prefers-reduced-motion` 下「关动画但不关反馈」。

- **卡片入场**：`0.12s ease` → `0.16s cubic-bezier(0.16, 1, 0.3, 1)`（decelerate），位移从 `-4px/0.98` 提到 `-6px/0.97`。`transform-origin` 由 `positionCard()` 按实际展开方向设为 `left center` / `right center`，所以卡片是从靠近圆点的那条边张开，翻到左侧时不会还从左上角放大。
- **卡片退场（新增）**：`hideCard()` 不再直接 `remove()`，先挂 `.is-leaving` 播 `0.1s cardOut`（淡出 + `scale 0.985` 回缩）再摘 DOM，期间 `pointer-events: none`。时长与 `script.js` 的 `CARD_OUT_MS = 100` 对齐；`card-layer.innerHTML = ""` 一并去掉，否则会把正在播退场的卡一起清掉。
- **换卡不播退场**：`refreshCard()` 里旧卡仍直接 `remove()`——相邻节点之间是接力而不是收起，两张卡同时半透明会叠出重影。
- **圆点缩放**：收缩 `0.12s cubic-bezier(0.4, 0, 0.7, 1)`，放大 `0.17s cubic-bezier(0.34, 1.4, 0.64, 1)`（约 4% 过冲，16px → 16.6px 再落回）。基准规则给收缩、命中/选中合并规则给放大，来回扫一排圆点时不拖残影。
- **跳转脉冲**：`rowJump` 曲线从 `ease-out` 换成 `cubic-bezier(0.16, 1, 0.3, 1)`，关键帧改为 `0% → 18% → 100%`，光环约 150ms 冲到最亮、剩下 1s 褪成 0，最后扩散到 12px 完全透明；`FLASH_MS` 仍为 1200 与 CSS 时长一致。
- **playhead**：`top` 过渡改 `0.2s cubic-bezier(0.22, 1, 0.36, 1)`，滚动停下时不再留一小段匀速位移。
- **`prefers-reduced-motion` 补全**：
  - `.acard.is-leaving` 单独列出（它的权重压过 `.acard`，否则 reduce 下退场照播）；
  - 圆点三条 transition 全部覆盖（只写 `.dot` 会留下放大过渡）；
  - 圆点放大过渡之外的 `seq-tip` / `flow-row` / `playhead` 状态切换保留；
  - 跳转高亮改为**静态点亮**（`is-jump` 期间直接给 `border-color` + 2px ring，无脉冲），关动画不等于关反馈，否则 reduce 用户双击后看不到「跳到了哪一行」。

## rail 视觉语言（第 7 轮）

- **dot 尺寸**：基准 10px；hover / 键盘聚焦 / 选中统一放大到 16px 并叠 ring，尺寸差 6px 保证「可点」可辨识。
- **三态**：accepted = 实心；draft = 2px 空心 ring（**只要含任意 draft 就画 ring**，混合 draft+accepted 也算 draft，否则待确认批注在 rail 上看不见）；orphan = warning 实心 + warning 外环。命中/选中时各自叠对应颜色 ring，状态不丢。
- **轴线**：2px，悬于 rail 中线，圆点水平居中于轴上。
- **playhead**：2px 横线从轴线向右伸到 rail 右缘，右端 2px 短竖标；随 `flow` 滚动选取视口中线最近的 `flow-row` 并同步到其 dot 的 `top`。先插 DOM、圆点后插，确保重合时 dot 不被那条线切断。
- **tooltip**：`#seq`（accent，等宽加粗）+ `HH:MM`（次级，tabular-nums）分段；11px 加实色底、1px 边框、投影与 6px 圆角，hover / `:focus-within` 均显示。

## 视觉参考（成熟组件库）

- 卡片：12px 圆角、1px `border-color`、`shadow-2xl` 级投影、实色 `modal-bg`（沿用既有「弹窗不透明」规则）。
- 图标按钮：26px 方形、`hover:bg-hover`；图标用 lucide 16px 网格（原型用内联 SVG 等价描边）。
- chip 统一：类型/标签共用一个 `.chip` 组件（1px 边框 + 9px 大写标签），干掉 `text-[9px]` 散装样式。
- 类型/尺寸 token：caption 11px、label 10px uppercase tracking；统一成 CSS 变量避免各文件各写一套。
- 工具节点行：复用 `tool-group.tsx` 的 wrench + 计数徽标 + summary 截断 + 状态点语言。
- 节点类型色编码（第 5 轮）：message = 中性次级色、tool = accent、summary = warning；卡片头底色、类型徽标、原文块左侧色条、流程行左边框都从同一组 `--node-type-*` token 派生，明暗主题自动跟随。

## 落地范围（建议新建任务 `10-28-aisessions-annotation-card-ux`）

- `annotation-model.ts`：新增 `AnnotationNodeInfo`（type/message/tool/summary/status/ts），供 rail→card。
- `annotation-card.tsx`：删「Node」标签、Jump 按钮、`onMouseDown` 钉住逻辑、pinned 徽标；新增 `nodeInfo`、`onOpenEditor`、节点身份头、类型化节点渲染。
- `annotation-rail.tsx`：圆点 `onClick`→选中、`onDoubleClick`→跳转；加 `#seq·time` tooltip；移除 thumbtack 路径。
- `session-detail.tsx`：build `nodeInfoByAnchorKey`（从 `toolCalls` + `detailMessages`）；把 `onOpenEditor` 接到现有 `setAnnotationEditor`；透传新 prop。

## 验收（对照真实组件）

- [ ] 卡片头显示类型图标 + #seq + 时间，无「Node」字样
- [ ] 单击选中留卡、双击跳转高亮，无「既跳又钉」
- [ ] 工具节点显示工具名/summary/状态，非挂着的消息文本
- [ ] summary 节点显示截断总结（带渐隐）
- [ ] 批注的标题/正文/标签/类型在节点上清晰分层
- [ ] 卡片内用 external-link 打开编辑器，无 Jump 按钮、无 thumbtack 徽标
- [ ] 明暗主题下配色与现有 app 一致

## Changelog（第 1–20 轮）

> 纯静态原型，每轮只动 `index.html` / `style.css` / `script.js` 三者，配套 `smoke.test.cjs` 随轮次补断言。`node --check` 与 `smoke.test.cjs` 在第 20 轮最终 QA 时全绿。

| 轮次 | 主题 | 关键改动（实际产出，按子代理回执核对） |
|---|---|---|
| 1 | 间距节奏 | 用 `--space-1/2/3` 三档 4/8px 变量统一卡片内间距；把「节点原文块」与「批注条目」分层，原文在上淡化、批注在下带分隔 |
| 2 | 字号阶梯 | 散装 9–15px 与 `font-weight:600` 收敛成 `--fs-*` / `--fw-*` / `--lh-*` token，行高 1.3/1.5 两档 |
| 3 | 明暗对比 | 审计每对文本/背景色对 WCAG AA，修主按钮白字 2.3:1、语义色拆 `*-text-color` token、选中轮廓专用色、补 `.tg-status.done` |
| 4 | 卡片信息架构 | 头承载类型名+图标+#seq+时间；节点块加 lead line（role chip / tool 状态 / summary 标题）在截断正文之上；footer 钉「Open editor」 |
| 5 | 节点类型色编码 | message/tool/summary 中性/accent/warning 三色贯穿卡片头、节点块、flow-row 左边框；卡片头类型名用大写类名而非通用 tag |
| 6 | 批注层级 | 元行（kind chip → draft chip → source）→ 标题 → 正文 → 标签；draft 用虚线 chip + 浅底 + 虚线左边框，accepted 干净无边框 |
| 7 | rail 视觉语言 | dot 10→16px 阶梯 + 命中/聚焦/选中 ring；accepted 实心 / draft 环 / orphan 警告三态；2px 轴线 + 跟随播放头；`#seq·HH:MM` 分段 tooltip |
| 8 | 交互打磨 | hover 70ms 展示 / 240ms 收起；卡片 DOM 复用（仅目标变化才重建）；跳转独立 1.2s 脉冲；`mousedown` 点外关闭；Esc 分层；修 `n.type` ReferenceError 与残留选中 ring |
| 9 | 动效 | 卡片入场缓动 + `transform-origin` 修正；新增退场态；换卡不播退场；圆点/跳转/playhead 曲线协调；`prefers-reduced-motion` 关位移保留反馈 |
| 10 | 边界态 | 顶部 Data 按钮切 Default / Edge / No-notes；dense 卡（≥6 批注）、orphan 态、空 rail 提示、窄屏；并写 `smoke.test.cjs` 与无头 29 项断言 |
| 11 | 可达性 | rail dot `aria-expanded/haspopup/controls`；卡片 `role=dialog`+`id=acard-<seq>`；flow-row `role=group`；编辑器 `aria-labelledby` + 首焦 + Tab 陷阱 + 关闭归还焦点；Esc 先关编辑器再关卡片 |
| 12 | 响应式 | `@media (max-width:520px)`：卡片 `min(320px,100vw-20px)` + `max-height:70vh` 内滚；rail 40px；flow 内边距收紧；隐藏顶部 hint |
| 13 | 编辑器布局 | 字段分 Kind / Node / Annotation 三段；标题作页面标题；Save 主按钮、Cancel 降级 ghost；首焦 Title；保留 Tab 陷阱 |
| 14 | 文案统一 | rail 头「Annotations」、空态「No notes yet」、orphan 大写、计数「N · M Accepted」、标签占位大写；`#seq·HH:MM` 全局一致 |
| 15 | 主题 token | 所有阴影/遮罩/渐隐遮罩改走 `:root` token，亮色给更柔的值；删除两处冗余 light override；暗色默认不动 |
| 16 | JS 重构 | 拆成 DATA/ICONS/HELPERS/STATE/RAIL/FLOW/CARD/INTERACTIONS/EDITOR/INIT 十段，`init()` 置底；行为不变 |
| 17 | CSS 重构 | 12 段注释分区（tokens→base→bar→stage→rail→flow→card→annotations→editor→controls→a11y→responsive）；合并重复 `.tg-status`/`.tool-row .tstatus` 与 720px 媒体查询 |
| 18 | 自审修 bug | 修 flow 用 `min-height` 不滚动导致 playhead 漂移；编辑器遮罩点击目标缺失；单击在鼠标已移到别的点时仍触发 pin；`jumpTo` 缺 `scrollIntoView` 空值保护；补交互断言 |
| 19 | 视觉打磨 | 圆角统一 6/8/12 档 token；阴影三层合成；按钮共用命中过渡 + `:active` 下沉 0.5px（reduce-motion 关位移）；图标 `display:block` 修正基线；tool-row 图标 16px |
| 20 | 终检 | `node --check` + `smoke.test.cjs`（全绿）；本轮 Changelog；确认仅原型目录变更 |

**终态验证（第 20 轮）**
```
$ node --check design/prototypes/aisessions-annotation-card-ux/script.js   # CHECK_OK
$ NODE_PATH=./node_modules node design/prototypes/aisessions-annotation-card-ux/smoke.test.cjs
  all checks passed   # 28 断言，3 数据集
```
