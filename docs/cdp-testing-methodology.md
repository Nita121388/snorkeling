# CDP 实测方法论（Snorkeling）

> 用 CDP（Chrome DevTools Protocol）对运行中的 Wave 应用做**真实行为验证**的方法论。
> 适用于：UI 布局/交互、Agent 块行为、数据流、前端 atom 状态等"单测测不到、静态读代码猜不准"的问题。
> 本文由 2026-08-12 Pi agent 顶部栏排查会话沉淀（详见 Obsidian 开发记录同日条目）。

## 1. 环境与启动

```bash
# 启动带 CDP 的 dev 实例（profile=cdp, Vite 51742, CDP 9222）
nohup npm run dev:cdp > /tmp/snorkeling-dev-cdp.log 2>&1 &
# 等待就绪（Go 后端编译 + Electron 启动，通常 1-2 分钟）
for i in $(seq 1 40); do
  curl -s --max-time 2 http://127.0.0.1:9222/json/list | grep -q 'Wave Terminal - T2' && break
  sleep 5
done
# 查看所有 target（title 含 "Wave Terminal - T2" 的是主 UI；裸 "Wave Terminal" 是备用空窗口，viewport 0x0）
curl -s http://127.0.0.1:9222/json/list | python3 -c "import json,sys; [print(t.get('title')) for t in json.load(sys.stdin)]"
```

- 工具：`node scripts/inspect-electron-ui.mjs [--target "Wave Terminal - T2"] <command>`
- 命令：`state` / `elements` / `style <query>` / `click <x> <y>` / `screenshot [path]` / `eval <js>`
- `eval` 支持 **async IIFE**（`awaitPromise: true`）：`(async () => { ... })()`
- 改 Go 代码后必须**重启 dev**（wavesrv 是编译二进制，不热重载）；前端改动能 HMR
- 频繁 eval / reload / 创建删除后前端状态可能污染（见 §5 常见坑），必要时重启 dev 以干净实例为准

## 2. 创建真实 Agent block 并验证后端

```js
// eval:创建 claude/pi agent block（等价于 launcher 的 blockDef 产物）
const uiCtx = window.globalStore.get(window.globalAtoms.uiContext);
const tabId = uiCtx.activetabid;                    // 注意字段名是小写 activetabid
const blockDef = { meta: {
  view: "term", controller: "cmd", cmd: "pi",       // 或 "claude"
  "cmd:shell": false, "cmd:runonstart": true, "cmd:jwt": true,
  "agent:autoresume": true, "agent:provider": "pi",
}};
const r = await window.RpcApi.CreateBlockCommand(window.TabRpcClient, {
  tabid: tabId, blockdef: blockDef, rtopts: { termsize: { rows: 25, cols: 80 } }, focused: true });
// r = "block:<blockid>"

// 删除
await window.RpcApi.DeleteBlockCommand(window.TabRpcClient, { blockid: "<blockid>" });
// 注意:DeleteBlockCommand 参数是 { blockid } 对象，不是字符串
```

后端状态验证：

```js
// 查 block meta（mint 的 sessionid 等）
await window.RpcApi.BlockInfoCommand(window.TabRpcClient, "<blockid>");
```

```bash
# 后端日志：persist / 事件广播 / controller 状态
grep '<blockid>' .runcfg/cdp/data/waveapp.log | grep -E 'ps-persist|ps-publish|run\(\)'
# 读 block 的 term 文件（关键!验证进程实际收到什么参数/输出）
sqlite3 .runcfg/cdp/data/db/filestore.db \
  "SELECT data FROM db_file_data WHERE zoneid='<blockid>' AND name='term'"
```

**重要坑**：macOS 的 `ps` 对 `shell -c` 启动的进程**不显示真实 argv**（会显示成裸命令名）。
验证进程参数要靠**进程输出**（term 文件），不是 `ps`。例：pi 收到 `--session-id <uuid>` 时
term 第一行是 `Warning: No project session found with id '<uuid>'; creating a new session with that id`。

## 3. 前端 atom 状态验证

