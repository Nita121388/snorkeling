# 设计：observe → oracle → loop 三层可判定验证台

## 1. 总体结构

```
scripts/verify/preview-edit/
  run.mjs                 CLI 入口（唯一的对外契约）
  lib/cdp.mjs             CDP 客户端（ws，evaluate/screenshot/input）
  lib/launch.mjs          verify 实例的 launch / attach / health-check
  lib/open.mjs            把 fixture 打开成 preview block（三级策略链）
  lib/observe.mjs         三态观察：before → during → afterEsc，产出 observation
  lib/oracle.mjs          规则加载器 + 断言器（rules/*.mjs）
  lib/pixel.mjs           pngjs：裁切、墨迹剖面、diff 图
  rules/0X-*.mjs          每条规则一个文件（可单独启用/禁用）
  cases/*.json            声明式用例
fixtures/verify/preview-edit/*.md
```

对外只有一个命令：

```
node scripts/verify/preview-edit/run.mjs [--attach] [--expect=fixed|broken] [--case=id]
                                        [--legacy-css] [--against=<report.json>] [--json]
```

## 2. L0 环境层

| 关注点 | 方案 |
|---|---|
| 实例隔离 | `dev-isolated --profile verify --vite-port 51799 --cdp-port 9231`，`.runcfg/verify/**` 与用户实例完全分离 |
| 冷启动 | `launch.mjs` spawn 分离进程；轮询 `http://127.0.0.1:9231/json/list` 找到 `type=page && url ~ /index.html` |
| 就绪判定 | `document.readyState==='complete'` **且** `document.fonts.status==='loaded'` **且** `!!document.querySelector('.markdown-render-root, .workspace .block')` |
| 热复用 | `--attach` 跳过 spawn，直接连 9231（循环迭代主力路径，单轮 <10s） |
| 固定观感 | `--force-device-scale-factor=1`；注入 `*{transition:none!important;animation:none!important;caret-color:transparent!important}` |
| 清理 | `launch.mjs` 记录自己 spawn 的 PID，结束/失败时只按 PID 结束（绝不按进程名批量杀） |

**已知限制（写进代码注释）**：布局存在 DB（`pkg/wcore/layout.go`），没有 `wave.lay` 文件可预置，
所以"启动即就位"不可行，必须走 `open.mjs`。

## 3. 打开 fixture：三级策略链

`open.mjs` 依次尝试，第一个成功就停，并记录 `openedBy`：

1. **`rpc`**（首选）：CDP evaluate → 动态 `import()` vite dev 服务器上的 app 模块，
   调 app 自己的建块逻辑，`BlockDef = { meta: { view: "preview", file: <abs> } }` 插到当前 tab。
   模块 URL 由 `location.origin` + `/app/store/...` 推导；导出名做候选探测（避免硬耦合单一函数名）。
2. **`argv`**：spawn 时把 fixture 绝对路径作为额外参数（`emain/emain-open.ts` 的
   `extractOpenPathsFromArgv` 会把路径开成 preview block）。
3. **`ui`**：真实点击文件树（真实指针），逐级展开到 fixture。

任一策略成功后都**必须**通过健康检查：`.markdown-render-root` 出现 **且** 其内文字包含 fixture 的
哨兵字符串（fixture 第一行固定写 `<!-- verify-fixture:v1 -->` 之外的可读哨兵），避免"打开了但内容不对"。

## 4. L1 观察层：observation 契约

一次 `observe(case)` 产出（这是 oracle 的唯一输入，也是 report 的证据）：

```js
{
  caseId, openedBy, viewport: {w,h,dpr},
  target: { tag, cls, rect:{x,y,w,h}, textInk:{x,y}, scrollHeight },
  during: {
    overlay: { rect:{...}, scrollHeight, clientHeight, overflowY, contain, zIndex },
    editorRoot: { paddingLeft, whiteSpace, tag, cls },
    firstList: { marginLeft, paddingLeft, listStyleType },
    firstLi: { paddingLeft, marginTop, position },
    marker: { content, width, position, rect },        // el::before via getComputedStyle + Range 近似 rect
    textInk: { x, y },
    inlineEditLog: [ {msg, t, details} ... ],           // window.__inlineEditLog
  },
  afterEsc: { overlayGone, hiddenLeft, activeLeft, rect:{...} },
  images: { before, during, afterEsc, crop: {x,y,w,h} },
}
```

**为什么 `textInk` 用 Range 而不是元素盒子**：上一轮踩过——折叠式列表项的序号是
`::before` 内联绘制的，盒子法会差一个序号宽度（实测 13px）。

**手势**：`open` 阶段用 CDP `Input.dispatchMouseEvent` 发 `mousePressed/mouseReleased` **两次**（真双击），
坐标取目标行文本的墨迹中心。禁用合成事件——这是上一轮的第二个洞。

## 5. L2 判定层：三层 oracle

