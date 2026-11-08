# 真机 UI 验证台 Playbook

> 面向"改完 UI 要能机器判定对不对"的场景。首个完整实例：
> `scripts/verify/preview-edit/`（几何/像素 oracle）、`scripts/verify/agent-card-seen/`（状态跨面）。
> 项目级硬约束见 `.trellis/spec/snorkeling-docs/frontend/quality-guidelines.md` 的同名章节。

---

## 1. 什么情况下必须上真机台

满足任意两条就别指望单测：

- 判据是"看起来对不对"（颜色、灰化、动画、布局位移）；
- 结论依赖**多个展示面同时一致**（agent 状态、tab 圆点、卡片 pill…）；
- 依赖 hover / focus / 停留时长 / 二次点击这类**交互时序**；
- 需要真实后端事件驱动（agentstatus、fs 变更、会话同步）。

反例（不需要台子）：纯函数判定表、组件快照、props 传递。那些用 vitest 更快更稳。

---

## 2. 台子的骨架（照抄这两条命令）

```bash
node scripts/verify/agent-card-seen/verify.mjs --dry        # 只解析依赖，不启动 GUI（<1s 自检）
node scripts/verify/<area>/verify.mjs              # 起干净实例（reset profile）→ 跑 → 自动关
node scripts/verify/<area>/verify.mjs --attach     # 复用已起实例，单轮 <1min（迭代主力）
node scripts/verify/<area>/verify.mjs --keep-open  # 断言失败后留下来手工看
node scripts/verify/index.mjs [--strict] [--json]  # 索引 / 自查：每个 area 最近一次结论
```

**不要自己再拼一套**：`scripts/verify/lib/` 已经提供
`cdp`（连接/多 target 选择）、`launch`（实例生命周期）、`probes`（可见性 / 文本归一化 /
hoverUntil / 键盘输入 / 引导弹窗）、`report`（verdict + 台账 + 退出码）。新台子从
`scripts/verify/_template/verify.mjs` 复制。

必备四件产物：

| 产物 | 用途 |
|---|---|
| `verify-runs/<ts>-<area>/report.json` | 机器读：每条断言的 `id/ok/detail` + 步骤日志 + summary |
| `report.md` | 人读：断言表 + 状态轨迹 + 未覆盖项 + 截图索引 |
| 每步 png | 争议时唯一能自证的东西（`01-…` 前置态、`0N-…` 后置态） |
| 退出码 | `0` 全绿 / `1` 断言失败 / `2` 环境错误（起不来、连不上） |

---

## 3. 六条设计原则（都是踩出来的）

### P1 确定性优先：每轮 reset，别复用脏工作区

第一版直接接上一轮残留实例，结果"新建 block"实际上复用了**上一次的 agent block**，
读到的是上一轮的 Done —— 假绿。正确做法：

- 默认 `ensureInstance({ resetProfile: true })`；
- 需要"我刚刚创建的那个对象"时，用 **before/after 差集**取新 id，不要用
  "第一个匹配 selector 的元素"：

```js
const before = new Set(await evaluate(blockIdsProbe));
// …点 UI 创建…
const blockId = (await evaluate(blockIdsProbe)).find((id) => !before.has(id));
```

### P2 等状态跃迁，不要等终态

`waitFor(s => /^Done/.test(s))` 在"上一轮已经 Done"时会**立刻返回**，于是断言的是旧状态。
正确做法是先等"跑起来了"（working 系文案），再等终态，并把每次变化记成轨迹：

```js
const working = await waitForSurfaces(client, id, (s) => /^(Thinking|Working|Tool)/.test(s.header.text));
const done    = await waitForSurfaces(client, id, (s) => /^Done/.test(s.header.text));
// 轨迹 ["Thinking","Done Just now"] 进 report，失败时一眼看出卡在哪
```

### P3 断言读语义，不读颜色

颜色/字体/间距随主题变，且截图比对对字体抗锯齿敏感。跨面一致性这类问题，
**在 DOM 上为每个面留一个可读属性**，然后断言属性：

```jsx
<span className={cn("agent-card-status-chip", read === "unread" ? "is-unread" : "is-seen")}
      data-agent-read={read} />
```

断言 `data-agent-read === "seen"` + `classList.contains("is-seen")` +
文案正则 `/^Done$/`；**不要**去读 `getComputedStyle().color`。
（像素/几何 oracle 另一路，见 preview-edit 台的三层判据。）

### P4 探针要能自愈：hover/异步都有延迟

浮层有 hover intent 延迟（本项目 300~2000ms 不等）、React 异步渲染、后端事件回落。
一次 `mouseMoved` + 立刻读 DOM 会拿到空。统一写：

```js
async function hoverUntil(client, point, probe, ready, { tries = 14, waitMs = 700 }) {
    let last = null;
    for (let i = 0; i < tries; i++) {
        await client.move(point.x, point.y);
        await sleep(waitMs);
        last = await client.evaluate(probe);
        if (ready(last)) return last;
    }
    return last;
}
```

