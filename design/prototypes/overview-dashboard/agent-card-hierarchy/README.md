> 同步状态：▲ 设计活跃（2026-11-22：原型成稿；emoji 整条不渲染已拍板；间距刻度与实测卡高已入表）
> 镜像源：`frontend/app/session-overview/overview-board.tsx`（BoardCard）、`frontend/app/session-overview/overview-board-model.ts`（`resolveBoardPropRows` / `BoardBuiltinPropKeys`）、`frontend/app/session-overview/session-overview.scss`（1591 起 `.session-overview-board-card`）、`frontend/app/theme.scss`（暗/亮 token）、`frontend/app/view/aisessions/property/property-list.scss`（`.property-chip` 色板）、`frontend/app/agent-status/agent-status-chip.scss`（chip 几何）
> 最后同步：2026-11-22

# Overview Agent Card · 属性紧凑化 + 卡面层次

四个议题，一个文件（`index.html`，零依赖，直接浏览器打开）：

1. **`emoji` 属性整条不渲染**（已拍板）：卡片左上头像与属性行 `emoji 🐚` 重复展示同一信息（用户 2026-11-22 真机截图确认）。
2. **属性行其余类型去名字前缀**：`Status In Progress` → `In Progress`（色胶囊自解释）。
3. **meta 行分层**：状态 / provider·项目 / tags 三类信息不该共用同一种胶囊几何（M1/M2/M3 三方案）。
4. **卡片脱离面板底色 + 间距/字号分级**：现状卡内六行 `gap:6px`、9–12px 字号混排、transparent 底与面板同色。

原型左列固定「现状」，右列可切 **A 宽松 / B 内容井 / C +状态左轨** × **meta M1/M2/M3**；列宽可切 **220/280/360**
（真实看板 `grid-auto-columns: minmax(220px, 1fr)`），暗/亮双主题；页内 `measure-line` 实时显示每列三张卡的
`getBoundingClientRect().height`。直链定态：`?variant=a|b|c&meta=m1|m2|m3&w=220|280|360&theme=dark|light`。

**主题对齐声明**：所有颜色 token 从 `frontend/app/theme.scss` 原样搬运（暗 `rgb(34,34,34)` 底/绿 accent，
亮 `#f2eee5` 底/紫 accent，working `#3b82f6` / blocked `--warning-color` / done `rgb(78,154,6)`）；
chip/胶囊/度量轨几何从 `session-overview.scss` / `property-list.scss` / `agent-status-chip.scss` 搬运。

## 议题 1：`emoji` 属性整条不渲染（已拍板）

真机截图：卡片头 🐚 头像 + 属性行 `emoji 🐚` —— 同一信息出现两次。

- **方案**：`resolveBoardPropRows` 的 `BoardBuiltinPropKeys` 增加 `"emoji"`（注释写明「卡面头像已表达，
  属性行不重复」）。看板卡与列表行 `RowMetaChips` 共用该函数，自动两处一致。
- **不受影响**：aisessions 属性面板（`property-list`）继续显示/编辑 `emoji` 属性 —— 只隐藏卡面上的重复行。
- 原型对照：左列（现状）保留 `emoji 🦊` 行，右列（方案）无。

## 议题 2：属性行其余类型去名字前缀

| 属性类型 | 现状 | 方案 | 规则 |
|---|---|---|---|
| `select` / `status` 单值 | `Status` + 色胶囊 | 仅色胶囊 | Notion 色胶囊自解释 |
| `person` / `multi_select` | 名字 + chips | 仅 chips | chips 自解释 |
| `text` / `number` / `url` | 名字 + 值 | **不变** | 纯文本值不自解释 |
| `checkbox` | 名字 + ✓ | **不变** | 值只有 ✓ |

名字降级进 `title="name: value"`，hover 与无障碍不丢。实现：`BoardPropRow` 增派生字段 `hideName`
（select/status/person/multi_select → true），`overview-board.tsx` 与 `session-overview.tsx`（`RowMetaChips`）两处共读。

## 议题 3：meta 行分层（M1 / M2 / M3）