```js
// 遍历已挂载的 jotai atom，找某个 block 的前端状态
const s = window.globalStore;
const m = s.dev4_get_mounted_atoms();
for (const a of m.keys()) {
  try {
    const v = s.get(a); const val = v && v.value;
    if (val && val.oid === "<blockid>") {
      return JSON.stringify({ ver: val.version, sid: val.meta?.["agent:sessionid"] });
    }
  } catch(e){}
}
```

用途：
- **前端 atom 版本 vs 后端版本对比**——前端停在旧版本 = 更新事件没到/被覆盖（订阅竞态排查）
- 检查 `agent:sessionid` 是否已进前端状态（决定 TermSessionTopBar 是否渲染）

前端 UI 验证：

```js
// TopBar / Note / Outline 渲染状态
document.querySelectorAll(".term-session-topbar").length
document.querySelector(".term-session-note-editor")?.textContent
document.querySelector(".term-session-outline")?.textContent
```

## 4. WPS 订阅与事件流排查

- 前端全局订阅 `waveobj:update` 在 `initGlobalWaveEventSubs`（frontend/app/store/global.ts）
- 订阅注册在后端 `wps.Broker.Subscribe`（routeId = `tab:<tabid>`）
- 排查事件是否到达前端：
  1. 看后端日志 `[ps-publish] event=waveobj:update ... client=true`（广播）——client=true 只说明有订阅者
  2. **手动重新订阅**可验证/修复前端订阅状态：
     ```js
     await window.RpcApi.EventSubCommand(window.TabRpcClient,
       { event: "waveobj:update", scopes: [], allscopes: true });
     ```
  3. 若手动订阅后事件能到 = 前端订阅状态异常（偶发，页面 reload 后可能丢失）
- 前端有两条更新通道：**HTTP 响应携带 updates**（`callBackendService` 响应、前端主动请求如 SetMeta）和 **WPS 推送**（后端主动，如 persist）。后者依赖订阅，前者不依赖——两者时序竞态曾导致旧快照覆盖新状态（wos.ts 已加 version guard 防御）

## 5. 常见坑清单

| 坑 | 说明 |
| --- | --- |
| `ps` 显示 argv 误导 | macOS 对 `shell -c` 进程不显示真实参数，看进程输出 |
| `querySelector(".block-xxx")` 不匹配 | 类名是 `block-<完整uuid>`，前缀选择器无效，用完整 uuid |
| `DeleteBlockCommand` 参数 | 是 `{ blockid }` 对象，不是字符串 |
| `uiContext` 字段名 | 是 `activetabid`（小写），不是 `ActiveTabId` |
| 频繁 reload/创建删除污染前端 | 表现为订阅丢失、atom 停在旧版本、block 不在 DOM；重启 dev 用干净实例确认 |
| `location.reload()` 后状态 | reload 后 WPS 订阅可能不重建（旧实例实测），遇异常先手动 resubscribe 或重启 |
| block 不在 DOM 但后端存在 | 检查 layout：`getLayoutModelForStaticTab()` 的 `treeState.leafOrder`；前端没插入节点则 TerminalView 不挂载 |
| 环境变量 | web endpoint 在 `.runcfg/cdp/data/waveapp.log` 启动行（`Server [web] listening on 127.0.0.1:<port>`），HTTP 直调 service 用这个端口 |

## 6. 本次沉淀的可复用结论（Agent 相关）

- pi / claude 的 session 文件都在**第一条 assistant 回复**才创建（pi 源码 `session-manager.js` `_persist`/`openSync("wx")`；claude 用 pty 实验验证）——启动后不输入就没有文件
- 因此后端 mint 的 `agent:sessionid` 在启动即有，但 Note/Outline 按 id 查文件会失败 → 前端必须**加载失败自动重试**
- `--session-id` 注入是后端 mint 方案的承重梁：pi 的 `--session-id <id>` 语义为 "creating it if missing"（与 claude 一致）
- 磁盘扫描（codex 式）对 pi 不可行：pi 文件延迟创建，扫描时序无法保证