### P5 断言红了先怀疑断言本身

这次 21 条里 3 条红，全部是断言写错，不是代码错：

- `formatDoneElapsed()` 在 <30s 返回 **`"Just now"` 两个词**，我按 `Done 3m` 单段匹配；
- block 头部 `textContent` 前面有 **LRM（`\u200e`）**，`^Done` 直接匹配失败。

所以：断言里先归一化（`replace(/[\u200b-\u200f\ufeff]/g,"").trim()`），
文案断言优先用"前缀 + 非空"而不是"完整形状"。**别为了让它绿去改产品代码。**

### P6 台子要大声，且区分"环境坏"和"功能坏"

- 断言失败 → 继续跑完后面所有断言（一次拿全貌），最后 `exit 1`；
- 起不来/连不上 → `FATAL` 立即 `exit 2`，并**仍然写 report.json**（把 steps 落盘）；
- 每条断言把 `detail` 存成原始快照（class/text/attr），不要只存 `true/false`。

---

## 4. 环境纪律（用户窗口别乱开）

验证实例是**真的 Electron 窗口**，会抢焦点、会出现在任务栏：

1. `spawn(..., { detached: true, windowsHide: true })`；所有 `powershell` 辅助调用也要
   `windowsHide: true`（否则黑 console 一闪一闪）。
2. 关闭只走**端口 → PID**：`findPidByPort(cdpPort)` → `Stop-Process -Id <pid>`，
   绝不按进程名批量杀（pi/Electron 都是一堆同名进程）。
3. 默认跑完 `cleanup()`；只有 `--keep-open` 才留。**不要**不打招呼就批量起实例
   （一次会话里连起 5 个，用户会以为电脑中毒）。
4. **不要往页面里注入全局 CSS**（隐藏光标、禁动画）。曾经为了截图全局
   `caret-color: transparent` 没撤，用户在同一个窗口里点标题看不到光标。
   需要"稳定观感"就只在测量/截图瞬间加，并保证 finally 移除。

---

## 5. 工具链坏了先修工具，不要绕过

`scripts/verify/preview-edit/lib/cdp.mjs` 里有个未提交的 `move()` 带了 trailing comma，
整个文件的 **import 就 SyntaxError** —— 所有 verify 台当场全崩。当时的第一反应是
"自己写一份 CDP client"，那会变成第二套实现，长期维护成本更高。

做法：先 `node -e "import('...cdp.mjs')"` 确认模块能否加载，能省半小时；
公共能力只加在该 lib 里（本次加了 `connectWhere()` / 导出 `connectToTarget()`，
因为多 Tab renderer 没法靠"第一个 page target"选中）。

---

## 6. 共享内核的边界（搬迁时踩到）

内核**不能假设自己住在某个 area 目录下**。本次物理搬迁当场炸出一条隐藏耦合：
`oracle.mjs` 里写死 `rulesDir = path.join(here, "..", "rules")`——在
`preview-edit/lib/` 下恰好等于 `preview-edit/rules/`，一搬到 `verify/lib/` 就变成
`verify/rules/`（ENOENT，整个 area 直接 exit 2）。

规则：内核里凡是"某个 area 私有资源"的路径（rules / cases / fixtures / 截图基线），
一律**由调用方当参数传进来**；内核只保留"从 repoRoot 推出来的公共路径"。
搬迁的正确姿势：先搬文件 → `node -e import(...)` 逐个验模块能加载 →
跑一个**用满这条链**的 area（preview-edit 覆盖 observe/oracle/open/pixel）→ 再提交。

## 8. 五条 2026-11-05 新增的坑（overview-board v2 现场）

1. **断言要"播种数据"，不要靠实例碰巧有数据。**
   全新 profile 里往往只有一个 term 块 —— emoji 头像 / 会话标题 / 状态 chip 这些最关键的断言
   只能 skipped，等于没验。做法（overview-board 已落地）：`createBlock({ meta: { "agent:provider": "claude" } })`
   + `BlockService.ReportAgentStatus({ state: "working", ... })` 造一张真卡片，断言跑完再删块清场。
2. **persona / 外部 store 不能靠写 localStorage 生效。**
   同文档写 localStorage 不触发 `storage` 事件，已初始化的 store 不会重读 → emoji 断言永远看到 logo。
   必须调 store 的写入函数（`setAgentPersona("claude", "🦊")`）。
3. **`connect()` 可能挑到空白窗口。** 多窗口/多 target 场景下先 `waitForApp(client, 30000)`
   轮询 `.block` 存在再断言，否则整轮 20+ 条断言全打在空 DOM 上（报 `rows=undefined`）。
4. **自己起的实例要自己关。** 脚本 finally 里调 `instance.cleanup()`（`--keep-open` 才留），
   否则端口 9231 上累积旧实例，下一轮 attach 到的是上一轮的状态。