真机问题：状态胶囊 / provider / 项目 / tags **共用同一种胶囊几何**（16px 高、9–10px 字、`radius:999`），
四者大小相近、无轻重，扫读时互相冒充；而它们其实是三类不同信息：

| 元素 | 语义 | 层级 |
|---|---|---|
| `.status-chip`（`Working 12m`） | 现在在干什么 | 最高 |
| `.board-chip`（`codex` / `snorkeling`） | 在哪（provider + 项目坐标） | 中 |
| `.board-chip.is-tag`（`#frontend`） | 归类标记 | 最低 |

方案：**只保留一个真胶囊（状态），归属降成排版文字，标签再降一档。** 原型「meta 行」控件可切三变体：

| 变体 | 状态 | provider / 项目 | tags |
|---|---|---|---|
| **M4 图标化**（推荐） | 着色胶囊（唯一胶囊/唯一彩色信号） | agent 类型 = 品牌标（`getAgentLogoByProvider` 同源，品牌色只上图标）+ 名称；项目 = folder 图标 + 名称 | 迷你小方片（radius 4、底色 main/6%、`#` 前缀 50% 透明） |
| **M1 文本** | 着色胶囊 | `codex · snorkeling` 纯文本 9.5px secondary + 中点 | `#tag` 纯文本、opacity .82 |
| **M2 描边** | 着色胶囊 | provider 描边胶囊（无底）+ 项目文本 | 纯文本 |
| **M3 右对齐** | 着色胶囊 | 同 M1 | 推到行尾 + 1px 竖线（位置稳定） |

- **M4 的形状词汇**（推荐）：`状态胶囊`（唯一彩色，点 + 时长）｜`品牌标 + 名称`（codex `#74a7cb` / opencode `#e0b956` / pi `#888888`，
  `agent-logo.tsx` 同源）｜`folder 图标 + 项目名`（全 app 的 `fa-folder` 词汇）｜`迷你方片`（tags，radius 4、无描边）。
  组间 gap 7px、组内 3px —— 分组靠间距，不靠分隔符。
- 品牌色只打在图标上、文字用 secondary：状态色仍是全行**唯一**彩色信号，不会出现两个彩色通道抢注意力。
- 保守做法（不动结构，只换渲染）：`.session-overview-board-chip` 去底色胶囊、保留 tags 胶囊但降透明度。
- 卡高影响 ≤ 2px；220px 窄列下 M1/M3 的 tags 可能换行到第二行（+13px），M2 因 provider 仍是胶囊更早换行。
- 已确认：`resolveBoardMetaLabel` 有状态 chip 时 `kindLabel` 返回 `""`，所以 agent 卡本来就不显示 `Agent` 视图标签
  （第一版原型多画了这个胶囊，已修）。

## 议题 4：卡面层次（间距 + 字号分级）

### 现状问题

- 卡片 `background: transparent` 与 `--panel-bg-color` 同色，只靠 1px 边框撑轮廓。
- 卡内六行 `gap: 6px` 平铺、9–12px 混排，视觉权重接近；「过于紧凑、层次不清」（用户 2026-11-22 反馈）。

### 方案刻度（A 宽松 = 基础档）

| 位置 | 现状 | 方案 |
|---|---|---|
| 卡内 padding | 10px | **13px** |
| 段间 gap（head/meta/正文/脚注） | 6px | **10px** |
| 正文内 gap（preview/note/props） | — | 6px |
| 标题 | 12px/600 | **13px**/600（卡内唯一 13px 行） |
| preview | 11px/1.4 | **11.5px/1.55** |
| note | 10px | 10.5px + opacity .78（附注降一档） |
| 属性行 | 10px | 10px + margin-top 1px + opacity .92（最弱档） |
| 脚注分割线 | `main/8%` + pt 6 | `main/10%` + **pt 9**（一段空气 + 一条线） |
| 度量轨 | 10px | 9.5px + opacity .85 |

**层次四级**：① 标题（13px 唯一大字）→ ② 状态/meta chip 行（16px 高胶囊）→ ③ 正文（11.5px secondary）→
④ 脚注（9.5px + 分割线）。字号只动标题与正文两档，chip 行不动（真实几何来自 `agent-status-chip.scss`，别改）。

### 三个变体