### 5.1 不变量规则（`rules/*.mjs`，硬门禁）

| rule id | 断言 | 覆盖的失效模式 |
|---|---|---|
| `text-zero-shift` | `|Δx| ≤ 1 && |Δy| ≤ 1`（DOM Range 墨迹） | 文字跳位 |
| `pixel-zero-shift` | 逐文本行比较"最左墨迹 x"，`|Δ| ≤ 1.5px` | DOM 数字对但渲染错位（AA/子像素/transform） |
| `no-clip` | `overlay.scrollHeight ≤ clientHeight+1` **且** 所有子元素 rect ⊆ overlay padding box | 内容被截断 |
| `single-level-indent` | 首层 `ul/ol` 的 `marginLeft==='0px' && paddingLeft==='0px'` | 缩进叠层 |
| `marker-drawn` | `::before.content !== 'none'`、`width>0`、`position==='absolute'`、rect 落在 overlay 内 | marker 丢失/被裁 |
| `clean-exit` | Esc 后 overlay 消失、`inline-edit-hidden/active` 残留 0、块 rect 复原（±0.5px） | 退出残留/高度塌陷 |
| `no-measure-loop` | `__inlineEditLog` 中同一 session 的 `measure` 事件计数 ≤ N 且无 `target lost` | 重测量抖动 |

每条 rule 是纯函数：`({observation, options}) => {pass, detail, evidence}`。

### 5.2 像素 oracle（`pixel-zero-shift` 的实现，**不需要人给基准**）

核心洞察：**预览编辑的契约是"零布局位移"，所以"编辑前的渲染态"就是"编辑中的编辑器"的基准。**

```
1. 取 crop = target.rect 外扩（左 40 / 上 24 / 右 8 / 下 24）
2. before.png / during.png 用同一 crop、同坐标裁切（pngjs）
3. 对 crop 内每一行像素带（按行扫描，连续非背景行聚成一个"文本行"）：
     inkLeft(line) = 该行带内第一个"非背景"像素的 x
4. 断言：每个文本行的 |inkLeft_before - inkLeft_during| ≤ 1.5
5. 断言：during 的文本行带数量 >= before（缺行 = 被裁）
```

优点：只测"文字起点"这一个与 bug 直接相关的量，对字体抗锯齿、颜色、光标闪烁完全不敏感，
**不需要 golden baseline**，因此 agent 可以自判而无需人工审批。

### 5.3 语义 oracle（软告警，非门禁）

可选 `--vlm`：把 `before|during|diff` 图交给视觉模型，要求返回
`{verdict, reason}`。只写进 report 的 `warnings`，不影响退出码。

## 6. L3 循环层

- 每次运行产出独立目录 `verify-runs/<ISO-ts>/`：`report.json`、`report.md`、所有 png。
- `--against=<path>`：与上一份 report 做差，输出 `fixed[]` / `newFailures[]` / `stillFailing[]`。
  **收敛判据**：`newFailures.length === 0 && failing.length` 单调减。
- `--expect=fixed|broken`：把"预期"写进退出码。
  - `--expect=broken --legacy-css`：注入旧实现的 CSS 覆盖（上一轮用过的对照手段），必须 fail。
  - M2 追加 `--legacy-worktree`：`git worktree add` 到修复前 commit，跑真旧代码，作为验收证据。
- 循环协议写进 skill（见 `implement.md` 的"loop 协议"一节），不在代码里 while 循环——
  由 agent 主持循环，脚本只负责"单轮判定"。

## 7. case 声明式格式

```json
{
  "id": "ordered-li-multiline",
  "fixture": "list-forms.md",
  "theme": "dark",
  "target": { "selector": "ol > li:nth-child(2)", "within": ".markdown-render-root" },
  "action": { "type": "dblclick", "at": "text-first-line" },
  "rules": ["text-zero-shift", "pixel-zero-shift", "no-clip", "single-level-indent",
            "marker-drawn", "clean-exit", "no-measure-loop"],
  "expectEditor": "wysiwyg"
}
```

`expectEditor: "textarea"` 用来锁"折叠项必须回退 textarea"这类数据安全契约。

## 8. 与既有代码的边界

- **零侵入**：不改 `markdown-inline-edit.tsx` / `markdown.scss`（本任务只新增脚本与 fixture）。
  唯一例外：若需要更细的 `__inlineEditLog` 事件，可加事件（向后兼容）。
- 复用 `scripts/inspect-electron-ui.mjs` 的 CDP 连接范式，但**不 import 它**（它是 CLI，
  内部函数未导出）；`lib/cdp.mjs` 单独实现一份最小客户端（ws 已在 deps）。
- `pngjs` 已在 deps，不新增依赖。

## 9. 回滚

纯新增文件 + `Taskfile.yml` 一行任务 + 一份 spec，回滚 = 删目录 + 撤那一行。
