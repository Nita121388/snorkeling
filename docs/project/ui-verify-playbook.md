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

## 6. 沉淀位置

| 内容 | 落点 |
|---|---|
| 必须遵守的硬约束 + 会再踩的坑 | `.trellis/spec/snorkeling-docs/frontend/quality-guidelines.md`（同名章节） |
| 可复用的方法论（本文件） | `docs/project/ui-verify-playbook.md` |
| 某一次的具体证据 | `verify-runs/<ts>-<area>/`（gitignore；本地保留作为"当时真的这么显示"的凭证） |
| 跨机器可查的结论 | `docs/project/verify-ledger.md`（入库，每次跑完自动追加一行） |
| 索引 / 自查命令 | `node scripts/verify/index.mjs --strict`（任一 area 最近一次失败 → exit 1） |