| 变体 | 内容 | 卡高代价（280px 列） |
|---|---|---|
| **A 宽松** | 上表刻度 + 卡面浮起（暗 `--surface-strong-color` 白 8% / 亮 `--surface-color`）+ hover 抬 1px | +30~33px/卡 |
| **B 内容井** | A + 正文区 `--surface-soft-color` 底 + 8/9px 内边距 + 圆角 7px，正文从 chip 行里独立出来 | 再 +16px/卡 |
| **C 左轨** | B + 3px 状态色左轨（滚动后列头不可见时单卡自证状态；与卡头状态 chip 双通道重复） | 同 B |

### 实测卡高（上/中/下三张卡，暗色，页面内 `measure-line` 实测）

| 列宽 | 现状 | A | B |
|---|---|---|---|
| **220px（真实最窄）** | 195/181/160 | 235/217/196（**+36~40**） | — |
| **280px** | 176/162/142 | 209/192/171（+30~33） | 219/202/180（+43~46） |
| 360px | — | 同比例 | — |

代价说明：A 在 220px 真实列宽下每卡 +36~40px（约 +20%），一屏少看 1 张卡。若嫌高，可出一档
「折中」（padding 11 / gap 8 / preview 11/1.5，约 +20px）—— 原型尚未做，拍板后 5 分钟加上。

### 事实备注

`.session-metrics` 本身已有 `border-top: main/8%` + `padding-top: 6px` —— 度量分割线不是新增项，
方案只是加宽一档（8%→10%）并把脚注上方留白加大。

## 落地清单（进 Trellis 任务后执行）

1. `overview-board-model.ts`：
   - `BoardBuiltinPropKeys` 增 `"emoji"`（卡面去重）；
   - `BoardPropRow` 增 `hideName?: boolean` 派生字段；
   - 单测：emoji 被滤；select/status/person/multi → hideName true；text/number/checkbox → false；
     emoji 整条不出现；hideName 行 `title` 仍含属性名。
2. `overview-board.tsx` + `session-overview.tsx`（`RowMetaChips`）：`hideName` 时跳过 `.prop-name`。
2b. meta 行分层（若拍板 M4）：`overview-board.tsx` 的 meta 组装改为三簇 ——
    `provider` 用 `getAgentLogoByProvider()` 的品牌标 + 名称（图标上品牌色、文字 secondary），
    `project` 用 folder 图标 + 名称，`tags` 换成迷你方片（radius 4、底色 main/6%）；
    `session-overview.scss` 加 `.session-overview-board-meta-group/.meta-agent/.meta-folder/.meta-tag-mini`；
    单测断言「有状态 chip 时无 kindLabel、meta 行彩色只来自状态 chip」。
3. `session-overview.scss`：
   - `.session-overview-board-card` 表面底色 + 微阴影 + hover 抬升（暗/亮/单色三主题验证）；
   - 间距/字号刻度按上表（padding 13 / gap 10 / 标题 13 / preview 11.5/1.55 / note 10.5/.78 / 度量 9.5）；
   - 若拍板 B：正文分组 `.card-body` + `--surface-soft-color` 内容井。
4. 验证（`scripts/verify/overview-board` 扩断言）：
   - emoji 属性行不渲染（`data-board-prop="emoji"` 不存在）；
   - `hideName` 行无 `.prop-name` 节点、`title` 含属性名；
   - 卡片底色与面板可区分（暗/亮各一次，防回退 transparent）；
   - 卡高漂移符合预期档位（±2px 内）。

## 待拍板

1. **meta 行**：M4 图标化（推荐）/ M1 文本 / M2 描边 / M3 右对齐？
   若只挑 tags 形态：迷你方片（M4）/ 无底纯文本（M1）/ 保留胶囊（保守）。
2. **密度档位**：A（+36~40px/卡 @220px）还是折中档（+20px，原型待补）？
3. **B 内容井**：要 / 不要（+16px/卡，层次最强）？
4. **C 状态左轨**：不做 / 设置项 / 下一轮（与卡头状态 chip 双通道重复）？
5. 卡面暗色档位：`--surface-strong-color`（白 8%，本原型）还是 `--surface-color`（白 6%，更克制）？