5. **并行开发会撞 scaffold。** 两个 agent 同时跑验证台启动器时，`run-task` 的
   `mv scaffold/node_modules scaffold/nm/node_modules` 会因竞争失败（exit 1，日志在
   `.cache/verify/launch-verify.log`）。撞见就等 20s 重试；长期解法是各自 worktree + 独立端口。

## 7. 沉淀位置

| 内容 | 落点 |
|---|---|
| 必须遵守的硬约束 + 会再踩的坑 | `.trellis/spec/snorkeling-docs/frontend/quality-guidelines.md`（同名章节） |
| 可复用的方法论（本文件） | `docs/project/ui-verify-playbook.md` |
| 某一次的具体证据 | `verify-runs/<ts>-<area>/`（gitignore；本地保留作为"当时真的这么显示"的凭证） |
| 跨机器可查的结论 | `docs/project/verify-ledger.md`（入库，每次跑完自动追加一行） |
| 索引 / 自查命令 | `node scripts/verify/index.mjs --strict`（任一 area 最近一次失败 → exit 1） |

## 踩坑记录（2026-11-06, overview 优化 1-4）

- **reload 后固定 sleep 不够**：`overview-board` 的「看板/分组跨 reload 持久化」三条断言长期红，
  根因不是持久化失效，而是 `location.reload()` 后固定等 6s，dev 模式下 renderer 重新引导 + workspace 回填
  常超 6s。改法：轮询 `{board:true, cards>0}` 直到成立（上限 60s）。**所有 reload 后的断言一律轮询，不要 sleep。**
- **复用实例会污染断言**：`--attach` 复用的实例里可能累积了 3 个 sessionoverview 块，
  `board-columns-all-five` / `group-select-present` 这类「全局 querySelector」断言会串。
  跑之前先按端口→PID 关掉旧实例，或用 `launch+reset`。
- **弹窗断言不能 scope 到面板**：`Modal` 通过 `createPortal` 挂到 `#main`，不在 overview block 内。
  测「点卡片开弹窗」时要查全局 `document.querySelector(".agent-dialog")`，且测完必须 `popModal()` 清栈，
  否则后续断言被遮罩层挡住。
- **播种的 `reportedAt` 要同时满足两个窗口**：甘特分段断言要求 `activeSince` 既落在条内、又距今
  < `AgentThinkStaleThresholdMs`（2 分钟，thinking 阶段）。条尾若停在 30 分钟前，这两个条件不可能同时成立
  —— 把条尾设成「刚刚」才能稳定切出两段。
- **verify 脚本里的模板字符串反引号**：在 ``client.evaluate(`...`)`` 的注释里写反引号会截断字符串，
  报 `SyntaxError: missing ) after argument list`。注释里描述类名用普通文本，不要用反引号。

## 踩坑记录（2026-11-08, agent Done 徽章 seen 样式统一）

- **冷启动时 Electron 可能先于 Vite 就绪 → 整页空壳，且不会自愈。** 现象：`dev-isolated` 的窗口先创建，
  Vite 51799 过了 ~3 分钟才 LISTEN；期间 renderer 拿不到模块，页面永远停在
  `document.body.className === "init"`、`readyState === "interactive"`、`.block` 数 0，
  应用自己 120s 后打一行 `initPromise timed out ... showing window for devtools`。
  这时 `launch.mjs` 的 420s 轮询 **一定超时**，`--attach` 也会在 `waitForReady`（要求 `document.fonts.status === "loaded"`
  且根节点存在）红掉，报「页面未就绪」而不是「实例没起来」—— 两者要分清，别当成脚本 bug。
  判断方法：`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:<vite>`，返回 `000` 就是 Vite 没起来；
  起来之后 `Page.reload` 也不一定救得回来（实测 body 直接变 null），正确做法是关掉实例重起一轮。
- **同一端口别同时开两轮。** 前一轮 `nohup ... &` 的实例还在冷启动、紧接着又跑一遍前台启动器，后者会因
  Electron 单实例锁提前退出，报「verify 启动器提前退出（exit=...）」；而端口其实是**前一轮**的。
  先用 `netstat -ano | grep :9231` 拿到 PID，确认是自己起的再 `taskkill //PID <pid> //T //F`。
- **纯样式一致性不必等真机。** 「同名 class 不同值」这类 bug（`is-acked` 在各面写了不同的四值）既不会
  被 TS 抓到、也不会被单帧 DOM 快照抓到，但可以直接**断言 SCSS 源码里的四值**：
  `frontend/app/agent-status/agent-status-seen-style.test.ts` 以 `block.scss` 的
  `.agent-status-header.is-acked` 为基准，检查 chip / Overview / Tab pill 是否写了同一套
  （dashed 边 + secondary/0.4 + main/0.04 底 + 0.7 透明度）。真机台负责行为，这条负责数值。
- **给 pill 加边框会改盒高。** `.tab-card-agent-pill` 原来无边框、`line-height: 17px`；
  要对齐头部的虚线边就必须 `border: 1px dashed`，此时 `line-height` 要降到 15px 才能保持 17px 总高，
  否则 Tab 悬浮卡的 agent 行会抖 2px。
